/**
 * The Express server checks every save it stores with the same
 * `parseGameProgress` the game loads saves with, so the two can never
 * disagree. That validator, and everything it reaches, must stay data shapes:
 * ids, numbers and records. This check bundles the server's entry point and
 * fails when any game module that paints, plays sound, speaks dialog, builds a
 * scene or touches the DOM or a canvas is among the modules it loads.
 *
 * It follows imports transitively, which a lint rule cannot: a sprite import
 * added three modules below a save parser fails here.
 *
 * Every run first proves the detector on an entry known to load art, so a
 * detector that has quietly stopped matching cannot pass as a clean tree.
 *
 * `npm run lint` and `npm run check` run it; it exits 1 on any violation.
 *
 * Usage:
 *   npm run check:server-imports
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_ENTRY = 'server/index.ts';
const KNOWN_ART_ENTRY = 'src/sprites/humanSprite.ts';

interface ForbiddenArea {
  readonly pattern: RegExp;
  readonly why: string;
}

/** Game code the server must never load. */
const FORBIDDEN: readonly ForbiddenArea[] = [
  { pattern: /^src\/(sprites|images|shelf)\//, why: 'art' },
  { pattern: /^src\/audio\//, why: 'audio' },
  { pattern: /^src\/dialog\//, why: 'dialog' },
  { pattern: /^src\/(ui|scenes|dev)\//, why: 'UI and scenes' },
  {
    pattern: /^src\/core\/(rendering|spriteAssets|input|perf)\//,
    why: 'canvas, DOM and frame timing',
  },
  { pattern: /^src\/map\/(tiles|tilegen|ground)\//, why: 'tile painting' },
  { pattern: /^src\/(creatures|abilities|ai)\//, why: 'live creatures, spells and the AI bridge' },
  { pattern: /^src\/(Player|game|utils)\.ts$/, why: 'the live game' },
];

/**
 * Modules inside a forbidden folder that hold data only, and that the save
 * check reads ids from. Each imports nothing at run time.
 */
const DATA_ONLY_EXCEPTIONS: ReadonlySet<string> = new Set([
  // Every sound id; the music library's saved track ids are checked against it.
  'src/audio/sounds.ts',
  // The tactics traits; the floor's seen tactics notices are checked against them.
  'src/creatures/tactics/tacticsTraits.ts',
]);

async function loadedModules(entry: string): Promise<readonly string[]> {
  const result = await build({
    entryPoints: [resolve(REPO_ROOT, entry)],
    absWorkingDir: REPO_ROOT,
    bundle: true,
    write: false,
    metafile: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    logLevel: 'silent',
  });
  return Object.keys(result.metafile.inputs);
}

function violations(modules: readonly string[]): string[] {
  return modules.flatMap((module) => {
    if (DATA_ONLY_EXCEPTIONS.has(module)) return [];
    const area = FORBIDDEN.find((candidate) => candidate.pattern.test(module));
    return area === undefined ? [] : [`${module} (${area.why})`];
  });
}

const selfCheck = violations(await loadedModules(KNOWN_ART_ENTRY));
if (selfCheck.length === 0) {
  console.log(
    `check:server-imports FAILED: the detector found nothing forbidden in ${KNOWN_ART_ENTRY}, which loads art`,
  );
  process.exit(1);
}

const serverModules = await loadedModules(SERVER_ENTRY);
const gameModules = serverModules.filter((module) => module.startsWith('src/'));
const found = violations(serverModules);
if (found.length > 0) {
  console.log(
    `check:server-imports FAILED: ${SERVER_ENTRY} loads ${found.length} game module(s) it must not:`,
  );
  for (const line of found) console.log(`  ${line}`);
  console.log(
    'Move the id list or parser the save check needs into a module that holds data only.',
  );
  process.exit(1);
}
console.log(
  `check:server-imports passed: the server loads ${gameModules.length} game modules, all data`,
);
