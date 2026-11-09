import { build } from 'esbuild';
await build({ entryPoints: ['src/extension.ts'], bundle: true, platform: 'node',
  format: 'cjs', target: 'node20', external: ['vscode'], outfile: 'dist/extension.js', sourcemap: true });
await build({ entryPoints: ['src/legacyMigration.ts'], bundle: true, platform: 'node',
  format: 'cjs', target: 'node20', external: ['vscode'], outfile: 'dist/legacy-migration.js' });
