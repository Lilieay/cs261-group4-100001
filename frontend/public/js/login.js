(() => {
  'use strict';
  const form = document.getElementById('login-form');
  const username = document.getElementById('username');
  const password = document.getElementById('password');
  const submit = document.getElementById('login-submit');
  const message = document.getElementById('login-message');
  const config = window.LoginConfig;
  const FAILURE = 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
  let pending = false;
  let completed = false;

  function fieldError(input, text = '') {
    const error = document.getElementById(`${input.id}-error`);
    input.setAttribute('aria-invalid', String(Boolean(text)));
    error.textContent = text;
    error.hidden = !text;
  }

  function showMessage(text, kind = 'error') {
    message.textContent = text;
    message.dataset.kind = kind;
    message.hidden = !text;
    if (text && kind === 'error') message.focus();
  }

  function busy() {
    username.disabled = pending || completed;
    password.disabled = pending || completed;
    submit.disabled = pending || completed;
    submit.textContent = completed ? 'เข้าสู่ระบบแล้ว' : pending ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ';
    form.setAttribute('aria-busy', String(pending));
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || completed) return;
    fieldError(username);
    fieldError(password);
    showMessage('');
    const studentId = username.value.trim();
    // Preserve the password exactly as typed, including leading/trailing spaces.
    const secret = password.value;
    let firstInvalid = null;
    if (!studentId || !/^\d+$/.test(studentId) || studentId.length > 50) {
      fieldError(username, !studentId ? 'กรุณากรอกรหัสนักศึกษา' : 'กรุณากรอกรหัสนักศึกษาเป็นตัวเลข ไม่เกิน 50 หลัก');
      firstInvalid = username;
    }
    if (!secret || secret.length > 100) {
      fieldError(password, !secret ? 'กรุณากรอกรหัสผ่าน' : 'รหัสผ่านต้องไม่เกิน 100 ตัวอักษร');
      firstInvalid ||= password;
    }
    if (firstInvalid) { firstInvalid.focus(); return; }

    pending = true;
    busy();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs || window.AppConfig.requestTimeoutMs);
    try {
      const base = new URL(config.apiBaseUrl || window.location.origin);
      if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Invalid API protocol');
      const url = new URL(config.loginPath, base);
      if (url.origin !== base.origin) throw new Error('Invalid API origin');
      const response = await fetch(url.href, {
        method: 'POST', signal: controller.signal, cache: 'no-store',
        headers: {'Content-Type': 'application/json', Accept: 'application/json'},
        body: JSON.stringify({username: studentId, password: secret})
      });
      if (!response.ok) throw new Error('Login rejected');
      const result = await response.json();
      if (typeof result?.access_token !== 'string' || !result.access_token.trim()
          || result.token_type?.toLowerCase() !== 'bearer'
          || !result.user || result.user.role !== 'student'
          || !Number.isSafeInteger(result.user.id) || result.user.id <= 0
          || typeof result.user.username !== 'string' || !result.user.username.trim()) {
        throw new Error('Invalid login response');
      }
      // Only the token is persisted; passwords and request bodies are never stored.
      try { sessionStorage.setItem(config.tokenStorageKey, result.access_token); }
      catch (_) {
        showMessage('เก็บสถานะเข้าสู่ระบบไม่ได้ กรุณาอนุญาตพื้นที่เก็บข้อมูลของเว็บไซต์แล้วลองใหม่');
        return;
      }
      completed = true;
      password.value = '';
      showMessage('เข้าสู่ระบบสำเร็จ กำลังเปิดหน้าค้นหารายวิชา', 'success');
      document.getElementById('login-next').hidden = false;
      document.getElementById('login-next').href = config.successUrl;
      try { window.location.assign(config.successUrl); }
      catch (_) { document.getElementById('login-next').focus(); }
    } catch (_) {
      // Use the same message for invalid credentials, ineligible accounts,
      // upstream failures, and malformed responses. Never render raw API errors.
      showMessage(FAILURE);
    } finally {
      clearTimeout(timer);
      pending = false;
      busy();
    }
  });

  for (const input of [username, password]) {
    input.addEventListener('input', () => { fieldError(input); showMessage(''); });
  }
  document.getElementById('forgot-password').addEventListener('click', () => {
    showMessage('หากลืมรหัสผ่าน กรุณากู้คืนผ่านระบบบัญชีนักศึกษาของมหาวิทยาลัย', 'info');
  });
})();
