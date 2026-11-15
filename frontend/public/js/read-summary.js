(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(window.location.search);
  const summaryId = params.get('summary');
  const fromMySummaries = params.get('source') === 'my-summaries';
  const status = $('summary-read-status');
  const viewer = $('summary-viewer');
  const frame = $('summary-pdf');
  const open = $('summary-open-file');
  const fullscreen = $('summary-fullscreen');
  const fileError = $('summary-file-alert');
  const retry = $('summary-read-retry');
  const retryDetail = $('summary-detail-retry');
  const api = window.SummaryApi;
  let summary;
  let pdfUrl;
  let fileRequest;

  if (fromMySummaries) {
    $('summary-back').href = 'shared-courses.html?type=summaries';
    $('summary-back').setAttribute('aria-label', 'กลับหน้าสรุปของฉัน');
  }

  function releaseFile() {
    fileRequest?.abort();
    if (!pdfUrl) return;
    frame.removeAttribute('src');
    open.removeAttribute('href');
    URL.revokeObjectURL(pdfUrl);
    pdfUrl = undefined;
  }

  async function loadFile() {
    releaseFile();
    viewer.hidden = true;
    retry.hidden = true;
    fileError.hidden = true;
    status.textContent = 'กำลังเปิดไฟล์ PDF…';
    const controller = new AbortController();
    fileRequest = controller;
    try {
      const pdf = await api.openFile(summary.id, controller.signal);
      if (controller.signal.aborted) return;
      pdfUrl = URL.createObjectURL(pdf);
      open.href = pdfUrl;
      $('summary-file-label').textContent = summary.file.original_name;
      frame.src = `${pdfUrl}#zoom=100`;
      viewer.hidden = false;
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error.status !== 401) {
        fileError.textContent = `เปิดไฟล์ PDF ไม่สำเร็จ — ${error.message}`;
        fileError.hidden = false;
        retry.hidden = false;
      }
    } finally {
      if (fileRequest === controller) {
        fileRequest = undefined;
        status.textContent = '';
      }
    }
  }

  async function loadInstructor(courseId) {
    try {
      const {instructorName} = await window.CourseApi.getCourse(courseId);
      if (instructorName) {
        $('summary-instructor').textContent = `อาจารย์ผู้สอน : ${instructorName}`;
        $('summary-instructor').hidden = false;
      }
    } catch (_) {
      // The PDF and summary details can still be read if course metadata is unavailable.
    }
  }

  async function start() {
    retryDetail.hidden = true;
    status.textContent = 'กำลังโหลดสรุป…';
    try {
      summary = await api.read(summaryId);
      $('summary-reading-title').textContent = summary.title;
      document.title = `${summary.title} | พี่จ๋า ขอแนวข้อสอบหน่อย`;
      $('summary-owner').textContent = `แบ่งปันโดย ${summary.owner.display_name}`;
      if (summary.description) {
        $('summary-reading-description').textContent = summary.description;
        $('summary-description-box').hidden = false;
      }
      if (!fromMySummaries) {
        const back = new URL(api.courseUrl(summary.course), window.location.href);
        if (/^[1-9]\d*$/.test(params.get('page'))) back.searchParams.set('page', params.get('page'));
        if (['oldest', 'title'].includes(params.get('sort'))) back.searchParams.set('sort', params.get('sort'));
        for (const key of ['period', 'year', 'semester']) {
          if (params.has(key)) back.searchParams.set(key, params.get(key));
        }
        $('summary-back').href = back.pathname + back.search;
        $('summary-back').setAttribute('aria-label', 'กลับรายการสรุปในรายวิชา');
      }
      $('summary-detail').hidden = false;
      loadInstructor(summary.course.id);
      await loadFile();
    } catch (error) {
      status.textContent = error.message || 'โหลดสรุปไม่สำเร็จ';
      retryDetail.hidden = [401, 404, 422].includes(error.status);
    }
  }

  // Keep the file out of browser history and require a fresh authorized request on return.
  window.addEventListener('pagehide', releaseFile);
  window.addEventListener('pageshow', event => {
    if (event.persisted && summary) loadFile();
  });
  retry.addEventListener('click', loadFile);
  retryDetail.addEventListener('click', start);
  if (document.fullscreenEnabled && viewer.requestFullscreen) {
    fullscreen.hidden = false;
    fullscreen.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await viewer.requestFullscreen();
      } catch (_) {
        status.textContent = 'เปิดเต็มหน้าจอไม่ได้ในเบราว์เซอร์นี้';
      }
    });
    document.addEventListener('fullscreenchange', () => {
      const expanded = document.fullscreenElement === viewer;
      fullscreen.setAttribute('aria-pressed', String(expanded));
      fullscreen.title = expanded ? 'ออกจากโหมดเต็มหน้าจอ' : 'เต็มหน้าจอ';
    });
  }
  start();
})();
