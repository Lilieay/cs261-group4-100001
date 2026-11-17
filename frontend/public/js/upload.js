(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const config = window.GuideConfig;
  const form = $('#upload-form');
  const fieldset = $('#upload-fields');
  const submit = $('#publish-submit');
  const fieldIds = {
    course: 'course-select', title: 'exam-title', academicYear: 'academic-year',
    semester: 'semester', examPeriod: 'exam-period', examType: 'exam-type',
    subjectiveCount: 'subjective-count', objectiveCount: 'objective-count',
    topics: 'exam-topics', note: 'note'
  };
  const serverFields = {
    course_id: 'course', title: 'title', academic_year: 'academicYear', semester: 'semester',
    exam_period: 'examPeriod', exam_format: 'examType', subjective_count: 'subjectiveCount',
    objective_count: 'objectiveCount', topics: 'topics', additional_advice: 'note'
  };
  let catalog = [];
  let user = null;
  let ready = false;
  let submitting = false;
  let saved = false;
  let uncertain = false;
  const field = key => document.getElementById(fieldIds[key]);

  function status(message, kind = '') {
    const target = $('#publish-status');
    target.textContent = message;
    target.dataset.kind = kind;
  }

  function showFieldError(key, message = '') {
    const input = field(key);
    const error = document.getElementById(`${input.id}-error`);
    input.setAttribute('aria-invalid', String(Boolean(message)));
    error.textContent = message;
    error.hidden = !message;
  }

  function clearErrors() {
    Object.keys(fieldIds).forEach(key => showFieldError(key));
    $('#publish-errors').hidden = true;
    $('#publish-errors').replaceChildren();
    $('#publish-login').hidden = true;
  }

  function showErrors(errors, message = 'กรุณาตรวจข้อมูลก่อนเผยแพร่') {
    const summary = $('#publish-errors');
    const heading = document.createElement('strong');
    heading.textContent = message;
    summary.replaceChildren(heading);
    for (const [key, text] of Object.entries(errors)) {
      if (!fieldIds[key]) continue;
      showFieldError(key, text);
      const link = document.createElement('a');
      link.href = `#${fieldIds[key]}`;
      link.textContent = text;
      summary.append(link);
    }
    summary.hidden = false;
    summary.focus();
  }

  function syncCounts() {
    const format = field('examType').value;
    for (const [key, blocked] of [
      ['subjectiveCount', format === 'objective'],
      ['objectiveCount', format === 'subjective']
    ]) {
      const input = field(key);
      input.disabled = blocked;
      input.placeholder = blocked ? 'ไม่ใช้กับรูปแบบนี้' : 'ไม่ระบุ';
      if (blocked) { input.value = ''; showFieldError(key); }
    }
  }

  function values() {
    const value = key => String(field(key).value ?? '').trim();
    const count = key => field(key).disabled ? '' : value(key);
    return {
      course: value('course'), title: value('title'), academicYear: value('academicYear'),
      semester: value('semester'), examPeriod: value('examPeriod'), examType: value('examType'),
      subjectiveCount: count('subjectiveCount'), objectiveCount: count('objectiveCount'),
      topics: value('topics'), note: value('note')
    };
  }

  function validate(input) {
    const errors = {};
    if (!catalog.some(course => course.code === input.course)) errors.course = 'กรุณาเลือกรายวิชาที่มีอยู่ในระบบ';
    if (!input.title) errors.title = 'กรุณากรอกชื่อแนวข้อสอบ ห้ามเว้นว่างหรือใส่เฉพาะช่องว่าง';
    else if (Array.from(input.title).length > 200) errors.title = 'ชื่อแนวข้อสอบต้องไม่เกิน 200 ตัวอักษร';
    if (!config.academicYears.map(String).includes(input.academicYear)) errors.academicYear = 'กรุณาเลือกปีการศึกษาที่กำหนด';
    if (!['1', '2', '3'].includes(input.semester)) errors.semester = 'กรุณาเลือกภาคเรียน';
    if (!['midterm', 'final'].includes(input.examPeriod)) errors.examPeriod = 'กรุณาเลือกช่วงการสอบ';
    if (!['objective', 'subjective', 'mixed'].includes(input.examType)) errors.examType = 'กรุณาเลือกรูปแบบข้อสอบ';
    if (!input.topics) errors.topics = 'กรุณากรอกหัวข้อที่เคยออกสอบ';
    else if (Array.from(input.topics).length > 2000) errors.topics = 'หัวข้อที่เคยออกสอบต้องไม่เกิน 2,000 ตัวอักษร';
    if (Array.from(input.note).length > 2000) errors.note = 'คำแนะนำต้องไม่เกิน 2,000 ตัวอักษร';
    for (const key of ['subjectiveCount', 'objectiveCount']) {
      if (field(key).disabled) continue;
      if (field(key).validity.badInput || (input[key] !== ''
        && (!/^[1-9]\d*$/.test(input[key]) || !Number.isSafeInteger(Number(input[key]))))) {
        errors[key] = 'จำนวนข้อต้องเป็นจำนวนเต็มมากกว่า 0 หรือเว้นว่างเมื่อไม่ระบุ';
      }
    }
    return errors;
  }

  function payload(input) {
    const course = catalog.find(row => row.code === input.course);
    return {
      course_id: course.id, title: input.title, academic_year: Number(input.academicYear),
      semester: Number(input.semester), exam_period: input.examPeriod, exam_format: input.examType,
      subjective_count: input.subjectiveCount === '' ? null : Number(input.subjectiveCount),
      objective_count: input.objectiveCount === '' ? null : Number(input.objectiveCount),
      topics: input.topics, additional_advice: input.note || null
    };
  }

  function updateControls() {
    fieldset.disabled = !ready || submitting || saved || uncertain;
    submit.textContent = saved ? 'บันทึกแล้ว' : uncertain ? 'กรุณาตรวจผลก่อนส่งซ้ำ'
      : submitting ? 'กำลังบันทึก…' : 'เผยแพร่';
    form.setAttribute('aria-busy', String(submitting));
    const cancel = $('.btn-cancel');
    cancel.setAttribute('aria-disabled', String(submitting));
  }

  function detailUrl(courseCode, id) {
    const query = new URLSearchParams({ course: courseCode, guide: String(id) });
    query.set('source', 'api');
    return `read-courses.html?${query}`;
  }

  function setupSelect(select, rows, placeholder, getValue, getText) {
    const previous = select.value;
    const options = [new Option(placeholder, ''), ...rows.map(row => new Option(getText(row), getValue(row)))];
    options[0].disabled = true;
    select.replaceChildren(...options);
    select.value = rows.some(row => String(getValue(row)) === previous) ? previous : '';
  }

  async function initialize() {
    ready = false;
    updateControls();
    $('#publish-retry').hidden = true;
    clearErrors();
    status('กำลังเตรียมข้อมูล…');
    try {
      if (!Array.isArray(config.academicYears) || !config.academicYears.length
        || config.academicYears.some(year => !Number.isInteger(year) || year < 2400 || year > 32767)) {
        throw new Error('รายการปีการศึกษาไม่ถูกต้อง กรุณาตรวจ guide-config.js');
      }
      user = await window.currentUserReady;

      if (!user) {
        window.location.replace('login.html');
        return;
      }
      if (!Number.isSafeInteger(user.id) || user.id <= 0) throw new Error('รูปแบบข้อมูลบัญชีจากเซิร์ฟเวอร์ไม่ถูกต้อง');
      catalog = await window.GuideApi.courses();
      $('#author').value = user.display_name || user.username;
      if (!catalog.length) throw new Error('ยังไม่มีรายวิชาให้เผยแพร่ กรุณาตรวจข้อมูลรายวิชา');
      setupSelect(field('course'), catalog, 'เลือกรายวิชา', row => row.code, row => `${row.code} - ${row.name}`);
      setupSelect(field('academicYear'), config.academicYears, 'เลือกปีการศึกษา', String, String);
      const code = new URL(window.location.href).searchParams.get('course');
      if (!field('course').value && catalog.some(row => row.code === code)) field('course').value = code;
      ready = true;
      syncCounts();
      status('');
    } catch (error) {
      showErrors({}, error.message || 'เตรียมข้อมูลไม่สำเร็จ');
      $('#publish-login').hidden = error.status !== 401;
      $('#publish-retry').hidden = false;
      status('ยังไม่พร้อมเผยแพร่', 'error');
    }
    updateControls();
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!ready || submitting || saved || uncertain) return;
    syncCounts();
    clearErrors();
    const input = values();
    const errors = validate(input);
    if (Object.keys(errors).length) { showErrors(errors); return; }
    submitting = true;
    updateControls();
    status('กำลังบันทึกข้อมูล…');
    try {
      const row = await window.GuideApi.publish(payload(input), input.course);
      saved = true;
      $('#publish-success').hidden = false;
      $('#publish-success-text').textContent = 'เผยแพร่สำเร็จ กำลังเปิดรายละเอียด';
      const url = detailUrl(input.course, row.id);
      $('#published-link').href = url;
      status('เผยแพร่สำเร็จ', 'success');
      // Keep a usable link and the saved state even if navigation is unavailable.
      try { window.location.assign(url); } catch (_) { $('#published-link').focus(); }
    } catch (error) {
      uncertain = Boolean(error.uncertain);
      const errors = {};
      for (const item of error.fields || []) {
        const key = serverFields[item.field];
        if (key && typeof item.message === 'string') errors[key] = item.message;
      }
      const message = error.message || 'บันทึกไม่สำเร็จ ข้อมูลที่กรอกยังอยู่ กรุณาลองใหม่';
      showErrors(errors, message);
      $('#publish-login').hidden = error.status !== 401;
      $('#publish-check').hidden = !uncertain;
      status(uncertain ? 'ยังยืนยันผลบันทึกไม่ได้' : 'บันทึกไม่สำเร็จ', 'error');
    } finally {
      submitting = false;
      updateControls();
    }
  });

  for (const key of Object.keys(fieldIds)) {
    field(key).addEventListener('input', () => showFieldError(key));
    field(key).addEventListener('change', () => showFieldError(key));
  }
  field('examType').addEventListener('change', syncCounts);
  $('.btn-cancel').addEventListener('click', event => { if (submitting) event.preventDefault(); });
  $('#publish-errors').addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    if (link) { event.preventDefault(); document.getElementById(link.getAttribute('href').slice(1))?.focus(); }
  });
  $('#publish-retry').addEventListener('click', initialize);
  initialize();
})();
