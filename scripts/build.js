const esbuild = require('esbuild');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

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
