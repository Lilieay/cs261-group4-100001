const express = require('express');
const path = require('node:path');

const validId = value => /^[1-9]\d*$/.test(value)
  && Number.isSafeInteger(Number(value)) && Number(value) <= 2147483647;

function createApp({backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:8000'} = {}) {
  const app = express();
  app.disable('x-powered-by');

  async function proxy(req, res, upstreamPath, {body, multipart = false,
    accept = 'application/json', contentType, onResponse, errorMessage, errorCode, timeoutMs = 12000} = {}) {
    res.set('Cache-Control', 'no-store');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const base = new URL(backendUrl);
      if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Invalid backend protocol');
      const headers = {Accept: accept};
      if (req.get('authorization')) headers.Authorization = req.get('authorization');
      if (multipart || contentType) headers['Content-Type'] = contentType || req.get('content-type');
      else if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(new URL(upstreamPath, base), {
        method: req.method, headers, signal: controller.signal, cache: 'no-store', redirect: 'manual',
        ...(body === undefined ? {} : {body: multipart || contentType ? body : JSON.stringify(body)})
      });
      if (onResponse) return await onResponse(response);
      const text = await response.text();
      const challenge = response.status === 401 && response.headers.get('www-authenticate');
      if (challenge) res.set('WWW-Authenticate', challenge);
      if (response.headers.get('content-type')) res.set('Content-Type', response.headers.get('content-type'));
      return res.status(response.status).send(text);
    } catch (_) {
      if (errorCode) return res.status(502).json({error: {code: errorCode, message: errorMessage, fields: []}});
      return res.status(502).json({detail: errorMessage});
    } finally { clearTimeout(timer); }
  }

  app.use('/api/auth', express.json({limit: '8kb'}));
  for (const [method, route] of [['post', '/login'], ['get', '/status'], ['get', '/me'], ['post', '/logout']]) {
    app[method](`/api/auth${route}`, (req, res) => {
      res.set('Cache-Control', 'no-store');
      let body;
      if (route === '/login') {
        if (!req.body || typeof req.body.username !== 'string' || typeof req.body.password !== 'string') {
          return res.status(422).json({detail: 'กรุณากรอกข้อมูลเข้าสู่ระบบให้ครบ'});
        }
        body = {username: req.body.username, password: req.body.password};
      }
      return proxy(req, res, `/api/auth${route}`, {
        body, errorMessage: 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
        onResponse: async response => {
          if (!response.ok) {
            const status = response.status >= 400 && response.status <= 599 ? response.status : 502;
            return res.status(status).json({detail: 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'});
          }
          const payload = await response.json();
          const user = value => value && ({id: value.id, username: value.username,
            display_name: value.display_name, role: value.role});
          if (route === '/login') return res.status(response.status).json({message: 'เข้าสู่ระบบสำเร็จ',
            access_token: payload.access_token, token_type: payload.token_type, user: user(payload.user)});
          if (route === '/me') return res.status(response.status).json(user(payload));
          if (route === '/status') return res.status(response.status).json({logged_in: payload.logged_in, user: user(payload.user)});
          return res.status(response.status).json({message: 'ออกจากระบบสำเร็จ'});
        }
      });
    });
  }

  const savedItemError = (res, status, code, message) => res.status(status).json({
    error: {code, message, fields: []}
  });
  app.all(['/api/saved-guides', '/api/saved-guides/:guideId'], (req, res) => {
    res.set('Cache-Control', 'no-store');
    const id = req.params.guideId;
    if (!['GET', 'PUT', 'DELETE'].includes(req.method) || (!id && req.method !== 'GET')) {
      return res.status(405).json({detail: 'METHOD_NOT_ALLOWED'});
    }
    if (id !== undefined && !validId(id)) return res.status(422).json({detail: 'GUIDE_ID_INVALID'});
    if (Object.keys(req.query).length) return res.status(422).json({detail: 'QUERY_NOT_ALLOWED'});
    return proxy(req, res, `/api/saved-guides${id ? `/${id}` : ''}`, {
      errorMessage: 'ตรวจสอบรายการที่บันทึกไม่ได้ กรุณาลองใหม่'
    });
  });

  app.get(['/api/courses', '/api/courses/:courseId'], (req, res) => {
    res.set('Cache-Control', 'no-store');
    const id = req.params.courseId;
    if (id !== undefined && !validId(id)) {
      return res.status(422).json({error: {code: 'INVALID_PARAMETERS', message: 'Invalid course ID', fields: []}});
    }
    const query = new URLSearchParams();
    if (id === undefined) {
      for (const value of new URL(req.originalUrl, 'http://frontend').searchParams.getAll('search')) query.append('search', value);
    }
    const target = id === undefined ? `/courses${query.size ? `?${query}` : ''}` : `/courses/${id}`;
    return proxy(req, res, target, {errorMessage: 'ไม่สามารถเชื่อมต่อบริการรายวิชาได้ กรุณาลองใหม่อีกครั้ง'});
  });

  const summaryError = (res, status, code, message) => res.status(status).json({
    error: {code, message, fields: []}
  });
  const hasSummaryQuery = req => Boolean(new URL(req.originalUrl, 'http://frontend').search);
  const proxySummary = (req, res, target, options = {}) => proxy(req, res, target, {
    errorCode: 'UPSTREAM_UNAVAILABLE', errorMessage: 'เชื่อมต่อบริการสรุป PDF ไม่สำเร็จ', ...options
  });

  async function rejectUnusedParameters(req, res, next) {
    res.set('Cache-Control', 'no-store');
    const reject = () => summaryError(res, 422, 'INVALID_PARAMETERS', 'เส้นทางนี้ไม่รับ query หรือ body');
    if (hasSummaryQuery(req) || Number(req.get('content-length')) > 0) return reject();
    if (req.get('transfer-encoding')) {
      for await (const chunk of req.iterator({destroyOnReturn: false})) {
        if (chunk.length) {
          req.resume();
          return reject();
        }
      }
    }
    next();
  }

  const summaryMultipart = express.raw({type: 'multipart/form-data', limit: 16_000_000, inflate: false});
  function writeSummary(req, res) {
    res.set('Cache-Control', 'no-store');
    const id = req.params.summaryId;
    if (id !== undefined && (!validId(id) || hasSummaryQuery(req))) {
      return summaryError(res, 422, 'INVALID_PARAMETERS', 'ข้อมูลที่ใช้แก้ไขสรุปไม่ถูกต้อง');
    }
    if (!req.is('multipart/form-data')) {
      return summaryError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'กรุณาแนบไฟล์ PDF ผ่านแบบฟอร์ม');
    }
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      return summaryError(res, 422, 'INVALID_PARAMETERS', 'กรุณากรอกข้อมูลสรุป');
    }
    return proxySummary(req, res, id === undefined ? '/api/summaries' : `/api/summaries/${id}`, {
      body: req.body, multipart: true, timeoutMs: 120_000
    });
  }
  app.post('/api/summaries', summaryMultipart, writeSummary);
  app.put('/api/summaries/:summaryId', summaryMultipart, writeSummary);

  app.get('/api/my-summaries', rejectUnusedParameters, (req, res) => proxySummary(req, res, '/api/my-summaries'));

  app.delete('/api/summaries/:summaryId', rejectUnusedParameters, (req, res) => {
    const id = req.params.summaryId;
    if (!validId(id)) {
      return summaryError(res, 422, 'INVALID_PARAMETERS', 'ข้อมูลที่ใช้ลบสรุปไม่ถูกต้อง');
    }
    return proxySummary(req, res, `/api/summaries/${id}`);
  });

  app.get(['/api/courses/:courseId/summaries', '/api/summaries/:summaryId', '/api/summaries/:summaryId/file'], (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!validId(req.params.courseId ?? req.params.summaryId) || Object.keys(req.query).length) {
      return summaryError(res, 422, 'INVALID_PARAMETERS', 'ข้อมูลที่ใช้เปิดสรุปไม่ถูกต้อง');
    }
    const isFile = /\/file\/?$/i.test(req.path);
    const upstreamPath = req.params.courseId
      ? `/api/courses/${req.params.courseId}/summaries`
      : `/api/summaries/${req.params.summaryId}${isFile ? '/file' : ''}`;
    return proxySummary(req, res, upstreamPath, {
      ...(isFile && {
        timeoutMs: 120_000,
        accept: 'application/pdf, application/json',
        onResponse: async response => {
          const contentType = response.headers.get('content-type');
          if (!response.ok) {
            const body = await response.text();
            return res.type('json').status(response.status).send(body);
          }
          if (response.status !== 200 || contentType?.split(';')[0] !== 'application/pdf') {
            return summaryError(res, 502, 'INVALID_RESPONSE', 'บริการส่งไฟล์ PDF กลับมาไม่ถูกต้อง');
          }
          const bytes = Buffer.from(await response.arrayBuffer());
          res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="summary-${req.params.summaryId}.pdf"`,
            'X-Content-Type-Options': 'nosniff'
          });
          return res.end(bytes);
        }
      })
    });
  });

  app.get('/api/my-guides', (req, res) => proxy(req, res, '/api/my-guides', {
    errorMessage: 'ไม่สามารถโหลดรายการแนวข้อสอบได้ กรุณาลองใหม่อีกครั้ง'
  }));

  app.put('/api/my-guides/:guideId', express.json({limit: '16kb'}), (req, res) => {
    res.set('Cache-Control', 'no-store');
    const id = req.params.guideId;
    if (!validId(id)) return res.status(422).json({detail: 'GUIDE_ID_INVALID'});
    if (!isJsonObject(req)) return res.status(400).json({detail: 'ข้อมูลแก้ไขไม่ถูกต้อง'});
    return proxy(req, res, `/api/my-guides/${id}`, {
      body: req.body, errorMessage: 'ยืนยันผลการแก้ไขไม่ได้ กรุณาโหลดรายการใหม่เพื่อตรวจสอบ'
    });
  });

  app.delete('/api/my-guides/:guideId', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const id = req.params.guideId;
    if (!validId(id)) return res.status(422).json({detail: 'GUIDE_ID_INVALID'});
    return proxy(req, res, `/api/my-guides/${id}`, {
      errorMessage: 'ยืนยันผลการลบไม่ได้ กรุณาโหลดรายการใหม่เพื่อตรวจสอบ'
    });
  });

  const reviewPaths = ['/api/guides/:guide_id/reviews', '/api/summaries/:summary_id/reviews', '/api/reviews/:review_id'];
  function reviewError(res, status, code, message, fields = []) {
    return res.set('Cache-Control', 'no-store').status(status).json({error: {code, message, fields}});
  }
  const reviewBody = express.raw({type: () => true, limit: 32768, inflate: false});
  app.all(reviewPaths, (req, res, next) => {
    const methods = req.params.review_id === undefined ? ['GET', 'POST'] : ['PUT', 'DELETE'];
    if (!methods.includes(req.method)) {
      res.set('Allow', methods.join(', '));
      return reviewError(res, 405, 'METHOD_NOT_ALLOWED', 'ไม่รองรับคำขอนี้');
    }
    if (!/^Bearer\s+\S+$/i.test(req.get('authorization') || '')) {
      res.set('WWW-Authenticate', 'Bearer');
      return reviewError(res, 401, 'AUTH_REQUIRED', 'กรุณาเข้าสู่ระบบ');
    }
    reviewBody(req, res, next);
  }, (req, res) => {
    const [field, id] = Object.entries(req.params)[0];
    // A non-numeric segment still fails backend validation, without URL normalization.
    const segment = /^[0-9]+$/.test(id) ? id : 'invalid';
    const collection = field === 'guide_id' ? 'guides' : 'summaries';
    const route = field === 'review_id' ? `/api/reviews/${segment}` : `/api/${collection}/${segment}/reviews`;
    const query = new URL(req.originalUrl, 'http://frontend').search;
    const write = req.method === 'POST' || req.method === 'PUT';
    if (req.method === 'GET' && req.body?.length) {
      return reviewError(res, 422, 'INVALID_PARAMETERS', 'เส้นทางนี้ไม่รับ body', [{field: 'body', message: 'ไม่รับ body'}]);
    }
    return proxy(req, res, route + query, {
      ...((write || req.body?.length) && {body: req.body, contentType: req.get('content-type') || 'application/octet-stream'}),
      errorCode: 'UPSTREAM_UNAVAILABLE', errorMessage: 'เชื่อมต่อบริการรีวิวไม่สำเร็จ'
    });
  });
  app.use(reviewPaths, (error, req, res, next) => {
    if (error.status === 413) return reviewError(res, 413, 'REQUEST_TOO_LARGE', 'คำขอมีขนาดเกินกำหนด');
    if (error.status === 415) return reviewError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'รูปแบบคำขอไม่ถูกต้อง');
    return reviewError(res, 400, 'MALFORMED_REQUEST', 'ข้อมูลคำขอไม่ถูกต้อง');
  });
  app.all(/^\/api\/(?:reviews|(?:guides|summaries)\/[^/]+\/reviews)(?:\/|$)/i, (req, res) => {
    return reviewError(res, 404, 'ROUTE_NOT_FOUND', 'ไม่พบเส้นทางรีวิว');
  });

  app.all(['/api/saved-items', '/api/saved-items/:type/:id'], (req, res, next) => {
    const methods = req.params.id === undefined ? ['GET'] : ['GET', 'PUT', 'DELETE'];
    if (!methods.includes(req.method)) {
      res.set('Allow', methods.join(', '));
      return res.set('Cache-Control', 'no-store').status(405).json({
        error: {code: 'METHOD_NOT_ALLOWED', message: 'ไม่รองรับคำขอนี้', fields: []}
      });
    }
    if (!/^Bearer\s+\S+$/i.test(req.get('authorization') || '')) {
      res.set({'Cache-Control': 'no-store', 'WWW-Authenticate': 'Bearer'});
      return res.status(401).json({error: {code: 'AUTH_REQUIRED', message: 'กรุณาเข้าสู่ระบบ', fields: []}});
    }
    return rejectUnusedParameters(req, res, next);
  }, (req, res) => {
    const {type, id} = req.params;
    const itemId = id?.replace(/^0+/, '');
    if (id !== undefined && (!['guide', 'summary'].includes(type) || !validId(itemId))) {
      return savedItemError(res, 422, 'INVALID_PARAMETERS', 'ข้อมูลรายการที่บันทึกไม่ถูกต้อง');
    }
    const target = id === undefined ? '/api/saved-items' : `/api/saved-items/${type}/${itemId}`;
    return proxy(req, res, target, {
      errorCode: 'UPSTREAM_UNAVAILABLE', errorMessage: 'เชื่อมต่อบริการรายการที่บันทึกไม่สำเร็จ'
    });
  });
  app.all(/^\/api\/saved-items(?:\/|$)/i, (req, res) => {
    return res.set('Cache-Control', 'no-store').status(404).json({
      error: {code: 'ROUTE_NOT_FOUND', message: 'ไม่พบเส้นทางรายการที่บันทึก', fields: []}
    });
  });

  // This route matches saved-item open_path. The legacy route is handled below.
  app.get('/api/guides/:guideId', rejectUnusedParameters, (req, res) => {
    if (!validId(req.params.guideId)) {
      return savedItemError(res, 422, 'INVALID_PARAMETERS', 'รหัสแนวข้อสอบไม่ถูกต้อง');
    }
    return proxy(req, res, `/guides/${req.params.guideId}`, {
      errorMessage: 'เปิดแนวข้อสอบไม่สำเร็จ', errorCode: 'UPSTREAM_UNAVAILABLE'
    });
  });

  app.use('/api/guides', express.json({limit: '16kb'}));
  app.post('/api/guides', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!isJsonObject(req)) return res.status(400).json({detail: 'ข้อมูลเผยแพร่ไม่ถูกต้อง'});
    return proxy(req, res, '/guides', {
      body: req.body, errorMessage: 'ไม่สามารถเผยแพร่แนวข้อสอบได้ กรุณาลองใหม่อีกครั้ง'
    });
  });

  app.get('/api/guides/*path', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const upstreamPath = Array.isArray(req.params.path) ? req.params.path.join('/') : req.params.path;
    const listPath = /^courses\/[1-9]\d*\/guides$/.test(upstreamPath);
    const allowedPath = listPath || /^courses\/[1-9]\d*\/guides\/filter-options$/.test(upstreamPath)
      || /^guides\/[1-9]\d*$/.test(upstreamPath);
    const query = new URL(req.originalUrl, 'http://frontend').searchParams;
    if (!allowedPath || (!listPath && query.size)) return res.status(404).json({detail: 'ไม่พบเส้นทางแนวข้อสอบ'});
    return proxy(req, res, `/${upstreamPath}${query.size ? `?${query}` : ''}`, {
      errorMessage: 'ไม่สามารถเชื่อมต่อบริการแนวข้อสอบได้ กรุณาลองใหม่อีกครั้ง'
    });
  });

  const publicRoot = path.join(__dirname, '../public');
  const pages = ['index', 'login', 'courses', 'choose-courses', 'read-courses',
    'shared-courses', 'saved-courses', 'upload', 'upload-summary', 'read-summary'];
  // Keep a single URL for each page even when opened through its folder path.
  app.get(pages.map(page => `/pages/${page}.html`), (req, res) => {
    res.redirect(302, req.originalUrl.replace(/^\/pages/, ''));
  });
  app.use(express.static(path.join(publicRoot, 'pages')));
  app.use(express.static(publicRoot));
  app.use((error, req, res, next) => {
    if (/^\/api\/summaries(?:\/[^/]+)?\/?$/i.test(req.path)) {
      res.set('Cache-Control', 'no-store');
      if (error.status === 413) return summaryError(res, 413, 'REQUEST_TOO_LARGE', 'ไฟล์ PDF ต้องมีขนาดไม่เกิน 15 MB');
      if (error.status === 415) return summaryError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'รูปแบบไฟล์อัปโหลดไม่ถูกต้อง');
      return summaryError(res, 400, 'INVALID_PARAMETERS', 'ข้อมูลอัปโหลดไม่ถูกต้อง');
    }
    if (req.path.startsWith('/api/auth') || req.path === '/api/guides' || req.path.startsWith('/api/my-guides/')) {
      return res.status(error.status === 413 ? 413 : 400).json({detail: 'ข้อมูลคำขอไม่ถูกต้อง'});
    }
    next(error);
  });
  return app;
}

function isJsonObject(req) {
  return req.is('application/json') && req.body && typeof req.body === 'object' && !Array.isArray(req.body);
}

if (require.main === module) {
  createApp().listen(5000, process.env.HOST || '127.0.0.1', () => console.log('Frontend: http://127.0.0.1:5000'));
}
module.exports = {createApp};
