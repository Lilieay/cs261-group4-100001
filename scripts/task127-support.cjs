const assert = require('node:assert/strict');

function validateExpiringBackend(record, project) {
  assert.equal(record.project, project, 'Expiry backend belongs to another project');
  assert.equal(record.service, 'backend-expiring');
  assert.equal(record.running, true);
  assert.equal(record.mode, 'mock');
  assert.equal(record.ttl, '1', 'Expiry test requires an actual 1-second TTL');
  assert((record.ports['8000/tcp'] || []).some(p => p.HostPort === '34803'
    && ['127.0.0.1', '0.0.0.0', ''].includes(p.HostIp)), 'Port 34803 is not owned by selected expiry backend');
}

async function cleanupFixtures(targets, remove, releaseFault, verify) {
  const errors = [];
  const remaining = [];
  try { await releaseFault(); } catch (error) { errors.push({phase:'trigger',message:error.message}); }
  for (const target of [...targets].reverse()) {
    if (target.removed) continue;
    try { await remove(target); }
    catch (error) {
      remaining.push({kind:target.kind,id:target.id});
      errors.push({phase:'fixture',kind:target.kind,id:target.id,message:error.message});
    }
  }
  try { await verify(); } catch (error) { errors.push({phase:'baseline',message:error.message}); }
  return {errors,remaining};
}

function throwFailure(primary, cleanupErrors) {
  if (primary) throw primary; // Preserve original identity and stack.
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors.map(e=>new Error(e.message)), 'System cleanup failed');
}
module.exports = {validateExpiringBackend,cleanupFixtures,throwFailure};
