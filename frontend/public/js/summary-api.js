(() => {
  'use strict';

  const MAX_PDF_BYTES = 15_000_000;
  const FILE_TIMEOUT_MS = 120_000;
  const validId = value => /^[1-9]\d*$/.test(String(value)) && Number(value) <= 2147483647;

  class SummaryApiError extends Error {
    constructor(message, status = 0, fields = [], code = '') {
      super(message);
      this.status = status;
      this.fields = Array.isArray(fields) ? fields : [];
      this.code = code;
    }
  }

  function login() {
    window.HttpClient.clearToken();
    window.location.replace('login.html');
    return new SummaryApiError('กรุณาเข้าสู่ระบบก่อนใช้สรุป PDF', 401);
  }

  async function request(path, {expectedStatus, ...options} = {}) {
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
        response.status, payload?.error?.fields, payload?.error?.code);
    }
    if (expectedStatus && response.status !== expectedStatus) {
      throw new SummaryApiError('ผลการจัดการสรุปจากบริการไม่ถูกต้อง', 502);
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
    const pdf = await request(`${summaryPath(id)}/file`, {responseType: 'pdf', timeoutMs: FILE_TIMEOUT_MS, signal});
    if (pdf?.type !== 'application/pdf' || !pdf.size) {
      throw new SummaryApiError('ไม่สามารถเปิดไฟล์ PDF นี้ได้', 502);
    }
    return pdf;
  }

  function summaryForm(courseId, title, description, file) {
    const body = new FormData();
    body.set('course_id', courseId);
    body.set('title', title);
    if (description) body.set('description', description);
    if (file) body.set('file', file.type ? file : file.slice(0, file.size, 'application/pdf'), file.name);
    return body;
  }

  async function publish(courseId, title, description, file, examMetadata = {}) {
    const body = summaryForm(courseId, title, description, file);
    for (const key of ['academic_year', 'semester', 'exam_period']) {
      if (examMetadata[key] !== undefined) body.set(key, examMetadata[key]);
    }
    return summary(await request('/api/summaries', {method: 'POST', body, timeoutMs: FILE_TIMEOUT_MS}));
  }

  async function mine() {
    const result = await request('/api/my-summaries');
    if (!Array.isArray(result?.items)) throw new SummaryApiError('รูปแบบรายการสรุปจากบริการไม่ถูกต้อง', 502);
    return result.items.map(summary);
  }

  async function update(id, courseId, title, description, file) {
    const body = summaryForm(courseId, title, description, file);
    const result = summary(await request(summaryPath(id), {method: 'PUT', body, expectedStatus: 200, timeoutMs: FILE_TIMEOUT_MS}));
    if (result.id !== Number(id) || result.course.id !== Number(courseId)) {
      throw new SummaryApiError('ข้อมูลที่บันทึกไม่ตรงกับรายการที่เลือก', 502);
    }
    return result;
  }

  async function remove(id) {
    await request(summaryPath(id), {method: 'DELETE', expectedStatus: 204});
  }

  function pdfSelectionError(files) {
    const [file] = files;
    if (files.length > 1) return 'กรุณาแนบไฟล์ PDF เพียงหนึ่งไฟล์';
    if (file && (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf') || !file.size)) {
      return 'กรุณาเลือกไฟล์ PDF ที่เปิดอ่านได้';
    }
    return file?.size > MAX_PDF_BYTES ? 'ไฟล์ PDF ต้องมีขนาดไม่เกิน 15 MB' : '';
  }

  async function pdfSignatureError(file) {
    try {
      return await file.slice(0, 5).text() === '%PDF-' ? '' : 'ไฟล์นี้ไม่ใช่ PDF ที่ถูกต้อง';
    } catch (_) {
      return 'อ่านไฟล์นี้ไม่ได้ กรุณาเลือกไฟล์อีกครั้ง';
    }
  }

  function courseUrl(course) {
    const query = new URLSearchParams({courseId: course.id, course: course.course_code, type: 'summaries'});
    return `choose-courses.html?${query}`;
  }

  window.SummaryApi = Object.freeze({
    list, read, openFile, publish, courseUrl, mine, update, remove, pdfSelectionError, pdfSignatureError
  });
})();
