const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');

exports.run = async () => {
  const fixture = JSON.parse(process.env.REMOTER_TEST_FIXTURE);
  if (fixture.expectedVersion) assert.equal(vscode.version, fixture.expectedVersion, 'The requested VS Code version is running');
  const ext = vscode.extensions.getExtension('webobscure.filebridge');
  assert.ok(ext, 'Development extension is available');
  await ext.activate();
  assert.equal(ext.packageJSON.publisher, 'Webobscure');
  const results = [];
  const check = async (name, work) => { await work(); results.push(name); console.log(`PASS ${name}`); };
  const uri = (id, file = '/') => vscode.Uri.from({scheme: 'remoterfs', authority: id, path: file});
  const disk = file => path.join(fixture.root, 'public_html', file);
  const read = async file => Buffer.from(await vscode.workspace.fs.readFile(file)).toString();
  const write = (file, text) => vscode.workspace.fs.writeFile(file, Buffer.from(text));
  const settings = vscode.workspace.getConfiguration('remotefs');
  const settingsUri = (key, entry, file = '/') => uri(`settings-${createHash('sha256').update(JSON.stringify([
    key, entry.scheme ?? 'ftp', entry.host, entry.port ?? 21, entry.username, entry.rootPath ?? '/'
  ])).digest('hex').slice(0, 32)}`, file);

  await check('activation, commands and FTP listing', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('remoterfs.connect'));
    const entries = await vscode.workspace.fs.readDirectory(uri('ftp-test'));
    assert.ok(entries.some(([name, type]) => name === 'hello.txt' && type === vscode.FileType.File));
    assert.ok(!entries.some(([name]) => name === 'outside.txt'));
  });
  await check('recursive FTP search finds unopened files and opens the matching line', async () => {
    await fs.mkdir(disk('search/nested'), {recursive: true});
    await fs.mkdir(disk('search/excluded'), {recursive: true});
    await fs.mkdir(disk('search/.hidden'), {recursive: true});
    await fs.writeFile(disk('search/.hidden/secret.php'), 'SearchToken');
    await fs.writeFile(disk('search/a.php'), 'first\r\n😀 SearchToken SEARCHTOKEN\r\n');
    await fs.writeFile(disk('search/nested/тест.php'), 'SearchToken');
    await fs.writeFile(disk('search/excluded/skip.php'), 'SearchToken');
    await fs.writeFile(disk('search/binary'), Buffer.from([0, 1, 2]));
    await fs.writeFile(disk('search/invalid'), Buffer.from([255]));
    await fs.writeFile(disk('search/large'), 'x'.repeat(2048));
    await fs.writeFile(disk('outside-search.php'), 'SearchToken');
    const options = {query: 'searchtoken', caseSensitive: false, exclude: ['excluded'], maxFileBytes: 1024, maxResults: 100};
    const summary = await vscode.commands.executeCommand('remoterfs.search', uri('ftp-test', '/search'), options);
    assert.equal(summary.matches, 4); assert.equal(summary.scanned, 3); assert.equal(summary.excluded, 1);
    assert.equal(summary.binary, 2); assert.equal(summary.large, 1); assert.equal(summary.errors, 0);
    await vscode.commands.executeCommand('remoterfs.openSearchResult', {uri: uri('ftp-test', '/search/a.php'), line: 1, column: 3, length: 11});
    assert.equal(vscode.window.activeTextEditor.document.uri.path, '/search/a.php');
    assert.equal(vscode.window.activeTextEditor.selection.start.line, 1);
    assert.equal(vscode.window.activeTextEditor.document.getText(vscode.window.activeTextEditor.selection), 'SearchToken');
    const sensitive = await vscode.commands.executeCommand('remoterfs.search', uri('ftp-test', '/search'), {...options, query: 'SearchToken', caseSensitive: true});
    assert.equal(sensitive.matches, 3);
    const limited = await vscode.commands.executeCommand('remoterfs.search', uri('ftp-test', '/search'), {...options, maxResults: 1});
    assert.equal(limited.matches, 1); assert.equal(limited.limited, true);
  });
  await check('parallel FTP search uses separate connections and filters downloads', async () => {
    await fs.mkdir(disk('search/parallel'), {recursive: true});
    await Promise.all(Array.from({length: 12}, (_, i) => fs.writeFile(disk(`search/parallel/${i}.PHP`), 'ParallelToken')));
    await fs.writeFile(disk('search/parallel/skip.log'), 'ParallelToken');
    const marker = path.join(fixture.root, 'slow-search');
    await fs.writeFile(marker, '0.12');
    try {
      const options = {query: 'ParallelToken', caseSensitive: true, extensions: ['.php']};
      const started = Date.now();
      const serial = await vscode.commands.executeCommand('remoterfs.search', uri('ftp-test', '/search/parallel'), {...options, concurrency: 1});
      const serialMs = Date.now() - started;
      assert.equal(JSON.parse(await fs.readFile(path.join(fixture.root, 'search-transfers.json'))).peak, 1);
      const parallelStart = Date.now();
      const parallel = await vscode.commands.executeCommand('remoterfs.search', uri('ftp-test', '/search/parallel'), {...options, concurrency: 3});
      const parallelMs = Date.now() - parallelStart;
      assert.equal(parallel.matches, 12); assert.equal(parallel.excluded, 1); assert.equal(parallel.errors, 0);
      assert.equal(serial.matches, parallel.matches);
      assert.equal(JSON.parse(await fs.readFile(path.join(fixture.root, 'search-transfers.json'))).peak, 3);
      console.log(`SEARCH BENCHMARK ${JSON.stringify({files: 12, delayMs: 120, serialMs, parallelMs})}`);
    } finally { await fs.rm(marker, {force: true}); }
  });
  await check('saving completes while three search downloads are held, and cancellation releases them', async () => {
    const slow = path.join(fixture.root, 'slow-search'), hold = path.join(fixture.root, 'hold-search');
    await fs.writeFile(slow, '0.01'); await fs.writeFile(hold, 'hold');
    const pending = vscode.commands.executeCommand('remoterfs.search', uri('ftp-test', '/search/parallel'), {
      query: 'ParallelToken', caseSensitive: true, extensions: ['.php'], concurrency: 3
    });
    try {
      const deadline = Date.now() + 10000;
      let waiting = 0;
      while (waiting !== 3 && Date.now() < deadline) {
        try { waiting = JSON.parse(await fs.readFile(path.join(fixture.root, 'search-transfers.json'))).waiting; } catch {}
        if (waiting !== 3) await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(waiting, 3, 'Three dedicated search connections reached the fixture barrier');
      let timer;
      try {
        await Promise.race([write(uri('ftp-test', '/search/independent-save.txt'), 'saved during search'),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Editor save was blocked by search')), 5000); })]);
      } finally { clearTimeout(timer); }
      assert.equal(await fs.readFile(disk('search/independent-save.txt'), 'utf8'), 'saved during search');
      assert.equal(JSON.parse(await fs.readFile(path.join(fixture.root, 'search-transfers.json'))).waiting, 3);
      await vscode.commands.executeCommand('remoterfs.cancelSearch');
      const result = await pending;
      assert.equal(result.cancelled, true); assert.equal(result.errors, 0);
    } finally {
      await vscode.commands.executeCommand('remoterfs.cancelSearch');
      await fs.rm(hold, {force: true}); await fs.rm(slow, {force: true}); await pending;
    }
  });
  await check('cancel remote search and continue editing', async () => {
    await fs.mkdir(disk('search/cancel'), {recursive: true});
    await Promise.all(Array.from({length: 60}, (_, i) => fs.writeFile(disk(`search/cancel/${i}.txt`), 'SearchToken')));
    const pending = vscode.commands.executeCommand('remoterfs.search', uri('ftp-test', '/search/cancel'), {query: 'SearchToken', caseSensitive: true});
    const timer = setInterval(() => void vscode.commands.executeCommand('remoterfs.cancelSearch'), 10);
    try { assert.equal((await pending).cancelled, true); } finally { clearInterval(timer); }
    await write(uri('ftp-test', '/search/after-cancel.txt'), 'still editable');
    assert.equal(await fs.readFile(disk('search/after-cancel.txt'), 'utf8'), 'still editable');
    await fs.rm(disk('search'), {recursive: true}); await fs.unlink(disk('outside-search.php'));
  });
  await check('open document, edit, save and verify bytes on server', async () => {
    const document = await vscode.workspace.openTextDocument(uri('ftp-test', '/hello.txt'));
    await vscode.window.showTextDocument(document);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), 'Сохранено из редактора\n');
    assert.ok(await vscode.workspace.applyEdit(edit));
    assert.ok(await document.save());
    assert.equal(await fs.readFile(disk('hello.txt'), 'utf8'), 'Сохранено из редактора\n');
    assert.equal(document.isDirty, false);
  });
  await check('unicode filenames, spaces, percent and hash', async () => {
    const file = uri('ftp-test', '/тест 100% #.txt');
    await write(file, 'Привет');
    assert.equal(await read(file), 'Привет');
    assert.equal(await fs.readFile(disk('тест 100% #.txt'), 'utf8'), 'Привет');
  });
  await check('create directory, rename, delete, and nonrecursive guard', async () => {
    const dir = uri('ftp-test', '/folder');
    await vscode.workspace.fs.createDirectory(dir);
    const a = uri('ftp-test', '/folder/a.txt'), b = uri('ftp-test', '/folder/b.txt');
    await write(a, 'A'); await write(b, 'B');
    await assert.rejects(vscode.workspace.fs.rename(a, b, {overwrite: false}));
    await assert.rejects(vscode.workspace.fs.delete(dir, {recursive: false}));
    await vscode.workspace.fs.rename(a, uri('ftp-test', '/folder/c.txt'));
    await vscode.workspace.fs.delete(dir, {recursive: true});
    await assert.rejects(fs.stat(disk('folder')));
  });
  await check('parallel reads and writes are serialized per server', async () => {
    await Promise.all(Array.from({length: 6}, (_, i) => write(uri('ftp-test', `/parallel-${i}.txt`), `item-${i}`)));
    const values = await Promise.all(Array.from({length: 6}, (_, i) => read(uri('ftp-test', `/parallel-${i}.txt`))));
    assert.deepEqual(values, Array.from({length: 6}, (_, i) => `item-${i}`));
  });
  await check('external change is refused without overwriting the server', async () => {
    const file = uri('ftp-test', '/conflict.txt');
    await write(file, 'original'); await read(file);
    await fs.writeFile(disk('conflict.txt'), 'changed-by-another-client');
    await assert.rejects(write(file, 'my-change'));
    assert.equal(await fs.readFile(disk('conflict.txt'), 'utf8'), 'changed-by-another-client');
  });
  await check('externally deleted file is not silently recreated', async () => {
    const file = uri('ftp-test', '/deleted-externally.txt');
    await write(file, 'original'); await read(file);
    await fs.unlink(disk('deleted-externally.txt'));
    await assert.rejects(write(file, 'my-change'));
    await assert.rejects(fs.stat(disk('deleted-externally.txt')));
  });
  await check('rejected upload and rejected rename preserve the original', async () => {
    const file = uri('ftp-test', '/protected.txt');
    await write(file, 'original');
    for (const marker of ['reject-upload', 'reject-rename']) {
      await fs.writeFile(path.join(fixture.root, marker), '1');
      try { await assert.rejects(write(file, 'replacement')); }
      finally { await fs.unlink(path.join(fixture.root, marker)); }
      assert.equal(await fs.readFile(disk('protected.txt'), 'utf8'), 'original');
      assert.ok(!(await fs.readdir(disk(''))).some(name => name.startsWith('.remoterfs-')));
    }
  });
  await check('read-only account cannot write', async () => {
    assert.equal(await read(uri('reader-test', '/protected.txt')), 'original');
    await assert.rejects(write(uri('reader-test', '/protected.txt'), 'forbidden'));
    assert.equal(await fs.readFile(disk('protected.txt'), 'utf8'), 'original');
  });
  await check('failed editor save keeps local edits dirty and manual retry succeeds', async () => {
    const file = uri('ftp-test', '/retry.txt');
    await write(file, 'original');
    const document = await vscode.workspace.openTextDocument(file);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(file, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), 'edited in editor');
    assert.ok(await vscode.workspace.applyEdit(edit));
    await fs.writeFile(path.join(fixture.root, 'reject-upload'), '1');
    try {
      assert.equal(await document.save(), false);
      assert.equal(document.isDirty, true);
      assert.equal(document.getText(), 'edited in editor');
      assert.equal(await fs.readFile(disk('retry.txt'), 'utf8'), 'original');
    } finally { await fs.unlink(path.join(fixture.root, 'reject-upload')); }
    assert.ok(await document.save());
    assert.equal(await fs.readFile(disk('retry.txt'), 'utf8'), 'edited in editor');
  });
  await check('closed connection reopens on the next request without replay', async () => {
    // Scope the fault to this folder: background editor scans must not consume it.
    await fs.mkdir(disk('connection-probe'));
    await fs.writeFile(path.join(fixture.root, 'drop-next-listing'), '/public_html/connection-probe');
    await assert.rejects(vscode.workspace.fs.readDirectory(uri('ftp-test', '/connection-probe')));
    const entries = await vscode.workspace.fs.readDirectory(uri('ftp-test'));
    assert.ok(entries.some(([name]) => name === 'protected.txt'));
    await fs.rmdir(disk('connection-probe'));
  });
  await check('direct overwrite mode', async () => {
    await write(uri('direct-test', '/direct.txt'), 'one');
    await write(uri('direct-test', '/direct.txt'), 'two');
    assert.equal(await read(uri('direct-test', '/direct.txt')), 'two');
  });
  await check('FTPS with trusted TLS certificate', async () => {
    await write(uri('ftps-test', '/secure.txt'), 'TLS works');
    assert.equal(await read(uri('ftps-test', '/secure.txt')), 'TLS works');
    const summary = await vscode.commands.executeCommand('remoterfs.search', uri('ftps-test'), {query: 'TLS works', caseSensitive: true});
    assert.equal(summary.matches, 1); assert.equal(summary.errors, 0);
  });
  await check('bad login and untrusted certificate are rejected', async () => {
    await assert.rejects(vscode.workspace.fs.readDirectory(uri('bad-login')));
    await assert.rejects(vscode.workspace.fs.readDirectory(uri('bad-tls')));
  });
  await check('missing files and root protection', async () => {
    await assert.rejects(vscode.workspace.fs.stat(uri('ftp-test', '/does-not-exist')), error => error.code === 'FileNotFound');
    await assert.rejects(vscode.workspace.fs.delete(uri('ftp-test'), {recursive: true}));
    await assert.rejects(vscode.workspace.fs.rename(uri('ftp-test'), uri('ftp-test', '/elsewhere')));
    await assert.rejects(vscode.workspace.fs.rename(uri('ftp-test', '/protected.txt'), uri('ftps-test', '/protected.txt')));
  });
  await check('disconnect blocks requests until explicit reconnect', async () => {
    await vscode.commands.executeCommand('remoterfs.disconnect', {profile: {id: 'ftp-test'}});
    await assert.rejects(vscode.workspace.fs.readDirectory(uri('ftp-test')));
    // Connecting adds a workspace folder. Do this last because it can restart the host.
    // The fixture workspace already contains this root, so this call only reconnects.
    await vscode.commands.executeCommand('remoterfs.connect', {profile: {id: 'ftp-test'}});
    assert.ok((await vscode.workspace.fs.readDirectory(uri('ftp-test'))).length > 0);
  });
  const settingsKey = 'original.remote.fs.test';
  const settingsEntry = {name: 'Original Remote FS JSON', scheme: 'ftp', host: '127.0.0.1',
    port: fixture.profiles[0].port, username: 'tester', password: 'test-password', rootPath: '/public_html'};
  await check('settings.json profile connects and saves with original Remote FS field names', async () => {
    await settings.update('remote', {[settingsKey]: settingsEntry}, vscode.ConfigurationTarget.Global);
    const file = settingsUri(settingsKey, settingsEntry, '/from-settings.txt');
    await write(file, 'Configured through settings.json');
    assert.equal(await read(file), 'Configured through settings.json');
    assert.equal(await fs.readFile(disk('from-settings.txt'), 'utf8'), 'Configured through settings.json');
    // Wizard profiles continue to work alongside settings profiles.
    assert.equal(await read(uri('ftp-test', '/from-settings.txt')), 'Configured through settings.json');
  });
  await check('settings password changes reauthenticate an existing live connection', async () => {
    await settings.update('remote', {[settingsKey]: {...settingsEntry, password: 'wrong-password'}}, vscode.ConfigurationTarget.Global);
    await assert.rejects(vscode.workspace.fs.readDirectory(settingsUri(settingsKey, settingsEntry)));
    await settings.update('remote', {[settingsKey]: settingsEntry}, vscode.ConfigurationTarget.Global);
    assert.ok((await vscode.workspace.fs.readDirectory(settingsUri(settingsKey, settingsEntry))).length > 0);
  });
  await check('root changes cannot redirect an already open file to a different folder', async () => {
    const oldFile = settingsUri(settingsKey, settingsEntry, '/from-settings.txt');
    const changed = {...settingsEntry, rootPath: '/'};
    await settings.update('remote', {[settingsKey]: changed}, vscode.ConfigurationTarget.Global);
    await assert.rejects(write(oldFile, 'must not be written'));
    const entries = await vscode.workspace.fs.readDirectory(settingsUri(settingsKey, changed));
    assert.ok(entries.some(([name]) => name === 'outside.txt'));
    assert.equal(await fs.readFile(disk('from-settings.txt'), 'utf8'), 'Configured through settings.json');
    await assert.rejects(fs.stat(path.join(fixture.root, 'from-settings.txt')));
  });
  await check('workspace JSON overrides user settings and applies optional defaults', async () => {
    const defaults = {host: '127.0.0.1', port: fixture.profiles[0].port, username: 'reader', password: 'test-password'};
    await settings.update('remote', {[settingsKey]: defaults}, vscode.ConfigurationTarget.Workspace);
    // VS Code merges object settings: explicitly replace inherited rootPath with its default.
    const effective = {...settingsEntry, ...defaults, rootPath: '/'};
    const entries = await vscode.workspace.fs.readDirectory(settingsUri(settingsKey, effective));
    assert.ok(entries.some(([name]) => name === 'outside.txt'));
    await assert.rejects(write(settingsUri(settingsKey, effective, '/forbidden.txt'), 'no'));
    await settings.update('remote', undefined, vscode.ConfigurationTarget.Workspace);
  });
  await check('malformed settings do not break valid or wizard connections', async () => {
    await settings.update('remote', {[settingsKey]: settingsEntry, invalid: {host: 123, password: 'not-logged'}}, vscode.ConfigurationTarget.Global);
    assert.ok((await vscode.workspace.fs.readDirectory(settingsUri(settingsKey, settingsEntry))).length > 0);
    assert.ok((await vscode.workspace.fs.readDirectory(uri('ftp-test'))).length > 0);
  });
  await check('removing a JSON profile disables its old URI without deleting files', async () => {
    await settings.update('remote', {}, vscode.ConfigurationTarget.Global);
    await assert.rejects(vscode.workspace.fs.readDirectory(settingsUri(settingsKey, settingsEntry)));
    assert.equal(await fs.readFile(disk('from-settings.txt'), 'utf8'), 'Configured through settings.json');
  });
  await check('legacy wizard connections and secure JSON passwords migrate across extension identities', async () => {
    const secretEntry = {scheme: 'ftp', host: '127.0.0.1', port: fixture.profiles[0].port,
      username: 'tester', rootPath: '/public_html'};
    await settings.update('remote', {'migration-secret.test': secretEntry}, vscode.ConfigurationTarget.Global);
    const legacy = vscode.extensions.getExtension('remoter-fs-local.remoter-fs');
    assert.ok(legacy, 'Migration helper is available');
    await legacy.activate();
    await vscode.commands.executeCommand('filebridge.migrateLegacyConnections.remoter-fs-local-remoter-fs');
    assert.equal(await read(uri('legacy-migrated', '/protected.txt')), 'original');
    assert.equal(await read(settingsUri('migration-secret.test', secretEntry, '/protected.txt')), 'original');
    assert.equal(vscode.workspace.getConfiguration('remotefs').get('remote')['migration-secret.test'].password, undefined);
  });
  await check('repeated migration keeps newer passwords and rejects invalid payloads', async () => {
    const api = ext.exports;
    await api.importLegacyState({servers: [fixture.legacyProfile], passwords: [{id: fixture.legacyProfile.id, password: 'wrong-password'}]});
    await vscode.commands.executeCommand('remoterfs.disconnect', {profile: {id: 'legacy-migrated'}});
    // Re-enable through the command would add a workspace folder, so check the JSON secret route instead.
    const entry = {scheme: 'ftp', host: '127.0.0.1', port: fixture.profiles[0].port, username: 'tester', rootPath: '/public_html'};
    const secretUri = settingsUri('migration-secret.test', entry, '/protected.txt');
    await api.importLegacyState({servers: [], passwords: [{id: secretUri.authority, password: 'wrong-password'}]});
    await assert.rejects(api.importLegacyState({servers: [{...fixture.legacyProfile, host: ''}], passwords: []}));
    assert.equal(await read(secretUri), 'original');
    await settings.update('remote', {}, vscode.ConfigurationTarget.Global);
  });
  await check('FileBridge publisher data migrates to Webobscure without conflicting with the older helper', async () => {
    const previous = vscode.extensions.getExtension('filebridge.filebridge');
    assert.ok(previous, 'Previous publisher migration helper is available');
    await previous.activate();
    await vscode.commands.executeCommand('filebridge.migrateLegacyConnections.filebridge-filebridge');
    assert.equal(await read(uri('previous-migrated', '/protected.txt')), 'original');
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('filebridge.migrateLegacyConnections.remoter-fs-local-remoter-fs'));
    assert.ok(commands.includes('filebridge.migrateLegacyConnections.filebridge-filebridge'));
  });
  await check('simultaneous migration imports retain both sets of connections', async () => {
    const api = ext.exports;
    await Promise.all(['concurrent-one', 'concurrent-two'].map(id => api.importLegacyState({
      servers: [{...fixture.legacyProfile, id}], passwords: [{id, password: 'test-password'}]
    })));
    assert.equal(await read(uri('concurrent-one', '/protected.txt')), 'original');
    assert.equal(await read(uri('concurrent-two', '/protected.txt')), 'original');
  });
  await fs.writeFile(fixture.report, JSON.stringify({editor: fixture.editor, version: vscode.version,
    platform: process.platform, arch: process.arch, node: process.versions.node, passed: results}, null, 2));
};
