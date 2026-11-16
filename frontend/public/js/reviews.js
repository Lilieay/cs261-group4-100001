(() => {
  'use strict';

  const labels = ['', 'ควรปรับปรุง', 'พอใช้', 'ดี', 'ดีมาก', 'ดีเยี่ยม'];
  const invalidResponse = () => Object.assign(new Error('ยืนยันข้อมูลรีวิวจากระบบไม่ได้'), {status: 502});
  const validId = value => /^[1-9]\d*$/.test(String(value)) && Number(value) <= 2147483647;
  const pathFor = target => {
    if (!['guide', 'summary'].includes(target.type) || !validId(target.id)) throw new Error('ไม่พบเอกสาร');
    return `/api/${target.type === 'guide' ? 'guides' : 'summaries'}/${target.id}/reviews`;
  };

  async function request(path, method = 'GET', body) {
    const token = window.HttpClient.token();
    if (!token) throw Object.assign(new Error('กรุณาเข้าสู่ระบบใหม่'), {status: 401});
    let result;
    try {
      result = await window.HttpClient.request(path, {
        method, token, timeoutMs: 15000,
        ...(body && {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})
      });
    } catch (_) {
      throw Object.assign(new Error('เชื่อมต่อบริการรีวิวไม่สำเร็จ'), {status: 0});
    }
    const {response, payload} = result;
    if (!response.ok) throw Object.assign(new Error(payload?.error?.message || 'ทำรายการรีวิวไม่สำเร็จ'), {
      status: response.status, code: payload?.error?.code
    });
    if (response.status !== ({GET: 200, POST: 201, PUT: 200, DELETE: 204})[method]) throw invalidResponse();
    return payload;
  }

  function validReview(item, target) {
    return validId(item?.id) && validId(item.author?.id) && typeof item.author.display_name === 'string'
      && Number.isInteger(item.rating) && item.rating >= 1 && item.rating <= 5
      && (item.comment === null || typeof item.comment === 'string')
      && item.target_type === target.type && item.target_id === Number(target.id);
  }

  const totals = items => ({
    count: items.length,
    average: items.length ? (items.reduce((sum, item) => sum + item.rating, 0) / items.length).toFixed(1) : null
  });
  const reads = new Map();
  function read(target, fresh = false) {
    const path = pathFor(target);
    const cached = reads.get(path);
    if (!fresh && cached && Date.now() < cached.expiry) return cached.promise;
    if (reads.size >= 100) reads.delete(reads.keys().next().value);
    const entry = {expiry: Date.now() + 30000};
    entry.promise = request(path).then(result => {
      if (result?.target_type !== target.type || result.target_id !== Number(target.id)
        || !Array.isArray(result.items) || !result.items.every(item => validReview(item, target))) {
        throw invalidResponse();
      }
      return result.items;
    }).catch(error => {
      if (reads.get(path) === entry) reads.delete(path);
      throw error;
    });
    reads.set(path, entry);
    return entry.promise;
  }

  function showCardScore(button, target, items) {
    const {average, count} = totals(items);
    const score = button.querySelector('[data-review-card-score]');
    if (count) score.replaceChildren(starIcon(1), average);
    else score.replaceChildren();
    score.hidden = count === 0;
    button.querySelector('[data-review-card-count]').textContent = `${count} รีวิว`;
    const details = count ? `คะแนน ${average} จาก 5, ${count} รีวิว` : '0 รีวิว';
    button.setAttribute('aria-label', `ดูรีวิว ${target.title} (${details})`);
    button.dataset.scoreLoaded = 'true';
  }

  function connectCards(container, targets) {
    container.querySelectorAll('[data-document-reviews]').forEach((button, index) => {
      const target = targets[index];
      button.setAttribute('aria-label', `ดูคะแนนรีวิว ${target.title}`);
      button.addEventListener('click', () => open(target, button));
      read(target).then(items => {
        if (button.isConnected && !button.dataset.scoreLoaded) showCardScore(button, target, items);
      }).catch(() => {
        // Keep the modal available so the reader can retry from this card.
      });
    });
  }

  let templates;
  function loadTemplates() {
    if (!templates) {
      const load = async path => {
        const response = await fetch(path);
        if (!response.ok) throw new Error('เปิดหน้าต่างรีวิวไม่สำเร็จ กรุณาลองอีกครั้ง');
        return new DOMParser().parseFromString(await response.text(), 'text/html');
      };
      templates = Promise.all(['/reviews-list.html', '/rate-review.html'].map(load)).then(([list, form]) => ({
        list: list.getElementById('review-list-template').content,
        item: list.getElementById('review-item-template').content,
        form: form.getElementById('review-form-template').content
      })).catch(error => { templates = null; throw error; });
    }
    return templates;
  }

  function starIcon(fill) {
    const svgNamespace = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(svgNamespace, 'svg');
    icon.classList.add('review-star-icon');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    const outline = document.createElementNS(svgNamespace, 'path');
    outline.setAttribute('d', 'M11.1 3.8a1 1 0 0 1 1.8 0l2.2 4.6 5.1.7a1 1 0 0 1 .6 1.7l-3.7 3.6.9 5.1a1 1 0 0 1-1.5 1L12 18.1l-4.5 2.4a1 1 0 0 1-1.5-1l.9-5.1-3.7-3.6a1 1 0 0 1 .6-1.7l5.1-.7z');
    outline.classList.add('review-star-outline');
    if (fill > 0) {
      const color = outline.cloneNode();
      color.setAttribute('class', 'review-star-fill');
      if (fill < 1) color.style.clipPath = `inset(0 ${(1 - fill) * 100}% 0 0)`;
      icon.append(color);
      icon.classList.add('has-fill');
    }
    icon.append(outline);
    return icon;
  }

  function stars(element, value, description) {
    element.setAttribute('aria-label', description);
    element.replaceChildren(...Array.from({length: 5}, (_, i) => starIcon(Math.max(0, Math.min(1, value - i)))));
  }

  function mountStarIcons(container) {
    container.querySelectorAll('[data-review-star-icon]').forEach(placeholder => placeholder.replaceChildren(starIcon(1)));
  }

  let dialog;
  let active;
  const $ = selector => dialog.querySelector(selector);
  const action = name => $(`[data-review-action="${name}"]`);

  function message(text) {
    const node = $('[data-review-message]');
    node.textContent = text || '';
    node.hidden = !text;
  }

  function mount(state) {
    dialog.classList.remove('review-loading');
    dialog.replaceChildren(state.templates.list.cloneNode(true));
    $('[data-review-editor]').append(state.templates.form.cloneNode(true));
    mountStarIcons(dialog);
    dialog.removeAttribute('aria-label');
    dialog.setAttribute('aria-labelledby', 'reviews-title');
    $('[data-review-course]').textContent = [state.target.courseCode, state.target.courseName].filter(Boolean).join(' · ');
    $('[data-review-title]').textContent = state.target.title;
    dialog.querySelector('header h2').focus();
  }

  function updateItems(state, items) {
    state.items = items;
    state.own = items.find(item => item.author.id === state.user?.id);
    if (state.trigger.matches('[data-document-reviews]') && state.trigger.isConnected) {
      showCardScore(state.trigger, state.target, items);
    }
  }

  function renderList(state, notice = '') {
    action('reload').hidden = true;
    action('retry-profile').hidden = true;
    const ready = Boolean(state.items);
    if (ready) {
      const {count, average} = totals(state.items);
      $('[data-review-empty]').hidden = count !== 0;
      $('[data-review-score]').hidden = count === 0;
      if (count) {
        $('[data-review-average]').textContent = average;
        stars($('[data-review-score-stars]'), Number(average), `คะแนนเฉลี่ย ${average} จาก 5 ดาว`);
        $('[data-review-count]').textContent = `${count} รีวิว`;
      }
    }
    const item = review => {
      const entry = state.templates.item.cloneNode(true);
      entry.querySelector('[data-review-author]').textContent = review.author.display_name;
      stars(entry.querySelector('[data-review-entry-stars]'), review.rating, `${review.rating} จาก 5 ดาว`);
      const comment = entry.querySelector('[data-review-comment]');
      comment.textContent = review.comment || '';
      comment.hidden = !review.comment;
      return entry;
    };
    const own = $('[data-review-own-entry]');
    own.replaceChildren();
    if (ready && state.own) own.append(item(state.own));
    const entries = $('[data-review-entries]');
    entries.replaceChildren();
    for (const review of state.items || []) {
      if (review !== state.own) entries.append(item(review));
    }
    renderEditor(state);
    message(notice);
  }

  async function reloadList(state) {
    state.items = null;
    state.user = null;
    state.owner = false;
    renderList(state, 'กำลังโหลดรีวิว…');
    try {
      const items = await read(state.target, true);
      if (active !== state || !dialog.open) return;
      updateItems(state, items);
      renderList(state);
      verifyReviewer(state);
    } catch (error) {
      if (active !== state || !dialog.open) return;
      message(error.message || 'โหลดรีวิวไม่สำเร็จ');
      action('reload').hidden = false;
    }
  }

  async function verifyReviewer(state, retry = false) {
    action('retry-profile').hidden = true;
    message('กำลังตรวจสอบบัญชีสำหรับจัดการรีวิว…');
    try {
      const user = await (retry ? window.refreshCurrentUser() : window.currentUserReady);
      if (active !== state || !dialog.open) return;
      if (!user) {
        message('กรุณาเข้าสู่ระบบใหม่เพื่อจัดการรีวิว');
        return;
      }
      if (!Number.isInteger(user.id) || !validId(user.id)) throw invalidResponse();
      const owner = state.target.type === 'guide'
        ? (await window.GuideApi.mine()).some(row => Number(row.id) === Number(state.target.id))
        : Number(state.target.ownerId) === user.id;
      if (active !== state || !dialog.open) return;
      state.user = user;
      state.owner = owner;
      updateItems(state, state.items);
      renderList(state);
    } catch (_) {
      if (active !== state || !dialog.open) return;
      message('โหลดข้อมูลบัญชีไม่สำเร็จ คุณยังอ่านรีวิวได้');
      action('retry-profile').hidden = false;
    }
  }

  function ratingValue() {
    const rating = Number($('input[name="rating"]:checked')?.value || 0);
    $('[data-review-rating-value]').textContent = rating ? `${rating} / 5 · ${labels[rating]}` : 'เลือกคะแนน 1 ถึง 5 ดาว';
    dialog.querySelectorAll('input[name="rating"]').forEach(input => {
      input.parentElement.toggleAttribute('data-filled', Number(input.value) <= rating);
    });
    return rating;
  }

  function renderEditor(state, mode = 'list') {
    const edit = mode === 'edit';
    const create = mode === 'create';
    state.editorMode = mode;
    state.editing = edit ? state.own : null;
    state.pending = null;
    const canReview = Boolean(state.items && state.user && !state.owner);
    $('[data-review-summary]').hidden = !state.items || create;
    $('[data-review-own-review]').hidden = !canReview || !state.own || mode !== 'list';
    $('[data-review-community]').hidden = create || !$('[data-review-entries]').childElementCount;
    const showAdd = canReview && !state.own && mode === 'list';
    const showOwnerNote = Boolean(state.items && state.owner);
    $('[data-review-footer]').hidden = !showAdd && !showOwnerNote;
    action('add').hidden = !showAdd;
    $('[data-review-owner-note]').hidden = !showOwnerNote;
    $('[data-review-editor]').hidden = !canReview || mode === 'list';
    $('.review-editor').reset();
    confirmDelete(state, false, false);
    action('recheck').hidden = true;
    $('[type="submit"]').textContent = edit ? 'บันทึกการแก้ไข' : 'บันทึกคะแนน';
    if (state.editing) {
      $(`#star-${state.editing.rating}`).checked = true;
      $('#review-comment').value = state.editing.comment || '';
    }
    ratingValue();
    if (state.editing) $('input[name="rating"]:checked').focus();
    else if (create) $('#star-1').focus();
  }

  function cancelEditor(state) {
    if (state.pending) {
      reloadList(state);
      return;
    }
    const returnTo = state.editorMode === 'create' ? 'add' : 'edit';
    renderEditor(state);
    action(returnTo).focus();
  }

  function confirmDelete(state, visible, focus = true) {
    state.confirming = visible;
    $('[data-review-delete-prompt]').hidden = !visible;
    $('[data-review-comment-field]').hidden = visible;
    $('[data-review-rating]').hidden = visible;
    for (const name of ['cancel-delete', 'confirm-delete']) action(name).hidden = !visible;
    action('delete').hidden = visible || !state.editing;
    action('cancel-editor').hidden = visible || state.editorMode === 'list';
    $('[type="submit"]').hidden = visible;
    message('');
    if (focus) (visible ? $('#review-delete-title') : action('delete')).focus();
  }

  function setBusy(state, busy) {
    state.busy = busy;
    dialog.setAttribute('aria-busy', String(busy));
    dialog.querySelectorAll('button, input, textarea').forEach(control => { control.disabled = busy; });
    if (!busy && state.pending) {
      $('[type="submit"]').disabled = true;
      action('confirm-delete').disabled = true;
      action('recheck').hidden = false;
    } else {
      action('recheck').hidden = true;
    }
  }

  async function reconcile(state) {
    const {method, payload, previous} = state.pending;
    try {
      updateItems(state, await read(state.target, true));
      const current = state.own;
      const sameReview = current?.id === previous?.id;
      const unchanged = sameReview && current?.rating === previous?.rating && current?.comment === previous?.comment;
      const matchesRequest = method !== 'DELETE' && current?.rating === payload.rating && current.comment === payload.comment;
      const applied = method === 'DELETE' ? !current : matchesRequest && (method === 'POST' || (sameReview && !unchanged));
      state.pending = null;
      if (applied) {
        renderList(state, method === 'DELETE' ? 'รีวิวของคุณถูกลบแล้ว' : 'บันทึกรีวิวแล้ว');
      } else if (!unchanged) {
        renderList(state, 'รีวิวของคุณมีการเปลี่ยนแปลง กรุณาตรวจสอบก่อนทำรายการอีกครั้ง');
      } else if (matchesRequest) {
        message('โหลดข้อมูลล่าสุดแล้ว ยังยืนยันผลการบันทึกครั้งนี้ไม่ได้');
      } else {
        message('ตรวจสอบข้อมูลล่าสุดแล้ว ยังไม่พบการเปลี่ยนแปลง กรุณาลองอีกครั้ง');
      }
    } catch (_) {
      message('ยังตรวจสอบผลไม่ได้ กรุณาตรวจสอบสถานะล่าสุดก่อนส่งซ้ำ');
    }
  }

  async function write(state, method, payload) {
    const previous = state.editing;
    const path = previous ? `/api/reviews/${previous.id}` : pathFor(state.target);
    setBusy(state, true);
    message('กำลังดำเนินการ…');
    try {
      const result = await request(path, method, payload);
      if (method !== 'DELETE' && (!validReview(result, state.target) || result.author.id !== state.user?.id
        || (previous && result.id !== previous.id))) throw invalidResponse();
      updateItems(state, method === 'DELETE' ? state.items.filter(item => item.id !== previous.id)
        : previous ? state.items.map(item => item.id === previous.id ? result : item) : [result, ...state.items]);
      reads.delete(pathFor(state.target));
      renderList(state, method === 'DELETE' ? 'ลบรีวิวแล้ว' : 'บันทึกรีวิวแล้ว');
    } catch (error) {
      if (error.status === 0 || error.status >= 500) {
        reads.delete(pathFor(state.target));
        state.pending = {method, payload, previous};
        await reconcile(state);
      } else if (error.code === 'SELF_REVIEW_FORBIDDEN') {
        state.owner = true;
        renderList(state, error.message);
      } else if (error.code === 'REVIEW_ALREADY_EXISTS' || error.status === 404) {
        try {
          updateItems(state, await read(state.target, true));
          renderList(state, error.message);
        } catch (_) {
          message(error.message);
        }
      } else {
        message(error.message);
      }
    } finally {
      setBusy(state, false);
      if (!dialog.contains(document.activeElement) || document.activeElement === dialog) {
        $('[data-review-message]').focus();
      }
    }
  }

  function open(target, trigger) {
    if (active) return;
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'u8-review-dialog';
      document.body.append(dialog);
      dialog.addEventListener('cancel', event => {
        if (active?.busy) event.preventDefault();
        else if (active?.confirming) {
          event.preventDefault();
          confirmDelete(active, false);
        } else if (active?.editorMode === 'create') {
          event.preventDefault();
          cancelEditor(active);
        }
      });
      dialog.addEventListener('close', () => {
        active?.trigger.focus();
        active = null;
      });
      dialog.addEventListener('click', async event => {
        const state = active;
        const button = event.target.closest('[data-review-action]');
        if (!button || !state || state.busy) return;
        switch (button.dataset.reviewAction) {
          case 'close': dialog.close(); break;
          case 'reload': reloadList(state); break;
          case 'retry-profile': verifyReviewer(state, true); break;
          case 'add': renderEditor(state, 'create'); break;
          case 'edit': renderEditor(state, 'edit'); break;
          case 'cancel-editor': cancelEditor(state); break;
          case 'delete': confirmDelete(state, true); break;
          case 'cancel-delete': confirmDelete(state, false); break;
          case 'confirm-delete': if (!state.pending) write(state, 'DELETE'); break;
          case 'recheck':
            setBusy(state, true);
            await reconcile(state);
            setBusy(state, false);
            if (!dialog.contains(document.activeElement) || document.activeElement === dialog) {
              $('[data-review-message]').focus();
            }
            break;
        }
      });
      dialog.addEventListener('change', event => {
        if (event.target.name === 'rating') ratingValue();
      });
      dialog.addEventListener('submit', event => {
        event.preventDefault();
        const state = active;
        if (!state || state.busy || state.pending || state.confirming || $('[data-review-editor]').hidden) return;
        const rating = ratingValue();
        const comment = $('#review-comment').value.trim();
        if (!rating) { message('กรุณาเลือกคะแนน 1 ถึง 5 ดาว'); $('#star-1').focus(); return; }
        if ([...comment].length > 2000) {
          message('ความคิดเห็นยาวได้ไม่เกิน 2,000 ตัวอักษร');
          $('#review-comment').focus();
          return;
        }
        write(state, state.editing ? 'PUT' : 'POST', {rating, comment: comment || null});
      });
    }
    const state = active = {target, trigger};
    dialog.className = 'u8-review-dialog review-loading';
    dialog.removeAttribute('aria-labelledby');
    dialog.setAttribute('aria-label', 'คะแนนรีวิว');
    dialog.innerHTML = '<p role="status">กำลังเปิดหน้าต่างรีวิว…</p><button class="review-control" type="button" data-review-action="close">ปิด</button>';
    dialog.showModal();
    loadTemplates().then(value => {
      if (active !== state || !dialog.open) return;
      state.templates = value;
      mount(state);
      reloadList(state);
    }).catch(() => {
      if (active === state && dialog.open) dialog.querySelector('p').textContent = 'เปิดหน้าต่างรีวิวไม่สำเร็จ กรุณาลองอีกครั้ง';
    });
  }

  window.Reviews = Object.freeze({open, connectCards, mountStarIcons});
})();
