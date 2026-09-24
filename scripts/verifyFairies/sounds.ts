/**
 * The fairies' sounds are loaded everywhere a fairy can be heard.
 *
 * `AudioManager.play` returns silently on a buffer that never loaded, so a cue
 * missing from a floor's preload group is not an error anywhere — it is a
 * beat that simply never happens. This reads the groups statically:
 *
 * - Every sound the fairy cue drains can play, and every `fairy_` sound in the
 *   manifest, is in every group a fairy spawns under.
 * - The raised skeleton's swing and collapse are in every floor group a necro
 *   fairy raises skeletons on.
 *
 * Each rule is also run against a group with one required id taken out.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { SFX_GROUPS, type SfxGroup } from '../../src/audio/sfxGroups';
import { ALL_SOUND_IDS, type SoundId } from '../../src/audio/sounds';
import type { FairyGateReport } from './report';

/** The module that maps every fairy cast, system cue and fireball cue to its sound. */
const FAIRY_CUE_MODULE = new URL('../../src/systems/fairyAudioCues.ts', import.meta.url);

/**
 * Where a fairy can be heard: rooms on floors 1 and 2, the floor-3 wilds, and
 * beside the hard-mode bosses the circus and murder-mystery systems stage.
 */
const FAIRY_GROUPS: readonly SfxGroup[] = [
  'level1',
  'level2',
  'level3',
  'circusQuest',
  'murderMysteryQuest',
];

/** The floors a necro fairy spawns on, and so raises skeletons on. */
const NECRO_FLOOR_GROUPS: readonly SfxGroup[] = ['level1', 'level2', 'level3'];

/** The skeleton's collapse, the negative's missing id. */
const SKELETON_COLLAPSE_SOUND: SoundId = 'bones_rattling';

/** The rank-and-file skeleton's swing and collapse, which a raised skeleton plays. */
const RAISED_SKELETON_SOUNDS: readonly SoundId[] = [
  SKELETON_COLLAPSE_SOUND,
  'slash_strike_1',
  'slash_strike_2',
  'slash_strike_3',
];

const FAIRY_SOUND_PREFIX = 'fairy_';

function isSoundId(candidate: string): candidate is SoundId {
  return ALL_SOUND_IDS.some((id) => id === candidate);
}

/**
 * Every sound id quoted in the fairy cue module. Read from the source rather
 * than imported because the cue maps are private to that module, and the
 * point is to find a sound no one thought to list.
 */
function cueModuleSoundIds(): SoundId[] {
  const source = readFileSync(fileURLToPath(FAIRY_CUE_MODULE), 'utf8');
  const found = new Set<SoundId>();
  for (const match of source.matchAll(/'([a-z0-9_]+)'/g)) {
    const quoted = match[1];
    if (isSoundId(quoted)) found.add(quoted);
  }
  return [...found];
}

/** The required ids missing from each group, as `group: id, id`. */
function missingFrom(
  groups: readonly SfxGroup[],
  required: readonly SoundId[],
  membership: (group: SfxGroup) => readonly SoundId[],
): string[] {
  const gaps: string[] = [];
  for (const group of groups) {
    const members = membership(group);
    const missing = required.filter((id) => !members.includes(id));
    if (missing.length > 0) gaps.push(`${group}: ${missing.join(', ')}`);
  }
  return gaps;
}

/** The shipped groups with `id` taken out of `group`. */
function withoutId(group: SfxGroup, id: SoundId): (candidate: SfxGroup) => readonly SoundId[] {
  return (candidate) =>
    candidate === group
      ? SFX_GROUPS[candidate].filter((member) => member !== id)
      : SFX_GROUPS[candidate];
}

export function verifyFairySounds(report: FairyGateReport): void {
  report.section('Fairy sounds: loaded wherever a fairy can be heard');
  const shipped = (group: SfxGroup): readonly SoundId[] => SFX_GROUPS[group];

  const cueSounds = cueModuleSoundIds();
  const manifestFairySounds = ALL_SOUND_IDS.filter((id) => id.startsWith(FAIRY_SOUND_PREFIX));
  const fairySounds = [...new Set([...cueSounds, ...manifestFairySounds])].sort();
  const fairyGaps = missingFrom(FAIRY_GROUPS, fairySounds, shipped);
  report.check(
    cueSounds.length > 0 && fairyGaps.length === 0,
    'every fairy sound is in every group a fairy spawns under',
    fairyGaps.join('; ') ||
      `${fairySounds.length} sounds (${cueSounds.length} from the cue drains) × ` +
        `${FAIRY_GROUPS.length} groups`,
  );
  const firstFairySound = fairySounds.length > 0 ? fairySounds[0] : undefined;
  const droppedFairy =
    firstFairySound === undefined
      ? []
      : missingFrom(FAIRY_GROUPS, fairySounds, withoutId('circusQuest', firstFairySound));
  report.checkCatches(
    droppedFairy.length === 0,
    'a circus group missing one fairy sound is caught',
    droppedFairy.join('; '),
  );

  const skeletonGaps = missingFrom(NECRO_FLOOR_GROUPS, RAISED_SKELETON_SOUNDS, shipped);
  report.check(
    skeletonGaps.length === 0,
    "a raised skeleton's swing and collapse are loaded on every floor a necro fairy raises them",
    skeletonGaps.join('; ') ||
      `${RAISED_SKELETON_SOUNDS.length} sounds × ${NECRO_FLOOR_GROUPS.length} floors`,
  );
  const droppedSkeleton = missingFrom(
    NECRO_FLOOR_GROUPS,
    RAISED_SKELETON_SOUNDS,
    withoutId('level2', SKELETON_COLLAPSE_SOUND),
  );
  report.checkCatches(
    droppedSkeleton.length === 0,
    "a floor-2 group missing the skeleton's collapse is caught",
    droppedSkeleton.join('; '),
  );
}
