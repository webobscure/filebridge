const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const Module = require('node:module');
const path = require('node:path');

function load(file, vscode) {
  const filename = path.join(__dirname, `${file}.cjs`);
  const compiled = buildSync({entryPoints: [path.join(__dirname, `../src/${file}.ts`)], bundle: true,
    write: false, platform: 'node', format: 'cjs', external: ['vscode']});
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.require = id => id === 'vscode' ? vscode : require(id);
  loaded._compile(compiled.outputFiles[0].text, filename);
  return loaded.exports;
}
const { parseRemotes } = load('settings');
const entry = {name: 'Article Builder', scheme: 'ftp', host: 'ftp.example.test', port: 22220,
  username: 'article-builder', password: 'example-password'};
const key = 'article-builder.example.test';

test('original Remote FS JSON supports dotted keys, a custom port, and optional defaults', () => {
  const parsed = parseRemotes({[key]: entry});
  assert.deepEqual(parsed.errors, []);
  const [profile] = parsed.profiles;
  assert.equal(profile.name, entry.name);
  assert.equal(profile.port, 22220);
  assert.equal(profile.protocol, 'ftp');
  assert.equal(profile.rootPath, '/');
  assert.equal(profile.timeout, 30000);
  assert.equal(profile.atomicSave, true);
  assert.equal(profile.configKey, key);
  assert.equal(parsed.passwords.get(profile.id), entry.password);
  assert.ok(!('password' in profile));
  assert.ok(!JSON.stringify(profile).includes(entry.password));
});
test('defaults for display name, protocol and ports, including empty passwords', () => {
  const parsed = parseRemotes({one: {host: 'host', username: 'user', password: ''},
    two: {scheme: 'ftps-implicit', host: 'host', username: 'user'}});
  const [one, two] = parsed.profiles;
  assert.equal(one.name, 'one'); assert.equal(one.protocol, 'ftp'); assert.equal(one.port, 21);
  assert.equal(parsed.passwords.get(one.id), '');
  assert.equal(two.port, 990); assert.equal(parsed.passwords.has(two.id), false);
});
test('routing changes invalidate old URIs while password and label changes keep identity', () => {
  const id = change => parseRemotes({[key]: {...entry, ...change}}).profiles[0].id;
  const original = id({});
  assert.equal(id({password: 'new'}), original);
  assert.equal(id({name: 'Renamed', connectTimeout: 1000}), original);
  for (const change of [{host: 'other.test'}, {port: 2121}, {username: 'other'}, {scheme: 'ftps'}, {rootPath: '/elsewhere'}]) {
    assert.notEqual(id(change), original);
  }
});
test('malformed entries are isolated and errors never include passwords', () => {
  for (const bad of [null, [], 'text', {host: 3}, {...entry, port: '21'}, {...entry, rootPath: '/../'},
    {...entry, scheme: 'sftp'}, {...entry, password: 'sensitive\nvalue'}]) {
    const parsed = parseRemotes({good: entry, bad});
    assert.equal(parsed.profiles.length, 1);
    assert.equal(parsed.errors.length, 1);
    assert.ok(!parsed.errors.join().includes(entry.password));
    assert.ok(!parsed.errors.join().includes('sensitive'));
  }
  assert.equal(parseRemotes([]).errors.length, 1);
});
test('settings profiles are never copied into local storage; inline passwords take precedence', async () => {
  let settings = {[key]: entry};
  const vscode = {workspace: {getConfiguration: () => ({get: () => settings})},
    FileSystemError: {Unavailable: message => new Error(message)}};
  const { Profiles } = load('profiles', vscode);
  const local = {id: 'local', name: 'Wizard profile', protocol: 'ftp', host: 'localhost', port: 21,
    username: 'user', rootPath: '/', timeout: 30000, atomicSave: true};
  let stored = [];
  const secrets = new Map();
  const profiles = new Profiles({globalState: {get: () => stored, update: async (_key, value) => { stored = value; }},
    secrets: {get: async key => secrets.get(key), store: async (key, value) => { secrets.set(key, value); },
      delete: async key => { secrets.delete(key); }}});
  const configured = profiles.list()[0];
  secrets.set(`password:${configured.id}`, 'old-secret');
  assert.equal(await profiles.password(configured.id), entry.password);
  assert.throws(() => profiles.setPassword(configured.id, 'new'), /password/);
  await profiles.add(local, 'wizard-secret');
  assert.deepEqual(stored, [local]);
  assert.equal(profiles.list().length, 2);
  await assert.rejects(profiles.remove(configured.id), /Settings/);
  settings = {[key]: {...entry}}; delete settings[key].password;
  assert.equal(await profiles.password(configured.id), 'old-secret');
  await profiles.setPassword(configured.id, 'new-secret');
  assert.equal(await profiles.password(configured.id), 'new-secret');
  await profiles.remove(local.id);
  assert.deepEqual(stored, []);
  settings = {};
  assert.deepEqual(profiles.list(), []);
  assert.throws(() => profiles.get(configured.id), /not found/);
});

test('late editor storage snapshots cannot drop successful profile imports or resurrect removed profiles', async () => {
  const vscode = {workspace: {getConfiguration: () => ({get: () => ({})})},
    FileSystemError: {Unavailable: message => new Error(message)}};
  const { Profiles } = load('profiles', vscode);
  const base = {id: 'one', name: 'One', protocol: 'ftp', host: 'localhost', port: 21,
    username: 'user', rootPath: '/', timeout: 30000, atomicSave: true};
  let snapshot = [], durable = [];
  const store = new Profiles({globalState: {get: () => snapshot, update: async (_key, value) => {
    durable = value; snapshot = value;
    // Model an older editor delivering its previous storage notification late.
    setImmediate(() => { snapshot = []; });
  }}, secrets: {delete: async () => {}}});
  await store.mergeImported([base]);
  await new Promise(resolve => setImmediate(resolve));
  await store.mergeImported([{...base, id: 'two'}]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(store.list().map(profile => profile.id), ['one', 'two']);
  assert.deepEqual(durable.map(profile => profile.id), ['one', 'two']);
  await store.remove('one');
  snapshot = [base, {...base, id: 'two'}];
  assert.deepEqual(store.list().map(profile => profile.id), ['two']);
});

test('concurrent profile imports and wizard additions share one write queue', async () => {
  const vscode = {workspace: {getConfiguration: () => ({get: () => ({})})},
    FileSystemError: {Unavailable: message => new Error(message)}};
  const { Profiles } = load('profiles', vscode);
  const base = {id: 'wizard', name: 'Wizard', protocol: 'ftp', host: 'localhost', port: 21,
    username: 'user', rootPath: '/', timeout: 30000, atomicSave: true};
  let durable = [], active = 0, peak = 0;
  const store = new Profiles({globalState: {get: () => [], update: async (_key, value) => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setImmediate(resolve));
    durable = value; active--;
  }}, secrets: {store: async () => {}, delete: async () => {}}});
  await Promise.all([store.add(base, 'fixture-secret'), store.mergeImported([{...base, id: 'imported'}])]);
  assert.equal(peak, 1); assert.deepEqual(durable.map(profile => profile.id).sort(), ['imported', 'wizard']);
});
