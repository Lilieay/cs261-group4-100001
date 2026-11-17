(() => {
  'use strict';
  const {clearToken} = window.HttpClient;
  let loggingOut = false;

  async function loadUser() {
    const token = window.HttpClient.token();
    if (!token) return null;
    const {response, payload: user} = await window.HttpClient.request('/api/auth/me', {token, timeoutMs: 10000});
    if (response.status === 401) {
      clearToken();
      return null;
    }
    if (!response.ok) throw new Error('โหลดข้อมูลผู้ใช้ไม่สำเร็จ');
    if (!user || typeof user.username !== 'string' || typeof user.display_name !== 'string') {
      throw new Error('ข้อมูลผู้ใช้ไม่ถูกต้อง');
    }
    return user;
  }

  document.querySelectorAll('[data-logout]').forEach(button => {
    button.addEventListener('click', async () => {
      if (loggingOut) return;
      loggingOut = true;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      const status = document.getElementById('session-status');
      if (status) status.textContent = 'กำลังออกจากระบบ…';
      try {
        const token = window.HttpClient.token(true);
        if (token) {
          const {response} = await window.HttpClient.request('/api/auth/logout', {
            method: 'POST', token, timeoutMs: 10000
          });
          if (!response.ok && response.status !== 401) throw new Error('logout failed');
        }
        clearToken();
        window.location.replace('login.html');
      } catch (_) {
        if (status) status.textContent = 'ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง';
        loggingOut = false;
        button.disabled = false;
        button.setAttribute('aria-busy', 'false');
      }
    });
  });

  async function renderProfile(profile) {
    try {
      const user = await profile;
      if (profile !== window.currentUserReady) return;
      if (!user) {
        document.querySelectorAll('[data-user-name]').forEach(el => { el.textContent = 'เข้าสู่ระบบ'; });
        document.querySelectorAll('[data-profile-link]').forEach(el => { el.href = 'login.html'; });
        window.location.replace('login.html');
        return;
      }
      const name = user.display_name.trim() || user.username;
      document.querySelectorAll('[data-user-name]').forEach(el => { el.textContent = name; });
      document.querySelectorAll('[data-user-id]').forEach(el => { el.textContent = user.username; });
      document.querySelectorAll('[data-user-avatar]').forEach(el => { el.textContent = Array.from(name)[0] || '?'; });
      const status = document.getElementById('profile-status');
      if (status) status.textContent = '';
    } catch (_) {
      if (profile !== window.currentUserReady) return;
      document.querySelectorAll('[data-user-name]').forEach(el => { el.textContent = 'โหลดข้อมูลไม่ได้'; });
      const status = document.getElementById('profile-status');
      if (status) status.textContent = 'โหลดข้อมูลไม่ได้ กรุณารีเฟรชหน้าเพื่อลองใหม่';
    }
  }
  window.refreshCurrentUser = () => {
    const profile = window.currentUserReady = loadUser();
    renderProfile(profile);
    return profile;
  };
  window.refreshCurrentUser();
})();
