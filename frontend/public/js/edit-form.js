(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const form = $('#edit-form'), dialog = $('#editor');
  const ids = {
    course_id: 'edit-course', title: 'edit-title', academic_year: 'edit-year',
    semester: 'edit-semester', exam_period: 'edit-period', exam_format: 'edit-formats',
    subjective_count: 'edit-essay-count', objective_count: 'edit-objective-count',
    topics: 'edit-topics', additional_advice: 'edit-notes'
  };
  const field = key => document.getElementById(ids[key]);
  const years = window.AppConfig.academicYears;
  field('academic_year').min = Math.min(...years);
  field('academic_year').max = Math.max(...years);
  let catalog = [], guide = null, onSaved = null, busy = false;

  function showError(message) {
    $('#edit-error').textContent = message;
    $('#edit-error').hidden = !message;
    if (message) $('#edit-error').focus();
  }
  function syncCounts() {
    const format = field('exam_format').value;
    for (const [key, blocked] of [['subjective_count', format === 'objective'], ['objective_count', format === 'subjective']]) {
      field(key).disabled = busy || blocked;
      if (blocked) field(key).value = '';
    }
  }
  function setBusy(value) {
    busy = value;
    form.querySelectorAll('input, select, textarea, button').forEach(control => { control.disabled = value; });
    form.querySelector('[type="submit"]').disabled = value || !catalog.length;
    syncCounts();
  }
  function fieldErrors(errors) {
    for (const key of Object.keys(ids)) {
      const message = errors[key] || '';
      field(key).setAttribute('aria-invalid', String(Boolean(message)));
      const target = document.getElementById(ids[key] + '-error');
      if (target) { target.textContent = message; target.hidden = !message; }
    }
    if (Object.keys(errors).length) field(Object.keys(errors)[0]).focus();
  }
  function values() {
    const text = key => field(key).value.trim();
    const errors = {};
    const payload = {
      course_id: Number(text('course_id')), title: text('title'),
      academic_year: Number(text('academic_year')), semester: Number(text('semester')),
      exam_period: text('exam_period'), exam_format: text('exam_format'),
      topics: text('topics'), additional_advice: text('additional_advice') || null
    };
    if (!catalog.some(course => course.id === payload.course_id)) errors.course_id = 'กรุณาเลือกรายวิชาที่มีอยู่ในระบบ';
    for (const [key, limit] of [['title', 200], ['topics', 2000]]) {
      if (!payload[key]) errors[key] = 'กรุณากรอกข้อมูล ห้ามเว้นว่างหรือใส่เฉพาะช่องว่าง';
      else if (Array.from(payload[key]).length > limit) errors[key] = `ต้องไม่เกิน ${limit} ตัวอักษร`;
    }
    if (Array.from(payload.additional_advice || '').length > 2000) errors.additional_advice = 'คำแนะนำต้องไม่เกิน 2,000 ตัวอักษร';
    if (!years.includes(payload.academic_year)) errors.academic_year = 'กรุณากรอกปีการศึกษาที่ถูกต้อง';
    if (![1, 2, 3].includes(payload.semester)) errors.semester = 'กรุณาเลือกภาคเรียน';
    if (!['midterm', 'final'].includes(payload.exam_period)) errors.exam_period = 'กรุณาเลือกช่วงสอบ';
    if (!['objective', 'subjective', 'mixed'].includes(payload.exam_format)) errors.exam_format = 'กรุณาเลือกรูปแบบข้อสอบ';
    for (const key of ['subjective_count', 'objective_count']) {
      const control = field(key);
      const value = control.disabled || !text(key) ? null : Number(text(key));
      payload[key] = value;
      if (!control.disabled && (control.validity.badInput || (value !== null && (!Number.isSafeInteger(value) || value <= 0 || value > window.AppConfig.maxId)))) errors[key] = 'กรุณาระบุจำนวนเต็มมากกว่า 0 หรือเว้นว่าง';
    }
    return {payload, errors};
  }
  async function open(row, saved) {
    if (dialog.open) return;
    guide = row; onSaved = saved; catalog = [];
    form.reset(); fieldErrors({}); showError('');
    const initial = {
      title: row.title, academic_year: row.year, semester: row.semester,
      exam_period: row.period === 'กลางภาค' ? 'midterm' : 'final',
      exam_format: {'ปรนัย': 'objective', 'อัตนัย': 'subjective', 'ผสม': 'mixed'}[row.formats[0]],
      subjective_count: row.essay_count ?? '', objective_count: row.objective_count ?? '',
      topics: row.topics, additional_advice: row.notes
    };
    for (const [key, value] of Object.entries(initial)) field(key).value = value;
    dialog.showModal(); setBusy(true);
    try {
      catalog = await window.GuideApi.courses();
      field('course_id').replaceChildren(...catalog.map(course => {
        const option = document.createElement('option');
        option.value = String(course.id); option.textContent = `${course.code} ${course.name}`;
        return option;
      }));
      field('course_id').value = String(row.course_id);
      if (!catalog.length) throw new Error('ไม่พบรายวิชาในระบบ');
    } catch (error) {
      catalog = [];
      showError((error.message || 'โหลดรายวิชาไม่สำเร็จ') + ' กรุณาปิดฟอร์มแล้วเปิดใหม่เพื่อลองอีกครั้ง');
    } finally { setBusy(false); }
  }
  field('exam_format').addEventListener('change', syncCounts);
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  form.querySelector('[data-close="editor"]').addEventListener('click', () => { if (!busy) dialog.close(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !catalog.length) return;
    showError('');
    const {payload, errors} = values();
    fieldErrors(errors);
    if (Object.keys(errors).length) return;
    setBusy(true);
    try { await window.GuideApi.update(guide.id, payload); }
    catch (error) {
      const fields = {};
      for (const item of error.fields || []) if (ids[item.field]) fields[item.field] = item.message;
      fieldErrors(fields);
      showError(error.status === 404 ? 'ไม่พบรายการหรือคุณไม่มีสิทธิ์แก้ไข กรุณาโหลดรายการใหม่'
        : error.status === 0 || error.status >= 500 ? 'ยืนยันผลการแก้ไขไม่ได้ ข้อมูลในฟอร์มยังอยู่ กรุณาโหลดรายการใหม่เพื่อตรวจสอบก่อนส่งซ้ำ'
        : error.message || 'บันทึกไม่สำเร็จ ข้อมูลในฟอร์มยังอยู่');
      return;
    } finally { setBusy(false); }
    dialog.close();
    await onSaved();
  });
  window.GuideEditor = Object.freeze({open});
})();
