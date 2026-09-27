import type { MercenaryVoiceId } from '../../core/mercenaryTemplates';
import { HIRELING_POTION_COOLDOWN_FRAMES } from './hirelingSurvival';
import type { BarkLine, NonEmpty } from '../../dialog/line';
import type { MercenaryLines } from '../../dialog/roles';
import {
  BOMO,
  BUCKET_BOY,
  DONG_QUIXOTE,
  GLUTEUS_MAXX,
  SLEDGE,
  SPLASH_ZONE,
  TUMBLEDOWN_BASE,
} from '../../dialog/scripts/mercenaries';

/**
 * The mechanism a hired mercenary's voice runs on: which moments it may speak
 * for, how long it must wait between them, and how a trigger is mapped onto
 * one of its `MercenaryLines` — never a runtime lookup by trigger name, so a
 * bark that isn't read from somewhere in the code is caught at the
 * declaration rather than only ever failing to fire.
 *
 * The words themselves live in `src/dialog/scripts/mercenaries.ts`.
 */

/**
 * The moments a hireling may speak.
 *
 * - `hired`: first appearance outside the club.
 * - `idle`: nothing hostile in range for a good while.
 * - `engage`: picked a fight (for a medic who never picks one, a hostile came close).
 * - `kill`: its own blow finished something.
 * - `low_hp`: crossed below a fraction of its health.
 * - `special`: its kit's signature move went off.
 * - `owner_hurt` / `cat_hurt`: the crawler it follows, or the cat, took a wound.
 * - `downed`: knocked flat, waiting for a crawler to stand over it and revive it.
 * - `revived`: back on its feet after a revive.
 * - `potion`: drank one of its own healing draughts mid-fight.
 * - `death`: last words.
 * - `talk`: the player walked up and pressed interact.
 * - `floor_end`: the floor is won and the contract with it.
 */
export type MercenaryBarkTrigger =
  | 'hired'
  | 'idle'
  | 'engage'
  | 'kill'
  | 'low_hp'
  | 'special'
  | 'owner_hurt'
  | 'cat_hurt'
  | 'downed'
  | 'revived'
  | 'potion'
  | 'death'
  | 'talk'
  | 'floor_end';

/** The two stone noises a golem can make; see `playMobAudioCues` for which cue each is. */
export type MercenaryGrunt = 'grunt' | 'frustrated';

export interface MercenaryVoice {
  /** Spoken lines. A trigger missing here is one the character is silent on. */
  readonly lines: MercenaryLines;
  /**
   * Stage directions, drawn in italics, for a character who does not talk. Read
   * only where `lines` has nothing for the trigger.
   */
  readonly actions?: MercenaryLines;
  /** Sounds made instead of words, read only where neither table has a line. */
  readonly grunts?: Partial<Record<MercenaryBarkTrigger, MercenaryGrunt>>;
}

/**
 * The one place a `MercenaryBarkTrigger` is turned into a `MercenaryLines`
 * property read. Every other reader of a voice's `lines` or `actions` goes
 * through this, so the literal `bag.hired`, `bag.idle`, … below are the only
 * place any of those pools is actually referenced by name.
 */
export function linesFor(
  bag: MercenaryLines | undefined,
  trigger: MercenaryBarkTrigger,
): NonEmpty<BarkLine> | undefined {
  if (bag === undefined) return undefined;
  switch (trigger) {
    case 'hired':
      return bag.hired;
    case 'idle':
      return bag.idle;
    case 'engage':
      return bag.engage;
    case 'kill':
      return bag.kill;
    case 'low_hp':
      return bag.lowHp;
    case 'special':
      return bag.special;
    case 'owner_hurt':
      return bag.ownerHurt;
    case 'cat_hurt':
      return bag.catHurt;
    case 'downed':
      return bag.downed;
    case 'revived':
      return bag.revived;
    case 'potion':
      return bag.potion;
    case 'death':
      return bag.death;
    case 'talk':
      return bag.talk;
    case 'floor_end':
      return bag.floorEnd;
  }
}

/** Any two barks are at least this far apart, so a busy fight is not a wall of bubbles. */
export const BARK_MIN_GAP_FRAMES = 180;

const HIRED_BARK_COOLDOWN_FRAMES = 0;
/** Long enough that a walk across town brings one or two, not a monologue. */
const IDLE_BARK_COOLDOWN_FRAMES = 2100;
const ENGAGE_BARK_COOLDOWN_FRAMES = 720;
const KILL_BARK_COOLDOWN_FRAMES = 480;
const LOW_HP_BARK_COOLDOWN_FRAMES = 1200;
/** Specials run on their own cooldowns; this only stops a double announcement. */
const SPECIAL_BARK_COOLDOWN_FRAMES = 240;
const OWNER_HURT_BARK_COOLDOWN_FRAMES = 900;
const CAT_HURT_BARK_COOLDOWN_FRAMES = 600;
const DOWNED_BARK_COOLDOWN_FRAMES = 0;
const REVIVED_BARK_COOLDOWN_FRAMES = 0;
/** Twice the draught's own cooldown, so a hireling only comments on every other one. */
const POTION_BARK_COOLDOWN_FRAMES = HIRELING_POTION_COOLDOWN_FRAMES * 2;
const DEATH_BARK_COOLDOWN_FRAMES = 0;
const TALK_BARK_COOLDOWN_FRAMES = 0;
const FLOOR_END_BARK_COOLDOWN_FRAMES = 0;

/** Frames before the same trigger can fire again for the same hireling. */
export const BARK_COOLDOWN_FRAMES: Readonly<Record<MercenaryBarkTrigger, number>> = {
  hired: HIRED_BARK_COOLDOWN_FRAMES,
  idle: IDLE_BARK_COOLDOWN_FRAMES,
  engage: ENGAGE_BARK_COOLDOWN_FRAMES,
  kill: KILL_BARK_COOLDOWN_FRAMES,
  low_hp: LOW_HP_BARK_COOLDOWN_FRAMES,
  special: SPECIAL_BARK_COOLDOWN_FRAMES,
  owner_hurt: OWNER_HURT_BARK_COOLDOWN_FRAMES,
  cat_hurt: CAT_HURT_BARK_COOLDOWN_FRAMES,
  downed: DOWNED_BARK_COOLDOWN_FRAMES,
  revived: REVIVED_BARK_COOLDOWN_FRAMES,
  potion: POTION_BARK_COOLDOWN_FRAMES,
  death: DEATH_BARK_COOLDOWN_FRAMES,
  talk: TALK_BARK_COOLDOWN_FRAMES,
  floor_end: FLOOR_END_BARK_COOLDOWN_FRAMES,
};

/**
 * Triggers that ignore {@link BARK_MIN_GAP_FRAMES}: the player asked for `talk`
 * by walking up and pressing a key, last words that lose to a kill line two
 * seconds earlier are never heard at all, and a signature move is the one
 * moment its line is for — a finisher lands seconds into a fight, right after
 * the `engage` line that would otherwise swallow it. Each kit's special runs on
 * its own cooldown, so exempting it never makes a wall of bubbles. The cry for
 * help on going down is the hireling's own call for a revive, and the thanks on
 * getting up is its answer; either swallowed by an `engage` line a second
 * earlier leaves the moment unmarked.
 */
export const GAP_EXEMPT_TRIGGERS: ReadonlySet<MercenaryBarkTrigger> = new Set([
  'talk',
  'downed',
  'revived',
  'death',
  'special',
]);

/** The two stone noises Tumbledown makes instead of words. */
const TUMBLEDOWN_GRUNTS: Partial<Record<MercenaryBarkTrigger, MercenaryGrunt>> = {
  hired: 'grunt',
  idle: 'grunt',
  engage: 'grunt',
  kill: 'grunt',
  special: 'grunt',
  low_hp: 'frustrated',
  owner_hurt: 'frustrated',
  cat_hurt: 'frustrated',
  downed: 'frustrated',
  revived: 'grunt',
  potion: 'grunt',
  death: 'frustrated',
  floor_end: 'grunt',
};

export const MERCENARY_VOICES: Readonly<Record<MercenaryVoiceId, MercenaryVoice>> = {
  sledge: SLEDGE,
  bomo: BOMO,
  dong_quixote: DONG_QUIXOTE,
  splash_zone: SPLASH_ZONE,
  gluteus_maxx: GLUTEUS_MAXX,
  bucket_boy: BUCKET_BOY,
  tumbledown: { ...TUMBLEDOWN_BASE, grunts: TUMBLEDOWN_GRUNTS },
};
