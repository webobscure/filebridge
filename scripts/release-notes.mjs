import { readFileSync, writeFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const tag = process.env.RELEASE_TAG;
if (tag !== `v${manifest.version}`) throw new Error(`Release tag ${tag} does not match package.json v${manifest.version}.`);
const changelog = readFileSync('CHANGELOG.md', 'utf8');
const section = changelog.split(`## ${manifest.version}\n`)[1]?.split('\n## ')[0]?.trim();
if (!section) throw new Error('Add changelog notes for this release first.');
writeFileSync('release-notes.md', `# FileBridge ${manifest.version}\n\n${section}\n\n` +
  'Includes the VS Code/Cursor extension, one-time migration helpers, and the experimental PhpStorm plugin.\n\n' +
  'See build-info.json for the source commit and package versions; verify downloads with SHA256SUMS.\n');
