/**
 * Static registry hygiene for `src/audio/`: the folders, the id tuples, the
 * manifest, the music catalogue, the SFX preload groups and the loudness table
 * have to agree, and
 * a disagreement otherwise shows up only as a cue that silently never plays.
 *
 * `npm run lint` runs it; it exits 1 on any violation.
 *
 * Usage:
 *   npm run check:audio
 *
 * Each rule is one entry in `RULES`: a name and a function returning the
 * problems it found. A new rule is a new entry.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_SOUND_IDS,
  JINGLE_IDS,
  MUSIC_TRACK_IDS,
  SOUND_MANIFEST,
  STREAMING_SOUND_IDS,
  UNWIRED_SOUND_IDS,
  type SoundId,
} from '../src/audio/sounds';
import { SFX_GROUPS } from '../src/audio/sfxGroups';
import { MUSIC_CATALOG } from '../src/audio/music/catalog';
import { MUSIC_STEM_SETS } from '../src/audio/music/stemSets';
import { LOUDNESS } from '../src/audio/loudness.generated';
import type { LoudnessEntry } from '../src/audio/loudnessTargets';
import { hashAudioFile } from './audioHash';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO_ROOT = join(REPO_ROOT, 'src/audio');
const MUSIC_FOLDER = 'music';
const JINGLES_FOLDER = 'jingles';
const AUDIO_FILE = /\.(mp3|ogg|wav|m4a|aac|flac)$/i;
/** The formats a recording may ship in; every browser the game targets decodes both. */
const SHIPPED_AUDIO_EXTENSIONS = ['mp3', 'ogg'] as const;
const SHIPPED_AUDIO_FILE = new RegExp(`\\.(${SHIPPED_AUDIO_EXTENSIONS.join('|')})$`);

interface AudioRule {
  readonly name: string;
  readonly check: () => readonly string[];
}

const soundIds: ReadonlySet<string> = new Set(ALL_SOUND_IDS);
const musicIds: ReadonlySet<string> = new Set(MUSIC_TRACK_IDS);
const jingleIds: ReadonlySet<string> = new Set(JINGLE_IDS);
const unwiredIds: ReadonlySet<string> = new Set(UNWIRED_SOUND_IDS);

function isSoundId(id: string): id is SoundId {
  return soundIds.has(id);
}

function manifestPathFor(folder: string, fileName: string): string {
  return `./src/audio/${folder}/${fileName}`;
}

function audioFilesIn(folder: string): string[] {
  const dir = join(AUDIO_ROOT, folder);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => AUDIO_FILE.test(name));
}

function idOfFile(name: string): string {
  return name.replace(AUDIO_FILE, '');
}

/** Every id in some SFX group, with the groups it is in. */
function groupsById(): Map<SoundId, string[]> {
  const byId = new Map<SoundId, string[]>();
  for (const [group, ids] of Object.entries(SFX_GROUPS)) {
    for (const id of ids) byId.set(id, [...(byId.get(id) ?? []), group]);
  }
  return byId;
}

/** A file in a flat id-named folder must be one of `ids`, registered at its own path. */
function folderFilesAreRegistered(
  folder: string,
  ids: ReadonlySet<string>,
  kind: string,
): readonly string[] {
  const problems: string[] = [];
  for (const name of audioFilesIn(folder)) {
    const id = idOfFile(name);
    if (!ids.has(id)) {
      problems.push(`src/audio/${folder}/${name} is not a ${kind}`);
      continue;
    }
    if (!isSoundId(id)) continue;
    if (!SHIPPED_AUDIO_FILE.test(name)) {
      problems.push(
        `src/audio/${folder}/${name} must be one of ${SHIPPED_AUDIO_EXTENSIONS.join(', ')}`,
      );
      continue;
    }
    const expected = manifestPathFor(folder, name);
    if (SOUND_MANIFEST[id] !== expected) {
      problems.push(`SOUND_MANIFEST.${id} is "${SOUND_MANIFEST[id]}", expected "${expected}"`);
    }
  }
  return problems;
}

/** Every one of `ids` must have its file in `folder`, named by its id. */
function idsHaveFiles(folder: string, ids: readonly SoundId[]): readonly string[] {
  const problems: string[] = [];
  for (const id of ids) {
    const candidates = SHIPPED_AUDIO_EXTENSIONS.map((extension) => `${id}.${extension}`);
    const found = candidates.some((name) => existsSync(join(AUDIO_ROOT, folder, name)));
    if (!found)
      problems.push(`${id} has no file at src/audio/${folder}/${candidates.join(' or ')}`);
  }
  return problems;
}

const loudnessById: Partial<Record<string, LoudnessEntry>> = LOUDNESS;
const REMEASURE_HINT = 'run `npm run measure:audio`';

/** Hashes each distinct file once; several ids can share a recording. */
function loudnessProblems(): readonly string[] {
  const problems: string[] = [];
  const hashByPath = new Map<string, string>();
  for (const id of ALL_SOUND_IDS) {
    const entry = loudnessById[id];
    if (entry === undefined) {
      problems.push(`${id} has no loudness entry; ${REMEASURE_HINT}`);
      continue;
    }
    const path = join(REPO_ROOT, SOUND_MANIFEST[id]);
    if (!existsSync(path)) continue;
    const hash = hashByPath.get(path) ?? hashAudioFile(path);
    hashByPath.set(path, hash);
    if (hash !== entry.hash) {
      problems.push(`${id}'s file changed since it was measured; ${REMEASURE_HINT}`);
    }
  }
  for (const id of Object.keys(loudnessById)) {
    if (!soundIds.has(id))
      problems.push(`loudness entry ${id} is not a SoundId; ${REMEASURE_HINT}`);
  }
  return problems;
}

const RULES: readonly AudioRule[] = [
  {
    name: 'music folder holds only catalogued songs at their manifest path',
    check: () => folderFilesAreRegistered(MUSIC_FOLDER, musicIds, 'MusicTrackId'),
  },
  {
    name: 'every MusicTrackId has its file in music/',
    check: () => idsHaveFiles(MUSIC_FOLDER, MUSIC_TRACK_IDS),
  },
  {
    name: 'jingles folder holds only jingles at their manifest path',
    check: () => folderFilesAreRegistered(JINGLES_FOLDER, jingleIds, 'JingleId'),
  },
  {
    name: 'every JingleId has its file in jingles/',
    check: () => idsHaveFiles(JINGLES_FOLDER, JINGLE_IDS),
  },
  {
    name: 'every manifest path exists on disk',
    check: () =>
      ALL_SOUND_IDS.filter((id) => !existsSync(join(REPO_ROOT, SOUND_MANIFEST[id]))).map(
        (id) => `SOUND_MANIFEST.${id} points at missing "${SOUND_MANIFEST[id]}"`,
      ),
  },
  {
    name: 'the catalogue holds exactly the music tracks',
    check: () => {
      const problems: string[] = [];
      const catalogued = new Set(Object.keys(MUSIC_CATALOG));
      for (const id of catalogued) {
        if (jingleIds.has(id)) problems.push(`jingle ${id} is in MUSIC_CATALOG`);
        else if (!musicIds.has(id))
          problems.push(`${id} is in MUSIC_CATALOG but not a MusicTrackId`);
      }
      for (const id of MUSIC_TRACK_IDS) {
        if (!catalogued.has(id)) problems.push(`${id} has no MUSIC_CATALOG entry`);
      }
      return problems;
    },
  },
  {
    name: 'catalogue titles are filled in and distinct',
    check: () => {
      const problems: string[] = [];
      const idByTitle = new Map<string, string>();
      for (const [id, def] of Object.entries(MUSIC_CATALOG)) {
        if (def.title.trim() === '') problems.push(`${id} has a blank title`);
        if (def.attribution.originalTitle.trim() === '') {
          problems.push(`${id} has a blank originalTitle`);
        }
        const clash = idByTitle.get(def.title);
        if (clash !== undefined) problems.push(`${id} and ${clash} share the title "${def.title}"`);
        idByTitle.set(def.title, id);
      }
      return problems;
    },
  },
  {
    name: 'every decoded sound is preloaded by some SFX group',
    check: () => {
      const grouped = groupsById();
      const problems: string[] = [];
      for (const id of ALL_SOUND_IDS) {
        if (STREAMING_SOUND_IDS.has(id)) continue;
        const inGroup = grouped.has(id);
        if (!inGroup && !unwiredIds.has(id)) {
          problems.push(`${id} is in no SFX group and not in UNWIRED_SOUND_IDS`);
        }
        if (inGroup && unwiredIds.has(id)) {
          problems.push(`${id} is in an SFX group, so it no longer belongs in UNWIRED_SOUND_IDS`);
        }
      }
      return problems;
    },
  },
  {
    name: 'no streamed sound is in an SFX group',
    check: () =>
      [...groupsById()]
        .filter(([id]) => STREAMING_SOUND_IDS.has(id))
        .map(([id, groups]) => `streamed ${id} is in SFX group(s) ${groups.join(', ')}`),
  },
  {
    name: 'no stem of a stem set is streamed',
    check: () =>
      Object.entries(MUSIC_STEM_SETS).flatMap(([set, stems]) =>
        stems
          .filter((id) => STREAMING_SOUND_IDS.has(id))
          .map((id) => `${id}, a stem of ${set}, is streamed; stems loop decoded`),
      ),
  },
  {
    name: 'every sound has a loudness measurement matching its file',
    check: loudnessProblems,
  },
  {
    name: 'no audio file sits at the src/audio root',
    check: () =>
      readdirSync(AUDIO_ROOT)
        .filter((name) => AUDIO_FILE.test(name) && statSync(join(AUDIO_ROOT, name)).isFile())
        .map(
          (name) => `${relative(REPO_ROOT, join(AUDIO_ROOT, name))} belongs in a category folder`,
        ),
  },
];

let failures = 0;
for (const rule of RULES) {
  const problems = rule.check();
  if (problems.length === 0) continue;
  failures += problems.length;
  console.error(`✗ ${rule.name}`);
  for (const problem of problems) console.error(`    ${problem}`);
}

if (failures > 0) {
  console.error(`check:audio: ${failures} problem(s)`);
  process.exit(1);
}
console.log(`check:audio: ${RULES.length} rules passed`);
