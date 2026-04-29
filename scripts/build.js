import esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const serve = process.argv.includes('--serve');

/** @type {import('esbuild').BuildOptions} */
const opts = {
  entryPoints: ['src/game.ts'],
  bundle: true,
  outfile: 'dist/bundle.js',
  alias: { ws: './src/ai/ws-stub.ts' },
  define: {
    __AI_CLIENT_ID__: JSON.stringify(process.env.AI_CLIENT_ID ?? ''),
    __AI_CLIENT_SECRET__: JSON.stringify(process.env.AI_CLIENT_SECRET ?? ''),
  },
};

if (serve) {
  esbuild
    .context(opts)
    .then((ctx) => ctx.serve({ servedir: '.', port: 8080 }))
    .catch(() => process.exit(1));
} else {
  esbuild.build(opts).catch(() => process.exit(1));
}
