const express = require('express');
const {pdf} = require('../../public/js/app-config');
const {validId, hasQuery, rejectUnusedParameters, errorResponse: summaryError} = require('../http/request');
function registerSummaryRoutes(app, proxy) {
  const proxySummary = (req, res, target, options = {}) => proxy(req, res, target, {
    errorCode: 'UPSTREAM_UNAVAILABLE', errorMessage: 'เชื่อมต่อบริการสรุป PDF ไม่สำเร็จ', ...options
  });

  const summaryMultipart = express.raw({type: 'multipart/form-data', limit: pdf.requestMaxBytes, inflate: false});
  function writeSummary(req, res) {
    res.set('Cache-Control', 'no-store');
    const id = req.params.summaryId;
    if (id !== undefined && (!validId(id) || hasQuery(req))) {
      return summaryError(res, 422, 'INVALID_PARAMETERS', 'ข้อมูลที่ใช้แก้ไขสรุปไม่ถูกต้อง');
    }
    if (!req.is('multipart/form-data')) {
      return summaryError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'กรุณาแนบไฟล์ PDF ผ่านแบบฟอร์ม');
    }
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      return summaryError(res, 422, 'INVALID_PARAMETERS', 'กรุณากรอกข้อมูลสรุป');
    }
    return proxySummary(req, res, id === undefined ? '/api/summaries' : `/api/summaries/${id}`, {
      body: req.body, multipart: true, timeoutMs: pdf.timeoutMs
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
        timeoutMs: pdf.timeoutMs,
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

  app.use((error, req, res, next) => {
    if (!/^\/api\/summaries(?:\/[^/]+)?\/?$/i.test(req.path)) return next(error);
    if (error.status === 413) return summaryError(res, 413, 'REQUEST_TOO_LARGE', 'ไฟล์ PDF ต้องมีขนาดไม่เกิน 15 MB');
    if (error.status === 415) return summaryError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'รูปแบบไฟล์อัปโหลดไม่ถูกต้อง');
    return summaryError(res, 400, 'INVALID_PARAMETERS', 'ข้อมูลอัปโหลดไม่ถูกต้อง');
  });
}

module.exports = {registerSummaryRoutes};
