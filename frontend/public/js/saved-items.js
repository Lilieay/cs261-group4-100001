(() => {
  'use strict';

  const root = '/api/saved-items';
  const idValid = value => /^[1-9][0-9]*$/.test(String(value)) && Number(value) <= window.AppConfig.maxId;
  const typeValid = type => type === 'guide' || type === 'summary';
  const failure = (message, status = 0) => Object.assign(new Error(message), {status});
  const unknownWrite = 'ยังยืนยันผลไม่ได้ กรุณาโหลดสถานะล่าสุด';

  function itemPath(type, id) {
    if (!typeValid(type) || !idValid(id)) throw failure('รหัสเอกสารไม่ถูกต้อง', 422);
    return `${root}/${type}/${id}`;
  }

  async function request(path, method = 'GET') {
    const token = window.HttpClient.token();
    if (!token) {
      window.location.replace('login.html');
      throw failure('กรุณาเข้าสู่ระบบ', 401);
    }
    let result;
    try {
      result = await window.HttpClient.request(path, {method, token, timeoutMs: 15_000});
    } catch (_) {
      throw failure(method === 'GET' ? 'เชื่อมต่อบริการรายการที่บันทึกไม่สำเร็จ' : unknownWrite);
    }
    const {response, payload} = result;
    if (response.status === 401) {
      window.HttpClient.clearToken();
      window.location.replace('login.html');
    }
    if (!response.ok) {
      const rawMessage = payload?.error?.message;
      const message = typeof rawMessage === 'string' ? rawMessage.trim() : '';
      const uncertain = method !== 'GET' && response.status >= 500 && (response.status !== 503 || !message);
      throw failure(uncertain ? unknownWrite : message || 'จัดการรายการที่บันทึกไม่สำเร็จ', response.status);
    }
    return payload;
  }

  async function list() {
    const result = await request(root);
    if (!Array.isArray(result?.items) || !result.items.every(item =>
      typeValid(item?.item_type) && idValid(item.item_id) && idValid(item.course?.id)
      && typeof item.course.course_code === 'string' && typeof item.course.course_name === 'string'
      && typeof item.title === 'string'
      && item.open_path === `/api/${item.item_type === 'guide' ? 'guides' : 'summaries'}/${item.item_id}`)) {
      throw failure('ได้รับรายการที่บันทึกในรูปแบบไม่ถูกต้อง', 502);
    }
    return result.items;
  }

  async function state(type, id, desired) {
    const method = desired === undefined ? 'GET' : desired ? 'PUT' : 'DELETE';
    const result = await request(itemPath(type, id), method);
    if (result?.item_type !== type || result.item_id !== Number(id) || typeof result.saved !== 'boolean'
      || (desired !== undefined && result.saved !== desired)) {
      throw failure(desired === undefined ? 'ยืนยันสถานะบันทึกจากระบบไม่ได้' : unknownWrite, 502);
    }
    return result.saved;
  }

  window.SavedItems = Object.freeze({list, state});
})();
