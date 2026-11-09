const {test} = require('node:test');
const assert = require('node:assert/strict');
const {buildSync} = require('esbuild');
const Module = require('node:module');
const path = require('node:path');
const loaded = new Module(path.join(__dirname, 'search.cjs'), module);
loaded.filename = path.join(__dirname, 'search.cjs');
loaded._compile(buildSync({entryPoints: [path.join(__dirname, '../src/searchEngine.ts')], bundle: true,
  write: false, platform: 'node', format: 'cjs'}).outputFiles[0].text, loaded.filename);
const {searchRemote, SearchFileTooLarge} = loaded.exports;
const options = {query: 'needle', caseSensitive: false, exclude: [], maxFileBytes: 10000, maxResults: 100};
function fixture(files) {
  const reads = [];
  return {reads, source: {
    async list(folder) {
      const prefix = folder === '/' ? '/' : folder + '/';
      const children = new Map();
      for (const [key, value] of Object.entries(files)) if (key.startsWith(prefix)) {
        const relative = key.slice(prefix.length), name = relative.split('/')[0];
        if (name) children.set(name, {name, directory: relative.includes('/'), link: false, size: Buffer.byteLength(value)});
      }
      return [...children.values()];
    },
    async read(file) { reads.push(file); return Buffer.from(files[file]); }
  }};
}
test('search visits unopened nested files, preserves UTF-16 editor offsets, CRLF/BOM and literal punctuation', async () => {
  const {source} = fixture({'/site/a.php': '\ufeffintro\r\n😀 Needle NEEDLE\r\n', '/site/deep/б.php': 'needle', '/outside.txt': 'needle'});
  const hits = [];
  const summary = await searchRemote(source, '/site', options, () => false, hit => hits.push(hit));
  assert.equal(summary.matches, 3); assert.equal(summary.scanned, 2);
  assert.deepEqual(hits.slice(0, 2).map(({line, column}) => [line, column]), [[1, 3], [1, 10]]);
  const literal = fixture({'/a': 'a.b aXb'}), matches = [];
  await searchRemote(literal.source, '/', {...options, query: 'a.b'}, () => false, hit => matches.push(hit));
  assert.equal(matches.length, 1);
});
test('exact name/path exclusions avoid downloading excluded subtrees, with no default exclusions', async () => {
  const data = fixture({'/scope/node_modules/a': 'needle', '/scope/logs/a': 'needle', '/scope/app/logs/b': 'needle', '/scope/a': 'needle'});
  const summary = await searchRemote(data.source, '/scope', {...options, exclude: ['node_modules', 'logs/a']}, () => false, () => {});
  assert.equal(summary.matches, 2); assert.equal(summary.excluded, 2);
  assert.ok(!data.reads.some(file => file.includes('node_modules') || file === '/scope/logs/a'));
});
test('binary, invalid UTF-8, size growth, symlinks and unreadable folders are counted while search continues', async () => {
  const source = {
    async list(path) {
      if (path !== '/') throw new Error('denied');
      return ['binary', 'invalid', 'large', 'grow', 'good', 'link', 'denied', '..', 'bad\r\nname'].map(name =>
        ({name, directory: name === 'denied', link: name === 'link', size: name === 'large' ? 99999 : 1}));
    },
    async read(path) {
      if (path === '/grow') throw new SearchFileTooLarge();
      return path === '/binary' ? Buffer.from([0, 1]) : path === '/invalid' ? Buffer.from([255]) : Buffer.from('needle');
    }
  };
  const summary = await searchRemote(source, '/', options, () => false, () => {});
  assert.equal(summary.binary, 2); assert.equal(summary.large, 2); assert.equal(summary.links, 1);
  assert.equal(summary.errors, 1); assert.equal(summary.matches, 1); assert.match(summary.issues[0], /denied/);
});
test('result limits and cancellation preserve partial results and stop further downloads', async () => {
  const data = fixture({'/a': 'needle needle needle', '/b': 'needle'});
  const limited = await searchRemote(data.source, '/', {...options, maxResults: 2}, () => false, () => {});
  assert.equal(limited.limited, true); assert.deepEqual(data.reads, ['/a']);
  let cancelled = false;
  const source = fixture({'/a': 'needle needle', '/b': 'needle'}).source;
  const summary = await searchRemote(source, '/', options, () => cancelled, () => { cancelled = true; });
  assert.equal(summary.cancelled, true); assert.equal(summary.matches, 1);
});
test('case-sensitive queries and invalid parameters', async () => {
  const data = fixture({'/a': 'Needle needle'});
  const summary = await searchRemote(data.source, '/', {...options, caseSensitive: true}, () => false, () => {});
  assert.equal(summary.matches, 1);
  for (const patch of [{query: ''}, {query: 'a\nb'}, {maxResults: 0}, {exclude: ['../x']}, {exclude: ['*.log']}]) {
    await assert.rejects(searchRemote(data.source, '/', {...options, ...patch}, () => false, () => {}));
  }
});
