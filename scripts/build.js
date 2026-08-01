import esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { generateServiceWorker } from './generate-sw.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const serve = process.argv.includes('--serve');

// Dev serving keeps readable output so stack traces point at real source lines;
// only the shipped bundle is minified.
const minify = !serve;

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
  alias: { ws: './src/ai/ws-stub.ts' },
  define: {
    __AI_CLIENT_ID__: JSON.stringify(process.env.AI_CLIENT_ID ?? ''),
    __AI_CLIENT_SECRET__: JSON.stringify(process.env.AI_CLIENT_SECRET ?? ''),
    __AI_ENABLED__: process.env.AI_ENABLED === 'true' ? 'true' : 'false',
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
