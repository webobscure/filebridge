import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const plugin = await readFile(join(root, 'jetbrains/src/main/resources/META-INF/plugin.xml'), 'utf8');
const nativeVersion = plugin.match(/<version>([^<]+)<\/version>/)[1];
const files = [`filebridge-${manifest.version}.vsix`, 'filebridge-migration-from-remoter-0.3.2.vsix',
  'filebridge-migration-from-0.4-0.4.1.vsix', `filebridge-phpstorm-${nativeVersion}.zip`];
const destination = join(root, 'release');
// Validate all inputs before replacing an earlier generated release directory.
const packages = await Promise.all(files.map(async file => ({file, bytes: await readFile(join(root, file))})));
await rm(destination, {recursive: true, force: true});
await mkdir(destination, {recursive: true});
const sums = [];
for (const {file, bytes} of packages) {
  await writeFile(join(destination, file), bytes);
  sums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${file}`);
}
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
const sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {cwd: root, encoding: 'utf8'}).trim());
await writeFile(join(destination, 'SHA256SUMS'), sums.join('\n') + '\n');
await writeFile(join(destination, 'build-info.json'), JSON.stringify({repository: manifest.repository.url,
  commit, sourceDirty, vscodeExtension: manifest.version, phpstormPlugin: nativeVersion, files}, null, 2) + '\n');
console.log(`Collected ${files.length} packages at ${destination}, commit ${commit}.`);
