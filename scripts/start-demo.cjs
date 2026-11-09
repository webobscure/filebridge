// Isolated, disposable loopback FTP workspace for screenshots and demonstrations.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');
const readline = require('node:readline');
const {once} = require('node:events');

async function main() {
  const project = path.resolve(__dirname, '..');
  const folder = await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/private/tmp' : os.tmpdir(), 'filebridge-demo-'));
  const server = path.join(folder, 'server');
  const site = path.join(server, 'public_html');
  for (const name of ['app/Http/Controllers', 'config', 'routes', 'public/css']) await fs.mkdir(path.join(site, name), {recursive: true});
  const files = {
    'config/site.php': "<?php\n\nreturn [\n    'name' => 'FileBridge Demo',\n    'message' => 'Hello from the server.',\n    'environment' => 'demo',\n];\n",
    'app/Http/Controllers/PageController.php': "<?php\n\nnamespace App\\Http\\Controllers;\n\nclass PageController\n{\n    public function index(): string\n    {\n        return 'Hello from the server.';\n    }\n}\n",
    'routes/web.php': "<?php\n\nuse App\\Http\\Controllers\\PageController;\n\nRoute::get('/', [PageController::class, 'index']);\n",
    'public/css/site.css': "body {\n    font-family: system-ui, sans-serif;\n    color: #1f2937;\n}\n",
    'README.md': '# Website Demo\n\nA disposable FTP website used to demonstrate FileBridge.\n'
  };
  for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(site, name), text);
  const python = process.env.REMOTER_TEST_PYTHON || '/private/tmp/remoter-fs-test-venv/bin/python';
  const ftp = spawn(python, [path.join(project, 'test/ftp-server.py'), server, ''], {stdio: ['ignore', 'pipe', 'ignore']});
  const lines = readline.createInterface({input: ftp.stdout});
  const [line] = await once(lines, 'line'); lines.close(); ftp.stdout.resume();
  const port = JSON.parse(line).port;
  const extension = path.join(folder, 'extension'); await fs.mkdir(path.join(extension, 'assets'), {recursive: true});
  const manifest = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
  manifest.main = './bootstrap.cjs'; manifest.activationEvents = [...manifest.activationEvents, 'onStartupFinished'];
  await fs.writeFile(path.join(extension, 'package.json'), JSON.stringify(manifest));
  await fs.copyFile(path.join(project, 'dist/extension.js'), path.join(extension, 'extension.js'));
  await fs.copyFile(path.join(project, 'assets/filebridge-icon.png'), path.join(extension, 'assets/filebridge-icon.png'));
  const profile = {id:'website-demo',name:'Website Demo',protocol:'ftp',host:'127.0.0.1',port,
    username:'tester',rootPath:'/public_html',timeout:30000,atomicSave:true};
  await fs.writeFile(path.join(extension, 'bootstrap.cjs'), `exports.activate = async context => {
    await context.globalState.update('servers', [${JSON.stringify(profile)}]);
    await context.secrets.store('password:website-demo', 'test-password');
    return require('./extension.js').activate(context);
  };`);
  const userData = path.join(folder, 'user-data'); await fs.mkdir(path.join(userData, 'User'), {recursive: true});
  await fs.writeFile(path.join(userData, 'User/settings.json'), JSON.stringify({
    'window.title': 'FileBridge Demo — ${activeEditorShort}',
    'workbench.startupEditor':'none','workbench.colorTheme':'Default Dark Modern',
    'workbench.tips.enabled':false,'editor.fontSize':16,'editor.minimap.enabled':false,
    'files.autoSave':'off','workbench.editor.enablePreview':false,
    'explorer.compactFolders':false,'security.workspace.trust.enabled':false,
    'telemetry.telemetryLevel':'off'
  }));
  const workspace = path.join(folder, 'FileBridge Demo.code-workspace');
  await fs.writeFile(workspace, JSON.stringify({folders:[],settings:{}}));
  const executable = process.env.REMOTER_TEST_EXECUTABLE || '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  const editor = spawn(executable, ['--user-data-dir',userData,'--extensions-dir',path.join(folder,'extensions'),
    '--disable-extensions','--disable-workspace-trust','--skip-welcome','--skip-release-notes','--new-window',
    `--extensionDevelopmentPath=${extension}`,workspace], {env,stdio:'ignore'});
  try { await once(editor, 'spawn'); }
  catch (error) { ftp.kill(); throw error; }
  await fs.writeFile('/private/tmp/filebridge-demo.json', JSON.stringify({folder,server,site,port,editorPid:editor.pid,ftpPid:ftp.pid},null,2));
  console.log('Demo ready:', folder);
  console.log('Only disposable loopback credentials are used. Close the demo editor to stop its FTP server.');
  editor.on('exit', () => ftp.kill());
}
main().catch(error => {console.error(error);process.exitCode=1;});
