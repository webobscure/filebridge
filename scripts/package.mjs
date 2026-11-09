import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const project = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
execFileSync(process.execPath, [join(project, 'node_modules/@vscode/vsce/vsce'), 'package', '--no-dependencies',
  '--out', join(project, `filebridge-${manifest.version}.vsix`)], {cwd: project, stdio: 'inherit'});
