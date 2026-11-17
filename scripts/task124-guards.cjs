const assert = require('node:assert/strict');

function validateStack(project, records, urls) {
  assert.match(project, /^cs261-task124-[a-z0-9-]+$/);
  for (const [index, suffix] of ['', '-b'].entries()) {
    const front = records[`frontend${suffix}`];
    const back = records[`backend${suffix}`];
    for (const [service, record] of [[`frontend${suffix}`, front], [`backend${suffix}`, back]]) {
      assert(record, `Missing ${service}`);
      assert.equal(record.project, project, `${service}: wrong Compose project`);
      assert.equal(record.service, service, `${service}: wrong Compose service`);
      assert.equal(record.running, true, `${service}: not running`);
    }
    const url = new URL(urls[index]);
    assert.equal(url.hostname, '127.0.0.1');
    assert((front.ports['5000/tcp'] || []).some(binding => binding.HostPort === url.port
      && ['127.0.0.1', '0.0.0.0', ''].includes(binding.HostIp)), `Frontend port ${url.port} is not owned by ${project}/frontend${suffix}`);
    assert.deepEqual(front.proxy, [`BACKEND_URL=http://backend${suffix}:8000`], `frontend${suffix}: wrong proxy target`);
    assert.deepEqual(back.mode, ['TU_API_MODE=mock'], `backend${suffix}: mock auth required`);
    const network = `${project}_default`;
    assert(front.networks[network] && back.networks[network], `${project}: frontend/backend network mismatch`);
    assert(back.networks[network].Aliases.includes(`backend${suffix}`), `backend${suffix}: missing service DNS alias`);
  }
}

// Ownership is acquired only after CREATE succeeds. Existing triggers are never ours.
class OwnedDeleteTrigger {
  constructor(execute) { this.execute = execute; this.owned = false; }
  create(statement) {
    assert.equal(this.owned, false);
    this.execute(statement);
    this.owned = true;
  }
  cleanup() {
    if (!this.owned) return;
    this.execute('DROP TRIGGER dbo.task124_delete_failure');
    this.owned = false;
  }
}
module.exports = {validateStack, OwnedDeleteTrigger};
