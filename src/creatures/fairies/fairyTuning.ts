/**
 * Every tuning number the fairies are built from, grouped per kind.
 *
 * One file so a retune never means hunting through five creatures and two
 * systems for the copy that matters: each value is read from here by whatever
 * owns the behaviour, and the gates assert against these same constants.
 */

import { PLAYER_SPEED } from '../../core/constants';
import type { Difficulty } from '../../core/difficultyProfiles';

// ── Shared body ──────────────────────────────────────────────────────────────

/**
 * A fairy's base HP as a share of the floor's typical host mob. A little more
 * than the host: a fairy keeps its distance and runs when its room falls, so
 * reaching it is most of the work, and one that then folded to a single blow
 * would make the chase pointless.
 */
export const FAIRY_BASE_HP_FRACTION = 1.2;

const FLOOR1 = 1;
const FLOOR2 = 2;
const FLOOR3 = 3;
/** Floor 1's goblin. */
const FLOOR1_TYPICAL_HOST_HP = 6;
/** Floor 2's troglodyte / llama / goblin mix, weighted by its room table. */
const FLOOR2_TYPICAL_HOST_HP = 14;
/** Floor 3's ruins ghoul. */
const FLOOR3_TYPICAL_HOST_HP = 16;

/**
 * Base HP of the body a room on each floor is typically made of, before any
 * level. A fairy is levelled on the same curve as its hosts, so matching their
 * authored HP keeps the share constant at every level rather than only at 1.
 */
export const FAIRY_TYPICAL_HOST_HP_BY_FLOOR: ReadonlyMap<number, number> = new Map([
  [FLOOR1, FLOOR1_TYPICAL_HOST_HP],
  [FLOOR2, FLOOR2_TYPICAL_HOST_HP],
  [FLOOR3, FLOOR3_TYPICAL_HOST_HP],
]);

/** Floor whose host HP a fairy is authored at when nothing names another. */
export const FAIRY_DEFAULT_HOST_FLOOR = FLOOR1;

/** Share of the pre-slowdown speeds every fairy but the shield fairy moves at: 30% slower. */
export const FAIRY_SPEED_SCALE = 0.7;

/** The shield fairy's ceiling as a share of the crawler's speed; it is the one fairy not slowed. */
export const SHIELD_MAX_SPEED_FRACTION_OF_PLAYER = 0.85;

/** The shield fairy's ceiling in pixels per frame. */
export const SHIELD_MAX_SPEED = PLAYER_SPEED * SHIELD_MAX_SPEED_FRACTION_OF_PLAYER;

/** The shield fairy's authored walk speed before level scaling. */
export const SHIELD_BASE_SPEED = 1.5;

/**
 * Ceiling on a fairy's walk speed as a share of the crawler's, levelled or not,
 * so a crawler who chases one down always catches it. Not the shield fairy's:
 * see {@link SHIELD_MAX_SPEED_FRACTION_OF_PLAYER}.
 */
export const FAIRY_MAX_SPEED_FRACTION_OF_PLAYER =
  SHIELD_MAX_SPEED_FRACTION_OF_PLAYER * FAIRY_SPEED_SCALE;

/** The ceiling above in pixels per frame. */
export const FAIRY_MAX_SPEED = PLAYER_SPEED * FAIRY_MAX_SPEED_FRACTION_OF_PLAYER;

/** Authored walk speed before level scaling; levelling can lift it only as far as {@link FAIRY_MAX_SPEED}. */
export const FAIRY_BASE_SPEED = SHIELD_BASE_SPEED * FAIRY_SPEED_SCALE;

/** How far a fairy notices a crawler, in tiles. */
export const FAIRY_NOTICE_RANGE_TILES = 8;

/**
 * How far a fairy looks for allies to support. With none inside it the fairy
 * counts itself alone and runs for another room.
 */
export const FAIRY_ALLY_SEARCH_TILES = 10;

/**
 * Farthest a fairy may fly from the tile it spawned on, in tiles, whether it
 * is backing off from a crawler, hunting a hover goal, or running for another
 * room to regroup. Past its notice range (8), so a fairy that has just noticed
 * a crawler can still take a step back, and short enough that neither kind of
 * run drags a chase into a room the fairy never started in. Every candidate
 * spot is measured against the same fixed point every frame, so nothing here
 * can disagree with itself about whether a spot is in bounds.
 */
export const FAIRY_SPAWN_LEASH_TILES = 9;

/**
 * Frames between re-choosing a hover goal while nothing is closing in; a goal
 * re-picked every frame jitters.
 */
export const FAIRY_GOAL_REPLAN_FRAMES = 20;

/**
 * The soonest a hover goal is re-chosen because a crawler closed on it. Short
 * enough that a charging crawler sees the fairy back off within a few frames,
 * long enough that the path search is not asked every frame.
 */
export const FAIRY_GOAL_MIN_REPLAN_FRAMES = 4;

/**
 * How much nearer a crawler must come to the fairy's hover goal, in tiles,
 * before the goal is re-chosen early. The hysteresis that keeps a crawler
 * pacing at the range boundary from flipping the fairy back and forth.
 */
export const FAIRY_THREAT_SHIFT_REPLAN_TILES = 0.75;

/**
 * How much better, in tiles of score, a fresh hover goal must be than the one
 * the fairy already has before it switches. The other half of the hysteresis.
 */
export const FAIRY_GOAL_SWITCH_MARGIN_TILES = 0.5;

/**
 * Score cost, per pixel, of a hover goal nearer the crawler than the fairy's
 * range, against 1 per pixel for one past it: closing in is far worse than
 * standing a little long.
 */
export const FAIRY_TOO_CLOSE_WEIGHT = 5;

/**
 * Score cost, per pixel, of a hover goal past its range for a fairy that does
 * not need to see the crawler to do its work. Small: a healer or warder
 * farther off than it needs is only safer, and a full weight would pull it
 * out from behind its ally towards a crawler across the room.
 */
export const FAIRY_SUPPORT_TOO_FAR_WEIGHT = 0.2;

/**
 * Radius of the retreat ring sampled around the fairy itself, in tiles, so a
 * crawler that closes in always offers a step straight away from it.
 */
export const FAIRY_RETREAT_STEP_TILES = 2.5;

/**
 * How far past its support leash, as a multiple of it, a retreat step may take
 * a fairy: a crawler pressing it may push it off its ally, not out of the room.
 */
export const FAIRY_RETREAT_LEASH_STRETCH = 1.5;

/**
 * Within this many tiles of a crawler a fairy flutters away at its top speed
 * rather than its cruising one. Its top speed is still {@link FAIRY_MAX_SPEED}.
 */
export const FAIRY_FLUTTER_RANGE_TILES = 3;

/**
 * Hover goals whose straight line from the fairy passes this close to a
 * crawler, in tiles, are penalised: escaping past the crawler reads as running
 * into it.
 */
export const FAIRY_CROSSING_CLEARANCE_TILES = 1.5;

/** The penalty above, in tiles of score. */
export const FAIRY_CROSSING_PENALTY_TILES = 8;

/**
 * The range a fairy with no ally left keeps when it has nowhere to run. At or
 * past every kind's preferred range, and inside the ice bolt's and fireball's
 * reach, so a cornered caster still fights back.
 */
export const FAIRY_LONE_RANGE_TILES = 6.5;

/**
 * How far a boss's healer may stray from its boss, in tiles, once it has
 * nobody left to hide behind. Keeps it in the fight it was sealed into.
 */
export const FAIRY_BOUND_HEALER_LEASH_TILES = 6;

// ── Running for the next room ────────────────────────────────────────────────

/**
 * A fleeing fairy stops running once an ally is this close, in tiles. Inside
 * {@link FAIRY_ALLY_SEARCH_TILES}, so an ally at the edge of that search does
 * not flip the fairy between running and staying.
 */
export const FAIRY_REFUGE_JOIN_TILES = 7;

/** A room holding bodies to hide behind is preferred as if it were this many tiles nearer. */
export const FAIRY_REFUGE_OCCUPIED_BONUS_TILES = 12;

/**
 * A refuge whose route closes to within this many tiles of a crawler, nearer
 * than the fairy already stands, lies through the party and is never taken.
 */
export const FAIRY_REFUGE_PARTY_CLEARANCE_TILES = 3;

/**
 * Frames a fleeing fairy may go without getting a tile further along its
 * route to its refuge before it gives the refuge up and picks another.
 */
export const FAIRY_REFUGE_STALL_FRAMES = 90;

/** Distance from an open-ground refuge at which a fleeing fairy has arrived, in tiles. */
export const FAIRY_REFUGE_ARRIVAL_TILES = 2;

/**
 * Frames a fairy that found nowhere to run waits before looking again, so a
 * cornered fairy is not searching the map every frame.
 */
export const FAIRY_REFUGE_RETRY_FRAMES = 60;

/** Directions sampled around the anchor when choosing a hover goal. */
export const FAIRY_GOAL_SAMPLE_DIRECTIONS = 12;

/**
 * How far off the fairy-to-crawler line an ally may stand and still count as
 * cover between them, in tiles.
 */
export const FAIRY_COVER_LINE_TOLERANCE_TILES = 0.8;

/**
 * Score bonus for a hover goal with an ally standing between it and the
 * crawlers, in tiles of range error it forgives. Large, because a fairy's
 * whole survival is the body in front of it.
 */
export const FAIRY_COVER_BONUS_TILES = 3;

/** Distance from a hover goal at which a fairy counts as having arrived, in tiles. */
export const FAIRY_GOAL_ARRIVAL_TILES = 0.35;

/**
 * Frames the cast row plays out over after any cast releases, while the fairy
 * flies on; also the least gap before its next cast.
 */
export const FAIRY_CAST_RECOVER_FRAMES = 12;

// ── Fights with fairies ──────────────────────────────────────────────────────

/**
 * The most a room (or roaming pair) that rolled fairies may cost the reference
 * party on normal, in party wipes: pooled max HP lost, averaged over the rolls
 * and not stopped at an empty bar, so 1 is exactly one wipe.
 *
 * Fights with fairies are a deliberately brutal encounter class, held apart
 * from the ordinary room band. The pricer has every body stand and trade
 * blows, so it never credits the answer fairies are built around — killing
 * the shield fairy first, then the casters behind the wall — nor a potion or a
 * retreat mid-fight, and it reads several of these fights as more than one
 * wipe. The class is read in wipes rather than HP remaining because HP
 * remaining stops at zero, and a floor of zero cannot fail. Set just above the
 * harshest of these fights, so they cannot quietly get harsher still.
 */
export const FAIRY_ROOM_FIGHT_WIPES_MAX = 2.7;

/** {@link FAIRY_ROOM_FIGHT_WIPES_MAX} on hard. */
export const HARD_FAIRY_ROOM_FIGHT_WIPES_MAX = 6;

/**
 * The least the fairies alone must add to a fight on normal, in party wipes,
 * over the very same rolls with the fairies left out. Just under the cheapest
 * they add anywhere: fairies that cost less have stopped being what makes the
 * fight.
 */
export const FAIRY_ROOM_FIGHT_FAIRY_COST_MIN = 0.2;

/**
 * Most blows the balanced build may need to kill one fairy where it is met,
 * in place of the ordinary `HITS_TO_KILL_MAX`. A fairy carries more health
 * than its floor's typical host ({@link FAIRY_BASE_HP_FRACTION}) so that
 * reaching it past its wall is a commitment, which puts it a blow past the
 * ordinary limit early in a floor's window; one more blow of room, and no
 * further.
 */
export const FAIRY_HITS_TO_KILL_MAX = 8;

// ── Potency ──────────────────────────────────────────────────────────────────

/** Fairy levels per extra potency step: one more shield ward or death-raised skeleton. */
export const FAIRY_LEVELS_PER_EXTRA_TARGET = 5;
export const FAIRY_MIN_POTENCY = 1;
export const FAIRY_MAX_POTENCY = 4;

// ── Shield fairy ─────────────────────────────────────────────────────────────

/**
 * Wards a shield fairy holds beyond its potency, at every level and
 * difficulty. Its own count only: a necro fairy's death skeletons stay at its
 * potency.
 */
export const SHIELD_EXTRA_WARDS = 1;
export const SHIELD_PREFERRED_RANGE_TILES = 4;
export const SHIELD_SUPPORT_LEASH_TILES = 4;
/**
 * Gap between any two ward casts. Short, so a fairy holding several wards lays
 * its opening set in a few seconds and replaces a warded ally that fell soon
 * after.
 */
export const SHIELD_BETWEEN_CASTS_FRAMES = 90;
export const SHIELD_BETWEEN_CASTS_MIN_FRAMES = 60;
/**
 * Farthest an ally may stand from a shield fairy and either take a ward or
 * keep one it already holds, in tiles; a new ward also needs a clear line to
 * the ally. A carrier that runs past this range while warded has its ward
 * stripped on the spot, so a fairy's protection can never follow its ally
 * somewhere the fairy itself cannot be reached and killed.
 */
export const SHIELD_WARD_LINK_RANGE_TILES = 7;
/**
 * Gap between any two crushing-ward casts on a vespa. Longer than the ordinary
 * ward's cooldown: this cast ends a fight outright rather than merely
 * prolonging one, so it should not be the fairy's default answer to every
 * vespa it sees.
 */
export const SHIELD_CRUSH_COOLDOWN_FRAMES = 600;
export const SHIELD_CRUSH_MIN_COOLDOWN_FRAMES = 480;
/** How long the ward bubble takes to snap shut on a vespa once cast: roughly half a second. */
export const SHIELD_CRUSH_IMPLODE_FRAMES = 30;
/**
 * An ally that struck a crawler this recently counts as in the fight, for
 * choosing whom to ward first.
 */
export const SHIELD_ENGAGED_RECENT_FRAMES = 180;
/** Reach of the shield fairy's death chains. */
export const AEGIS_CHAIN_RADIUS_TILES = 5;
/** How long the death chains' damage reduction lasts. */
export const AEGIS_DURATION_FRAMES = 300;
export { AEGIS_DAMAGE_SCALE } from '../../core/statusTuning';

// ── Healing fairy ────────────────────────────────────────────────────────────

export const HEALER_PREFERRED_RANGE_TILES = 5;
export const HEALER_SUPPORT_LEASH_TILES = 4;
/** Only an ally under this share of its max HP is worth a heal. */
export const HEAL_TRIGGER_HP_FRACTION = 0.8;
export const HEAL_RANGE_TILES = 6;
export const HEAL_FRACTION_OF_TARGET_MAX_HP = 0.2;
/** A boss is healed this share of what a regular mob would be. */
export const BOSS_HEAL_SCALE = 0.25;
/**
 * The most one heal restores at level 1, whatever the target; scaled by
 * `hpScaleForLevel` on the healer's own curve. Without it a share of a boss's
 * max HP would outgrow the party's damage, so this cap — not the share — is
 * what holds a healer under `HEAL_MAX_SHARE_OF_PARTY_DPS` on a big target.
 */
export const HEAL_AMOUNT_CAP_BASE = 10;
export const HEAL_COOLDOWN_FRAMES = 360;
export const HEAL_COOLDOWN_MIN_FRAMES = 240;
/**
 * The most one healer may restore per second on any target, as a share of the
 * reference party's damage per second at that level: a healer slows a fight
 * and never makes one unwinnable.
 */
export const HEAL_MAX_SHARE_OF_PARTY_DPS = 0.25;
export const HEAL_WAVE_EXPAND_FRAMES = 30;
export const HEAL_WAVE_RADIUS_TILES = 5;
/** A full-HP mob the death wave reaches gains this share of its max HP as a decaying ward. */
export const OVERHEAL_MAX_HP_FRACTION = 0.5;
export const OVERHEAL_DURATION_FRAMES = 1800;

// ── Ice fairy ────────────────────────────────────────────────────────────────

export const ICE_PREFERRED_RANGE_TILES = 5;
export const ICE_SUPPORT_LEASH_TILES = 5;
/** Farthest crawler an ice fairy fires at, in tiles; it also needs a clear line to it. */
export const ICE_BOLT_RANGE_TILES = 7;
/** How far a bolt flies before it melts away, in tiles: a little past its firing range. */
export const ICE_BOLT_MAX_TRAVEL_TILES = 9;
/**
 * The bolt's flight speed as a share of the crawler's. Under one, so a crawler
 * can outrun it as well as step aside; fixed rather than level-scaled, so the
 * dodge it asks for is the same at every level. From its firing range the
 * flight gives far longer than a sidestep out of its path takes.
 */
export const ICE_BOLT_SPEED_FRACTION_OF_PLAYER = 0.8;
/** The speed above in pixels per frame. */
export const ICE_BOLT_SPEED = PLAYER_SPEED * ICE_BOLT_SPEED_FRACTION_OF_PLAYER;
/** A body whose centre comes this close to the bolt's is struck, in pixels. */
export const ICE_BOLT_HIT_RADIUS_PX = 12;
export const ICE_BOLT_DAMAGE = 2;
/**
 * Two bolts fired from the same range land this far apart, and it is kept
 * inside `CHILLED_FRAMES` at every level, so a lone fairy's second bolt lands
 * while its first chill still holds and a crawler hit by both is frozen. A
 * longer cycle would leave the freeze reachable only by two ice fairies taking
 * turns.
 */
export const ICE_BOLT_COOLDOWN_FRAMES = 120;
/**
 * Below what the cooldown scales to at the level cap, so the floor only guards
 * a raised cap.
 */
export const ICE_BOLT_COOLDOWN_MIN_FRAMES = 80;
// The frost statuses the bolt applies are tuned with the statuses themselves,
// because the crawler reads them every frame; re-exported so a fairy retune
// finds every number from here.
export {
  CHILLED_ACTION_SPEED_FACTOR,
  CHILLED_FRAMES,
  CHILLED_MOVE_SPEED_FACTOR,
  FREEZE_GRACE_FRAMES,
  FROZEN_FRAMES,
} from '../../core/statusTuning';
export const CHILL_BLAST_RADIUS_TILES = 3;

// ── Fire fairy ───────────────────────────────────────────────────────────────

export const FIRE_PREFERRED_RANGE_TILES = 6;
export const FIRE_SUPPORT_LEASH_TILES = 5;
/**
 * Frames a crawler standing on a lob's landing takes to notice the throw and
 * choose a way out: half a second. The flight is sized against it.
 */
export const FIREBALL_DODGE_REACTION_FRAMES = 30;
/**
 * The lob is thrown the frame it is chosen, its landing point fixed then, so
 * its flight is its telegraph: never under `LOCKED_TELEGRAPH_MIN_FRAMES`, and
 * long enough that a crawler standing dead on the landing who starts walking
 * `FIREBALL_DODGE_REACTION_FRAMES` after the throw is clear of the whole blast
 * radius before the ball comes down: `FIREBALL_DODGE_REACTION_FRAMES +
 * ceil(blast px / PLAYER_SPEED)` = 30 + 16 = 46 frames against 80, over half a
 * second to spare. Half this flight would land on that crawler still inside
 * the circle.
 */
export const FIREBALL_FLIGHT_FRAMES = 80;
export const FIREBALL_ARC_HEIGHT_TILES = 2.25;
/**
 * The farthest a lob is thrown, in tiles. Not a speed limit: the ball flies a
 * fixed-time arc to a landing point fixed and marked at the throw, so at full
 * range it crosses the ground a little faster than the crawler walks. The
 * dodge is leaving the marked circle before it lands, not outrunning the ball.
 */
export const FIREBALL_MAX_RANGE_TILES = 7;
export const FIREBALL_HIT_RADIUS_PX = 14;
export const FIREBALL_DAMAGE = 3;
export const FIREBALL_FUSE_FRAMES = 90;
/**
 * Sized so that `FROZEN_FRAMES + ceil(blast px / (PLAYER_SPEED ×
 * CHILLED_MOVE_SPEED_FACTOR)) < FIREBALL_FUSE_FRAMES`: a crawler frozen on the
 * frame a charge lands thaws and walks clear before it goes off. The walk is
 * measured at the chilled pace because the freeze grace blocks only a second
 * freeze, and an ice bolt can still re-chill the crawler on the way out.
 */
export const FIREBALL_BLAST_RADIUS_TILES = 1.25;
/**
 * How far past the blast radius a landing or a charge counts as marked ground
 * for anything steering by `GroundHazardSource`. A companion fleeing a circle
 * stops this far outside it rather than on the rim, where a shove from a mob
 * or the next follow step would tip her back into the blast.
 */
export const FIREBALL_HAZARD_MARGIN_TILES = 0.25;

/**
 * The landing reticle, as a share of the charge's blast radius. The fire
 * fairy's lock reticle and the in-flight reticle share it, so the mark does not
 * jump when the ball leaves the fairy's hands.
 */
export const FIREBALL_RETICLE_RADIUS_FRACTION = 0.6;
export const FIREBALL_BLAST_DAMAGE = 4;
export const FIREBALL_BURN_CHANCE = 0.35;
export const FIREBALL_COOLDOWN_FRAMES = 270;
export const FIREBALL_COOLDOWN_MIN_FRAMES = 170;
export const DEATH_FLAME_RADIUS_TILES = 1.2;
export const DEATH_FLAME_FRAMES = 180;
export const DEATH_FLAME_TICK_DAMAGE = 1;
export const DEATH_FLAME_TICK_FRAMES = 30;
export const DEATH_EXPLOSION_RADIUS_TILES = 2;
export const DEATH_EXPLOSION_DAMAGE = 5;

// ── Necro fairy ──────────────────────────────────────────────────────────────

export const NECRO_PREFERRED_RANGE_TILES = 5;
export const NECRO_SUPPORT_LEASH_TILES = 5;
export const RESURRECT_RANGE_TILES = 6;
export const RESURRECT_HP_FRACTION = 0.5;
/**
 * Short, because one raise stands up every eligible corpse in reach at once:
 * the cooldown only spaces out casts for bodies that fall after the last one.
 */
export const RESURRECT_COOLDOWN_FRAMES = 60;
export const RESURRECT_COOLDOWN_MIN_FRAMES = 45;
/** A resurrected mob rises this long, immune, before it fights. */
export const RESURRECT_RISE_FRAMES = 40;
/**
 * How far below the fairy's own level every skeleton it raises stands, in life
 * or on its death. A necro keeps a standing army and leaves a bigger one when
 * it dies; at the fairy's own level those bodies alone outweighed the room the
 * fairy joined, so they rise as its lesser servants.
 */
export const NECRO_SKELETON_LEVELS_BELOW_FAIRY = 3;
/**
 * Share of a skeleton warrior's authored HP and of every blow's damage that a
 * necro fairy's skeletons rise with. The warrior is authored as a Skeleton
 * Lord's escort and, level for level, out-hits the goblins and troglodytes of
 * the floors a necro also haunts; a level step alone cannot close that on the
 * shallow floors, where the levels are already near the bottom.
 */
export const NECRO_SKELETON_STRENGTH = 0.4;
/** How many sword skeletons and skeleton archers make up a necro fairy's army. */
export type NecroSkeletonArmy = Readonly<Record<'sword' | 'archer', number>>;
/** The army a living necro fields, and refills to — never past it. */
export const NECRO_ARMY: NecroSkeletonArmy = { sword: 2, archer: 1 };
/**
 * The army a necro's death leaves behind, by the difficulty stamped on it at
 * spawn, so a settings change mid-floor never changes a necro that already
 * exists.
 */
export const NECRO_DEATH_ARMY: Readonly<Record<Difficulty, NecroSkeletonArmy>> = {
  easy: { sword: 4, archer: 2 },
  normal: { sword: 4, archer: 2 },
  hard: { sword: 7, archer: 3 },
};
/**
 * A necro calls its army once a crawler it has noticed comes this close: inside
 * its notice range, just past the range it hovers at, so the army rises for a
 * fight the crawler has walked into rather than one glimpsed across a hall.
 */
export const NECRO_SUMMON_TRIGGER_TILES = 6;
/** Delay, rolled per wipe, before a necro whose whole army has fallen summons a new one. */
export const NECRO_RESUMMON_AFTER_WIPE_MIN_FRAMES = 150;
export const NECRO_RESUMMON_AFTER_WIPE_MAX_FRAMES = 210;
/** Living skeletons at or under which a necro starts refilling its army before the last one falls. */
export const NECRO_ARMY_LAST_STANDING = 1;
/** Delay before a necro down to {@link NECRO_ARMY_LAST_STANDING} skeletons refills its army. */
export const NECRO_RESUMMON_LAST_STANDING_FRAMES = 300;
export const TK_TRIGGER_RADIUS_TILES = 2;
export const TK_RADIUS_TILES = 2.5;
export const TK_KNOCKBACK_TILES = 3;
export const TK_KNOCKBACK_FRAMES = 12;
/**
 * Flat rather than level-scaled: the wave's rhythm is part of its read. It
 * never shoves the same party twice inside this.
 */
export const TK_COOLDOWN_FRAMES = 420;
