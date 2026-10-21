/**
 * The bomber goblins' sounds and the explosives they share with the party, by
 * what they mean rather than by file.
 *
 * Every play site raises a cue from {@link BOMBER_GOBLIN_CUES}, never a raw
 * id, and each play picks one of the cue's takes at random. The goblins spawn
 * on every floor and in Briar Hollow's siege waves, so each id here is
 * preloaded by `level1`, `level2`, `level3` and `briarHollow` in
 * `src/audio/sfxGroups.ts`; the cues the party's own explosives raise are
 * `universal` as well, beside `dynamite_explosion`.
 */

import type { AudioScope } from '../audio/AudioScope';
import type { SoundId } from '../audio/sounds';
import { TILE_SIZE } from '../core/constants';
import type { BomberGoblinSoundCue } from '../creatures/GoblinBomber';
import type { ExplosionVariant } from '../sprites/dynamiteExplosion';

export const BOMBER_GOBLIN_CUES = {
  /** Either goblin's light row, on the frame the fuse catches. */
  fuseLit: ['fuse_light_1', 'fuse_light_2', 'fuse_light_3', 'fuse_light_4'],
  /** A goblin stick on the floor, its fuse burning down; a loop, one take per stick. */
  fuseBurning: ['fuse_sizzle_loop_1', 'fuse_sizzle_loop_2', 'fuse_sizzle_loop_3'],
  /** The explosive leaving a goblin's hand. */
  toss: ['bomb_toss_whoosh_1', 'bomb_toss_whoosh_2', 'bomb_toss_whoosh_3', 'bomb_toss_whoosh_4'],
  /** The goblin's effort on the same frame as {@link BOMBER_GOBLIN_CUES.toss}. */
  throwGrunt: [
    'goblin_bomber_throw_grunt_1',
    'goblin_bomber_throw_grunt_2',
    'goblin_bomber_throw_grunt_3',
  ],
  /** A stick of dynamite, a goblin's or one the party threw, hitting the floor. */
  stickLanded: ['dynamite_stick_land_1', 'dynamite_stick_land_2', 'dynamite_stick_land_3'],
  /** A stick of dynamite going off. */
  dynamiteBlast: ['dynamite_explosion'],
  /** A black powder bomb going off, a goblin's or the party's own. */
  blackPowderBlast: [
    'black_powder_explosion_1',
    'black_powder_explosion_2',
    'black_powder_explosion_3',
    'black_powder_explosion_4',
  ],
  /** The Dynamite Goblin giggling as it lights up; one at a time across a pack. */
  cackle: [
    'goblin_bomber_cackle_1',
    'goblin_bomber_cackle_2',
    'goblin_bomber_cackle_3',
    'goblin_bomber_cackle_4',
    'goblin_bomber_cackle_5',
  ],
  /**
   * The warning shout either goblin may give: the Black Powder Goblin as its
   * aim locks, the Dynamite Goblin as it lets go.
   */
  shout: [
    'goblin_fire_in_the_hole_1',
    'goblin_fire_in_the_hole_2',
    'goblin_fire_in_the_hole_3',
    'goblin_fire_in_the_hole_4',
    'goblin_bombs_away_1',
    'goblin_bombs_away_2',
    'goblin_bombs_away_3',
    'goblin_bombs_away_4',
  ],
} as const satisfies Record<string, readonly SoundId[]>;

export type BomberGoblinCue = keyof typeof BOMBER_GOBLIN_CUES;

/** What each sound a bomber asks for plays: a throw is the toss and the grunt together. */
export const BOMBER_SOUND_CUE_PLAYS = {
  fuseLit: ['fuseLit'],
  cackle: ['cackle'],
  throw: ['toss', 'throwGrunt'],
  shout: ['shout'],
} as const satisfies Record<BomberGoblinSoundCue, readonly BomberGoblinCue[]>;

/** The cue a blast of each picture sounds as. */
export function blastCue(kind: ExplosionVariant): BomberGoblinCue {
  return kind === 'black_powder' ? 'blackPowderBlast' : 'dynamiteBlast';
}

/**
 * The shortest gap between two Dynamite Goblin cackles, whoever gives them.
 * Each take's own repeat limit cannot stop a pack lighting together from
 * giggling over each other in five different takes.
 */
export const PACK_CACKLE_GAP_S = 2.5;

/** Lets a cue through at most once per gap on the audio clock, across every caller. */
export class CueGap {
  private lastS = Number.NEGATIVE_INFINITY;

  constructor(private readonly gapS: number) {}

  /** Whether the cue may play at `nowS`; a yes stamps the gap from now. */
  allows(nowS: number): boolean {
    if (nowS - this.lastS < this.gapS) return false;
    this.lastS = nowS;
    return true;
  }
}

/** A stick on the floor as the fuse loop hears it. */
export interface SizzlingStick {
  readonly x: number;
  readonly y: number;
  /** Stable for the stick's life, so it keeps one take until it blows. */
  readonly seed: number;
}

/** How far from a burning fuse it can still be heard, in tiles. */
export const FUSE_SIZZLE_RADIUS_TILES = 8;
/** The loop's level with the listener on top of the stick. */
export const FUSE_SIZZLE_MAX_VOLUME = 0.45;
/** Short, so the hiss is gone under the blast rather than tailing out of it. */
const FUSE_SIZZLE_STOP_FADE_MS = 40;

/** The fuse loop take a stick keeps for its whole life. */
export function fuseSizzleTake(seed: number): SoundId {
  const takes = BOMBER_GOBLIN_CUES.fuseBurning;
  const index = Math.abs(Math.floor(seed)) % takes.length;
  return takes[index] ?? takes[0];
}

/**
 * The fuse loops of the goblin sticks on the floor, placed in the world the
 * way a torch's burn is: each take sounds at the level of its nearest stick,
 * fading with distance, and stops the frame its last stick is gone.
 */
export class FuseSizzleLoops {
  private readonly running = new Set<SoundId>();
  private readonly levels = new Map<SoundId, number>();

  /** Sets every loop for `sticks` heard from `listener`, a world point. */
  update(
    scope: AudioScope | null,
    sticks: readonly SizzlingStick[],
    listener: { readonly x: number; readonly y: number },
  ): void {
    if (scope === null) return;
    const levels = this.levels;
    levels.clear();
    const reachPx = FUSE_SIZZLE_RADIUS_TILES * TILE_SIZE;
    for (const stick of sticks) {
      const take = fuseSizzleTake(stick.seed);
      const distancePx = Math.hypot(stick.x - listener.x, stick.y - listener.y);
      const level = FUSE_SIZZLE_MAX_VOLUME * Math.max(0, 1 - distancePx / reachPx);
      levels.set(take, Math.max(levels.get(take) ?? 0, level));
    }
    for (const take of this.running) {
      if (levels.has(take)) continue;
      scope.stopAmbientLoop(take, FUSE_SIZZLE_STOP_FADE_MS);
      this.running.delete(take);
    }
    for (const [take, level] of levels) {
      // Asked of the scope each frame: a start declined while the buffer is
      // still decoding or the context is locked must be retried.
      if (scope.isAmbientLoopRunning(take)) scope.setAmbientLoopVolume(take, level);
      else scope.startAmbientLoop(take, level);
      this.running.add(take);
    }
  }

  /** Stops every fuse loop at once, for a scene leaving the floor. */
  stopAll(scope: AudioScope | null): void {
    for (const take of this.running) scope?.stopAmbientLoop(take, FUSE_SIZZLE_STOP_FADE_MS);
    this.running.clear();
  }
}
