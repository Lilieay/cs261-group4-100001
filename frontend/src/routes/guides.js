const express = require('express');
const {validId, isJsonObject, rejectUnusedParameters, errorResponse: savedItemError} = require('../http/request');

function registerGuideRoutes(app, proxy) {
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

  app.use((error, req, res, next) => {
    if (req.path !== '/api/guides' && !req.path.startsWith('/api/my-guides/')) return next(error);
    return res.status(error.status === 413 ? 413 : 400).json({detail: 'ข้อมูลคำขอไม่ถูกต้อง'});
  });
}

module.exports = {registerGuideRoutes};
