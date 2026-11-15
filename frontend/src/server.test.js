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
