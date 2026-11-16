(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const api = window.SummaryApi;
  const {escapeHtml: e} = window.UiUtils;
  const list = $('my-summary-list');
  const status = $('summary-management-status');
  const search = $('summary-search');
  const courseFilter = $('summary-course-filter');
  const filterButton = $('summary-filter-toggle');
  const filters = $('summary-filters');
  const clearCourse = $('summary-clear-course');
  const editor = $('summary-editor');
  const editForm = $('summary-editor-form');
  const editFields = $('summary-editor-fields');
  const editSave = $('summary-edit-save');
  const editCancel = $('summary-edit-cancel');
  const editRefresh = $('summary-edit-refresh');
  const editError = $('summary-editor-error');
  const courseStatus = $('summary-edit-course-status');
  const courseInput = $('summary-edit-course');
  const titleInput = $('summary-edit-title');
  const descriptionInput = $('summary-edit-description');
  const fileInput = $('summary-edit-file');
  const keepFile = $('summary-edit-keep-file');
  const dropZone = $('summary-edit-drop');
  const previewButton = $('summary-edit-preview-button');
  const previewNewButton = $('summary-edit-preview-new');
  const preview = $('summary-edit-preview');
  const previewFrame = $('summary-edit-preview-frame');
  const previewLink = $('summary-edit-preview-open');
  const previewStatus = $('summary-edit-preview-status');
  const previewError = $('summary-edit-preview-error');
  const inputs = {course_id: courseInput, title: titleInput, description: descriptionInput, file: fileInput};
  const deleteDialog = $('summary-delete-dialog');
  const deleteConfirm = $('summary-delete-confirm');
  const deleteCancel = $('summary-delete-cancel');
  const deleteError = $('summary-delete-error');
  const dateFormat = new Intl.DateTimeFormat('th-TH', {dateStyle: 'medium', timeZone: 'Asia/Bangkok'});
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  let rows = [];
  let loadError = '';
  let loading = false;
  let busy = false;
  let editing;
  let deleting;
  let selectedFile;
  let coursesRequest;
  let previewRequest;
  let previewUrl;
  let editBlock = '';
  let editFailure = '';

  function publishedDate(summary) {
    const time = Date.parse(summary.created_at);
    return Number.isFinite(time) ? `เผยแพร่เมื่อ ${dateFormat.format(time)}` : '';
  }

  function card(summary) {
    const query = new URLSearchParams({summary: summary.id, source: 'my-summaries'});
    return `<article class="exam-card summary-owned-card">
      <div>
        <div class="badges">
          <span class="badge code">${e(summary.course.course_code)}</span><span class="badge">สรุปเนื้อหา</span>
          <span class="summary-owner-note">${e(publishedDate(summary))}</span>
        </div>
        <h3 class="exam-card-title" title="${e(summary.title)}">${e(summary.title)}</h3>
        <p class="summary-owned-course">${e(summary.course.course_name)}</p>
        ${summary.description ? `<p class="description">${e(summary.description)}</p>` : ''}
      </div>
      <div class="card-side">
        <div class="card-actions">
          <div class="compact-review-score" data-review-score-id="${e(summary.id)}" data-review-score-type="summary" hidden></div>
          <a class="open" href="read-summary.html?${e(query.toString())}">${icon('openbook')}เปิดอ่านสรุปเนื้อหา</a>
          <button type="button" data-summary-action="edit" data-summary-id="${e(summary.id)}">${icon('edit')}แก้ไขข้อมูล</button>
          <button type="button" class="delete" data-summary-action="delete" data-summary-id="${e(summary.id)}">${icon('trash')}ลบรายการ</button>
        </div>
      </div>
    </article>`;
  }

  function render() {
    clearCourse.hidden = !courseFilter.value;
    clearCourse.textContent = courseFilter.value ? `${courseFilter.value} ×` : '';
    clearCourse.setAttribute('aria-label', `ล้างตัวกรอง ${courseFilter.value}`);
    if (loading) {
      list.innerHTML = '<p role="status">กำลังโหลดรายการสรุป PDF…</p>';
      return;
    }
    if (loadError) {
      list.innerHTML = `<div class="empty"><p role="alert">${e(loadError)}</p><button type="button" class="primary" data-summary-action="retry">ลองอีกครั้ง</button></div>`;
      return;
    }
    if (!rows.length) {
      list.innerHTML = '<div class="empty"><h3>คุณยังไม่ได้แบ่งปันสรุป PDF</h3><a class="primary" href="upload-summary.html">แบ่งปันสรุป</a></div>';
      return;
    }
    const term = search.value.trim().toLocaleLowerCase();
    const filtered = rows.filter(row => (!courseFilter.value || row.course.course_code === courseFilter.value)
      && `${row.course.course_code} ${row.course.course_name} ${row.title}`.toLocaleLowerCase().includes(term));
    list.innerHTML = filtered.length ? filtered.map(card).join('')
      : '<div class="empty"><h3>ไม่พบสรุปที่ตรงกับการค้นหา</h3><button type="button" class="primary" data-summary-action="clear">ล้างการค้นหาและตัวกรอง</button></div>';
    window.Reviews?.connectScores(list);
  }

  function refreshFilters() {
    const selected = courseFilter.value;
    const courses = new Map(rows.map(({course}) => [course.course_code, course.course_name]));
    courseFilter.replaceChildren(new Option('ทุกรายวิชา', ''));
    for (const [code, name] of [...courses].sort()) courseFilter.add(new Option(`${code} — ${name}`, code));
    courseFilter.value = courses.has(selected) ? selected : '';
  }

  async function load() {
    if (loading) return false;
    loading = true;
    loadError = '';
    render();
    try {
      rows = await api.mine();
      refreshFilters();
      return true;
    } catch (error) {
      loadError = error.message || 'โหลดรายการสรุป PDF ไม่สำเร็จ กรุณาลองใหม่';
      return false;
    } finally {
      loading = false;
      render();
    }
  }

  function showError(element, message = '') {
    element.textContent = message;
    element.hidden = !message;
  }

  function fieldError(input, message = '') {
    showError($(`${input.id}-error`), message);
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function chooseFile(files) {
    const message = api.pdfSelectionError(files);
    selectedFile = message ? undefined : files[0];
    if (message) fileInput.value = '';
    $('summary-edit-file-name').textContent = selectedFile?.name || editing.file.original_name;
    previewButton.textContent = selectedFile ? 'ดูตัวอย่างไฟล์ที่เผยแพร่' : 'ดูตัวอย่างไฟล์เดิม';
    previewNewButton.hidden = !selectedFile;
    keepFile.hidden = !(selectedFile || message);
    fieldError(fileInput, message);
  }

  function releasePreview() {
    previewRequest?.abort();
    previewRequest = undefined;
    previewFrame.hidden = previewLink.hidden = true;
    previewFrame.removeAttribute('src');
    previewLink.removeAttribute('href');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = undefined;
  }

  async function openPreview(file) {
    if (!editor.open || busy || preview.open) return;
    const summary = editing;
    releasePreview();
    showError(previewError);
    $('summary-edit-preview-title').textContent = file ? 'ตัวอย่างไฟล์ PDF ใหม่' : 'ตัวอย่างไฟล์ PDF เดิม';
    $('summary-edit-preview-name').textContent = file?.name || summary.file.original_name;
    previewStatus.textContent = 'กำลังเปิดตัวอย่าง…';
    previewStatus.hidden = false;
    preview.showModal();
    const request = new AbortController();
    previewRequest = request;
    try {
      let pdf;
      if (file) {
        const message = await api.pdfSignatureError(file);
        if (message) throw new Error(message);
        pdf = file.type ? file : file.slice(0, file.size, 'application/pdf');
      } else {
        pdf = await api.openFile(summary.id, request.signal);
      }
      if (!preview.open || request.signal.aborted) return;
      previewUrl = URL.createObjectURL(pdf);
      previewFrame.src = `${previewUrl}#view=FitH`;
      previewLink.href = previewUrl;
      previewFrame.hidden = previewLink.hidden = false;
    } catch (error) {
      if (preview.open && !request.signal.aborted && error.status !== 401) showError(previewError, error.message);
    } finally {
      if (previewRequest === request) {
        previewRequest = undefined;
        previewStatus.hidden = true;
      }
    }
  }

  previewButton.addEventListener('click', () => openPreview());
  previewNewButton.addEventListener('click', () => openPreview(selectedFile));

  preview.addEventListener('close', () => {
    if (!preview.open) releasePreview();
  });

  function setCourses(courses, current) {
    const available = new Map([[editing.course.id, editing.course]]);
    for (const course of courses) available.set(course.id, {
      course_code: course.code, course_name: course.name
    });
    courseInput.replaceChildren();
    for (const [id, course] of available) {
      courseInput.add(new Option(`${course.course_code} — ${course.course_name}`, id));
    }
    courseInput.value = String(current);
  }

  async function openEditor(summary) {
    editing = summary;
    editBlock = '';
    editFailure = '';
    editRefresh.hidden = true;
    editSave.disabled = false;
    editForm.reset();
    for (const input of Object.values(inputs)) fieldError(input);
    showError(editError);
    showError(courseStatus);
    setCourses([], summary.course.id);
    titleInput.value = summary.title;
    descriptionInput.value = summary.description ?? '';
    chooseFile([]);
    editor.showModal();
    try {
      coursesRequest ??= window.CourseApi.searchCourses();
      const courses = await coursesRequest;
      if (editor.open && editing === summary) setCourses(courses, courseInput.value);
    } catch (error) {
      coursesRequest = undefined;
      if (error.status !== 401 && editor.open && editing === summary) {
        showError(courseStatus, 'โหลดรายวิชาอื่นไม่สำเร็จ กรุณาปิดและเปิดฟอร์มอีกครั้งหากต้องการย้ายวิชา');
      }
    }
  }

  function openDelete(summary) {
    deleting = summary;
    showError(deleteError);
    $('summary-delete-title').textContent = summary.title;
    $('summary-delete-meta').textContent = [summary.course.course_code, publishedDate(summary)].filter(Boolean).join(' · ');
    deleteDialog.showModal();
  }

  function setBusy(value, controls) {
    busy = value;
    for (const control of controls) control.disabled = value;
  }

  function setEditBusy(value) {
    setBusy(value, [editFields, editCancel]);
    editSave.disabled = value || Boolean(editBlock);
  }

  const isUncertain = error => error.status === 0 || error.status >= 500;

  async function verifyEditResult() {
    editRefresh.hidden = true;
    showError(editError, 'ยังยืนยันผลการแก้ไขไม่ได้ กำลังตรวจสอบรายการล่าสุด…');
    if (!(await load())) {
      showError(editError, `${editFailure} ตรวจสอบรายการล่าสุดไม่ได้ กรุณาตรวจสอบอีกครั้งก่อนบันทึกซ้ำ`);
      editRefresh.hidden = false;
    } else {
      const latest = rows.find(row => row.id === editing.id);
      editBlock = latest ? '' : 'missing';
      if (latest) {
        editing = latest;
        if (!selectedFile) $('summary-edit-file-name').textContent = latest.file.original_name;
        showError(editError, `${editFailure} โหลดรายการล่าสุดแล้ว กรุณาตรวจไฟล์ที่เผยแพร่ก่อนบันทึกอีกครั้ง`);
      } else {
        showError(editError, 'ไม่พบสรุปในรายการล่าสุด ข้อมูลที่กรอกยังอยู่ในฟอร์ม');
      }
    }
    editError.focus();
  }

  editRefresh.addEventListener('click', async () => {
    if (!editor.open || busy || editBlock !== 'refresh') return;
    setEditBusy(true);
    try {
      await verifyEditResult();
    } finally {
      setEditBusy(false);
    }
  });

  async function refreshAfterFailure(error, dialog) {
    if (error.status === 401) return true;
    const uncertain = isUncertain(error);
    const stale = error.status === 403 || error.code === 'SUMMARY_NOT_FOUND';
    if (!uncertain && !stale) return false;
    dialog.close();
    status.textContent = uncertain
      ? 'ยังยืนยันผลไม่ได้ กรุณาตรวจรายการล่าสุดก่อนลองอีกครั้ง'
      : error.message || 'ไม่พบรายการสรุปที่คุณจัดการได้';
    await load();
    $('summary-list-heading').focus();
    return true;
  }

  editForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!editor.open || busy || editBlock) return;
    const courseId = Number(courseInput.value);
    const title = titleInput.value.trim();
    const description = descriptionInput.value.trim();
    setEditBusy(true);
    showError(editError);
    try {
      fieldError(courseInput, courseId ? '' : 'กรุณาเลือกรายวิชา');
      fieldError(titleInput, title && [...title].length <= 200 ? '' : 'กรุณากรอกชื่อสรุป 1 ถึง 200 ตัวอักษร');
      fieldError(descriptionInput, [...description].length <= 2000 ? '' : 'ข้อมูลประกอบต้องไม่เกิน 2,000 ตัวอักษร');
      if (selectedFile) fieldError(fileInput, await api.pdfSignatureError(selectedFile));
      const invalid = editForm.querySelector('[aria-invalid="true"]');
      if (invalid) {
        editFields.disabled = false;
        invalid.focus();
        return;
      }
      editSave.textContent = 'กำลังบันทึก…';
      const updated = await api.update(editing.id, courseId, title, description, selectedFile);
      rows = rows.map(row => row.id === updated.id ? updated : row);
      editor.close();
      search.value = '';
      courseFilter.value = '';
      refreshFilters();
      render();
      status.textContent = 'บันทึกการแก้ไขสรุปแล้ว';
      $('summary-list-heading').focus();
    } catch (error) {
      if (isUncertain(error)) {
        editBlock = 'refresh';
        editFailure = error.message || 'ยังยืนยันผลการแก้ไขไม่ได้';
        await verifyEditResult();
        return;
      }
      if (await refreshAfterFailure(error, editor)) return;
      for (const {field, message} of error.fields || []) {
        if (Object.hasOwn(inputs, field)) fieldError(inputs[field], message);
      }
      if (error.code === 'COURSE_NOT_FOUND') fieldError(courseInput, 'ไม่พบรายวิชา CS ที่เลือก');
      if (error.status === 413) fieldError(fileInput, 'ไฟล์ PDF ต้องมีขนาดไม่เกิน 15 MB');
      showError(editError, error.message || 'บันทึกการแก้ไขไม่สำเร็จ');
      editError.focus();
    } finally {
      setEditBusy(false);
      editSave.textContent = 'บันทึกการแก้ไข';
    }
  });

  $('summary-delete-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!deleteDialog.open || busy) return;
    const controls = [deleteConfirm, deleteCancel];
    setBusy(true, controls);
    showError(deleteError);
    try {
      await api.remove(deleting.id);
      rows = rows.filter(row => row.id !== deleting.id);
      deleteDialog.close();
      refreshFilters();
      render();
      status.textContent = 'ลบสรุป PDF แล้ว';
      $('summary-list-heading').focus();
    } catch (error) {
      if (await refreshAfterFailure(error, deleteDialog)) return;
      showError(deleteError, error.message || 'ลบสรุปไม่สำเร็จ');
      deleteError.focus();
    } finally {
      setBusy(false, controls);
    }
  });

  list.addEventListener('click', event => {
    const button = event.target.closest('[data-summary-action]');
    if (!button || busy) return;
    const {summaryAction, summaryId} = button.dataset;
    if (summaryAction === 'retry') return load();
    if (summaryAction === 'clear') {
      search.value = '';
      courseFilter.value = '';
      render();
      search.focus();
      return;
    }
    const row = rows.find(item => String(item.id) === summaryId);
    if (!row) return;
    status.textContent = '';
    if (summaryAction === 'edit') openEditor(row);
    else if (summaryAction === 'delete') openDelete(row);
  });

  function setFilterOpen(open) {
    filters.hidden = !open;
    filterButton.setAttribute('aria-expanded', String(open));
  }

  $('summary-search-form').addEventListener('submit', event => { event.preventDefault(); render(); });
  search.addEventListener('input', render);
  filterButton.addEventListener('click', () => setFilterOpen(filters.hidden));
  courseFilter.addEventListener('change', () => {
    setFilterOpen(false);
    render();
    filterButton.focus();
  });
  clearCourse.addEventListener('click', () => { courseFilter.value = ''; render(); filterButton.focus(); });
  editCancel.addEventListener('click', () => editor.close());
  deleteCancel.addEventListener('click', () => deleteDialog.close());
  for (const dialog of [editor, deleteDialog]) {
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  }
  editor.addEventListener('close', () => {
    if (!editor.open) {
      editForm.reset();
      selectedFile = undefined;
    }
  });
  for (const input of [courseInput, titleInput, descriptionInput]) {
    input.addEventListener('input', () => fieldError(input));
  }
  fileInput.addEventListener('change', () => chooseFile(fileInput.files));
  keepFile.addEventListener('click', () => { fileInput.value = ''; chooseFile([]); fileInput.focus(); });
  dropZone.addEventListener('dragover', event => {
    event.preventDefault();
    if (!busy) dropZone.classList.add('is-dragging');
  });
  dropZone.addEventListener('dragleave', event => {
    if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('is-dragging');
  });
  dropZone.addEventListener('drop', event => {
    event.preventDefault();
    dropZone.classList.remove('is-dragging');
    if (busy) return;
    fileInput.value = '';
    chooseFile(event.dataTransfer.files);
  });

  window.MySummaries = Object.freeze({load});
})();
