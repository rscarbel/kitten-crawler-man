import type { AudioManager } from '../audio/AudioManager';
import type { SoundId } from '../audio/sounds';
import type { Mob } from '../creatures/Mob';
import type { Player } from '../Player';
import { FROZEN_STATUS } from '../core/StatusEffect';
import { Fairy, type ActiveFairyCast } from '../creatures/fairies/Fairy';
import type { FairyCastRow } from '../sprites/art/fairyTiming';
import type { FairySystemCue } from './FairySystem';
import type { FairyFireballCue } from './FairyFireballSystem';

/** The sound each cast makes on the frame it lets go. */
const CAST_RELEASE_SOUNDS: Record<FairyCastRow, SoundId> = {
  cast_ward: 'fairy_shield_cast',
  cast_heal: 'fairy_heal_bloom',
  cast_beam: 'fairy_ice_cast',
  cast_lob: 'fairy_fireball_whoosh',
  cast_raise: 'fairy_raise_call',
  cast_push: 'fairy_telekinetic_thrum',
};

/**
 * Casts that are only heard while their fairy is on screen. A heal off screen
 * changes nothing the player can act on, and a bloom heard from nowhere reads
 * as a bug; the other casts either only happen on screen or are aimed at the
 * party, where the sound is the warning.
 */
const ON_SCREEN_ONLY_CAST_ROWS: ReadonlySet<FairyCastRow> = new Set<FairyCastRow>(['cast_heal']);

const SYSTEM_CUE_SOUNDS: Record<FairySystemCue, SoundId> = {
  shieldDeath: 'fairy_shield_shatter',
  healWave: 'fairy_heal_wave',
  chillBlast: 'fairy_ice_death',
  necroDeath: 'fairy_necro_wail',
  resurrection: 'fairy_resurrection_moan',
  iceBoltShatter: 'fairy_ice_hits_ground',
  iceBoltHit: 'fairy_ice_chill',
};

/** The one call the cast and system cue drains make, so a gate can hand in a recorder. */
export type FairyCuePlayer = Pick<AudioManager, 'play'>;

const DEATH_FLAME_SOUND: SoundId = 'fairy_death_flame';
const FROZEN_SOLID_SOUND: SoundId = 'fairy_ice_freeze';

/** Every fireball cue but the one that only ends a sound. */
const FIREBALL_CUE_SOUNDS: Record<Exclude<FairyFireballCue, 'deathFlamesOut'>, SoundId> = {
  fireballLand: 'fairy_charge_fizz',
  chargeExplode: 'fairy_explosion',
  deathFlame: DEATH_FLAME_SOUND,
  deathExplosion: 'fairy_death_explosion',
};

/**
 * Casts already voiced. A cast holds its `release` phase for a single AI tick,
 * but a fairy outside the AI radius stops ticking, and a drain that keyed on
 * the phase alone would replay a stalled release every frame — so each cast
 * object is voiced once, the first time it is seen.
 */
const voicedCasts = new WeakSet<ActiveFairyCast>();

/**
 * A fairy's cast letting go: the ward, the heal, the ice bolt, the lob, the
 * raise or the shove. Read off the cast state rather than a pending flag, so no
 * kind has to raise one.
 */
export function playFairyCastCues(mob: Mob, audio: FairyCuePlayer | null): void {
  if (!(mob instanceof Fairy)) return;
  const cast = mob.activeCast;
  if (cast === null) return;
  if (voicedCasts.has(cast)) return;
  voicedCasts.add(cast);
  const row = cast.cast.row;
  if (ON_SCREEN_ONLY_CAST_ROWS.has(row) && !mob.isOnScreen) return;
  audio?.play(CAST_RELEASE_SOUNDS[row]);
}

/**
 * The cues `FairySystem` raises: each kind's parting effect and a necro's
 * resurrections. Drained by the scene because they outlive the fairy that
 * caused them.
 */
export function playFairySystemCues(
  cues: readonly FairySystemCue[],
  audio: FairyCuePlayer | null,
): void {
  for (const cue of cues) audio?.play(SYSTEM_CUE_SOUNDS[cue]);
}

/**
 * The cues `FairyFireballSystem` raises; a charge and a death flame outlive
 * their fairy too.
 *
 * All the death flames on the floor share one burning sample. `AudioManager`
 * can stop only the newest copy of a sound, so a second copy left running
 * under the first could never be cut off. Each new flame restarts the sample
 * instead — it outlasts a flame's whole burn, so a restart at the newest
 * ignition covers every older flame too — and it ends only when the last
 * flame is out, never at one flame's explosion while another still burns.
 */
export function playFairyFireballCues(
  cues: readonly FairyFireballCue[],
  audio: AudioManager | null,
): void {
  for (const cue of cues) {
    if (cue === 'deathFlamesOut') {
      audio?.stopSound(DEATH_FLAME_SOUND);
      continue;
    }
    if (cue === 'deathFlame') audio?.stopSound(DEATH_FLAME_SOUND);
    audio?.play(FIREBALL_CUE_SOUNDS[cue]);
  }
}

/** Whether each crawler was encased last frame, so a freeze and a thaw each sound once. */
const wasFrozen = new WeakMap<Player, boolean>();

/**
 * A crawler freezing solid, and the ice breaking when it thaws. Read off the
 * frozen status each frame rather than hooked into the ice hit, so a cure, a
 * death or a save restore that lifts the freeze ends the ice too.
 *
 * The encasing sample is shared: it starts when the first crawler freezes and
 * is cut off when the last one is free, because `AudioManager` can stop only
 * the newest copy of a sound and a copy per crawler would leave one ringing
 * past its thaw. Each living crawler's thaw still shatters its own ice.
 */
export function playFrostCues(crawlers: readonly Player[], audio: AudioManager | null): void {
  let anyFrozenBefore = false;
  let anyFrozenNow = false;
  for (const crawler of crawlers) {
    const frozen = crawler.isAlive && crawler.hasStatus(FROZEN_STATUS);
    const frozenBefore = wasFrozen.get(crawler) ?? false;
    wasFrozen.set(crawler, frozen);
    anyFrozenBefore ||= frozenBefore;
    anyFrozenNow ||= frozen;
    const thawed = frozenBefore && !frozen;
    if (thawed && crawler.isAlive) audio?.play('fairy_ice_cracking');
  }
  if (anyFrozenNow && !anyFrozenBefore) audio?.play(FROZEN_SOLID_SOUND);
  if (anyFrozenBefore && !anyFrozenNow) audio?.stopSound(FROZEN_SOLID_SOUND);
}
