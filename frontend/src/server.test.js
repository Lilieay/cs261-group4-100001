const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {createApp} = require('./server');

async function withServer(run) {
  const server = createApp({backendUrl: 'http://backend:8000'}).listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    await run(server.address().port);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function request(port, path, method = 'GET', headers = {}, body = '') {
  return new Promise((resolve, reject) => {
    const req = http.request({host: '127.0.0.1', port, path, method, headers}, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body}));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('HTML pages in public/pages retain their original URLs and assets load from the public root', async () => {
  await withServer(async port => {
    const assets = new Set();
    for (const page of ['index', 'login', 'courses', 'choose-courses', 'read-courses',
      'shared-courses', 'saved-courses', 'upload', 'upload-summary', 'read-summary']) {
      const response = await request(port, `/${page}.html`);
      assert.equal(response.status, 200, page);
      assert.match(response.headers['content-type'], /text\/html/);
      assert.match(response.body, /<!DOCTYPE html>/);
      for (const match of response.body.matchAll(/(?:src|href)="(\/(?:css|js|assets)\/[^"#]+)(?:#[^"]*)?"/g)) {
        assets.add(match[1]);
      }
      assert.doesNotMatch(response.body, /(?:src|href)="(?:css|js|assets)\//);
    }
    assert.equal((await request(port, '/')).status, 200);
    for (const asset of assets) {
      const response = await request(port, asset);
      assert.equal(response.status, 200, asset);
      assert.doesNotMatch(response.headers['content-type'], /text\/html/, asset);
    }
    assert.equal((await request(port, '/unknown-page.html')).status, 404);
  });
});

test('folder URLs redirect to the original page URL while retaining course and guide parameters', async () => {
  await withServer(async port => {
    const query = '?source=api&courseId=4&course=CS261&guide=12&returnTo=saved-courses.html';
    const response = await request(port, `/pages/read-courses.html${query}`);
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, `/read-courses.html${query}`);
    const target = await request(port, response.headers.location);
    assert.equal(target.status, 200);
    assert.match(target.body, /id="readingContent"/);
  });
});

test('shared proxy keeps auth payload filtering and does not expose upstream errors', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let sent;
  global.fetch = async (url, init) => {
    sent = {url: url.href, init};
    return new Response(JSON.stringify({access_token: 'test-token', token_type: 'bearer', internal: 'private',
      user: {id: 1, username: 'student', display_name: 'Student', role: 'student', internal: 'private'}}));
  };
  await withServer(async port => {
    const result = await request(port, '/api/auth/login', 'POST', {'Content-Type': 'application/json'},
      JSON.stringify({username: 'student', password: 'test-password', ignored: 'do not forward'}));
    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(sent.init.body), {username: 'student', password: 'test-password'});
    assert.equal(sent.url, 'http://backend:8000/api/auth/login');
    assert.doesNotMatch(result.body, /private|internal/);
    global.fetch = async () => new Response('{"detail":"private upstream failure"}', {status: 401});
    const failed = await request(port, '/api/auth/me');
    assert.equal(failed.status, 401);
    assert.doesNotMatch(failed.body, /private/);
    global.fetch = async () => { throw new Error('offline'); };
    assert.equal((await request(port, '/api/auth/me')).status, 502);
  });
});

test('course list proxy pins the backend path and forwards search and authorization', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let target;
  let init;
  global.fetch = async (url, options) => {
    target = url;
    init = options;
    return new Response('[{"id":4}]', {status: 200, headers: {'content-type': 'application/json'}});
  };

  await withServer(async port => {
    const response = await request(port, '/api/courses?search=CS%20261', 'GET', {Authorization: 'Bearer safe-test-token'});
    assert.equal(response.status, 200);
    assert.equal(response.body, '[{"id":4}]');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(target.href, 'http://backend:8000/courses?search=CS+261');
    assert.equal(init.headers.Authorization, 'Bearer safe-test-token');
    assert.equal(init.method, 'GET');
  });
});

test('my guides proxy pins the backend path, forwards authorization, and preserves an empty result', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let target;
  let init;
  global.fetch = async (url, options) => {
    target = url;
    init = options;
    return new Response('[]', {status: 200, headers: {'content-type': 'application/json'}});
  };

  await withServer(async port => {
    const response = await request(port, '/api/my-guides?username=other', 'GET', {Authorization: 'Bearer test-token'});
    assert.equal(response.status, 200);
    assert.equal(response.body, '[]');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(target.href, 'http://backend:8000/api/my-guides');
    assert.equal(init.method, 'GET');
    assert.equal(init.headers.Authorization, 'Bearer test-token');
    assert.equal(init.headers.Accept, 'application/json');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'manual');
  });
});

test('my guides proxy preserves backend errors and returns 502 when unavailable', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => new Response('{"detail":"unauthorized"}', {
    status: 401, headers: {'content-type': 'application/json'}
  });
  await withServer(async port => {
    const response = await request(port, '/api/my-guides');
    assert.equal(response.status, 401);
    assert.deepEqual(JSON.parse(response.body), {detail: 'unauthorized'});
  });

  global.fetch = async () => { throw new Error('backend unavailable'); };
  await withServer(async port => {
    const response = await request(port, '/api/my-guides');
    assert.equal(response.status, 502);
  });
});

test('update proxy pins the owned-guide path and forwards JSON, authorization and errors', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let target, init;
  global.fetch = async (url, options) => {
    target = url; init = options;
    return new Response('{"detail":"GUIDE_NOT_FOUND"}', {status: 404, headers: {'content-type': 'application/json'}});
  };
  await withServer(async port => {
    const response = await request(port, '/api/my-guides/7?owner=other', 'PUT', {
      Authorization: 'Bearer test-token', 'Content-Type': 'application/json'
    }, '{"course_id":4,"title":"updated"}');
    assert.equal(response.status, 404);
    assert.equal(JSON.parse(response.body).detail, 'GUIDE_NOT_FOUND');
    assert.equal(target.href, 'http://backend:8000/api/my-guides/7');
    assert.equal(init.method, 'PUT');
    assert.equal(init.headers.Authorization, 'Bearer test-token');
    assert.equal(JSON.parse(init.body).course_id, 4);
    assert.equal(response.headers['cache-control'], 'no-store');
    const invalid = await request(port, '/api/my-guides/0', 'PUT', {'Content-Type': 'application/json'}, '{}');
    assert.equal(invalid.status, 422);
  });
});

test('update proxy preserves validation/auth/server failures and bounds network failures', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  for (const status of [401, 422, 500]) {
    global.fetch = async () => new Response('{"detail":"failure"}', {status});
    await withServer(async port => {
      const response = await request(port, '/api/my-guides/7', 'PUT', {'Content-Type': 'application/json'}, '{}');
      assert.equal(response.status, status);
      assert.equal(JSON.parse(response.body).detail, 'failure');
    });
  }
  global.fetch = async () => { throw new Error('offline'); };
  await withServer(async port => {
    const response = await request(port, '/api/my-guides/7', 'PUT', {'Content-Type': 'application/json'}, '{}');
    assert.equal(response.status, 502);
  });
});

test('delete proxy pins the owned-guide path and forwards authorization and the backend result', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let target, init;
  global.fetch = async (url, options) => {
    target = url; init = options;
    return new Response('{"id":7,"message":"deleted"}', {
      status: 200, headers: {'content-type': 'application/json'}
    });
  };
  await withServer(async port => {
    const response = await request(port, '/api/my-guides/7?owner=other', 'DELETE', {
      Authorization: 'Bearer test-token'
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(JSON.parse(response.body), {id: 7, message: 'deleted'});
    assert.equal(target.href, 'http://backend:8000/api/my-guides/7');
    assert.equal(init.method, 'DELETE');
    assert.equal(init.headers.Authorization, 'Bearer test-token');
    assert.equal(init.redirect, 'manual');
    const invalid = await request(port, '/api/my-guides/0', 'DELETE');
    assert.equal(invalid.status, 422);
  });
});

test('delete proxy preserves ownership/auth errors and reports upstream failures', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  for (const status of [401, 404, 500]) {
    global.fetch = async () => new Response('{"detail":"failure"}', {status});
    await withServer(async port => {
      const response = await request(port, '/api/my-guides/7', 'DELETE');
      assert.equal(response.status, status);
      assert.deepEqual(JSON.parse(response.body), {detail: 'failure'});
    });
  }
  global.fetch = async () => { throw new Error('offline'); };
  await withServer(async port => {
    const response = await request(port, '/api/my-guides/7', 'DELETE');
    assert.equal(response.status, 502);
  });
});

test('course detail proxy forwards bearer authorization and preserves API errors', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let target;
  let authorization;
  global.fetch = async (url, options) => {
    target = url;
    authorization = options.headers.Authorization;
    return new Response('{"error":{"code":"COURSE_NOT_FOUND"}}', {
      status: 404, headers: {'content-type': 'application/json'}
    });
  };

  await withServer(async port => {
    const response = await request(port, '/api/courses/27', 'GET', {Authorization: 'Bearer safe-test-token'});
    assert.equal(response.status, 404);
    assert.deepEqual(JSON.parse(response.body), {error: {code: 'COURSE_NOT_FOUND'}});
    assert.equal(target.href, 'http://backend:8000/courses/27');
    assert.equal(authorization, 'Bearer safe-test-token');
  });
});

test('course detail proxy rejects malformed IDs before constructing or calling the upstream URL', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let calls = 0;
  global.fetch = async () => { calls += 1; return new Response('unexpected'); };

  await withServer(async port => {
    const response = await request(port, '/api/courses/%2E%2E');
    assert.equal(response.status, 422);
    assert.equal(JSON.parse(response.body).error.code, 'INVALID_PARAMETERS');
    assert.equal(calls, 0);
  });
});

test('course proxy preserves invalid-parameter status from the API', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let authorization;
  global.fetch = async (_url, options) => {
    authorization = options.headers.Authorization;
    return new Response('{"error":{"code":"INVALID_PARAMETERS"}}', {status: 422});
  };

  await withServer(async port => {
    const response = await request(port, '/api/courses?search=CS261', 'GET', {Authorization: 'Bearer safe-test-token'});
    assert.equal(response.status, 422);
    assert.equal(authorization, 'Bearer safe-test-token');
  });
});

test('course proxy preserves the authentication-required status and response', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => new Response('{"error":{"code":"AUTH_REQUIRED"}}', {
    status: 401, headers: {'content-type': 'application/json'}
  });

  await withServer(async port => {
    const response = await request(port, '/api/courses');
    assert.equal(response.status, 401);
    assert.deepEqual(JSON.parse(response.body), {error: {code: 'AUTH_REQUIRED'}});
  });
});

test('course proxy returns a bounded gateway error when the backend is unavailable', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => { throw new Error('backend unavailable'); };

  await withServer(async port => {
    const response = await request(port, '/api/courses');
    assert.equal(response.status, 502);
    assert.match(JSON.parse(response.body).detail, /บริการรายวิชา/);
  });
});

test('guide proxy forwards guide paths, filters, bearer authorization and disables caching', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let target;
  let init;
  global.fetch = async (url, options) => {
    target = url;
    init = options;
    return new Response('{"course_id":27,"items":[]}', {
      status: 200, headers: {'content-type': 'application/json'}
    });
  };

  await withServer(async port => {
    const response = await request(port,
      '/api/guides/courses/27/guides?academic_year=2568&semester=1',
      'GET', {Authorization: 'Bearer safe-test-token'});
    assert.equal(response.status, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(target.href, 'http://backend:8000/courses/27/guides?academic_year=2568&semester=1');
    assert.equal(init.headers.Authorization, 'Bearer safe-test-token');
    assert.equal(init.method, 'GET');
  });
});

test('publish proxy pins POST to the guide endpoint and forwards JSON and authorization', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let target;
  let init;
  global.fetch = async (url, options) => {
    target = url;
    init = options;
    return new Response('{"id":32}', {
      status: 201, headers: {'content-type': 'application/json'}
    });
  };
  const payload = JSON.stringify({course_id: 4, title: 'แนวข้อสอบ'});

  await withServer(async port => {
    const response = await request(port, '/api/guides', 'POST', {
      Authorization: 'Bearer safe-test-token', 'Content-Type': 'application/json'
    }, payload);
    assert.equal(response.status, 201);
    assert.equal(response.body, '{"id":32}');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(target.href, 'http://backend:8000/guides');
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), JSON.parse(payload));
    assert.equal(init.headers.Authorization, 'Bearer safe-test-token');
  });
});

test('publish proxy rejects non-JSON bodies before calling the backend', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let calls = 0;
  global.fetch = async () => { calls += 1; return new Response('{}'); };

  await withServer(async port => {
    const response = await request(port, '/api/guides', 'POST', {
      'Content-Type': 'text/plain'
    }, 'not-json');
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
  });
});

test('guide proxy preserves backend authentication and missing-record responses', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => new Response('{"error":{"code":"AUTH_REQUIRED"}}', {
    status: 401, headers: {'content-type': 'application/json'}
  });

  await withServer(async port => {
    const response = await request(port, '/api/guides/guides/123');
    assert.equal(response.status, 401);
    assert.deepEqual(JSON.parse(response.body), {error: {code: 'AUTH_REQUIRED'}});
  });
});

test('guide proxy rejects backend paths outside the read API allowlist', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let calls = 0;
  global.fetch = async () => { calls += 1; return new Response('{}'); };

  await withServer(async port => {
    const response = await request(port, '/api/guides/my-guides');
    assert.equal(response.status, 404);
    assert.equal(calls, 0);
  });
});


test('saved proxy pins paths, forwards the session, and preserves backend failures', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push([url.href, init]);
    return new Response(JSON.stringify({id: 12, saved: init.method !== 'DELETE'}),
      {status: 200, headers: {'content-type': 'application/json'}});
  };
  await withServer(async port => {
    for (const [method, path] of [['GET', '/api/saved-guides'], ['GET', '/api/saved-guides/12'],
      ['PUT', '/api/saved-guides/12'], ['DELETE', '/api/saved-guides/12']]) {
      const response = await request(port, path, method, {Authorization: 'Bearer saved-test'});
      assert.equal(response.status, 200);
      assert.equal(response.headers['cache-control'], 'no-store');
      const [target, init] = calls.at(-1);
      assert.equal(target, `http://backend:8000${path}`);
      assert.equal(init.method, method);
      assert.equal(init.headers.Authorization, 'Bearer saved-test');
      assert.equal(init.redirect, 'manual');
    }
    const count = calls.length;
    for (const [method, path, status] of [['GET', '/api/saved-guides/0', 422],
      ['GET', '/api/saved-guides/2147483648', 422], ['GET', '/api/saved-guides?user_id=2', 422],
      ['POST', '/api/saved-guides/12', 405], ['PUT', '/api/saved-guides', 405]]) {
      assert.equal((await request(port, path, method)).status, status);
    }
    assert.equal(calls.length, count);
    global.fetch = async () => new Response('{"detail":"Unauthorized"}', {status: 401});
    assert.equal((await request(port, '/api/saved-guides')).status, 401);
    global.fetch = async () => { throw new Error('offline'); };
    assert.equal((await request(port, '/api/saved-guides')).status, 502);
  });
});

test('U6 proxy forwards a multipart upload and returns authenticated PDF bytes intact', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const calls = [];
  const pdf = Buffer.from([37, 80, 68, 70, 45, 255, 0, 128]);
  global.fetch = async (url, init) => {
    calls.push({path: url.pathname, init});
    if (url.pathname.endsWith('/file')) {
      if (!init.headers.Authorization) {
        return new Response('{"error":{"code":"AUTH_REQUIRED"}}', {status: 401});
      }
      return new Response(pdf, {headers: {'Content-Type': 'application/pdf'}});
    }
    return new Response('{"id":41}', {status: init.method === 'POST' ? 201 : 200});
  };

  await withServer(async port => {
    const base = `http://127.0.0.1:${port}`;
    const form = new FormData();
    form.set('course_id', '7');
    form.set('title', 'สรุปทดสอบ');
    form.set('file', new Blob([pdf], {type: 'application/pdf'}), 'summary.pdf');
    const headers = {Authorization: 'Bearer u6-test'};
    const posted = await originalFetch(base + '/api/summaries', {method: 'POST', body: form, headers});
    assert.equal(posted.status, 201);
    assert.equal(posted.headers.get('cache-control'), 'no-store');
    assert.equal(calls[0].path, '/api/summaries');
    const upload = calls[0].init;
    assert.equal(upload.headers.Authorization, headers.Authorization);
    const decoded = await new Response(upload.body, {headers: upload.headers}).formData();
    assert.equal(decoded.get('course_id'), '7');
    assert.equal(decoded.get('title'), 'สรุปทดสอบ');
    assert.deepEqual(Buffer.from(await decoded.get('file').arrayBuffer()), pdf);

    const list = await originalFetch(base + '/api/courses/7/summaries', {headers});
    assert.equal(list.status, 200);
    assert.equal(calls.at(-1).path, '/api/courses/7/summaries');

    const downloaded = await originalFetch(base + '/api/summaries/41/file', {headers});
    assert.equal(downloaded.headers.get('content-type'), 'application/pdf');
    assert.equal(downloaded.headers.get('cache-control'), 'no-store');
    assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), pdf);
    assert.equal(calls.at(-1).init.headers.Authorization, headers.Authorization);
    const expired = await originalFetch(base + '/api/summaries/41/file');
    assert.equal(expired.status, 401);
    assert.equal((await expired.json()).error.code, 'AUTH_REQUIRED');
  });
});

test('U7 proxy forwards the owned list, metadata-only edits and empty deletion responses', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({path: url.pathname, ...init});
    if (url.pathname === '/api/my-summaries') return Response.json({items: []});
    if (init.method === 'PUT') return Response.json({id: 41});
    if (init.headers.Authorization === 'Bearer other') {
      return Response.json({error: {code: 'SUMMARY_FORBIDDEN'}}, {status: 403});
    }
    return new Response(null, {status: 204});
  };

  await withServer(async port => {
    const base = `http://127.0.0.1:${port}`;
    const headers = {Authorization: 'Bearer owner'};
    const mine = await originalFetch(base + '/api/my-summaries', {headers});
    assert.deepEqual(await mine.json(), {items: []});
    assert.equal(calls.at(-1).path, '/api/my-summaries');
    assert.equal(calls.at(-1).headers.Authorization, headers.Authorization);

    const body = new FormData();
    body.set('course_id', '2');
    body.set('title', 'สรุปฉบับแก้ไข');
    const updated = await originalFetch(base + '/api/summaries/41', {method: 'PUT', body, headers});
    assert.equal(updated.status, 200);
    const upload = calls.at(-1);
    assert.equal(upload.path, '/api/summaries/41');
    assert.equal(upload.headers.Authorization, headers.Authorization);
    const decoded = await new Response(upload.body, {headers: upload.headers}).formData();
    assert.deepEqual([...decoded], [['course_id', '2'], ['title', 'สรุปฉบับแก้ไข']]);

    const denied = await originalFetch(base + '/api/summaries/41', {method: 'DELETE', headers: {Authorization: 'Bearer other'}});
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error.code, 'SUMMARY_FORBIDDEN');
    const deleted = await originalFetch(base + '/api/summaries/41', {method: 'DELETE', headers});
    assert.equal(deleted.status, 204);
    assert.equal(await deleted.text(), '');
    assert.equal(deleted.headers.get('cache-control'), 'no-store');
    assert.equal(calls.at(-1).path, '/api/summaries/41');
    assert.equal(calls.at(-1).headers.Authorization, headers.Authorization);

    const count = calls.length;
    assert.equal((await originalFetch(base + '/api/my-summaries?owner_id=3', {headers})).status, 422);
    assert.equal((await originalFetch(base + '/api/summaries/0', {method: 'DELETE', headers})).status, 422);
    for (const [method, path] of [['GET', '/api/my-summaries'], ['DELETE', '/api/summaries/41']]) {
      for (const framing of [{'content-length': '2'}, {'transfer-encoding': 'chunked'}]) {
        const invalid = await request(port, path, method, {...headers, ...framing}, '{}');
        assert.equal(invalid.status, 422);
        assert.equal(JSON.parse(invalid.body).error.code, 'INVALID_PARAMETERS');
      }
    }
    assert.equal(calls.length, count);
  });
});

test('summary proxy waits 120 seconds for PDF transfers and normalizes timeouts and connection failures', async t => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const timeouts = [];
  t.mock.method(global, 'setTimeout', (callback, delay, ...args) => {
    if (delay === 120_000 || delay === 12_000) {
      timeouts.push(delay);
      return originalSetTimeout(callback, 0, ...args);
    }
    return originalSetTimeout(callback, delay, ...args);
  });
  const calls = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    calls.push([init.method, url.pathname]);
    if (url.pathname === '/api/my-summaries') throw new Error('connection refused');
    await new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), {once: true}));
  });

  await withServer(async port => {
    const base = `http://127.0.0.1:${port}`;
    const body = new FormData();
    body.set('course_id', '2');
    body.set('title', 'สรุป');
    body.set('file', new Blob(['%PDF-'], {type: 'application/pdf'}), 'new.pdf');
    const edit = await originalFetch(base + '/api/summaries/41', {method: 'PUT', body});
    const pdf = await originalFetch(base + '/api/summaries/41/file');
    const owned = await originalFetch(base + '/api/my-summaries');
    for (const response of [edit, pdf, owned]) {
      assert.equal(response.status, 502);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), {error: {
        code: 'UPSTREAM_UNAVAILABLE', message: 'เชื่อมต่อบริการสรุป PDF ไม่สำเร็จ', fields: []
      }});
    }
    assert.deepEqual(timeouts, [120_000, 120_000, 12_000]);
    assert.deepEqual(calls, [['PUT', '/api/summaries/41'], ['GET', '/api/summaries/41/file'], ['GET', '/api/my-summaries']]);
  });
});

test('U8 proxies review collections ahead of the legacy guide wildcard and keeps write responses intact', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({url: url.pathname, ...options});
    if (options.method === 'DELETE') return new Response(null, {status: 204});
    return new Response('{"ok":true}', {status: options.method === 'POST' ? 201 : 200,
      headers: {'Content-Type': 'application/json'}});
  };
  const auth = {Authorization: 'Bearer review-user'};
  const body = '{"rating":4,"comment":"ดีมาก"}';
  const json = {...auth, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)};
  await withServer(async port => {
    for (const collection of ['guides', 'summaries']) {
      const path = `/api/${collection}/12/reviews`;
      assert.equal((await request(port, path, 'GET', auth)).status, 200);
      assert.equal((await request(port, path, 'POST', json, body)).status, 201);
      assert.deepEqual(calls.slice(-2).map(call => call.url), [path, path]);
      assert.equal(calls.at(-1).headers.Authorization, auth.Authorization);
      assert.equal(calls.at(-1).body.toString(), body);
    }
    assert.equal((await request(port, '/api/reviews/25', 'PUT', json, body)).status, 200);
    const removed = await request(port, '/api/reviews/25', 'DELETE', auth);
    assert.equal(removed.status, 204);
    assert.equal(removed.body, '');
    assert.equal(removed.headers['cache-control'], 'no-store');
    assert.equal(calls.at(-1).body, undefined);
  });
});

test('U8 review proxy responds with structured errors for unsupported requests and unavailable upstream', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let forwards = 0;
  global.fetch = async () => { forwards++; throw new Error('offline'); };
  const auth = {Authorization: 'Bearer review-user'};
  const path = '/api/guides/12/reviews';
  await withServer(async port => {
    const missing = await request(port, path);
    assert.equal(missing.status, 401);
    assert.equal(JSON.parse(missing.body).error.code, 'AUTH_REQUIRED');
    const method = await request(port, path, 'PUT', auth);
    assert.equal(method.status, 405);
    assert.equal(method.headers.allow, 'GET, POST');
    const large = 'x'.repeat(32769);
    const tooLarge = await request(port, path, 'POST', {...auth, 'Content-Length': large.length}, large);
    assert.equal(tooLarge.status, 413);
    assert.equal(JSON.parse(tooLarge.body).error.code, 'REQUEST_TOO_LARGE');
    assert.equal(forwards, 0);
    const failed = await request(port, path, 'GET', auth);
    assert.equal(failed.status, 502);
    assert.equal(JSON.parse(failed.body).error.code, 'UPSTREAM_UNAVAILABLE');
    assert.equal(forwards, 1);
  });
});

test('U8 forwards the backend authentication challenge for expired tokens', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const payload = {error: {code: 'AUTH_REQUIRED', message: 'กรุณาเข้าสู่ระบบ', fields: []}};
  global.fetch = async () => new Response(JSON.stringify(payload), {
    status: 401,
    headers: {'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer'}
  });
  await withServer(async port => {
    const reply = await request(port, '/api/summaries/12/reviews', 'GET', {Authorization: 'Bearer expired'});
    assert.equal(reply.status, 401);
    assert.equal(reply.headers['www-authenticate'], 'Bearer');
    assert.equal(reply.headers['cache-control'], 'no-store');
    assert.deepEqual(JSON.parse(reply.body), payload);
  });
});

test('U8 unknown review routes return a JSON 404 without forwarding upstream', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let forwards = 0;
  global.fetch = async () => { forwards++; throw new Error('unexpected backend request'); };
  await withServer(async port => {
    for (const reviewPath of ['/api/reviews', '/api/reviews/1/unknown', '/api/guides/12/reviews/unknown',
      '/api/summaries/12/reviews/unknown']) {
      const reply = await request(port, reviewPath);
      assert.equal(reply.status, 404, reviewPath);
      assert.match(reply.headers['content-type'], /^application\/json/);
      assert.equal(reply.headers['cache-control'], 'no-store');
      assert.equal(JSON.parse(reply.body).error.code, 'ROUTE_NOT_FOUND');
    }
    assert.equal(forwards, 0);
  });
});

test('U9 forwards typed bookmarks and rejects unexpected body and query parameters', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push([url.pathname, options.method, options.headers.Authorization, options.body]);
    return new Response('{"item_type":"summary","item_id":41,"saved":true}', {
      status: 200, headers: {'Content-Type': 'application/json'}
    });
  };
  await withServer(async port => {
    const auth = {Authorization: 'Bearer mock-session'};
    const saved = '/api/saved-items/summary/41';
    assert.equal((await request(port, saved, 'PUT', auth)).status, 200);
    assert.deepEqual(calls, [[saved, 'PUT', auth.Authorization, undefined]]);
    const invalidQuery = await request(port, saved + '?user_id=2', 'PUT', auth);
    assert.equal(invalidQuery.status, 422);
    assert.equal(JSON.parse(invalidQuery.body).error.code, 'INVALID_PARAMETERS');
    const invalidBody = await request(port, saved, 'PUT', {...auth, 'Content-Length': 2}, '{}');
    assert.equal(invalidBody.status, 422);
    assert.equal((await request(port, saved, 'PUT')).headers['www-authenticate'], 'Bearer');
    assert.equal((await request(port, saved + '/unknown')).status, 404);
    assert.equal(calls.length, 1);
  });
});
