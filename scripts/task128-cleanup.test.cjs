const assert = require('node:assert/strict');
const test = require('node:test');
const {finishRun} = require('./task128-cleanup.cjs');

test('a 503 on the first DELETE leaves a typed failure and cleanup still attempts the rest', async t => {
  const fixtures = [
    {kind: 'guide', id: 41},
    {kind: 'summary', id: 41},
    {kind: 'summary', id: 42}
  ];
  const attempted = [];
  let verifiedBaseline = false;
  const report = await finishRun({
    fixtures,
    originalError: new Error('Original system test assertion'),
    remove: async ({kind, id}) => {
      attempted.push(`${kind}:${id}`);
      if (id === 42) {
        return {status: 503, data: {error: {code: 'STORAGE_UNAVAILABLE', message: 'Simulated DELETE failure'}}};
      }
      return {status: kind === 'guide' ? 200 : 204};
    },
    verifyBaseline: () => {
      verifiedBaseline = true;
      throw new Error('The first fixture is still present');
    }
  });

  assert.deepEqual(attempted, ['summary:42', 'summary:41', 'guide:41']);
  assert.equal(verifiedBaseline, true);
  assert.deepEqual(report, {
    testError: {name: 'Error', message: 'Original system test assertion'},
    cleanup: {
      status: 'Fail',
      failedFixtures: [{
        kind: 'summary', id: 42, status: 503,
        error: {code: 'STORAGE_UNAVAILABLE', message: 'Simulated DELETE failure'}
      }],
      baselineError: {name: 'Error', message: 'The first fixture is still present'}
    }
  });
  t.diagnostic(JSON.stringify({attempted, ...report}));
});
