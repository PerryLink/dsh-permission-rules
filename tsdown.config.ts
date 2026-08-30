/**
 * Build faces for dsh-permission-rules. The node half (src/index.ts plus
 * the hand-written Typert host manifest src/typert.host.ts) is the host
 * Loader entry; the browser half (src/client/index.ts) is the client
 * bundle the client-modules node half serves under
 * /plugins/dsh-permission-rules/client.js.
 *
 * The browser half follows the shell's client-bundle handshake exactly: a
 * CJS bundle wrapped in `window.__ModuleLoader__.load({ id, factory })`,
 * with the shell's platform modules left external (the factory's `require`
 * answers them from the frozen module table) and every other dependency
 * inlined. zod (the wire codecs) is inlined into both halves.
 */

import { defineConfig } from 'tsdown'

/** Plugin id: the cordis.yml bare row name, the graph row id, and the stamped bundle id must all match. */
const PLUGIN_ID = 'dsh-permission-rules'

/**
 * Module specifiers the shell shares into the frozen browser module table
 * (packages/client/web/src/platform.ts `PLATFORM_MODULES` at the 0.1.2-alpha
 * host line). Any value import outside this list must be inlined.
 */
const PLATFORM_EXTERNALS: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

export default defineConfig([
  {
    name: PLUGIN_ID,
    entry: { index: 'src/index.ts', 'typert.host': 'src/typert.host.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: false,
    // ESM output under a "type": "module" package must land on .js, not .mjs.
    fixedExtension: false,
    deps: {
      // Only zod may come in from node_modules; everything else stays external
      // (the @deepseek-ai/* peers are provided by the host at runtime, and
      // `yaml`/`chokidar` resolve from the profile's node_modules). Bundling
      // zod keeps the host half self-contained when a profile resolves the
      // package outside pnpm's tree, since the shared profiles/node_modules
      // fallback carries no dep set.
      onlyBundle: ['zod'],
      alwaysBundle: ['zod'],
      neverBundle: [/^node:/],
    },
  },
  {
    name: `${PLUGIN_ID}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      // Platform modules stay external (the factory's `require` answers them
      // from the shell's frozen module table); every other import is inlined.
      // `onlyBundle: false` suppresses the bundled-dependency warning — the
      // inlining here is deliberate, not accidental.
      onlyBundle: false,
      alwaysBundle: (id: string) => (PLATFORM_EXTERNALS.includes(id) ? undefined : true),
      neverBundle: [...PLATFORM_EXTERNALS],
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
