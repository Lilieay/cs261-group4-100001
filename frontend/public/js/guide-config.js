// Guide endpoints use the authenticated same-origin frontend proxy.
window.GuideConfig = Object.freeze({
  apiBaseUrl: window.location.origin,
  coursesPath: '/courses',
  publishPath: '/guides',
  mePath: '/api/auth/me',
  myGuidesPath: '/api/my-guides',
  academicYears: window.AppConfig.academicYears,
  timeoutMs: window.AppConfig.requestTimeoutMs
});
