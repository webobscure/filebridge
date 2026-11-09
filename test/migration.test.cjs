const {test} = require('node:test');
const assert = require('node:assert/strict');
const {buildSync} = require('esbuild');
const Module = require('node:module');
const path = require('node:path');
const filename = path.join(__dirname, 'migration.cjs');
const compiled = buildSync({entryPoints: [path.join(__dirname, '../src/migration.ts')], bundle: true, write: false,
  platform: 'node', format: 'cjs', external: ['vscode']});
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.require = id => id === 'vscode' ? {} : require(id);
loaded._compile(compiled.outputFiles[0].text, filename);
const {importLegacyState} = loaded.exports;
const profile = {id: 'old-profile', name: 'Legacy server', protocol: 'ftp', host: 'localhost', port: 21,
  username: 'user', rootPath: '/', timeout: 30000, atomicSave: true};
function fixture() {
  const state = new Map(), secrets = new Map();
  return {state, secrets, context: {
    globalState: {get: (key, fallback) => state.get(key) ?? fallback, update: async (key, value) => {state.set(key, value);}},
    secrets: {get: async key => secrets.get(key), store: async (key, value) => {secrets.set(key, value);}}
  }};
}
test('migration preserves IDs and secrets without putting passwords in global state', async () => {
  const f = fixture();
  await importLegacyState(f.context, {servers: [profile], passwords: [{id: profile.id, password: 'private-value'}, {id: 'settings-abc', password: ''}]});
  assert.deepEqual(f.state.get('servers'), [profile]);
  assert.equal(f.secrets.get('password:old-profile'), 'private-value');
  assert.equal(f.secrets.get('password:settings-abc'), '');
  assert.ok(!JSON.stringify([...f.state]).includes('private-value'));
  assert.equal(f.state.get('legacyMigrationComplete'), true);
});
test('repeated import does not overwrite newer profiles or secrets', async () => {
  const f = fixture();
  const newer = {...profile, name: 'New name'};
  f.state.set('servers', [newer]); f.secrets.set('password:old-profile', 'new-password');
  const payload = {servers: [profile], passwords: [{id: profile.id, password: 'old-password'}]};
  await importLegacyState(f.context, payload); await importLegacyState(f.context, payload);
  assert.deepEqual(f.state.get('servers'), [newer]);
  assert.equal(f.secrets.get('password:old-profile'), 'new-password');
});
test('invalid migration payloads are rejected before writing any state or secret', async () => {
  for (const payload of [null, {}, {servers: [{...profile, port: 0}], passwords: []},
    {servers: [profile, profile], passwords: []}, {servers: [profile], passwords: [{id: '../bad', password: 'private'}]},
    {servers: [profile], passwords: [{id: 'old-profile', password: 'bad\nvalue'}]}]) {
    const f = fixture();
    await assert.rejects(importLegacyState(f.context, payload));
    assert.equal(f.state.size, 0); assert.equal(f.secrets.size, 0);
  }
});
