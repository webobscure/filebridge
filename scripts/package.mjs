import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const project = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
// Marketplace enforces this limit on the uncompressed icon, not the VSIX size.
if (manifest.icon) {
  const icon = readFileSync(join(project, manifest.icon));
  if (icon.length > 1024 * 1024) {
    throw new Error('Extension icon exceeds the Marketplace limit of 1024 KB.');
  }
  if (!icon.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('Extension icon must be a PNG.');
  }
  const width = icon.readUInt32BE(16);
  const height = icon.readUInt32BE(20);
  if (width < 128 || height < 128 || width > 1024 || height > 1024) {
    throw new Error('Extension icon dimensions must be between 128 and 1024 pixels.');
  }
}
execFileSync(process.execPath, [join(project, 'node_modules/@vscode/vsce/vsce'), 'package', '--no-dependencies',
  '--out', join(project, `filebridge-${manifest.version}.vsix`)], {cwd: project, stdio: 'inherit'});
