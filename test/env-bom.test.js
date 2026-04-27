const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('node:child_process');

test('UTF-8 BOM in .env still loads ADMIN_USERNAME (regression)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x402-bom-'));
  const envFile = path.join(dir, '.env');
  fs.writeFileSync(envFile, '\uFEFFADMIN_USERNAME=bomok\nADMIN_PASSWORD=secretx\n', 'utf8');
  const projectRoot = path.join(__dirname, '..');
  const script = `
    process.env.DOTENV_CONFIG_PATH = ${JSON.stringify(envFile)};
    delete require.cache[require.resolve('./src/config.js')];
    const { loadConfig } = require('./src/config.js');
    process.stdout.write(loadConfig([]).admin.username);
  `;
  const r = spawnSync(process.execPath, ['-e', script], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, LOG_LEVEL: 'error' },
  });
  try {
    assert.equal(r.status, 0, r.stderr || r.stdout || 'spawn failed');
    assert.equal(String(r.stdout || '').trim(), 'bomok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
