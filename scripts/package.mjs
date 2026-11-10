import { readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const project = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
// Marketplace enforces this limit on the uncompressed icon, not the VSIX size.
if (manifest.icon && statSync(join(project, manifest.icon)).size > 1024 * 1024) {
  throw new Error('Extension icon exceeds the Marketplace limit of 1024 KB.');
}
execFileSync(process.execPath, [join(project, 'node_modules/@vscode/vsce/vsce'), 'package', '--no-dependencies',
  '--out', join(project, `filebridge-${manifest.version}.vsix`)], {cwd: project, stdio: 'inherit'});
