function createProxy(backendUrl) {
  async function proxy(req, res, upstreamPath, {body, multipart = false,
    accept = 'application/json', contentType, onResponse, errorMessage, errorCode, timeoutMs = 12000} = {}) {
    res.set('Cache-Control', 'no-store');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const base = new URL(backendUrl);
      if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Invalid backend protocol');
      const headers = {Accept: accept};
      if (req.get('authorization')) headers.Authorization = req.get('authorization');
      if (multipart || contentType) headers['Content-Type'] = contentType || req.get('content-type');
      else if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(new URL(upstreamPath, base), {
        method: req.method, headers, signal: controller.signal, cache: 'no-store', redirect: 'manual',
        ...(body === undefined ? {} : {body: multipart || contentType ? body : JSON.stringify(body)})
      });
      if (onResponse) return await onResponse(response);
      const text = await response.text();
      const challenge = response.status === 401 && response.headers.get('www-authenticate');
      if (challenge) res.set('WWW-Authenticate', challenge);
      if (response.headers.get('content-type')) res.set('Content-Type', response.headers.get('content-type'));
      return res.status(response.status).send(text);
    } catch (_) {
      if (errorCode) return res.status(502).json({error: {code: errorCode, message: errorMessage, fields: []}});
      return res.status(502).json({detail: errorMessage});
    } finally { clearTimeout(timer); }
  }
  return proxy;
}

module.exports = {createProxy};
