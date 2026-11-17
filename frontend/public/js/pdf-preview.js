(() => {
  'use strict';

  function create({dialog, frame, link, status}) {
    let active;
    let url;

    function clear() {
      active?.abort();
      active = undefined;
      frame.hidden = link.hidden = true;
      frame.removeAttribute('src');
      link.removeAttribute('href');
      if (url) URL.revokeObjectURL(url);
      url = undefined;
    }

    async function show(load) {
      clear();
      if (status) {
        status.textContent = 'กำลังเปิดตัวอย่าง…';
        status.hidden = false;
      }
      dialog.showModal();
      const request = new AbortController();
      active = request;
      try {
        const pdf = await load(request.signal);
        if (!dialog.open || request.signal.aborted) return;
        url = URL.createObjectURL(pdf);
        frame.src = `${url}#view=FitH`;
        link.href = url;
        frame.hidden = link.hidden = false;
      } catch (error) {
        if (!request.signal.aborted && dialog.open) throw error;
      } finally {
        if (active === request) {
          active = undefined;
          if (status) status.hidden = true;
        }
      }
    }

    dialog.addEventListener('close', clear);
    return Object.freeze({show});
  }

  window.PdfPreview = Object.freeze({create});
})();
