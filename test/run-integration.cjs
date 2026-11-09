const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');
const { once } = require('node:events');
const { createHash } = require('node:crypto');

async function main() {
  const project = path.resolve(__dirname, '..');
  // macOS Unix socket names are limited to 103 bytes; keep editor profiles short.
  const temporary = await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/private/tmp' : os.tmpdir(), 'rfs-it-'));
  const root = path.join(temporary, 'server');
  await fs.mkdir(path.join(root, 'public_html'), {recursive: true});
  const python = process.env.REMOTER_TEST_PYTHON || '/private/tmp/remoter-fs-test-venv/bin/python';
  const children = [];
  async function startServer(cert = '') {
    const child = spawn(python, [path.join(__dirname, 'ftp-server.py'), root, cert], {stdio: ['ignore', 'pipe', 'pipe']});
    children.push(child);
    child.stderr.resume();
    const lines = readline.createInterface({input: child.stdout});
    const line = await Promise.race([
      once(lines, 'line').then(([line]) => line),
      once(child, 'error').then(([error]) => { throw error; }),
      once(child, 'exit').then(([code]) => { throw new Error(`FTP fixture exited: ${code}`); })
    ]);
    lines.close();
    return JSON.parse(line).port;
  }
  function certificate(name) {
    const cert = path.join(temporary, `${name}.pem`);
    const key = path.join(temporary, `${name}.key`);
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-keyout', key, '-out', cert], {stdio: 'ignore'});
    return fs.readFile(key).then(async bytes => { await fs.appendFile(cert, bytes); return cert; });
  }
  try {
    const cert = await certificate('trusted');
    const untrusted = await certificate('untrusted');
    const port = await startServer();
    const tlsPort = await startServer(cert);
    const badTlsPort = await startServer(untrusted);
    const editors = process.env.REMOTER_TEST_EDITOR ? [[process.env.REMOTER_TEST_EDITOR, process.env.REMOTER_TEST_EXECUTABLE]] : [
      ['VS Code', '/Applications/Visual Studio Code.app/Contents/MacOS/Code'],
      ['Cursor', '/Applications/Cursor.app/Contents/MacOS/Cursor']
    ];
    for (const [editor, executable] of editors) {
      const folder = path.join(temporary, editor.replaceAll(' ', '-'));
      await fs.mkdir(folder, {recursive: true});
      await fs.writeFile(path.join(root, 'public_html/hello.txt'), 'Hello FTP\n');
      await fs.writeFile(path.join(root, 'outside.txt'), 'outside configured root');
      const extension = path.join(folder, 'extension');
      await fs.mkdir(extension);
      const manifest = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
      manifest.main = './bootstrap.cjs';
      await fs.writeFile(path.join(extension, 'package.json'), JSON.stringify(manifest));
      await fs.writeFile(path.join(extension, 'bootstrap.cjs'), `
        exports.activate = async context => {
          const fixture = JSON.parse(process.env.REMOTER_TEST_FIXTURE);
          const profiles = fixture.profiles;
          await context.globalState.update('servers', profiles);
          for (const profile of profiles) await context.secrets.store('password:' + profile.id, profile.id === 'bad-login' ? 'wrong-password' : 'test-password');
          return require(${JSON.stringify(path.join(project, 'dist/extension.js'))}).activate(context);
        };
      `);
      const legacyExtension = path.join(folder, 'legacy-extension');
      await fs.mkdir(legacyExtension);
      await fs.writeFile(path.join(legacyExtension, 'package.json'), JSON.stringify({
        name: 'remoter-fs', publisher: 'remoter-fs-local', version: '0.3.2',
        engines: {vscode: '^1.90.0'}, main: './bootstrap.cjs',
        contributes: {commands: [{command: 'filebridge.migrateLegacyConnections.remoter-fs-local-remoter-fs', title: 'Transfer Legacy Connections'}]}
      }));
      await fs.writeFile(path.join(legacyExtension, 'bootstrap.cjs'), `
        exports.activate = async context => {
          const fixture = JSON.parse(process.env.REMOTER_TEST_FIXTURE);
          await context.globalState.update('servers', [fixture.legacyProfile]);
          await context.globalState.update('filebridgeMigrationComplete', true);
          await context.secrets.store('password:' + fixture.legacyProfile.id, 'test-password');
          await context.secrets.store('password:' + fixture.legacySecretId, 'test-password');
          return require(${JSON.stringify(path.join(project, 'dist/legacy-migration.js'))}).activate(context);
        };
      `);
      const previousExtension = path.join(folder, 'previous-extension');
      await fs.mkdir(previousExtension);
      await fs.writeFile(path.join(previousExtension, 'package.json'), JSON.stringify({
        name: 'filebridge', publisher: 'FileBridge', version: '0.4.1', engines: {vscode: '^1.90.0'}, main: './bootstrap.cjs',
        contributes: {commands: [{command: 'filebridge.migrateLegacyConnections.filebridge-filebridge', title: 'Transfer Previous Publisher Connections'}]}
      }));
      await fs.writeFile(path.join(previousExtension, 'bootstrap.cjs'), `
        exports.activate = async context => {
          const fixture = JSON.parse(process.env.REMOTER_TEST_FIXTURE);
          await context.globalState.update('servers', [fixture.previousProfile]);
          await context.globalState.update('filebridgeMigrationComplete', true);
          await context.secrets.store('password:' + fixture.previousProfile.id, 'test-password');
          return require(${JSON.stringify(path.join(project, 'dist/legacy-migration.js'))}).activate(context);
        };
      `);
      const base = {name: 'Local FTP fixture', host: '127.0.0.1', port, protocol: 'ftp', username: 'tester', rootPath: '/public_html', timeout: 3000, atomicSave: true};
      const profiles = [
        {...base, id: 'ftp-test'}, {...base, id: 'reader-test', username: 'reader'},
        {...base, id: 'direct-test', atomicSave: false}, {...base, id: 'bad-login'},
        {...base, id: 'ftps-test', protocol: 'ftps', port: tlsPort},
        {...base, id: 'bad-tls', protocol: 'ftps', port: badTlsPort}
      ];
      const report = path.join(folder, 'report.json');
      const legacyProfile = {...base, id: 'legacy-migrated', name: 'Migrated wizard connection'};
      const previousProfile = {...base, id: 'previous-migrated', name: 'Previous publisher connection'};
      const legacySecretId = `settings-${createHash('sha256').update(JSON.stringify([
        'migration-secret.test', 'ftp', '127.0.0.1', port, 'tester', '/public_html'
      ])).digest('hex').slice(0, 32)}`;
      const workspace = path.join(folder, 'fixture.code-workspace');
      await fs.writeFile(workspace, JSON.stringify({folders: [{uri: 'remoterfs://ftp-test/', name: 'Local FTP fixture'}],
        settings: {'security.workspace.trust.enabled': false, 'files.autoSave': 'off', 'workbench.startupEditor': 'none', 'window.newWindowProfile': 'Default'}}));
      const env = {...process.env, NODE_EXTRA_CA_CERTS: cert,
        REMOTER_TEST_FIXTURE: JSON.stringify({root, profiles, report, editor, legacyProfile, legacySecretId, previousProfile})};
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(executable, [
        '--user-data-dir', path.join(folder, 'user-data'), '--extensions-dir', path.join(folder, 'extensions'),
        '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
        '--disable-updates', '--disable-telemetry', '--new-window',
        `--extensionDevelopmentPath=${extension}`, `--extensionDevelopmentPath=${legacyExtension}`,
        `--extensionDevelopmentPath=${previousExtension}`,
        `--extensionTestsPath=${path.join(__dirname, 'host-tests.cjs')}`, workspace
      ], {env, stdio: ['ignore', 'pipe', 'pipe']});
      children.push(child);
      let logs = '';
      for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { logs += chunk.toString(); });
      const timer = setTimeout(() => { child.kill('SIGTERM'); }, 120000);
      let code;
      try { [code] = await once(child, 'exit'); }
      finally { clearTimeout(timer); }
      await fs.writeFile(path.join(folder, 'editor.log'), logs);
      if (code !== 0) { throw new Error(`${editor} integration failed (${code}). ${logs.slice(-6000)}\nLogs: ${folder}`); }
      const result = JSON.parse(await fs.readFile(report, 'utf8'));
      console.log(`${editor}: ${result.passed.length} integration checks passed. Report: ${report}`);
    }
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
    console.log(`Integration artifacts: ${temporary}`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
