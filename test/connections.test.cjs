const {test} = require('node:test');
const assert = require('node:assert/strict');
const {buildSync} = require('esbuild');
const Module = require('node:module');
const path = require('node:path');

function setup() {
  const clients = [];
  class Client {
    closed = true;
    constructor() { this.accesses = 0; clients.push(this); }
    close() { this.closed = true; }
    async access() { this.accesses++; this.closed = false; }
  }
  const loaded = new Module(path.join(__dirname, 'connections.cjs'), module);
  loaded.filename = path.join(__dirname, 'connections.cjs');
  const unavailable = message => new Error(message);
  loaded.require = name => name === 'vscode' ? {FileSystemError: {Unavailable: unavailable, NoPermissions: unavailable}} :
    name === 'basic-ftp' ? {Client, FTPError: class extends Error {}} : require(name);
  loaded._compile(buildSync({entryPoints: [path.join(__dirname, '../src/connections.ts')], bundle: true,
    external: ['vscode', 'basic-ftp'], write: false, platform: 'node', format: 'cjs'}).outputFiles[0].text, loaded.filename);
  let profile = {id: 'test', host: 'localhost', port: 21, username: 'test', protocol: 'ftp', rootPath: '/', timeout: 1000};
  let release;
  const password = new Promise(resolve => { release = resolve; });
  const profiles = {get: () => profile, password: () => password, list: () => [profile]};
  return {connections: new loaded.exports.Connections(profiles), clients, release,
    changeHost() { profile = {...profile, host: 'different.example'}; }};
}

test('disposed search transport cannot reconnect after waiting for secret storage', async () => {
  const {connections, clients, release} = setup();
  const reader = connections.openReadSession('test');
  let operations = 0;
  const pending = reader.run(async () => { operations++; });
  await new Promise(resolve => setImmediate(resolve));
  reader.dispose(); release('fixture-secret');
  await assert.rejects(pending);
  assert.equal(operations, 0); assert.equal(clients.reduce((n, client) => n + client.accesses, 0), 0);
  await connections.run('test', async () => { operations++; });
  assert.equal(operations, 1, 'The editor connection remains usable');
  connections.dispose();
});

test('server routing change while awaiting credentials prevents a search from following it', async () => {
  const {connections, clients, release, changeHost} = setup();
  const reader = connections.openReadSession('test');
  let operations = 0;
  const pending = reader.run(async () => { operations++; });
  await new Promise(resolve => setImmediate(resolve));
  changeHost(); release('fixture-secret');
  await assert.rejects(pending, /settings changed/);
  assert.equal(operations, 0); assert.equal(clients.reduce((n, client) => n + client.accesses, 0), 0);
  connections.dispose();
});

test('explicit disconnect retires all search readers even after reconnect is enabled', async () => {
  const {connections, release} = setup();
  const readers = Array.from({length: 3}, () => connections.openReadSession('test'));
  const pending = readers.map(reader => reader.run(async () => assert.fail('A retired reader performed work')));
  await new Promise(resolve => setImmediate(resolve));
  await connections.disconnect('test'); connections.enable('test'); release('fixture-secret');
  for (const result of await Promise.allSettled(pending)) assert.equal(result.status, 'rejected');
  connections.dispose();
});
