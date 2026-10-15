/**
 * Measures every registered recording with ffmpeg's EBU R128 filter and writes
 * `src/audio/loudness.generated.ts`: integrated loudness, true peak, a content
 * hash and the playback trim that brings the file to its bus target.
 *
 * Run it after adding or swapping any audio file; `check:audio` fails on a
 * stale hash until it has been run. It never modifies the audio itself — files
 * whose trim had to be clamped are listed for re-export instead.
 *
 * A file whose hash matches its existing entry keeps its measurement, so only
 * new or swapped files go through ffmpeg; `--all` re-measures everything.
 *
 * Usage:
 *   npm run measure:audio
 *   npm run measure:audio -- --all
 *
 * Needs ffmpeg and ffprobe: on PATH, at `$FFMPEG` / `$FFPROBE`, or at the
 * Homebrew location.
 */
import { execFile, execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { format, resolveConfig } from 'prettier';
import {
  ALL_SOUND_IDS,
  JINGLE_IDS,
  MUSIC_TRACK_IDS,
  SOUND_MANIFEST,
  type SoundId,
} from '../src/audio/sounds';
import {
  BUS_TARGET_LUFS,
  MAX_TRIM_DB,
  SFX_FAMILIES,
  SFX_FAMILY_TARGET_LUFS,
  SHORT_ONE_SHOT_MAX_S,
  SHORT_ONE_SHOT_PEAK_TARGET_DBTP,
  TRIMMED_TRUE_PEAK_CEILING_DBTP,
  type LoudnessBasis,
  type LoudnessBus,
  type LoudnessEntry,
  type SfxFamily,
} from '../src/audio/loudnessTargets';
import { hashAudioFile } from './audioHash';
import { LOUDNESS } from '../src/audio/loudness.generated';

const execFileAsync = promisify(execFile);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_PATH = join(REPO_ROOT, 'src/audio/loudness.generated.ts');
const HOMEBREW_BIN = '/opt/homebrew/bin';
const AMBIENT_PREFIX = './src/audio/ambient/';
const AUDIO_PREFIX = './src/audio/';

/** ebur128 reports this floor when nothing passed its gate: too short or near-silent. */
const UNGATED_LUFS = -70;
/** ffmpeg's summary is short, but a long file's warnings are not. */
const FFMPEG_OUTPUT_BUFFER_BYTES = 16 * 1024 * 1024;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const DECIMALS_PER_DB = 10;
const MONO_CHANNELS = 1;
const STEREO_CHANNELS = 2;
/**
 * Web Audio plays a mono buffer into a stereo graph by copying it to both
 * speakers at unity gain, which ebur128 would otherwise measure as a single
 * centre channel about 3 LU quieter than what is heard.
 */
const BROWSER_MONO_UPMIX = 'pan=stereo|c0=c0|c1=c0';
const EBUR128_FILTER = 'ebur128=peak=true:framelog=quiet';
/**
 * A peak clamp that costs less than this is inaudible next to the by-ear SFX
 * tuning, so it is counted but not listed for re-export. Web Audio decodes to
 * float, so an over-0 dBTP file trimmed down far enough is not clipped either.
 */
const REEXPORT_CLAMP_SHORTFALL_DB = 2;

const musicBusIds: ReadonlySet<string> = new Set([...MUSIC_TRACK_IDS, ...JINGLE_IDS]);
const sfxFamilies: ReadonlySet<string> = new Set(SFX_FAMILIES);
const familyTargets: Partial<Record<SfxFamily, number>> = SFX_FAMILY_TARGET_LUFS;

interface Tools {
  readonly ffmpeg: string;
  readonly ffprobe: string;
}

interface Measurement {
  readonly lufs: number;
  readonly truePeakDbtp: number;
  readonly basis: LoudnessBasis;
}

interface MeasuredEntry extends LoudnessEntry {
  readonly id: SoundId;
  readonly path: string;
  readonly reexportReasons: readonly string[];
  readonly peakClamped: boolean;
}

function findTool(name: string, envVar: string): string {
  const homebrewPath = join(HOMEBREW_BIN, name);
  const candidates = [process.env[envVar], name, homebrewPath].filter(
    (candidate): candidate is string => candidate !== undefined && candidate !== '',
  );
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['-version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      continue;
    }
  }
  console.error(
    `measure:audio needs ${name} and could not find it (tried $${envVar}, PATH and ` +
      `${homebrewPath}). Install it with \`brew install ffmpeg\` or set ${envVar}=/path/to/${name}.`,
  );
  process.exit(1);
}

function isSfxFamily(folder: string): folder is SfxFamily {
  return sfxFamilies.has(folder);
}

function sfxFamilyOf(id: SoundId, path: string): SfxFamily {
  const folder = path.slice(AUDIO_PREFIX.length).split('/')[0] ?? '';
  if (!isSfxFamily(folder)) {
    throw new Error(`${id} lives in "${folder}", which is no bus folder or SFX family`);
  }
  return folder;
}

function busOf(id: SoundId, path: string): LoudnessBus {
  if (musicBusIds.has(id)) return 'music';
  if (path.startsWith(AMBIENT_PREFIX)) return 'ambience';
  return 'sfx';
}

function targetLufsOf(id: SoundId, path: string, bus: LoudnessBus): number {
  if (bus !== 'sfx') return BUS_TARGET_LUFS[bus];
  return familyTargets[sfxFamilyOf(id, path)] ?? BUS_TARGET_LUFS.sfx;
}

function matchNumber(output: string, pattern: RegExp, what: string, path: string): number {
  const match = pattern.exec(output);
  const value = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!Number.isFinite(value)) throw new Error(`no ${what} in ffmpeg output for ${path}`);
  return value;
}

function parseDurationS(output: string, path: string): number {
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(output);
  if (match === null) throw new Error(`no duration in ffmpeg output for ${path}`);
  const [, hours, minutes, seconds] = match;
  return Number(hours) * SECONDS_PER_HOUR + Number(minutes) * SECONDS_PER_MINUTE + Number(seconds);
}

async function channelCountOf(ffprobe: string, file: string): Promise<number> {
  const { stdout } = await execFileAsync(ffprobe, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=channels',
    '-of',
    'csv=p=0',
    file,
  ]);
  const channels = Number(stdout.trim());
  if (channels !== MONO_CHANNELS && channels !== STEREO_CHANNELS) {
    throw new Error(`${file} has ${stdout.trim()} channels; only mono and stereo are measured`);
  }
  return channels;
}

async function measure(tools: Tools, path: string): Promise<Measurement> {
  const file = join(REPO_ROOT, path);
  const channels = await channelCountOf(tools.ffprobe, file);
  const filter =
    channels === MONO_CHANNELS ? `${BROWSER_MONO_UPMIX},${EBUR128_FILTER}` : EBUR128_FILTER;
  const { stderr } = await execFileAsync(
    tools.ffmpeg,
    ['-nostats', '-hide_banner', '-i', file, '-filter_complex', filter, '-f', 'null', '-'],
    { maxBuffer: FFMPEG_OUTPUT_BUFFER_BYTES },
  );
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const lufs = matchNumber(summary, /I:\s*(-?[\d.]+|-inf)\s*LUFS/, 'integrated loudness', path);
  const durationS = parseDurationS(stderr, path);
  const tooShortToGate = durationS < SHORT_ONE_SHOT_MAX_S || lufs <= UNGATED_LUFS;
  return {
    lufs,
    truePeakDbtp: matchNumber(summary, /Peak:\s*(-?[\d.]+|-inf)\s*dBFS/, 'true peak', path),
    basis: tooShortToGate ? 'peak' : 'integrated',
  };
}

/** Measurements already in the table whose file is byte-for-byte unchanged, by path. */
function unchangedMeasurements(paths: readonly string[]): Map<string, Measurement> {
  const table: Partial<Record<SoundId, LoudnessEntry>> = LOUDNESS;
  const recorded = new Map<string, LoudnessEntry>();
  for (const id of ALL_SOUND_IDS) {
    const entry = table[id];
    if (entry !== undefined) recorded.set(SOUND_MANIFEST[id], entry);
  }
  const reusable = new Map<string, Measurement>();
  for (const path of paths) {
    const entry = recorded.get(path);
    if (entry === undefined || entry.hash !== hashAudioFile(join(REPO_ROOT, path))) continue;
    reusable.set(path, { lufs: entry.lufs, truePeakDbtp: entry.truePeakDbtp, basis: entry.basis });
  }
  return reusable;
}

async function measureAll(
  tools: Tools,
  paths: readonly string[],
): Promise<Map<string, Measurement>> {
  const results = new Map<string, Measurement>();
  const queue = [...paths];
  const workerCount = Math.min(availableParallelism(), queue.length);
  const worker = async (): Promise<void> => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      results.set(path, await measure(tools, path));
    }
  };
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

function roundDb(value: number): number {
  const rounded = Math.round(value * DECIMALS_PER_DB) / DECIMALS_PER_DB;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function entryFor(id: SoundId, path: string, measurement: Measurement): MeasuredEntry {
  const bus = busOf(id, path);
  const { basis } = measurement;
  const desiredTrim =
    basis === 'peak'
      ? SHORT_ONE_SHOT_PEAK_TARGET_DBTP - measurement.truePeakDbtp
      : targetLufsOf(id, path, bus) - measurement.lufs;

  const reexportReasons: string[] = [];
  const cappedTrim = Math.max(-MAX_TRIM_DB, Math.min(MAX_TRIM_DB, desiredTrim));
  if (cappedTrim !== desiredTrim) {
    reexportReasons.push(`capped ${roundDb(desiredTrim)} → ${cappedTrim} dB`);
  }
  const peakHeadroomTrim = TRIMMED_TRUE_PEAK_CEILING_DBTP - measurement.truePeakDbtp;
  const peakClamped = cappedTrim > peakHeadroomTrim;
  const trim = peakClamped ? peakHeadroomTrim : cappedTrim;
  if (cappedTrim - trim >= REEXPORT_CLAMP_SHORTFALL_DB) {
    const truePeak = roundDb(measurement.truePeakDbtp);
    reexportReasons.push(
      `peak-clamped ${roundDb(cappedTrim)} → ${roundDb(trim)} dB (true peak ${truePeak} dBTP)`,
    );
  }

  return {
    id,
    path,
    bus,
    basis,
    lufs: roundDb(measurement.lufs),
    truePeakDbtp: roundDb(measurement.truePeakDbtp),
    hash: hashAudioFile(join(REPO_ROOT, path)),
    trimDb: roundDb(trim),
    reexportReasons,
    peakClamped,
  };
}

function renderTable(entries: readonly MeasuredEntry[]): string {
  const rows = entries.map(
    (entry) =>
      `${entry.id}: { bus: '${entry.bus}', basis: '${entry.basis}', lufs: ${entry.lufs}, ` +
      `truePeakDbtp: ${entry.truePeakDbtp}, hash: '${entry.hash}', trimDb: ${entry.trimDb} },`,
  );
  return [
    '// Generated by `npm run measure:audio`; do not edit by hand.',
    "import type { LoudnessEntry } from './loudnessTargets';",
    "import type { SoundId } from './sounds';",
    '',
    'export const LOUDNESS = {',
    ...rows,
    '} as const satisfies Record<SoundId, LoudnessEntry>;',
    '',
  ].join('\n');
}

function printSpread(entries: readonly MeasuredEntry[]): void {
  const buses: readonly LoudnessBus[] = ['music', 'ambience', 'sfx'];
  for (const bus of buses) {
    const gated = entries.filter((entry) => entry.bus === bus && entry.basis === 'integrated');
    const peakBased = entries.filter((entry) => entry.bus === bus && entry.basis === 'peak');
    if (gated.length === 0) continue;
    const loudest = gated.reduce((a, b) => (b.lufs > a.lufs ? b : a));
    const quietest = gated.reduce((a, b) => (b.lufs < a.lufs ? b : a));
    const spread = roundDb(loudest.lufs - quietest.lufs);
    console.log(
      `${bus}: ${gated.length} integrated, ${peakBased.length} peak-based; ` +
        `${quietest.lufs} (${quietest.id}) … ${loudest.lufs} LUFS (${loudest.id}), spread ${spread} LU`,
    );
  }
}

async function main(): Promise<void> {
  const tools: Tools = {
    ffmpeg: findTool('ffmpeg', 'FFMPEG'),
    ffprobe: findTool('ffprobe', 'FFPROBE'),
  };
  const { values: flags } = parseArgs({ options: { all: { type: 'boolean', default: false } } });
  const uniquePaths = [...new Set(ALL_SOUND_IDS.map((id) => SOUND_MANIFEST[id]))].sort();
  const reused = flags.all ? new Map<string, Measurement>() : unchangedMeasurements(uniquePaths);
  const pathsToMeasure = uniquePaths.filter((path) => !reused.has(path));
  const measurements = new Map([...reused, ...(await measureAll(tools, pathsToMeasure))]);
  console.log(
    `measure:audio: measured ${pathsToMeasure.length} file(s), reused ${reused.size} unchanged`,
  );

  const entries = [...ALL_SOUND_IDS].sort().map((id) => {
    const path = SOUND_MANIFEST[id];
    const measurement = measurements.get(path);
    if (measurement === undefined) throw new Error(`${path} was never measured`);
    return entryFor(id, path, measurement);
  });

  const prettierConfig = (await resolveConfig(OUTPUT_PATH)) ?? {};
  const source = await format(renderTable(entries), {
    ...prettierConfig,
    filepath: OUTPUT_PATH,
  });
  writeFileSync(OUTPUT_PATH, source);
  console.log(`measure:audio: wrote ${entries.length} entries to src/audio/loudness.generated.ts`);
  printSpread(entries);

  const minorClampCount = entries.filter(
    (entry) => entry.peakClamped && entry.reexportReasons.length === 0,
  ).length;
  console.log(
    `${minorClampCount} more file(s) were held to ${TRIMMED_TRUE_PEAK_CEILING_DBTP} dBTP ` +
      `by less than ${REEXPORT_CLAMP_SHORTFALL_DB} dB.`,
  );
  const freshlyMeasured: ReadonlySet<string> = new Set(pathsToMeasure);
  const allReexports = entries.filter((entry) => entry.reexportReasons.length > 0);
  const reexports = allReexports.filter((entry) => freshlyMeasured.has(entry.path));
  const unlistedCount = allReexports.length - reexports.length;
  if (unlistedCount > 0) {
    console.log(`${unlistedCount} unchanged file(s) need re-export; \`--all\` lists them.`);
  }
  if (reexports.length === 0) {
    console.log('No newly measured file needs re-export.');
    return;
  }
  console.log(`\n${reexports.length} newly measured file(s) need re-export:`);
  for (const entry of reexports) {
    console.log(`  ${entry.path.slice(AUDIO_PREFIX.length)}: ${entry.reexportReasons.join('; ')}`);
  }
}

await main();
