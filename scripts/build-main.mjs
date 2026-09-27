// Bundles the Electron main process + preload scripts (including the core business layer)
// and copies the Arabic font files used by printable documents.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  external: ['electron', 'node:sqlite'],
  logLevel: 'warning',
};

await build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'build/main/main.js' });
await build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'build/main/preload.js' });
await build({ ...common, entryPoints: ['src/preload/print-preload.ts'], outfile: 'build/main/print-preload.js' });

const fontSrc = 'node_modules/@fontsource/cairo/files';
const fontDst = 'build/main/fonts';
fs.mkdirSync(fontDst, { recursive: true });
for (const f of fs.readdirSync(fontSrc)) {
  if (/^cairo-(arabic|latin)-(400|700)-normal\.woff2$/.test(f)) fs.copyFileSync(path.join(fontSrc, f), path.join(fontDst, f));
}
console.log('main/preload built');
