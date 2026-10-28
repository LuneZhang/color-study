import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['packages/server/src/index.ts'], format: ['esm'], platform: 'node', target: 'node24',
  outDir: 'packages/server/dist', splitting: false, sourcemap: true,
  noExternal: ['@color-study/shared'],
  external: ['better-sqlite3', 'sharp', '@napi-rs/keyring', 'rss-parser', 'undici', 'yauzl', 'yazl', 'busboy'],
});
