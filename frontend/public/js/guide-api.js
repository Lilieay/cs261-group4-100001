(() => {
  'use strict';
  const config = window.GuideConfig;
  class GuideApiError extends Error {
    constructor(message, {status = 0, fields = [], uncertain = false} = {}) {
      super(message);
      this.name = 'GuideApiError';
      Object.assign(this, {status, fields, uncertain});
    }
  }

  function accessToken() {
    try {
      return window.HttpClient.token(true);
    } catch (_) {
      throw new GuideApiError('อ่านสถานะเข้าสู่ระบบไม่ได้ กรุณาอนุญาตพื้นที่เก็บข้อมูลของเว็บไซต์');
    }
  }

  function resolveTarget(path, method) {
    if (['PUT', 'DELETE'].includes(method)) return path;
    if (method === 'POST' && path === config.publishPath) return '/api/guides';
    if (method === 'GET' && [config.mePath, config.myGuidesPath].includes(path)) return path;
    if (method === 'GET' && path === config.coursesPath) return '/api/courses';
    if (method === 'GET' && path.startsWith('/')) {
      const local = new URL(path, window.location.origin);
      const listPath = /^\/courses\/[1-9]\d*\/guides$/.test(local.pathname);
      const guidePath = /^\/guides\/[1-9]\d*$/.test(local.pathname);
      const allowed = guidePath || listPath || /^\/courses\/[1-9]\d*\/guides\/filter-options$/.test(local.pathname);
      const allowedQuery = new Set(['academic_year', 'semester', 'exam_period']);
      if (!allowed || (!listPath && local.search)
          || [...local.searchParams.keys()].some(key => !allowedQuery.has(key))) {
        throw new GuideApiError('เส้นทางอ่านแนวข้อสอบไม่ถูกต้อง', {status: 422});
      }
      return `${guidePath ? '/api' : '/api/guides'}${local.pathname}${local.search}`;
    }
    const base = new URL(config.apiBaseUrl || window.location.origin);
    if (!['http:', 'https:'].includes(base.protocol)) throw new GuideApiError('ที่อยู่ API ต้องเป็น HTTP หรือ HTTPS');
    const url = new URL(path, base);
    if (url.origin !== base.origin) throw new GuideApiError('เส้นทาง API ต้องอยู่ในเซิร์ฟเวอร์ที่ตั้งค่าไว้');
    return url.href;
  }

  async function request(path, {method = 'GET', body} = {}) {
    const token = accessToken();
    if (!token) {
      window.location.replace('login.html');
      throw new GuideApiError('กรุณาเข้าสู่ระบบก่อนใช้งานแนวข้อสอบ', {status: 401});
    }
    if (method === 'POST' && (!config || path !== config.publishPath)) {
      throw new GuideApiError('เส้นทางเผยแพร่แนวข้อสอบไม่ถูกต้อง', {status: 422});
    }
    if (method === 'PUT' && !/^\/api\/my-guides\/[1-9]\d*$/.test(path)) {
      throw new GuideApiError('เส้นทางแก้ไขแนวข้อสอบไม่ถูกต้อง', {status: 422});
    }
    if (method === 'DELETE' && !/^\/api\/my-guides\/[1-9]\d*$/.test(path)) {
      throw new GuideApiError('เส้นทางลบแนวข้อสอบไม่ถูกต้อง', {status: 422});
    }
    const target = resolveTarget(path, method);
    let response;
    let payload;
    try {
      ({response, payload} = await window.HttpClient.request(target, {
        method, token, timeoutMs: config.timeoutMs || 15000,
        ...(body === undefined ? {} : {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})
      }));
    } catch (_) {
      throw new GuideApiError(method === 'POST'
        ? 'ยังยืนยันผลเผยแพร่ไม่ได้ กรุณาตรวจรายการของคุณก่อนส่งซ้ำ เพื่อหลีกเลี่ยงรายการซ้ำ'
        : method === 'DELETE'
        ? 'ยังยืนยันผลการลบไม่ได้ กรุณาตรวจรายการของคุณก่อนลองอีกครั้ง'
        : 'ติดต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจการเชื่อมต่อและลองใหม่',
      {uncertain: method === 'POST' || method === 'DELETE'});
    }

    if (!response.ok) {
      if (response.status === 401) {
        try {
          window.HttpClient.clearToken();
        } catch (_) { /* Storage may be unavailable. */ }
        window.location.replace('login.html');
      }
      const fields = Array.isArray(payload?.error?.fields) ? payload.error.fields
        : Array.isArray(payload?.detail) ? payload.detail.filter(item => item && typeof item === 'object').map(item => ({
          field: item.loc?.[item.loc.length - 1], message: item.msg
        })) : [];
      const messages = {
        401: 'สถานะเข้าสู่ระบบใช้ไม่ได้ กรุณาเข้าสู่ระบบใหม่',
        403: 'บัญชีนี้ไม่มีสิทธิ์ดำเนินการ',
        404: 'ไม่พบรายวิชาหรือเส้นทาง API กรุณาตรวจข้อมูลและการตั้งค่าเซิร์ฟเวอร์',
        405: 'เซิร์ฟเวอร์ยังไม่รองรับการเผยแพร่ผ่านเส้นทางนี้',
        422: 'ข้อมูลไม่ผ่านการตรวจสอบ กรุณาตรวจช่องที่ระบุ',
        429: 'ส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่'
      };
      throw new GuideApiError(messages[response.status] || 'เซิร์ฟเวอร์ทำรายการไม่สำเร็จ กรุณาลองใหม่', {
        status: response.status, fields: fields.filter(item => item && typeof item.field === 'string' && typeof item.message === 'string'),
        uncertain: (method === 'POST' || method === 'DELETE') && response.status >= 500
      });
    }
    return {status: response.status, payload};
  }

  async function currentUser() {
    const {payload} = await request(config.mePath);
    if (!payload || !Number.isSafeInteger(payload.id) || typeof payload.username !== 'string') {
      throw new GuideApiError('รูปแบบข้อมูลบัญชีจากเซิร์ฟเวอร์ไม่ถูกต้อง');
    }
    return payload;
  }

  async function courses() {
    const {payload} = await request(config.coursesPath);
    const rows = Array.isArray(payload) ? payload : payload?.items;
    if (!Array.isArray(rows)) throw new GuideApiError('รูปแบบรายการรายวิชาจากเซิร์ฟเวอร์ไม่ถูกต้อง');
    const ids = new Set(), codes = new Set();
    return rows.map(row => {
      if (!row || !Number.isSafeInteger(row.id) || row.id <= 0
          || typeof row.course_code !== 'string' || typeof row.course_name !== 'string'
          || !/^CS\d{3}$/.test(row.course_code) || !row.course_name.trim()
          || ids.has(row.id) || codes.has(row.course_code)) {
        throw new GuideApiError('ข้อมูลรายวิชาไม่ถูกต้องหรือซ้ำกัน กรุณาตรวจข้อมูลเซิร์ฟเวอร์');
      }
      ids.add(row.id); codes.add(row.course_code);
      return {id: row.id, code: row.course_code, name: row.course_name};
    });
  }

  function validateDetail(row, expectedCode, expectedId, {allowZeroCounts = false} = {}) {
    if (!row || !Number.isSafeInteger(row.id) || row.id <= 0
        || (expectedId != null && String(row.id) !== String(expectedId))
        || !row.course || row.course.course_code !== expectedCode
        || typeof row.title !== 'string' || !row.title.trim()
        || typeof row.topics !== 'string' || !row.topics.trim()
        || !Number.isInteger(row.academic_year) || ![1, 2, 3].includes(row.semester)
        || !['midterm', 'final'].includes(row.exam_period)
        || !['objective', 'subjective', 'mixed'].includes(row.exam_format)
        || typeof row.publisher_name !== 'string'
        || ![row.subjective_count, row.objective_count].every(value => value === null
          || (Number.isSafeInteger(value) && (allowZeroCounts ? value >= 0 : value > 0)))
        || !(row.additional_advice == null || typeof row.additional_advice === 'string')) {
      throw new GuideApiError('ข้อมูลรายละเอียดที่เซิร์ฟเวอร์ส่งกลับไม่ถูกต้อง');
    }
    return row;
  }

  async function publish(body, code) {
    const {status, payload} = await request(config.publishPath, {method: 'POST', body});
    try {
      if (status !== 201 || payload?.course?.id !== body.course_id) throw new Error('Unexpected creation response');
      return validateDetail(payload, code);
    } catch (_) {
      throw new GuideApiError('เซิร์ฟเวอร์ตอบกลับแล้ว แต่ยืนยันรายการที่สร้างไม่ได้ กรุณาตรวจรายการของคุณก่อนส่งซ้ำ', {uncertain: true});
    }
  }

  async function read(id, code) {
    if (!/^[1-9]\d*$/.test(String(id))) throw new GuideApiError('ไม่พบแนวข้อสอบ', {status: 404});
    const {payload} = await request(`/guides/${encodeURIComponent(id)}`);
    return validateDetail(payload, code, id, {allowZeroCounts: true});
  }

  async function mine() {
    const {payload} = await request(config.myGuidesPath);
    if (!Array.isArray(payload)) throw new GuideApiError('รูปแบบรายการแนวข้อสอบของฉันจากเซิร์ฟเวอร์ไม่ถูกต้อง');
    return payload.map(normalizeMyGuide);
  }

  function normalizeMyGuide(row) {
    if (!row || !Number.isSafeInteger(row.id) || row.id <= 0
        || !Number.isSafeInteger(row.course_id) || row.course_id <= 0
        || typeof row.course_code !== 'string' || !/^CS\d{3}$/.test(row.course_code)
        || typeof row.course_name !== 'string' || !row.course_name.trim()
        || !(row.instructor_name == null || typeof row.instructor_name === 'string')
        || typeof row.title !== 'string' || !row.title.trim()
        || !Number.isInteger(row.academic_year)
        || ![1, 2, 3].includes(row.semester)
        || !['midterm', 'final'].includes(row.exam_period)
        || typeof row.topics !== 'string'
        || !['objective', 'subjective', 'mixed'].includes(row.exam_format)
        || ![row.objective_count, row.subjective_count].every(value => value == null
          || (Number.isSafeInteger(value) && value >= 0))
        || !(row.additional_advice == null || typeof row.additional_advice === 'string')) {
      throw new GuideApiError('ข้อมูลรายการแนวข้อสอบของฉันไม่ถูกต้อง');
    }
    return {
      id: String(row.id), course_id: row.course_id,
      course_code: row.course_code, course_name: row.course_name,
      instructor_name: row.instructor_name, title: row.title,
      year: String(row.academic_year), semester: String(row.semester),
      period: row.exam_period === 'midterm' ? 'กลางภาค' : 'ปลายภาค',
      formats: [{objective: 'ปรนัย', subjective: 'อัตนัย', mixed: 'ผสม'}[row.exam_format]],
      topics: row.topics, notes: row.additional_advice || '',
      objective_count: row.objective_count, essay_count: row.subjective_count
    };
  }

  async function update(id, body) {
    if (!/^[1-9]\d*$/.test(String(id))) throw new GuideApiError('ไม่พบแนวข้อสอบ', {status: 404});
    const {payload} = await request(`/api/my-guides/${encodeURIComponent(id)}`, {method: 'PUT', body});
    if (payload?.id !== Number(id) || payload?.course_id !== body.course_id) {
      throw new GuideApiError('ยืนยันรายการที่แก้ไขไม่ได้ กรุณาโหลดรายการใหม่เพื่อตรวจสอบ');
    }
    return normalizeMyGuide(payload);
  }

  async function remove(id) {
    if (!/^[1-9]\d*$/.test(String(id))) throw new GuideApiError('ไม่พบแนวข้อสอบ', {status: 404});
    const {payload} = await request(`/api/my-guides/${encodeURIComponent(id)}`, {method: 'DELETE'});
    if (payload?.id !== Number(id) || typeof payload?.message !== 'string') {
      throw new GuideApiError('ยืนยันผลการลบไม่ได้ กรุณาโหลดรายการใหม่เพื่อตรวจสอบ', {uncertain: true});
    }
    return payload;
  }

  async function list(courseId, filters = {}) {
    if (!/^[1-9]\d*$/.test(String(courseId))) throw new GuideApiError('รหัสรายวิชาไม่ถูกต้อง', {status: 422});
    const query = new URLSearchParams();
    if (filters.academic_year != null) query.set('academic_year', String(filters.academic_year));
    if (filters.semester != null) query.set('semester', String(filters.semester));
    if (filters.exam_period != null) query.set('exam_period', filters.exam_period);
    const suffix = query.size ? `?${query}` : '';
    const {payload} = await request(`/courses/${encodeURIComponent(courseId)}/guides${suffix}`);
    if (!payload || payload.course_id !== Number(courseId) || !Array.isArray(payload.items)) {
      throw new GuideApiError('รูปแบบรายการแนวข้อสอบจากเซิร์ฟเวอร์ไม่ถูกต้อง');
    }
    return payload.items.map(row => {
      if (!row || !Number.isSafeInteger(row.id) || row.id <= 0 || typeof row.title !== 'string'
          || !Number.isInteger(row.academic_year) || ![1, 2, 3].includes(row.semester)
          || !['midterm', 'final'].includes(row.exam_period) || typeof row.publisher_name !== 'string') {
        throw new GuideApiError('ข้อมูลรายการแนวข้อสอบไม่ถูกต้อง');
      }
      return {id: String(row.id), title: row.title, year: String(row.academic_year),
        semester: String(row.semester), period: row.exam_period === 'midterm' ? 'กลางภาค' : 'ปลายภาค',
        publisher_name: row.publisher_name};
    });
  }

  async function filterOptions(courseId) {
    if (!/^[1-9]\d*$/.test(String(courseId))) throw new GuideApiError('รหัสรายวิชาไม่ถูกต้อง', {status: 422});
    const {payload} = await request(`/courses/${encodeURIComponent(courseId)}/guides/filter-options`);
    if (!payload || payload.course_id !== Number(courseId) || !Array.isArray(payload.academic_years)
        || !Array.isArray(payload.semesters) || !Array.isArray(payload.exam_periods)
        || !payload.academic_years.every(Number.isInteger)
        || !payload.semesters.every(value => [1, 2, 3].includes(value))
        || !payload.exam_periods.every(value => ['midterm', 'final'].includes(value))) {
      throw new GuideApiError('รูปแบบตัวเลือกตัวกรองจากเซิร์ฟเวอร์ไม่ถูกต้อง');
    }
    return payload;
  }

  function toGuideRow(row) {
    return {
      id: String(row.id), course_code: row.course.course_code, title: row.title,
      year: String(row.academic_year), semester: String(row.semester),
      period: row.exam_period === 'midterm' ? 'กลางภาค' : 'ปลายภาค',
      formats: [{objective: 'ปรนัย', subjective: 'อัตนัย', mixed: 'ผสม'}[row.exam_format]],
      topics: row.topics, notes: row.additional_advice || '',
      essay_count: row.subjective_count, objective_count: row.objective_count,
      publisher_name: row.publisher_name, instructor_names: row.course.instructor_names
    };
  }

  window.GuideApi = Object.freeze({request, currentUser, courses, publish, read, mine, update, remove, list, filterOptions, toGuideRow});
})();
