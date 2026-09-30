/**
 * "The Borrowed Blueprints"' sounds, by what they mean rather than by file.
 *
 * Every play site in this quest raises a cue from this table, never a raw id,
 * so each recording that lands is its registration in `src/audio/sounds.ts`
 * plus one line here. Most of the quest's own recordings have not landed yet,
 * so a cue either borrows the nearest sound the game already has or is an
 * empty list — silent — where nothing stands in; each entry's JSDoc names the
 * file it is waiting for.
 *
 * A cue with several takes is meant to be rotated through, one take per play.
 *
 * Every id named here must be preloaded wherever the cue can play: the
 * `briarHollow` or `universal` group in `src/audio/sfxGroups.ts`.
 * `AudioManager.play` returns silently on a buffer that was never preloaded,
 * and `verify:borrowed-blueprints` fails on any id missing from both.
 *
 * Unlike every other quest's, this quest's `quest_complete` is a cue here
 * rather than a `questCompleted` listener in `AudioManager.wireEvents`: it
 * plays when the quest-complete screen goes up, which can be a while after
 * the phase moves (the last upgrade's callout plays out first, and the screen
 * waits out any conversation), and the fanfare belongs with the screen.
 *
 * Plumbline Farm's room ambience (`ambient_quiet_farmhouse`, not yet
 * recorded) is the room's, not the quest's, and belongs with the interior
 * ambience once it lands; until then the room keeps what it has.
 */

import type { SoundId } from '../../../audio/sounds';

export const BLUEPRINTS_CUES = {
  // ── The fence ──
  /** The hammering loop while a fence section is being rebuilt. Final: `repairing_loop`. */
  fenceWorkLoop: ['repairing_loop'],
  /** The old wire and rotten rails coming away as a section's rebuild starts. Waits on `rickety_fence_pull`. */
  fencePull: [],
  /** A section's new post and rails driven home. Waits on `fence_post_set`; `hammer_strike` stands in. */
  fencePostSet: ['hammer_strike'],

  // ── The scythe and the grain ──
  /** Taking Merrit's scythe off the barn wall. Waits on `scythe_unhook`. */
  scytheUnhook: ['picking_up_ground_object'],
  /** Every scythe swing through the grain. Waits on `scythe_swing_1..3`. */
  scytheSwing: ['axe_striking_wood'],
  /** A second press in the swing's outer window. Waits on `scythe_timing_good`; the lucky-refine sparkle stands in. */
  scytheTimingGood: ['lucky_refined'],
  /** A second press in the swing's inner window. Waits on `scythe_timing_perfect`; the award fanfare stands in. */
  scytheTimingPerfect: ['achievement_awarded'],
  /**
   * A second press outside both windows, or a swing that ran out with none.
   * Waits on `scythe_timing_miss`; the refusal buzz stands in.
   */
  scytheMiss: ['error'],
  /** The grain landing in the counter at the end of a swing. Waits on `grain_sheaf_gather`. */
  grainGather: [],

  // ── Midge ──
  /** Merrit's whistle, just before she shouts for Midge. Waits on `merrit_whistle`. */
  merritWhistle: [],
  /** Midge's cowbell, clanking in step while she is led. Waits on `cowbell_clank_1..3`. */
  cowbellClank: [],
  /** Midge standing and calling after a party that got too far ahead. Waits on `cow_lonely_moo_1..2`. */
  midgeLonelyMoo: ['cow_angry_moo_1', 'cow_angry_moo_2'],
  /** Midge taking a hit on the road. Waits on `cow_hurt_moo_1..2`. */
  midgeHurtMoo: ['cow_angry_moo_1', 'cow_angry_moo_2'],
  /** Midge settling into Wendell's pasture. Final: `cow_happy_moo`. */
  midgeSettled: ['cow_happy_moo'],
  /** Midge's only ambient moo once she lives at Wendell's. Final: `cow_ambient_moo_1`. */
  midgeAmbientMoo: ['cow_ambient_moo_1'],
  /** Each ambush wave arriving on the road to town. Waits on `escort_ambush_sting`. */
  escortAmbushSting: ['necro_war_horn'],

  // ── The blueprints and the stations ──
  /** Wendell handing over the blueprints, and any time they come back to the quest slot. Waits on `blueprint_unroll`. */
  blueprintHandover: ['picking_up_ground_object'],
  /** The hammering loop while a station is being upgraded. Final: `repairing_loop`. */
  stationUpgradeLoop: ['repairing_loop'],
  /** A station's upgrade finished. Final: `construction_complete`. */
  stationUpgraded: ['construction_complete'],
  /** Layered on `stationUpgraded` as the upgraded machine springs to life. Waits on `station_upgrade_flourish`. */
  stationUpgradeFlourish: [],
  /** The upgraded saw bench while it processes. Waits on `sawmill_upgraded_loop`. */
  upgradedSawLoop: ['loopable_sawing'],
  /** The upgraded rope walk while it processes. Waits on `rope_walk_upgraded_loop`. */
  upgradedRopeWalkLoop: ['rope_tightening'],

  // ── The finish ──
  /** The quest-complete screen going up. Final: `quest_complete`. */
  questComplete: ['quest_complete'],
} as const satisfies Record<string, readonly SoundId[]>;

/** Which cue a play site raises. */
export type BlueprintsCue = keyof typeof BLUEPRINTS_CUES;

/** The music that plays while any escort ambusher is alive. */
export const BLUEPRINTS_ESCORT_MUSIC: SoundId = 'defense_quest_music';

/**
 * Plays `cue`'s next take through `audio`, rotating through its takes.
 * Silent for an empty cue. `played` keeps the rotation per caller; pass the
 * same map every time.
 */
export function playBlueprintsCue(
  audio: { play(id: SoundId): void } | null,
  cue: BlueprintsCue,
  played: Map<BlueprintsCue, number>,
): void {
  const takes: readonly SoundId[] = BLUEPRINTS_CUES[cue];
  if (audio === null || takes.length === 0) return;
  const taken = played.get(cue) ?? 0;
  played.set(cue, taken + 1);
  audio.play(takes[taken % takes.length]);
}

/**
 * The sound to play for `cue`: its first take, or `standIn` while the cue is
 * still silent, so a station that was upgraded never falls quieter than the
 * plain one it replaced. For one-per-press and looping sounds, which have no
 * use for the rotation {@link playBlueprintsCue} keeps.
 */
export function cueSoundOr(cue: BlueprintsCue, standIn: SoundId): SoundId {
  const takes: readonly SoundId[] = BLUEPRINTS_CUES[cue];
  return takes[0] ?? standIn;
}
