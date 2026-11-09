const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const Module = require('node:module');
const path = require('node:path');
const compiled = buildSync({ entryPoints: [path.join(__dirname, '../src/model.ts')], bundle: true, write: false, platform: 'node', format: 'cjs' });
const loaded = new Module(path.join(__dirname, 'model.cjs'), module);
loaded.filename = path.join(__dirname, 'model.cjs');
loaded._compile(compiled.outputFiles[0].text, loaded.filename);
const { remotePath, SerialQueue, validateProfile } = loaded.exports;

test('server paths stay within the configured root and keep literal unicode / percent', () => {
  assert.equal(remotePath('/public_html', '/css/main.css'), '/public_html/css/main.css');
  assert.equal(remotePath('/public_html', '/'), '/public_html/');
  assert.equal(remotePath('/', '/Каталог/100% #.txt'), '/Каталог/100% #.txt');
  for (const value of ['/../etc/passwd', '/a/../../x', '/a\r\nDELE b', '/x\0', '/a\\b', 'relative']) {
    assert.throws(() => remotePath('/root', value));
  }
});
test('queue keeps whole operations sequential and recovers after a failure', async () => {
  const queue = new SerialQueue();
  const events = [];
  const first = queue.run(async () => {
    events.push('start');
    await new Promise(resolve => setTimeout(resolve, 10));
    events.push('failed');
    throw new Error('offline');
  });
  const second = queue.run(async () => { events.push('next'); return 7; });
  await assert.rejects(first, /offline/);
  assert.equal(await second, 7);
  assert.deepEqual(events, ['start', 'failed', 'next']);
});
test('invalid host, port and protocol are rejected before opening a socket', () => {
  const profile = { id: 'test', name: 'Test', host: 'localhost', port: 21, protocol: 'ftp', username: 'user', rootPath: '/', timeout: 30000, atomicSave: true };
  validateProfile(profile);
  for (const patch of [{host: 'ftp://localhost'}, {port: 0}, {protocol: 'sftp'}, {rootPath: '/../'}, {timeout: 0}]) {
    assert.throws(() => validateProfile({...profile, ...patch}));
  }
});
