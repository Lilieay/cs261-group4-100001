const express = require('express');
const {createProxy} = require('./http/proxy');
const {registerAuthRoutes} = require('./routes/auth');
const {registerCourseRoutes} = require('./routes/courses');
const {registerSummaryRoutes} = require('./routes/summaries');
const {registerReviewRoutes} = require('./routes/reviews');
const {registerSavedItemRoutes} = require('./routes/saved-items');
const {registerGuideRoutes} = require('./routes/guides');
const {registerPages} = require('./routes/pages');

function createApp({backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:8000'} = {}) {
  const app = express();
  app.disable('x-powered-by');
  const proxy = createProxy(backendUrl);
  registerAuthRoutes(app, proxy);
  registerCourseRoutes(app, proxy);
  registerSummaryRoutes(app, proxy);
  registerReviewRoutes(app, proxy);
  registerSavedItemRoutes(app, proxy);
  registerGuideRoutes(app, proxy);
  registerPages(app);
  return app;
}

if (require.main === module) {
  createApp().listen(5000, process.env.HOST || '127.0.0.1', () => console.log('Frontend: http://127.0.0.1:5000'));
}
module.exports = {createApp};
