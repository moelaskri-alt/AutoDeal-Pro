// Bundles the Electron main process and preload script (including the core business layer).
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  external: ['electron', 'node:sqlite'],
  logLevel: 'info',
};

await build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'build/main/main.js' });
await build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'build/main/preload.js' });
