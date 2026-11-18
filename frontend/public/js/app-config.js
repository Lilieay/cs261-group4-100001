(() => {
  'use strict';
  const config = Object.freeze({
    academicYears: Object.freeze([2569, 2568, 2567, 2566]),
    maxId: 2147483647,
    requestTimeoutMs: 15000,
    pdf: Object.freeze({maxBytes: 15_000_000, requestMaxBytes: 16_000_000, timeoutMs: 120_000})
  });
  if (typeof module === 'object' && module.exports) module.exports = config;
  else window.AppConfig = config;
})();
