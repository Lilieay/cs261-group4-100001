const express = require('express');
const path = require('node:path');

function registerPages(app) {
  const publicRoot = path.join(__dirname, '../../public');
  const pages = ['index', 'login', 'courses', 'choose-courses', 'read-courses',
    'shared-courses', 'saved-courses', 'upload', 'upload-summary', 'read-summary'];
  // Keep a single URL for each page even when opened through its folder path.
  app.get(pages.map(page => `/pages/${page}.html`), (req, res) => {
    res.redirect(302, req.originalUrl.replace(/^\/pages/, ''));
  });
  app.use(express.static(path.join(publicRoot, 'pages')));
  app.use(express.static(publicRoot));
}

module.exports = {registerPages};
