import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: false,
  clean: true,
  outDir: 'lib',
  outExtensions: () => ({ js: '.js' }),
  // Everything under @deepseek-ai/* is provided by the host at runtime; the
  // runtime dependencies (`yaml`, `chokidar`) stay external and resolve from
  // the profile's node_modules.
  deps: { neverBundle: [/^@deepseek-ai\//] },
})
