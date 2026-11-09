import { mkdtemp, copyFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const project = resolve(import.meta.dirname, '..');
const sources = [
  {name: 'remoter-fs', publisher: 'remoter-fs-local', version: '0.3.2', label: 'Remoter FS', file: 'filebridge-migration-from-remoter-0.3.2.vsix'},
  {name: 'filebridge', publisher: 'FileBridge', version: '0.4.1', label: 'FileBridge Publisher', file: 'filebridge-migration-from-0.4-0.4.1.vsix'}
];
for (const source of sources) {
const staging = await mkdtemp(join(tmpdir(), 'filebridge-migration-'));
await mkdir(join(staging, 'assets'));
await copyFile(join(project, 'dist/legacy-migration.js'), join(staging, 'extension.js'));
await copyFile(join(project, 'assets/filebridge-icon.png'), join(staging, 'assets/icon.png'));
await copyFile(join(project, 'LICENSE'), join(staging, 'LICENSE'));
await writeFile(join(staging, 'package.json'), JSON.stringify({
  name: source.name, publisher: source.publisher, version: source.version,
  displayName: `FileBridge Migration Helper (${source.label})`,
  description: 'Transfer saved connections and passwords to FileBridge by Webobscure.',
  license: 'MIT', engines: { vscode: '^1.90.0' }, main: './extension.js',
  icon: 'assets/icon.png', extensionKind: ['ui'], activationEvents: ['onStartupFinished'],
  capabilities: { virtualWorkspaces: true, untrustedWorkspaces: { supported: false } },
  contributes: { commands: [{
    command: `filebridge.migrateLegacyConnections.${`${source.publisher}.${source.name}`.toLowerCase().replace(/\./g, '-')}`,
    title: `FileBridge: Transfer Legacy Connections (${source.label})`
  }] }
}, null, 2));
await writeFile(join(staging, 'README.md'), `# FileBridge Migration Helper

Install this helper over ${source.publisher}.${source.name}, then install FileBridge by Webobscure 0.5.0 and reload the editor.
Saved connections and passwords are transferred directly between the two extensions, without writing secrets to a file or sending them over a network.

Wait for the transfer success notification, then uninstall this helper. The helper itself does not connect to servers.
You can retry with **FileBridge: Transfer Legacy Connections**. Existing data is kept in the legacy storage, and newer data in FileBridge is not overwritten.
`);
execFileSync(process.execPath, [join(project, 'node_modules/@vscode/vsce/vsce'), 'package',
  '--no-dependencies', '--allow-missing-repository', '--out', join(project, source.file)],
{ cwd: staging, stdio: 'inherit' });
}
