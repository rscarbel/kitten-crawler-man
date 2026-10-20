import esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { generateServiceWorker } from './generate-sw.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const serve = process.argv.includes('--serve');

/** Where the AI server listens when `.env` names none: the local dev server. */
const DEFAULT_AI_SERVER_URL = 'http://localhost:3001';

// Dev serving keeps readable output so stack traces point at real source lines;
// only the shipped bundle is minified.
const minify = !serve;

/**
 * Whether `?playtest=` / `?level=` / the art preview routes are compiled in.
 *
 * Opt-in rather than opt-out, because the shipped site is built by plain
 * `npm run build` — a route left to a runtime guard would still be sitting in
 * the deployed bundle for a player to find.
 */
const devBoot = serve || process.argv.includes('--dev-boot');

/**
 * Redirects `src/dev/devBoot.ts` to its inert stub unless this is a dev build.
 *
 * A resolve-time swap rather than a `define` flag: dead-code elimination folds
 * the *call* away but still drags the module's imports — every preview scene,
 * every playtest preset — into the output. Cutting the import edge is what
 * actually keeps them out.
 */
const devBootStub = {
  name: 'dev-boot-stub',
  setup(build) {
    if (devBoot) return;
    build.onResolve({ filter: /(^|\/)dev\/devBoot$/ }, () => ({
      path: path.resolve(__dirname, '../src/dev/devBoot.stub.ts'),
    }));
  },
};

/** @type {import('esbuild').BuildOptions} */
const opts = {
  entryPoints: ['src/game.ts'],
  bundle: true,
  outfile: 'dist/bundle.js',
  minify,
  // Mob.mobType and the AI adapter read `constructor.name`, so class and
  // function names must survive minification.
  keepNames: minify,
  legalComments: 'none',
  plugins: [devBootStub],
  // The AI SDK loads the Node `ws` package only when there is no global
  // WebSocket; a browser always has one, so it must never be bundled.
  external: ['ws'],
  define: {
    // Only public values belong here: whatever is defined is readable by anyone
    // who loads the game. The AI credential stays on the game server, which
    // signs player tokens at /api/ai-token.
    __AI_SERVER_URL__: JSON.stringify(process.env.AI_SERVER_URL ?? DEFAULT_AI_SERVER_URL),
    __AI_ENABLED__: process.env.AI_ENABLED === 'true' ? 'true' : 'false',
    __DEV_BUILD__: devBoot ? 'true' : 'false',
  },
};

if (serve) {
  esbuild
    .context(opts)
    .then((ctx) => ctx.serve({ servedir: '.', port: 8080 }))
    .catch(() => process.exit(1));
} else {
  esbuild
    .build(opts)
    .then(() => generateServiceWorker())
    .catch(() => process.exit(1));
}
