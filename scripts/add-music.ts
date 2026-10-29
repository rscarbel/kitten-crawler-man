/**
 * Registers a credited song in one step: copies the file into
 * `src/audio/music/<id>.<mp3|ogg>` (unless it is already there), adds the id to
 * `MUSIC_TRACK_IDS`, `SOUND_MANIFEST` and (unless `--decoded`) `STREAMING_SOUND_IDS`, writes its
 * `MUSIC_CATALOG` entry (and a new music area when asked), optionally an intro
 * length in `MUSIC_LOOP_START_S`, then measures loudness, formats and runs
 * `check:audio`. Making something claim the song is left to the caller.
 *
 * Usage:
 *   npm run add:music -- <file.mp3|file.ogg> --title "Shown Title" --area <area>
 *     (--author-name "Real Name" | --author-username handle)
 *     [--original-title "Recording's own title"]   default: --title
 *     [--pixabay]                                  licensed from Pixabay; omit for originals
 *     [--id snake_case_id]                         default: the file name
 *     [--area-label "Label"]                       creates --area as a new music area
 *     [--loop-start <seconds>]                     intro heard once before the loop body
 *     [--decoded]                                  played from a decoded buffer, not streamed:
 *                                                  a gapless loop or a stem; needs a preload group
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ALL_SOUND_IDS } from '../src/audio/sounds';
import { MUSIC_AREA_IDS } from '../src/audio/music/catalog';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOUNDS_PATH = join(REPO_ROOT, 'src/audio/sounds.ts');
const CATALOG_PATH = join(REPO_ROOT, 'src/audio/music/catalog.ts');
const MUSIC_DIR = 'src/audio/music';
const EXPECTED_SAMPLE_RATE_HZ = 44100;
const EXPECTED_CHANNELS = 2;
const SNAKE_CASE_ID = /^[a-z][a-z0-9_]*$/;
/**
 * Song formats. Ogg Vorbis carries its exact length, so a decoded loop of it
 * repeats with no gap; an MP3 is padded by its encoder at both ends.
 */
const SONG_EXTENSIONS: ReadonlySet<string> = new Set(['.mp3', '.ogg']);

function fail(message: string): never {
  console.error(`add:music: ${message}`);
  process.exit(1);
}

function toId(fileName: string): string {
  return basename(fileName, extname(fileName))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Inserts `text` right after `anchor`, which must occur exactly once in `source`. */
function insertAfter(source: string, anchor: string, text: string, file: string): string {
  const at = source.indexOf(anchor);
  if (at === -1 || source.indexOf(anchor, at + 1) !== -1) {
    fail(`expected exactly one ${JSON.stringify(anchor)} in ${file}`);
  }
  const end = at + anchor.length;
  return source.slice(0, end) + text + source.slice(end);
}

/** Inserts `text` before the first `closer` that follows `opener`. */
function insertBeforeClose(
  source: string,
  opener: string,
  closer: string,
  text: string,
  file: string,
): string {
  const openAt = source.indexOf(opener);
  const closeAt = openAt === -1 ? -1 : source.indexOf(closer, openAt);
  if (closeAt === -1) fail(`could not find ${JSON.stringify(opener)} … ${closer} in ${file}`);
  return source.slice(0, closeAt) + text + source.slice(closeAt);
}

function warnOnExportFormat(file: string): void {
  try {
    const probe = execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=sample_rate,channels',
        '-of',
        'csv=p=0',
        file,
      ],
      { encoding: 'utf8' },
    );
    const [sampleRate, channels] = probe.trim().split(',').map(Number);
    if (sampleRate !== EXPECTED_SAMPLE_RATE_HZ || channels !== EXPECTED_CHANNELS) {
      console.warn(
        `add:music: warning: ${basename(file)} is ${sampleRate} Hz, ${channels} channel(s); ` +
          `songs should be exported ${EXPECTED_SAMPLE_RATE_HZ} Hz stereo`,
      );
    }
  } catch {
    console.warn('add:music: ffprobe unavailable; export format not checked');
  }
}

function run(command: string, args: readonly string[]): void {
  execFileSync(command, args, { cwd: REPO_ROOT, stdio: 'inherit' });
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      title: { type: 'string' },
      area: { type: 'string' },
      'area-label': { type: 'string' },
      'author-name': { type: 'string' },
      'author-username': { type: 'string' },
      'original-title': { type: 'string' },
      pixabay: { type: 'boolean', default: false },
      id: { type: 'string' },
      'loop-start': { type: 'string' },
      decoded: { type: 'boolean', default: false },
    },
  });

  const [sourceArg] = positionals;
  if (sourceArg === undefined) fail('pass the .mp3 or .ogg file as the first argument');
  const sourceFile = resolve(sourceArg);
  if (!existsSync(sourceFile)) fail(`${sourceArg} does not exist`);
  const extension = extname(sourceFile).toLowerCase();
  if (!SONG_EXTENSIONS.has(extension)) fail('songs must be .mp3 or .ogg');

  const { title, area } = values;
  if (title === undefined || title.trim() === '') fail('--title is required');
  if (area === undefined) fail(`--area is required (one of: ${MUSIC_AREA_IDS.join(', ')})`);
  const authorName = values['author-name'];
  const authorUsername = values['author-username'];
  if (authorName === undefined && authorUsername === undefined) {
    fail('pass --author-name and/or --author-username');
  }

  const id = values.id ?? toId(sourceFile);
  if (!SNAKE_CASE_ID.test(id)) fail(`id "${id}" must be snake_case; pass --id`);
  const registeredIds: ReadonlySet<string> = new Set(ALL_SOUND_IDS);
  if (registeredIds.has(id)) fail(`"${id}" is already a registered sound id`);

  const knownAreas: ReadonlySet<string> = new Set(MUSIC_AREA_IDS);
  const areaLabel = values['area-label'];
  if (knownAreas.has(area) && areaLabel !== undefined) fail(`area "${area}" already exists`);
  if (!knownAreas.has(area) && areaLabel === undefined) {
    fail(
      `unknown area "${area}" (known: ${MUSIC_AREA_IDS.join(', ')}); ` +
        'pass --area-label to create it',
    );
  }
  if (!SNAKE_CASE_ID.test(area)) fail(`area "${area}" must be snake_case`);

  const loopStartArg = values['loop-start'];
  const loopStartS = loopStartArg === undefined ? undefined : Number(loopStartArg);
  if (loopStartS !== undefined && !(Number.isFinite(loopStartS) && loopStartS > 0)) {
    fail('--loop-start must be a positive number of seconds');
  }

  const repoRelativePath = `${MUSIC_DIR}/${id}${extension}`;
  const destination = join(REPO_ROOT, repoRelativePath);
  if (sourceFile !== destination) {
    if (existsSync(destination)) fail(`${repoRelativePath} already exists`);
    copyFileSync(sourceFile, destination);
  }
  warnOnExportFormat(destination);

  const quoted = (value: string): string => JSON.stringify(value);
  let sounds = readFileSync(SOUNDS_PATH, 'utf8');
  sounds = insertBeforeClose(
    sounds,
    'export const MUSIC_TRACK_IDS = [',
    '] as const;',
    `  ${quoted(id)},\n`,
    'sounds.ts',
  );
  sounds = insertAfter(
    sounds,
    'export const SOUND_MANIFEST: Record<SoundId, string> = {\n',
    `  ${id}: ${quoted(`./${repoRelativePath}`)},\n`,
    'sounds.ts',
  );
  if (!values.decoded) {
    sounds = insertAfter(sounds, '  // music/ and jingles/\n', `  ${quoted(id)},\n`, 'sounds.ts');
  }
  if (loopStartS !== undefined) {
    sounds = insertAfter(
      sounds,
      'export const MUSIC_LOOP_START_S = {\n',
      `  ${id}: ${loopStartS},\n`,
      'sounds.ts',
    );
  }

  let catalog = readFileSync(CATALOG_PATH, 'utf8');
  if (areaLabel !== undefined) {
    catalog = insertBeforeClose(
      catalog,
      'export const MUSIC_AREA_IDS = [',
      '] as const;',
      `  ${quoted(area)},\n`,
      'catalog.ts',
    );
    catalog = insertBeforeClose(
      catalog,
      'export const MUSIC_AREA_LABELS = {',
      '} as const satisfies',
      `  ${area}: ${quoted(areaLabel)},\n`,
      'catalog.ts',
    );
  }
  const attribution = [
    authorName === undefined ? '' : `authorName: ${quoted(authorName)}, `,
    authorUsername === undefined ? '' : `authorUsername: ${quoted(authorUsername)}, `,
    `originalTitle: ${quoted(values['original-title'] ?? title)}`,
    values.pixabay ? `, source: 'Pixabay'` : '',
  ].join('');
  catalog = insertBeforeClose(
    catalog,
    'export const MUSIC_CATALOG = {',
    '} as const satisfies Record<MusicTrackId, MusicTrackDef>;',
    `  ${id}: { title: ${quoted(title)}, area: ${quoted(area)}, attribution: { ${attribution} } },\n`,
    'catalog.ts',
  );

  writeFileSync(SOUNDS_PATH, sounds);
  writeFileSync(CATALOG_PATH, catalog);
  console.log(`add:music: registered ${id} (${repoRelativePath})`);
  if (values.decoded) {
    console.log(
      `add:music: ${id} is decoded, not streamed: until it is in the SFX_GROUPS group ` +
        '(src/audio/sfxGroups.ts) of the place that claims it, check:audio below fails.',
    );
  }

  run('npx', ['tsx', 'scripts/measure-audio.ts']);
  run('npx', ['prettier', '--write', '--log-level', 'warn', SOUNDS_PATH, CATALOG_PATH]);
  run('npx', ['tsx', 'scripts/check-audio.ts']);

  console.log(
    `\nadd:music: ${id} is registered but nothing plays it yet. Claim it with\n` +
      `  scope.claimMusic({ owner, layer: 'area', selection: { kind: 'loop', id: '${id}' } })\n` +
      'adding a MusicClaimOwner for a new claimant, or add it to an existing playlist claim.',
  );
}

main();
