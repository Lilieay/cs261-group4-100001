(() => {
  'use strict';
  const data = window.UiUtils;
  const e = data.escapeHtml;
  const params = new URL(window.location.href).searchParams;
  let course = null;
  const guideId = params.get('guide');
  let apiRow = null;
  let apiError = '';
  let authRequired = false;
  let loadVersion = 0;
  let saving = false;
  let savedKnown = false;
  let savedError = '';
  const content = document.querySelector('#readingContent');
  const back = document.querySelector('#readingBack');

  function safeReturnUrl(candidate, code) {
    const fallback = code ? `choose-courses.html?${new URLSearchParams({course:code})}` : 'courses.html';
    if (!candidate) return fallback;
    try {
      const url = new URL(candidate, window.location.href);
      const expected = new URL('choose-courses.html', window.location.href);
      if (url.origin !== expected.origin) return fallback;
      const saved = new URL('saved-courses.html', window.location.href);
      if (url.pathname === saved.pathname && !url.search) return 'saved-courses.html';
      const shared = new URL('shared-courses.html', window.location.href);
      if (url.pathname === shared.pathname && !url.search) return `shared-courses.html${url.hash}`;
      if (url.pathname !== expected.pathname || url.searchParams.get('course') !== code) return fallback;
      return `choose-courses.html${url.search}${url.hash}`;
    } catch (_) { return fallback; }
  }

  function renderGuide(row) {
    const counts = data.questionCounts(row);
    const format = row.formats.join(' / ') || 'ไม่ระบุ';
    const count = value => value == null ? 'ไม่ระบุ' : `${value} ข้อ`;
    return [
      `<h1>${e(row.title)}</h1><div class="subheading"><p>แบ่งปันโดย ${e(row.publisher_name || data.publisherName(row))}</p></div><p class="reading-course-name">${e(course.code)} ${e(course.name)}</p>`,
      `<div class="meta-grid"><div>รายวิชา : <strong>${e(course.code)}</strong></div><div>ปีการศึกษา: <strong>${e(row.year)}</strong></div><div>ภาคเรียน: <strong>${e(data.semesterLabel(row.semester))}</strong></div><div>ช่วงสอบ : <strong>${e(row.period)}</strong></div></div>`,
      `<section class="info-card topics-card"><h2>หัวข้อที่เคยออกสอบ</h2><p class="reading-text">${e(row.topics || 'ไม่ระบุ')}</p></section>`,
      `<section class="info-card format-card"><h2>รูปแบบแนวข้อสอบ — ${e(format)}</h2><div class="format-grid"><div>ปรนัย : <strong>${e(count(counts.objective))}</strong></div><div>อัตนัย : <strong>${e(count(counts.essay))}</strong></div></div></section>`,
      `<section class="info-card advice-card"><h2>คำแนะนำเพิ่มเติม</h2><p class="reading-text">${e(String(row.notes || '').trim() || 'ไม่ระบุ')}</p></section>`,
      `<div class="actions"><button class="save-button" type="button" aria-pressed="${Boolean(row.saved)}" ${(!savedKnown || saving) ? 'disabled' : ''} aria-busy="${saving}"><svg class="icon" aria-hidden="true"><use href="#i-save"/></svg> ${row.saved ? 'บันทึกแล้ว' : 'บันทึก'}</button><button class="review-button" type="button"><span class="review-open-icon" data-review-star-icon aria-hidden="true"></span> รีวิว</button></div>`,
      `${savedError ? `<p role="alert">${e(savedError)}</p><button type="button" class="saved-retry-button">ลองโหลดสถานะบันทึกอีกครั้ง</button>` : ''}`
    ].join('');
  }

  function render() {
    back.href = safeReturnUrl(params.get('returnTo'), course?.code);
    const backLabel = new URL(back.href, window.location.href).pathname
      === new URL('shared-courses.html', window.location.href).pathname
      ? 'กลับแนวข้อสอบของฉัน' : back.href.includes('saved-courses.html') ? 'กลับรายการที่บันทึก' : 'กลับหน้ารายวิชา';
    back.setAttribute('aria-label', backLabel);
    const row = apiRow;
    const error = apiError;
    if (!row) {
      document.title = 'ไม่พบแนวข้อสอบ';
      content.innerHTML = `<section class="reading-empty" role="status"><h1>${error ? 'โหลดข้อมูลไม่สำเร็จ' : 'ไม่พบแนวข้อสอบ'}</h1><p>${e(error || 'รายการไม่มีอยู่หรือถูกลบแล้ว')}</p>${authRequired ? '<p><a href="login.html">เข้าสู่ระบบใหม่</a></p>' : ''}${error && !authRequired ? '<button class="reading-retry-button" type="button">ลองอีกครั้ง</button>' : ''}<a class="reading-back-button" href="${e(back.href)}">${backLabel}</a></section>`;
      return;
    }
    document.title = `${row.title} | อ่านแนวข้อสอบ`;
    content.innerHTML = renderGuide(row);
    window.Reviews?.mountStarIcons(content);
  }
  content.addEventListener('click', async event => {
    const review = event.target.closest('.review-button');
    if (review && apiRow) {
      window.Reviews.open({id: apiRow.id, type: 'guide', title: apiRow.title,
        courseCode: course.code, courseName: course.name}, review);
      return;
    }
    if (event.target.closest('.reading-retry-button, .saved-retry-button')) {
      loadApiDetail();
      return;
    }
    if (!event.target.closest('.save-button') || saving) return;
    const status = document.querySelector('#reading-status');
    if (!apiRow || !savedKnown) return;
    if (apiRow.saved) {
      status.textContent = 'ได้บันทึกการแบ่งปันนี้ไปแล้ว';
      status.dataset.kind = 'success';
      return;
    }
    saving = true;
    render();
    status.textContent = 'กำลังบันทึก…';
    try {
      apiRow.saved = await window.SavedItems.state('guide', guideId, true);
      status.textContent = 'เพิ่มในรายวิชาที่บันทึกแล้ว';
      status.dataset.kind = 'success';
    } catch (error) {
      status.textContent = error.message || 'บันทึกรายการไม่สำเร็จ';
      status.dataset.kind = 'error';
      // Keep the write outcome visible while refreshing the current status.
      try { apiRow.saved = await window.SavedItems.state('guide', guideId); }
      catch (_) { savedKnown = false; savedError = 'ตรวจสอบสถานะบันทึกไม่ได้ กรุณาลองอีกครั้ง'; }
    } finally {
      saving = false;
      render();
      content.querySelector('.save-button')?.focus();
    }
  });
  async function loadApiDetail() {
    if (saving) return;
    if (!guideId) { apiError = 'ไม่พบแนวข้อสอบ'; render(); return; }
    const version = ++loadVersion;
    back.href = safeReturnUrl(params.get('returnTo'), course?.code);
    content.innerHTML = '<p role="status">กำลังโหลดแนวข้อสอบ…</p>';
    apiRow = null; apiError = ''; authRequired = false;
    savedKnown = false; savedError = '';
    try {
      if (!course) {
        const courseId = params.get('courseId');
        if (courseId) course = await window.CourseApi.getCourse(courseId);
        else {
          const courseCode = params.get('course');
          if (courseCode) {
            const matches = await window.CourseApi.searchCourses(courseCode);
            const match = matches.find(item => item.code.toUpperCase() === courseCode.trim().toUpperCase());
            if (match) course = await window.CourseApi.getCourse(match.id);
          }
        }
      }
      if (!course) throw new window.CourseApi.CourseApiError('ไม่พบรายวิชาในระบบ', 404);
      const expectedCode = params.get('course');
      if (expectedCode && expectedCode.toUpperCase() !== course.code.toUpperCase()) {
        throw new window.CourseApi.CourseApiError('รหัสรายวิชาไม่ตรงกับรายการที่เลือก', 404);
      }
      const response = await window.GuideApi.read(guideId, course.code);
      if (version !== loadVersion) return;
      apiRow = window.GuideApi.toGuideRow(response);
      render();
      try {
        const saved = await window.SavedItems.state('guide', guideId);
        if (version !== loadVersion) return;
        apiRow.saved = saved;
        savedKnown = true;
      } catch (error) {
        if (version !== loadVersion) return;
        savedError = error.message || 'โหลดสถานะบันทึกไม่สำเร็จ';
      }
    } catch (error) {
      if (version !== loadVersion) return;
      apiError = error.status === 404 ? '' : error.message;
      authRequired = error.status === 401;
    }
    render();
  }
  loadApiDetail();
  window.addEventListener('focus', loadApiDetail);
})();
