// Login uses the same-origin /api/auth proxy in frontend/src/server.js.
window.LoginConfig = Object.freeze({
  apiBaseUrl: '',
  loginPath: '/api/auth/login',
  tokenStorageKey: 'access_token',
  successUrl: 'courses.html',
  timeoutMs: 15000
});
