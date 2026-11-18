(() => {
  'use strict';

  const tokenKey = () => window.LoginConfig?.tokenStorageKey || 'access_token';

  function token(allowLegacy = false) {
    return sessionStorage.getItem(tokenKey())
      || (allowLegacy ? localStorage.getItem(tokenKey()) : '') || '';
  }

  function clearToken(includeLegacy = true) {
    sessionStorage.removeItem(tokenKey());
    if (includeLegacy) localStorage.removeItem(tokenKey());
  }

  // Transport only. Each API adapter owns its validation and user-facing errors.
  async function request(url, {timeoutMs = 0, token: bearer, responseType = 'json', ...options} = {}) {
    const controller = timeoutMs ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    const abort = () => controller.abort();
    const signal = options.signal;
    if (controller && signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', abort, {once: true});
    }
    try {
      const response = await fetch(url, {
        ...options,
        ...(controller ? {signal: controller.signal} : {}),
        headers: {...options.headers, Accept: responseType === 'pdf' ? 'application/pdf, application/json' : 'application/json',
          ...(bearer ? {Authorization: `Bearer ${bearer}`} : {})},
        cache: 'no-store'
      });
      if (response.ok && responseType === 'pdf') {
        return {response, payload: await response.blob()};
      }
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch (_) { /* Adapters validate payloads. */ }
      return {response, payload};
    } finally {
      if (timer !== null) clearTimeout(timer);
      if (controller && signal) signal.removeEventListener('abort', abort);
    }
  }

  window.HttpClient = Object.freeze({token, clearToken, request});
})();
