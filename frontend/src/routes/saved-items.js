const {validId, rejectUnusedParameters, errorResponse: savedItemError} = require('../http/request');
function registerSavedItemRoutes(app, proxy) {
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
}

module.exports = {registerSavedItemRoutes};
