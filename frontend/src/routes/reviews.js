const express = require('express');
const {errorResponse: reviewError} = require('../http/request');
function registerReviewRoutes(app, proxy) {
  const reviewPaths = ['/api/guides/:guide_id/reviews', '/api/summaries/:summary_id/reviews', '/api/reviews/:review_id'];
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
}

module.exports = {registerReviewRoutes};
