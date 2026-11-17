const {validId} = require('../http/request');
function registerCourseRoutes(app, proxy) {
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
}

module.exports = {registerCourseRoutes};
