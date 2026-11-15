(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const form = $('summary-form');
  const fields = $('summary-fields');
  const courseInput = $('summary-course');
  const titleInput = $('summary-title');
  const descriptionInput = $('summary-description');
  const fileInput = $('summary-file');
  const fileName = $('summary-file-name');
  const previewButton = $('summary-preview-button');
  const preview = $('summary-preview');
  const previewFrame = $('summary-preview-frame');
  const previewOpen = $('summary-preview-open');
  const success = $('summary-success');
  const dropZone = $('summary-drop');
  const status = $('summary-upload-status');
  const alert = $('summary-upload-error');
  const result = $('summary-upload-result');
  const resultMessage = $('summary-upload-message');
  const readLink = $('summary-upload-link');
  const courseLink = $('summary-upload-course-link');
  const retryCourses = $('summary-courses-retry');
  const verify = $('summary-verify');
  const examInputs = {
    academic_year: [$('summary-year'), 'ปีการศึกษา'],
    semester: [$('summary-semester'), 'ภาคเรียน'],
    exam_period: [$('summary-period'), 'ช่วงการสอบ']
  };
  const inputs = {course_id: courseInput, title: titleInput, description: descriptionInput, file: fileInput,
    ...Object.fromEntries(Object.entries(examInputs).map(([name, [input]]) => [name, input]))};
  const summaryApi = window.SummaryApi;
  let courses = [];
  let selectedFile;
  let previewUrl;
  let user;
  let pendingCheck;

  function fieldError(input, message = '') {
    const error = $(`${input.id}-error`);
    error.textContent = message;
    error.hidden = !message;
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function showError(message = '') {
    alert.textContent = message;
    alert.hidden = !message;
    if (message) alert.focus();
  }

  async function loadCourses() {
    fields.disabled = true;
    retryCourses.hidden = true;
    showError();
    status.textContent = 'กำลังโหลดรายวิชา…';
    try {
      user = await window.currentUserReady;
      if (!user) return;
      courses = await window.CourseApi.searchCourses();
      courseInput.options.length = 1;
      for (const course of courses) {
        courseInput.add(new Option(`${course.code} — ${course.name}`, course.id));
      }
      if (courses.length) fields.disabled = false;
      else showError('ไม่พบรายวิชา CS ที่เผยแพร่สรุปได้');
    } catch (error) {
      if (error.status !== 401) {
        showError('โหลดรายวิชาไม่สำเร็จ กรุณาลองอีกครั้ง');
        retryCourses.hidden = false;
      }
    } finally {
      status.textContent = '';
    }
  }

  function chooseFile(files) {
    const [file] = files;
    const message = summaryApi.pdfSelectionError(files);

    selectedFile = message ? undefined : file;
    if (message) fileInput.value = '';
    fileName.textContent = selectedFile?.name || '';
    fileName.hidden = !selectedFile;
    previewButton.hidden = !selectedFile;
    fieldError(fileInput, message);
  }

  previewButton.addEventListener('click', async () => {
    const file = selectedFile;
    if (!file || fields.disabled || preview.open) return;
    const message = await summaryApi.pdfSignatureError(file);
    if (file !== selectedFile || fields.disabled || preview.open) return;
    if (message) {
      fieldError(fileInput, message);
      fileInput.focus();
      return;
    }
    const pdf = file.type ? file : file.slice(0, file.size, 'application/pdf');
    previewUrl = URL.createObjectURL(pdf);
    $('summary-preview-name').textContent = file.name;
    previewFrame.src = `${previewUrl}#view=FitH`;
    previewOpen.href = previewUrl;
    preview.showModal();
  });

  preview.addEventListener('close', () => {
    previewFrame.removeAttribute('src');
    previewOpen.removeAttribute('href');
    URL.revokeObjectURL(previewUrl);
    previewUrl = undefined;
  });

  success.addEventListener('close', () => {
    form.reset();
    chooseFile([]);
    fields.disabled = false;
    courseInput.focus();
  });

  function showResult(message, course, id) {
    result.hidden = false;
    resultMessage.textContent = message;
    courseLink.href = summaryApi.courseUrl({id: course.id, course_code: course.code});
    readLink.hidden = !id;
    if (id) readLink.href = `read-summary.html?summary=${id}`;
  }

  async function validate(course, title, description, examMetadata) {
    if (!course) fieldError(courseInput, 'กรุณาเลือกรายวิชา CS');
    if (!title || [...title].length > 200) fieldError(titleInput, 'กรุณากรอกชื่อสรุปความยาว 1 ถึง 200 ตัวอักษร');
    if ([...description].length > 2000) fieldError(descriptionInput, 'ข้อมูลประกอบต้องไม่เกิน 2,000 ตัวอักษร');
    for (const [name, [input, label]] of Object.entries(examInputs)) {
      if (!examMetadata[name]) fieldError(input, `กรุณาเลือก${label}`);
    }
    if (!selectedFile && fileInput.getAttribute('aria-invalid') !== 'true') {
      fieldError(fileInput, 'กรุณาแนบไฟล์ PDF');
    }
    if (selectedFile) {
      const message = await summaryApi.pdfSignatureError(selectedFile);
      if (message) fieldError(fileInput, message);
    }
    return form.querySelector('[aria-invalid="true"]');
  }

  async function publish(event) {
    event.preventDefault();
    if (fields.disabled) return;
    const course = courses.find(item => item.id === Number(courseInput.value));
    const title = titleInput.value.trim();
    const description = descriptionInput.value.trim();
    const examMetadata = Object.fromEntries(Object.entries(examInputs).map(([name, [input]]) => [name, input.value]));
    fields.disabled = true;
    showError();
    result.hidden = true;
    const invalid = await validate(course, title, description, examMetadata);
    if (invalid) {
      fields.disabled = false;
      invalid.focus();
      return;
    }

    status.textContent = 'กำลังเผยแพร่สรุป…';
    try {
      const summary = await summaryApi.publish(course.id, title, description, selectedFile, examMetadata);
      $('summary-success-name').textContent = summary.title;
      $('summary-success-read').href = `read-summary.html?summary=${summary.id}`;
      success.showModal();
    } catch (error) {
      if (error.status === 401) return;
      if (error.status === 0 || [502, 504].includes(error.status)) {
        pendingCheck = {course, title, description, file: selectedFile, examMetadata};
        showResult('ยังยืนยันผลไม่ได้ กรุณาตรวจสอบรายการของคุณก่อนส่งอีกครั้งเพื่อเลี่ยงรายการซ้ำ', course);
        verify.hidden = false;
        verify.focus();
        return;
      }
      const errors = error.fields || [];
      for (const {field, message} of errors) {
        if (Object.hasOwn(inputs, field)) fieldError(inputs[field], message);
      }
      if (error.status === 413) fieldError(fileInput, 'ไฟล์ PDF ต้องมีขนาดไม่เกิน 15 MB');
      if (error.status === 404) fieldError(courseInput, 'ไม่พบรายวิชา CS ที่เลือก');
      fields.disabled = false;
      showError(`เผยแพร่สรุปไม่สำเร็จ — ${error.message}`);
    } finally {
      status.textContent = '';
    }
  }

  verify.addEventListener('click', async () => {
    const {course, title, description, file, examMetadata} = pendingCheck;
    verify.disabled = true;
    resultMessage.textContent = 'กำลังตรวจรายการสรุปของคุณในรายวิชา…';
    try {
      const summaries = await summaryApi.list(course.id);
      const match = summaries.find(item => item.owner.id === user.id && item.title === title
        && (item.description || '') === description && item.file.size_bytes === file.size
        && Object.entries(examMetadata).every(([name, value]) => String(item[name]) === value));
      if (match) {
        showResult('พบสรุปของคุณที่ตรงกับข้อมูลที่ส่ง กรุณาเปิดเพื่อตรวจสอบ', course, match.id);
        readLink.focus();
      } else {
        showResult('ยังไม่พบสรุปของคุณที่ตรงกับข้อมูลที่ส่ง ตอนนี้คุณตรวจแบบฟอร์มและกดเผยแพร่ได้อีกครั้ง', course);
        fields.disabled = false;
        titleInput.focus();
      }
      verify.hidden = true;
      pendingCheck = null;
    } catch (error) {
      if (error.status !== 401) resultMessage.textContent = 'ตรวจสอบรายการไม่ได้ กรุณาลองตรวจอีกครั้ง';
    } finally {
      verify.disabled = false;
    }
  });

  fileInput.addEventListener('change', () => chooseFile(fileInput.files));
  for (const input of Object.values(inputs).filter(input => input !== fileInput)) {
    input.addEventListener('input', () => fieldError(input));
  }
  for (const name of ['dragenter', 'dragover']) {
    dropZone.addEventListener(name, event => {
      event.preventDefault();
      if (!fields.disabled) dropZone.classList.add('is-dragging');
    });
  }
  dropZone.addEventListener('dragleave', event => {
    if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('is-dragging');
  });
  dropZone.addEventListener('drop', event => {
    event.preventDefault();
    dropZone.classList.remove('is-dragging');
    if (fields.disabled) return;
    fileInput.value = '';
    chooseFile(event.dataTransfer.files);
  });
  form.noValidate = true;
  form.addEventListener('submit', publish);
  retryCourses.addEventListener('click', () => {
    if (user) loadCourses();
    else window.location.reload();
  });
  for (const year of window.GuidePublishConfig.academicYears) $('summary-year').add(new Option(year, year));
  loadCourses();
})();
