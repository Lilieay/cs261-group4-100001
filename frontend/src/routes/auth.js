const express = require('express');

function registerAuthRoutes(app, proxy) {
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

  app.use((error, req, res, next) => {
    if (!req.path.startsWith('/api/auth')) return next(error);
    return res.status(error.status === 413 ? 413 : 400).json({detail: 'ข้อมูลคำขอไม่ถูกต้อง'});
  });
}

module.exports = {registerAuthRoutes};
