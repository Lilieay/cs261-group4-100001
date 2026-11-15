(() => {
  'use strict';

  const MAX_PDF_BYTES = 15_000_000;
  const validId = value => /^[1-9]\d*$/.test(String(value)) && Number(value) <= 2147483647;

  class SummaryApiError extends Error {
    constructor(message, status = 0, fields = []) {
      super(message);
      this.status = status;
      this.fields = Array.isArray(fields) ? fields : [];
    }
  }

  function login() {
    window.HttpClient.clearToken();
    window.location.replace('login.html');
    return new SummaryApiError('กรุณาเข้าสู่ระบบก่อนใช้สรุป PDF', 401);
  }

  async function request(path, options = {}) {
    const token = window.HttpClient.token();
    if (!token) throw login();
    let result;
    try {
      result = await window.HttpClient.request(path, {token, timeoutMs: 20000, ...options});
    } catch (_) {
      throw new SummaryApiError('เชื่อมต่อบริการสรุป PDF ไม่สำเร็จ กรุณาลองใหม่');
    }
    const {response, payload} = result;
    if (response.status === 401) throw login();
    if (!response.ok) {
      throw new SummaryApiError(payload?.error?.message || payload?.detail || 'โหลดข้อมูลสรุปไม่สำเร็จ',
        response.status, payload?.error?.fields);
    }
    return payload;
  }

  function summaryPath(id) {
    if (!validId(id)) throw new SummaryApiError('รหัสสรุปไม่ถูกต้อง', 422);
    return `/api/summaries/${id}`;
  }

  function summary(value) {
    if (!value || !validId(value.id) || !validId(value.course?.id) || !validId(value.owner?.id)
      || typeof value.title !== 'string' || typeof value.course.course_code !== 'string'
      || typeof value.owner.display_name !== 'string' || typeof value.file?.original_name !== 'string'
      || value.file.read_path !== `${summaryPath(value.id)}/file`) {
      throw new SummaryApiError('รูปแบบข้อมูลสรุปจากบริการไม่ถูกต้อง', 502);
    }
    return value;
  }

  async function list(courseId) {
    if (!validId(courseId)) throw new SummaryApiError('รหัสรายวิชาไม่ถูกต้อง', 422);
    const result = await request(`/api/courses/${courseId}/summaries`);
    if (!Array.isArray(result?.items) || result.course_id !== Number(courseId)) {
      throw new SummaryApiError('รูปแบบรายการสรุปจากบริการไม่ถูกต้อง', 502);
    }
    return result.items.map(summary);
  }

  async function read(id) {
    const result = summary(await request(summaryPath(id)));
    if (result.id !== Number(id)) {
      throw new SummaryApiError('ข้อมูลสรุปที่ได้รับไม่ตรงกับรายการที่เลือก', 502);
    }
    return result;
  }

  async function openFile(id, signal) {
    const pdf = await request(`${summaryPath(id)}/file`, {responseType: 'pdf', signal});
    if (pdf?.type !== 'application/pdf' || !pdf.size) {
      throw new SummaryApiError('ไม่สามารถเปิดไฟล์ PDF นี้ได้', 502);
    }
    return pdf;
  }

  async function publish(courseId, title, description, file) {
    const body = new FormData();
    body.set('course_id', courseId);
    body.set('title', title);
    if (description) body.set('description', description);
    body.set('file', file.type ? file : new Blob([file], {type: 'application/pdf'}), file.name);
    return summary(await request('/api/summaries', {method: 'POST', body}));
  }

  function courseUrl(course) {
    const query = new URLSearchParams({courseId: course.id, course: course.course_code, type: 'summaries'});
    return `choose-courses.html?${query}`;
  }

  window.SummaryApi = Object.freeze({MAX_PDF_BYTES, list, read, openFile, publish, courseUrl});
})();
