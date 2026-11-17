(() => {
  'use strict';

  const invalidResponse = () => Object.assign(new Error('ยืนยันข้อมูลรีวิวจากระบบไม่ได้'), {status: 502});
  const validId = value => /^[1-9]\d*$/.test(String(value)) && Number(value) <= window.AppConfig.maxId;
  const pathFor = target => {
    if (!['guide', 'summary'].includes(target.type) || !validId(target.id)) throw new Error('ไม่พบเอกสาร');
    return `/api/${target.type === 'guide' ? 'guides' : 'summaries'}/${target.id}/reviews`;
  };

  async function request(path, method = 'GET', body) {
    const token = window.HttpClient.token();
    if (!token) throw Object.assign(new Error('กรุณาเข้าสู่ระบบใหม่'), {status: 401});
    let result;
    try {
      result = await window.HttpClient.request(path, {
        method, token, timeoutMs: 15000,
        ...(body && {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})
      });
    } catch (_) {
      throw Object.assign(new Error('เชื่อมต่อบริการรีวิวไม่สำเร็จ'), {status: 0});
    }
    const {response, payload} = result;
    if (!response.ok) {
      const serverMessage = payload?.error?.message;
      const message = typeof serverMessage === 'string' ? serverMessage.trim() : '';
      const fallback = response.status === 503 ? '' : 'ทำรายการรีวิวไม่สำเร็จ';
      throw Object.assign(new Error(message || fallback), {status: response.status, code: payload?.error?.code});
    }
    if (response.status !== ({GET: 200, POST: 201, PUT: 200, DELETE: 204})[method]) throw invalidResponse();
    return payload;
  }

  function validReview(item, target) {
    return validId(item?.id) && validId(item.author?.id) && typeof item.author.display_name === 'string'
      && Number.isInteger(item.rating) && item.rating >= 1 && item.rating <= 5
      && (item.comment === null || typeof item.comment === 'string')
      && item.target_type === target.type && item.target_id === Number(target.id);
  }

  const reads = new Map();
  function read(target, fresh = false) {
    const path = pathFor(target);
    const cached = reads.get(path);
    if (!fresh && cached && Date.now() < cached.expiry) return cached.promise;
    if (reads.size >= 100) reads.delete(reads.keys().next().value);
    const entry = {expiry: Date.now() + 30000};
    entry.promise = request(path).then(result => {
      if (result?.target_type !== target.type || result.target_id !== Number(target.id)
        || !Array.isArray(result.items) || !result.items.every(item => validReview(item, target))) {
        throw invalidResponse();
      }
      return result.items;
    }).catch(error => {
      if (reads.get(path) === entry) reads.delete(path);
      throw error;
    });
    reads.set(path, entry);
    return entry.promise;
  }

  async function write(target, {method, id, authorId, body}) {
    const targetPath = pathFor(target);
    try {
      const result = await request(id ? `/api/reviews/${id}` : targetPath, method, body);
      if (method !== 'DELETE' && (!validReview(result, target) || result.author.id !== authorId
        || (id && result.id !== id))) throw invalidResponse();
      return result;
    } finally {
      reads.delete(targetPath);
    }
  }

  window.ReviewApi = Object.freeze({read, write});
})();
