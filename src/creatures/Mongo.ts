import { ASTAR_FAILURE_BACKOFF_FRAMES, ASTAR_MAX_DENIED_FRAMES, Mob } from './Mob';
import type { DamageSource, Player } from '../Player';
import { TILE_SIZE } from '../core/constants';
import {
  MONGO_HEAD_CLEARANCE_TILES,
  MONGO_WALK_FRAMES,
  MONGO_UNDERSAMPLING_FRAME_LIMIT,
  MONGO_WALK_FRAMES_PER_TICK_AT_BASE_SPEED,
  MongoAnimator,
  drawMongoSprite,
  mongoActionDuration,
  type MongoAction,
} from '../sprites/mongoSprite';
import {
  MONGO_BITE_FRAMES,
  MONGO_BITE_IMPACT_PROGRESS,
  MONGO_POUNCE_AIRBORNE_END,
  MONGO_POUNCE_AIRBORNE_START,
  MONGO_POUNCE_FRAMES,
  MONGO_POUNCE_IMPACT_PROGRESS,
  MONGO_SLASH_FRAMES,
  MONGO_SLASH_IMPACT_PROGRESS,
  mongoImpactFrame,
} from '../sprites/mongoAttackTiming';
import { getMongoStats, type MongoAttack, type MongoStats } from '../abilities/mongo';
import { MONGO_MIN_SUMMON_HP } from '../core/MongoPetState';
import type { LootDrop } from './Mob';

/**
 * Mongo — the cat's pet Mongoliensis.
 *
 * He hunts anything {@link Mob.isPetAttackable} within aggro range of his
 * owner, breaks off to stay inside his leash, and attacks in his *own* name so
 * the mobs he mauls come after him rather than after the cat standing behind
 * him. Kill XP still reaches the cat, via `Player.xpCreditTarget`.
 *
 * He never actually dies: {@link MongoSystem} intercepts him at zero HP, plays
 * the collapse, and runs him back to the cat to despawn. His HP lives in the
 * scene-spanning `MongoPetState`, not on this object, which is thrown away.
 */

/**
 * Leash band and aggro bubble, which have to be read together.
 *
 * Staying with the cat is the rule and fighting is what he does inside it, not
 * the other way round: every radius here is measured from the *cat*, and the
 * leash outranks any target. He takes a new fight only inside
 * `ENGAGE_RADIUS_TILES`, keeps one he is already in out to
 * `ENGAGE_PERSIST_TILES`, and abandons it outright past `LEASH_BREAK_TILES`.
 *
 * `ENGAGE_RADIUS_TILES > LEASH_RESUME_TILES` so that after being hauled home he
 * is close enough to actually re-acquire rather than bouncing off the resume
 * line.
 *
 * What these numbers do *not* do is prevent the yo-yo, and it is worth being
 * exact about that, because `ENGAGE_PERSIST_TILES < LEASH_BREAK_TILES` reads
 * like it should. It does not: the persist radius is straight-line cat-to-mob,
 * while the leash is cat-to-Mongo along the route he actually walks. A mob four
 * tiles away through a gap that A* has to detour nine tiles around puts him past
 * the break distance while sitting well inside the persist band — engage, run
 * out, come home, find it still legal, repeat forever. The thing that stops it
 * is {@link breakLeash} dropping the target and holding it off; do not widen the
 * bands or delete the hold-off on the strength of an ordering these radii do not
 * actually guarantee.
 *
 * All four are one band and must be re-scaled together — they were doubled from
 * 4.5/6/7/3 as a unit. Widening the engage bubble alone, past the leash break,
 * would have him take fights he snaps the leash before reaching: walk out,
 * break, ban the mob, come home, never land a blow. That is strictly *less*
 * aggressive than the tighter band it came from.
 */
const ENGAGE_RADIUS_TILES = 9.0;
const ENGAGE_PERSIST_TILES = 12.0;
const LEASH_BREAK_TILES = 14.0;
const LEASH_RESUME_TILES = 6.0;

/**
 * Follow band, and it is a *latch* rather than a pair of thresholds.
 *
 * He sets off once the cat is `RETURN_THRESHOLD_TILES` away and keeps walking
 * until he is inside `RETURN_STOP_TILES`; the gap between the two is only real
 * hysteresis if something remembers that he is mid-return. Re-deciding from the
 * distance alone every frame stops him the instant he crosses the threshold, the
 * cat's next step pushes him back over it, and he alternates walk/stand on
 * consecutive frames — which on screen is the sprite vibrating at her shoulder.
 */
const RETURN_THRESHOLD_TILES = 3.0;
const RETURN_STOP_TILES = 1.6;

const RECALL_SPEED_MULTIPLIER = 1.5;
/**
 * The fastest leg cadence any real locomotion of his produces — the recall
 * sprint. Anything the gait measures above this came from a shove, not a stride.
 *
 * Derived rather than written down, so raising the sprint speeds his legs up
 * with it instead of quietly clamping them to a stale number. Held under the
 * undersampling limit by the same expression: a sprint multiplier large enough
 * to cross it degrades to "the sprint stops looking faster", which is visible,
 * rather than to a strobe, which is what this whole method exists to prevent.
 */
const MAX_WALK_FRAMES_PER_TICK = Math.min(
  MONGO_WALK_FRAMES_PER_TICK_AT_BASE_SPEED * RECALL_SPEED_MULTIPLIER,
  MONGO_UNDERSAMPLING_FRAME_LIMIT,
);
/** How close he has to get to the cat before the recall counts as finished. */
const RECALL_ARRIVE_TILES = 1.2;
const RECALL_STOP_TILES = 0.4;
const CENTER_OFFSET = 0.5;
const FOLLOW_STOP_RANGE_RATIO = 0.7;
/** A blow may be started from slightly outside its own reach; contact is re-checked. */
const ATTACK_TRIGGER_RANGE_RATIO = 1.15;

const BITE_RANGE_TILES = 0.9;
const BITE_COOLDOWN_FRAMES = 46;
/** The rake reaches further than the bite — that is the point of having it. */
const SLASH_RANGE_TILES = 1.3;
const SLASH_COOLDOWN_FRAMES = 84;
/** The pounce is a gap-closer, so it is only offered at a gap worth closing. */
const POUNCE_MIN_TILES = 2.0;
const POUNCE_MAX_TILES = 4.2;
const POUNCE_COOLDOWN_FRAMES = 220;
const POUNCE_LANDING_RANGE_TILES = 1.1;
/**
 * How much faster than his walk he travels through the airborne window.
 *
 * The leap is ordinary self-movement rather than a position write: the mob grid
 * only tracks a mob that moves itself, and a teleported Mongo would keep being
 * hit — and keep missing — from the tile the grid still thought he was on.
 */
const POUNCE_LUNGE_SPEED_MULTIPLIER = 2.7;

/** How long a target he could not get to stays off his list. */
const NO_ROUTE_FORGET_FRAMES = 180;
/**
 * How long the mob that snapped the leash stays off his list.
 *
 * Shorter than a routing failure, because nothing is wrong with the target — he
 * simply cannot have it and stay with the cat. Without it he re-acquires the
 * same mob the frame he gets home: the leash is measured along the route he
 * walks and the engage radius in a straight line, so a mob 4 tiles away through
 * a diagonal gap A* has to detour nine tiles around passes the entry test on
 * every lap. He paces between the cat and the corner and never fights.
 */
const LEASH_BREAK_FORGET_FRAMES = 90;
/** How much nearer the cat a held-off mob has to get before the hold-off lifts. */
const LEASH_BAN_LIFT_APPROACH_TILES = 1.0;
/**
 * Cat-distance inside which a held-off mob lifts on proximity alone.
 *
 * The approach bar is relative, and relative alone inverts: a mob already beside
 * the cat when the leash broke gets a bar of zero or less, which `Math.hypot`
 * can never satisfy, so the mob standing *on* the owner is the one the hold-off
 * refuses to release. Kiting past an enemy does exactly that. Set inside
 * `ENGAGE_RADIUS_TILES` so such a mob lifts on the first frame home, and below
 * the bar a mob broken off at camp range would have to clear, so the anti-lap
 * behaviour is untouched.
 */
const LEASH_BAN_LIFT_MIN_TILES = 2.25;
/** A cat-distance no mob can be inside, for bans that must run their full term. */
const NO_EARLY_LIFT = -1;

/** Pixels of movement in a frame below which a walk counts as going nowhere. */
const MOVEMENT_PROGRESS_EPSILON_PX = 0.01;
/** Frames of standing still mid-chase before he writes the target off. */
const ENGAGE_STALL_LIMIT_FRAMES = 45;

/**
 * Frames beyond the pathfinder's own backoff that a stall has to persist for,
 * so tripping the rescue takes a *second* failed search rather than one.
 */
const FRAMES_TO_CONFIRM_A_STALL = 30;
/**
 * Frames of getting nowhere on the way to the cat before he calls for a rescue.
 *
 * Derived from the pathfinder's own timings rather than written down, and the
 * ordering is load-bearing. `astarSearchFailed` is a latch, not a per-frame
 * observation: one empty search holds it true for the whole failure backoff,
 * during which no re-search is allowed to run — and once that expires the retry
 * is still only *wanted*, so a crowded frame can withhold it for the denial cap
 * on top. Both terms therefore have to be in the sum. A limit shorter than their
 * total *cannot* tell a transient failure — the cat rounding a corner, a search
 * that blew its expansion budget on a windy route, the cat standing for a moment
 * on a tile `isWalkable` rejects — from a sealed door, and would snap a raptor
 * who was walking home perfectly well to her heels a second and a half later.
 * Longer, every single failure gets its chance to clear before the count can
 * matter, and only a sustained absence of a route trips a rescue.
 */
const HOME_STALL_LIMIT_FRAMES =
  ASTAR_FAILURE_BACKOFF_FRAMES + ASTAR_MAX_DENIED_FRAMES + FRAMES_TO_CONFIRM_A_STALL;
/**
 * Cat-distance beyond which he asks for a rescue regardless of progress.
 *
 * Deliberately inside the mob loop's activation radius. The rescue is decided by
 * his own AI, so it can only fire on a frame that AI runs — and while
 * {@link Mongo.exemptFromAiActivationRadius} means that is now every frame, a
 * bar set outside the radius would have depended on the exemption for its
 * correctness rather than merely for its speed.
 */
const RESCUE_DISTANCE_TILES = 18.0;

/**
 * Target tiers, highest first. Within a tier, nearest wins.
 *
 * One sentence describes the whole result, which is the point: he guards the
 * cat, helps with whatever she is hitting, and otherwise hunts what is nearest.
 * A flat nearest-first scan gave none of that — a raptor summoned into a fight
 * would trot past the mob chewing on his owner to reach a rat one pixel closer.
 */
const PRIORITY_PARTY_THREAT = 2;
const PRIORITY_OWNER_QUARRY = 1;
const PRIORITY_NEAREST = 0;
/** Below every tier, so the first admissible candidate always beats it. */
const PRIORITY_NONE = -1;

/**
 * Fraction of a blow he actually takes.
 *
 * He cannot kite, cannot heal in the field, is on every hostile's target list
 * while he is out, and pays real minutes of recovery for every point — so the
 * same hit costs the party far more landing on him than on a crawler. Flat and
 * in one place rather than folded into the level table, so it can be judged and
 * tuned as the single lever it is.
 */
const MONGO_DAMAGE_TAKEN_MULTIPLIER = 0.6;
/** A blow never rounds away to nothing; the resistance softens hits, it does not void them. */
const MIN_DAMAGE_TAKEN = 1;
/**
 * The most the softening ledger may ever run in the pet's favour, in hit points.
 *
 * A bound rather than a tuning number — see {@link Mongo.soften}. Without one the
 * ledger is a sink that both voids the resistance on small hits and banks the
 * difference as free hit points to spend later.
 */
const MAX_SOFTENING_CREDIT = 1;

/**
 * Whether a badly wounded Mongo breaks off and holds at the cat's side.
 *
 * A single switch because it is a genuine design trade rather than a tuning
 * number: it turns "he died instantly" into a visible limping raptor the player
 * can answer with a recall, at the cost of softening the rule that spending him
 * is the decision. Flip it off to get the old press-until-collapse behaviour
 * back in one edit.
 */
// A named setting rather than a bare `true`, because a bare boolean cannot be
// written here at all: left to infer it takes the literal type and the guard
// reading it is dead code the linter rejects, and annotated `boolean` it is a
// trivially-inferrable annotation the linter also rejects. A two-member union
// says the same thing and stays flippable in one edit.
type WoundedRetreatSetting = 'on' | 'off';
const MONGO_WOUNDED_RETREAT: WoundedRetreatSetting = 'on';
/** HP fraction at or below which the wounded retreat takes over from fighting. */
const MONGO_RETREAT_HP_FRACTION = 0.25;

/**
 * Health fraction the Summon button requires, against the retreat threshold's.
 *
 * A margin rather than one hit point above the threshold, and the gap is the
 * point. Sent in at exactly the threshold he stops fighting again after a single
 * point of damage — which is what every status tick delivers, and what the
 * resistance's own floor guarantees the smallest blow delivers — so the trap
 * this floor exists to close would reopen within a second of closing. The gap is
 * roughly fifteen per cent of his health: a few blows of fighting, which is the
 * least a summon should be worth.
 */
const MONGO_MIN_SUMMON_HP_FRACTION = 0.4;

/**
 * The least health he can be sent in with and still be worth sending in.
 *
 * One hit point used to be the floor, and with the wounded retreat that becomes
 * a trap rather than a choice: the whole band under the retreat threshold
 * summons a raptor who walks out, never picks a target, never bites, and stands
 * on every hostile's list as a free target — for two usage XP and a green
 * button that explains none of it. The Summon button already has the right
 * affordance for "not yet": it reads Resting and counts down.
 */
export function mongoMinFightingHp(maxHp: number): number {
  // With the retreat switched off he fights at any health, so the only floor left
  // is the one the pet state has always had.
  if (MONGO_WOUNDED_RETREAT === 'off') return MONGO_MIN_SUMMON_HP;
  return Math.ceil(maxHp * MONGO_MIN_SUMMON_HP_FRACTION);
}

/**
 * Frames a recall must have been running before a second press of the button is
 * read as "he is not coming" rather than as a double-tap.
 */
const RECALL_RESCUE_GRACE_FRAMES = 90;

/** Frames the white flash marking a growth spurt runs for. */
const GROWTH_FLASH_FRAMES = 10;

/** Frames the despawn fade runs for once the recall has landed. */
export const MONGO_FADE_FRAMES = 18;

const TWO_PI = Math.PI * 2;

/**
 * A mob Mongo may not pick, and the two ways the ban ends.
 *
 * `liftAtCatDistance` is what makes a leash-break ban safe to apply to anything.
 * The question a break cannot answer is "will this mob come to us" — and the
 * proxies for it are all wrong. `retaliateMob` is set by every blow he lands and
 * nothing clears it while he lives, so it exempts every mob he has ever bitten;
 * `currentTarget` catches a mob that holds aggro while refusing to travel, which
 * is exactly the camp-dweller the ban exists for. Measuring instead lets the mob
 * answer with its feet: closing on the cat is what a mob in a fight does, and a
 * mob sitting out past a detour never will.
 */
interface TargetBan {
  framesLeft: number;
  /**
   * Cat-distance at which the ban lifts early, in pixels. Negative for a ban
   * that only ever expires — there is no route to that mob, so it walking closer
   * would just restart the grinding this recorded.
   */
  liftAtCatDistance: number;
  /**
   * Whether a mob attacking the owner has already spent its one free attempt at
   * this ban, and must now serve the full term like anything else.
   *
   * A ban is a claim that he cannot get to something, and a mob that has walked
   * to the cat has disproved the version of that claim which said "it is over
   * there". So the top tier is allowed through — see {@link isValidTarget} — but
   * exactly once, and this is what makes "once" true. Ungated, the exemption and
   * the ban feed each other every single frame: he re-acquires the mob, the
   * search fails, {@link abandonUnreachable} bans it again, and the next frame
   * the exemption deletes the fresh ban. That is a full A* search per frame for
   * as long as the mob lives, and worse than the cost, it pins him inside
   * {@link engage} — where the homeward watchdog does not run, because walking
   * away from the cat is what engaging *is*. A raptor laps there with no route to
   * the mob and no route to a rescue, which is the vanish again wearing a
   * different hat.
   */
  refusesPartyThreatLift: boolean;
}

interface PendingBlow {
  readonly attack: MongoAttack;
  readonly target: Mob;
  framesLeft: number;
}

export class Mongo extends Mob {
  readonly xpValue = 0; // ally — no XP on death
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName = 'Mongo';
  description = 'A loyal blue velociraptor with pink feathers.';
  override readonly audioTag = 'mongo';

  /** The cat player who owns this summon. */
  owner: Player;
  /** All mobs in the scene — set each frame by `MongoSystem`. */
  allMobs: Mob[] = [];

  /**
   * Damage he has landed that has not been paid out as ability XP yet.
   *
   * Banked here rather than granted per blow because a juvenile's bite is worth
   * a fraction of a point: rounded down every hit pays nothing, rounded up it
   * pays him more for a nibble than the rate says. `MongoSystem` drains it.
   */
  damageDealtPendingXp = 0;

  /** Pet ability level, 1–15. Drives every stat and which sheet he is drawn from. */
  private petLevel: number;
  private stats: MongoStats;

  private readonly animator = new MongoAnimator();
  private pending: PendingBlow | null = null;

  /**
   * Which blow raised `attackSoundPending`. All three of his attacks share that
   * one flag, and a chomp is not the sound a claw makes — `playMobAudioCues`
   * reads this to tell them apart.
   */
  lastAttack: MongoAttack = 'bite';
  private biteCooldown = 0;
  private slashCooldown = 0;
  private pounceCooldown = 0;
  /** Where the pounce was aimed, so the lunge keeps its line if the target moves. */
  private pounceAimX = 0;
  private pounceAimY = 0;

  /** Where he stood last frame, for measuring the ground his gait is paced by. */
  private gaitSampleX = 0;
  private gaitSampleY = 0;

  /** True while he is heading home because he outran his leash. Latched — see the band above. */
  private leashed = false;
  /** True while he is closing a gap the cat opened. Latched — see the follow band above. */
  private following = false;
  /**
   * The mob he is currently fighting.
   *
   * Held across frames rather than re-chosen from scratch, because "nearest" is
   * a quantity that changes hands between two mobs a pixel apart and re-picking
   * it every frame swaps his goal tile back and forth faster than a path can be
   * walked.
   */
  private target: Mob | null = null;
  /**
   * Mobs he may not pick right now.
   *
   * Two reasons land here. A* failing means `followTargetAStar` degrades to a
   * straight-line walk, so a mob sealed behind a wall does not read as
   * "unreachable" — it reads as Mongo grinding into the masonry between them.
   * And a mob that snapped his leash is one he cannot have without leaving the
   * cat, so it has to stop being the answer for long enough to get home.
   * Everything expires: doors open, walls come down, and the cat moves the whole
   * frame of reference.
   */
  private readonly offLimits = new Map<Mob, TargetBan>();
  /**
   * What the cached A* route was last computed toward.
   *
   * `astarSearchFailed` describes whichever goal the last search used, and a
   * failure suppresses re-searching for a couple of seconds — so a route to the
   * cat that came back empty is still the answer on the books when he next asks
   * about a mob, and he blacklists an enemy he could have walked to. Switching
   * goals throws the stale verdict away with the stale path.
   */
  private navigationGoal: 'cat' | 'target' | null = null;
  /**
   * Consecutive frames spent chasing a target while getting nowhere.
   *
   * A target that has broken line of sight leaves his A* goal parked on its last
   * known position, which is a perfectly routable tile — the search *succeeds*,
   * he walks to it, and stops. Nothing about that is a pathfinding failure, so
   * the failure check never fires, and he stands at a wall with an enemy behind
   * it for as long as both of them live.
   */
  private engageStallFrames = 0;
  /**
   * Consecutive frames of walking toward the cat without getting closer to her.
   *
   * Separate from {@link engageStallFrames} because the two mean opposite
   * things. A chase that stalls is abandoned — there are other mobs. A walk home
   * that stalls cannot be abandoned; there is only the one cat, and giving up on
   * reaching her is the vanish this whole counter exists to end.
   */
  private homeStallFrames = 0;

  /**
   * Set when he cannot reach the cat by walking; {@link MongoSystem} teleports
   * him.
   *
   * He never moves himself by fiat. Deciding *that* he is stuck needs the
   * navigation state only he holds, and executing the rescue needs the map and
   * the mob grid only the system holds, so the two halves live where their
   * information is and this flag is the seam.
   */
  needsRescue = false;

  /**
   * Damage the resistance has softened away but not yet charged, in fractions of
   * a hit point. See {@link soften}.
   *
   * Approximate across a dodge or an absorbed blow — the balance is added to
   * before the base class decides whether the hit landed at all — which is worth
   * a sentence only to say it does not matter: the drift is under a hit point and
   * it falls in the pet's favour.
   */
  private softenedDamageOwed = 0;

  /**
   * Frames the current run home has been going, for the forced rescue.
   *
   * A double-tap of the recall key is an ordinary input, and without this the
   * second press snapped him to the cat's feet and completed the despawn — which
   * deletes the run home, and the run home is the thing that makes a recall read
   * as a pet coming back rather than as a toggle being flipped.
   */
  private recallFrames = 0;

  /**
   * Every mob this frame's scan let past its ban for attacking the owner.
   *
   * A set rather than "the last one", so the bookkeeping is right by inspection
   * instead of by argument: a scan can exempt more than one candidate, and
   * recording only the most recent quietly forgets an attempt that was spent on
   * a mob the scan did not end up choosing. That is exactly the shape of
   * near-miss that turned the previous version of this exemption into a
   * per-frame A* lap. Cleared and refilled by every {@link pickTarget}; on the
   * frames that skips — leashed, wounded, recalling, collapsing — it is stale and
   * unread, because `abandonUnreachable` is unreachable from all of them.
   */
  private readonly partyThreatExemptionsUsed = new Set<Mob>();

  /** True once he has run out of HP — the state `MongoSystem` writes back as zero. */
  exhausted = false;
  /** True while the collapse one-shot plays, before the recall run begins. */
  collapsing = false;
  /** When true, he is running back to the cat before despawning. */
  recalling = false;
  /** Set when the recall run has reached the cat; the system then fades him out. */
  recallArrived = false;
  /** Counts down through the despawn fade once the recall has arrived. */
  fadeFrames = 0;

  constructor(
    tileX: number,
    tileY: number,
    tileSize: number,
    owner: Player,
    level: number,
    startingHp: number,
  ) {
    const stats = getMongoStats(level);
    super(tileX, tileY, tileSize, stats.maxHp, stats.speed);
    this.owner = owner;
    // Kill credit and XP belong to the cat who sent him in, even though the
    // blows land in his own name so mobs fight back against *him*.
    this.creditTarget = owner;
    this.petLevel = level;
    this.stats = stats;
    this.hp = Math.max(1, Math.min(stats.maxHp, Math.round(startingHp)));
    this.gaitSampleX = this.x;
    this.gaitSampleY = this.y;
  }

  /** Mongo is an ally — never hostile to players. */
  override get isHostile(): boolean {
    return false;
  }

  /**
   * He ticks wherever he is. A summon frozen for being far from the party is a
   * summon that can never stop being far from the party — see the base getter.
   */
  override get exemptFromAiActivationRadius(): boolean {
    return true;
  }

  /**
   * The wound he actually takes; see {@link MONGO_DAMAGE_TAKEN_MULTIPLIER}.
   *
   * Applied in *both* damage entry points below, because they are genuinely two
   * doors rather than one wrapping the other: `takeDamage` is what a mob swinging
   * at a player-like target calls, `takeDamageFrom` is what a mob swinging at
   * another *mob* calls — the golem's boulders and the Ball of Swine's charge go
   * through the second — and it writes hp itself rather than delegating. Softened
   * in one place only, half the things on the floor would ignore the resistance
   * entirely, which is exactly the sort of gap that reads as random difficulty.
   * Because neither method calls the other, softening both cannot double-apply.
   *
   * Kept as a running ledger rather than rounded per blow, and that is not
   * fussiness — rounding gave the resistance a rate that depended on the size of
   * the hit, and gave it *no effect at all* on the one damage class he cannot
   * walk away from. Every damage-over-time tick in the game is one point, and one
   * point softened and rounded is still one point: burn, poison, sepsis and the
   * rest landed at full strength on the animal who cannot kite and cannot heal in
   * the field. Charging whole points off an accumulated balance makes a run of
   * ticks cost 0.6 each on average, which is what the multiplier says.
   *
   * The balance is bounded on the credit side, and that bound is the whole
   * safety of the scheme. A blow forced up to {@link MIN_DAMAGE_TAKEN} bills the
   * difference back to the ledger, and unbounded that is a sink: a stream of
   * one-point hits pushes the balance 0.4 further negative every time, so the
   * resistance stops applying to them *and* the accumulated credit is later
   * spent as flat immunity — measured at seventy-six free hit points after two
   * hundred ticks of a shell edge, which is a damage shield rather than a
   * resistance. Clamped, the most the ledger can ever owe or be owed is one hit
   * point in either direction.
   *
   * @param mayLandForNothing whether the blow is allowed to charge zero. True
   *   wherever nothing reads a "did not connect" answer — every status tick, and
   *   `takeDamageFrom`, which returns nothing at all. False only for a blow
   *   arriving through `takeDamage`, where returning false means "missed" and
   *   attackers use it to hold back the status riders they swing alongside.
   */
  private soften(amount: number, mayLandForNothing: boolean): number {
    if (amount <= 0) return amount;
    this.softenedDamageOwed += amount * MONGO_DAMAGE_TAKEN_MULTIPLIER;
    let charged = Math.max(0, Math.floor(this.softenedDamageOwed));
    if (charged < MIN_DAMAGE_TAKEN && !mayLandForNothing) charged = MIN_DAMAGE_TAKEN;
    this.softenedDamageOwed = Math.max(-MAX_SOFTENING_CREDIT, this.softenedDamageOwed - charged);
    return charged;
  }

  override takeDamage(amount: number, source?: DamageSource): boolean {
    const isStatusTick = source?.kind === 'status';
    return super.takeDamage(this.soften(amount, isStatusTick), source);
  }

  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: 'melee' | 'missile' | 'shell' | 'smush' | null = 'melee',
  ): void {
    // Free to charge nothing: this door returns void, so no caller is waiting to
    // be told whether the blow connected. A one-point mob-on-mob tick — the
    // shell edge, a thorn — is therefore genuinely resisted rather than forced
    // up to a full point forty per cent of the time.
    super.takeDamageFrom(this.soften(amount, true), attacker, damageType);
  }

  /**
   * The cat's own Scroll of Confusing Fog does not apply to her pet.
   *
   * `SpellSystem` fogs every mob in the radius with no hostility filter, and a
   * confused mob has its whole `updateAI` replaced with `doWander()`. For Mongo
   * that stops the animator, the pending blow, the pounce lunge and the recall —
   * so a pet caught in his owner's fog while retreating stands in the fight at
   * the one hit point the interception pins him to, unable to leave and unable
   * to be re-summoned, until the fog expires.
   */
  override immuneToConfusion = true;

  /** No loot — he is a pet, not an encounter. */
  protected override rollLootItems(): LootDrop['items'] {
    return [];
  }

  /**
   * His pet-ability level. Not called `level`: `Player.level` is the crawler XP
   * level every entity in the game already has, and shadowing it with an
   * accessor is both a compile error and a genuinely different number.
   */
  get growthLevel(): number {
    return this.petLevel;
  }

  get currentStats(): MongoStats {
    return this.stats;
  }

  /**
   * Grow him on the spot when the pet ability levels while he is out.
   *
   * HP keeps its *fraction* across the change, so levelling can never hurt: a
   * raptor at half health comes out of a growth spurt at half of a bigger
   * number. `setFixedMaxHp` would otherwise credit the delta one-for-one, which
   * is a different (kinder) rule — the fraction is the one the design specifies,
   * and the two paths, summoned and stored, have to agree on which it is.
   */
  applyLevel(level: number): void {
    if (level === this.petLevel) return;
    const fraction = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    this.petLevel = level;
    this.stats = getMongoStats(level);
    this.setFixedMaxHp(this.stats.maxHp);
    this.speed = this.stats.speed;
    this.hp = Math.max(1, Math.min(this.maxHp, Math.ceil(fraction * this.maxHp)));
    // The growth spurt has to be *seen*. The damage flash is already a
    // full-brightness pulse over whatever the sprite draws, and the sheet
    // swapping under it on the same frame is what sells the change.
    this.damageFlash = GROWTH_FLASH_FRAMES;
  }

  /** Begin the collapse one-shot; the recall run starts when it finishes. */
  beginCollapse(): void {
    if (this.collapsing || this.recalling) return;
    this.exhausted = true;
    this.collapsing = true;
    this.pending = null;
    this.target = null;
    this.engageStallFrames = 0;
    this.homeStallFrames = 0;
    // A stall latched on the very frame he was beaten to zero must not survive
    // the collapse. The rescue is suppressed *during* it, so left set it fires on
    // frame one of the run home — snapping him to the cat's feet and completing
    // the despawn instead of letting him limp back, which is the one moment the
    // limp is the whole point. `runHome` re-latches it in a couple of seconds if
    // he genuinely cannot get there.
    this.needsRescue = false;
    this.isMoving = false;
    this.animator.play('collapse');
  }

  /** Start the run back to the cat. */
  beginRecall(): void {
    if (this.recalling) return;
    this.collapsing = false;
    this.recalling = true;
    this.pending = null;
    this.target = null;
    this.engageStallFrames = 0;
    // The run home is a fresh walk and gets a fresh allowance: a pet who stalled
    // his way into the recall should not be teleported on its first frame.
    this.homeStallFrames = 0;
    this.recallFrames = 0;
    this.needsRescue = false;
    this.animator.cancel();
    this.clearAStarPath();
  }

  /**
   * AI. The `targets` argument is ignored — he builds his own target list from
   * `allMobs`, because everything he cares about is a mob rather than a player.
   */
  updateAI(_targets: Player[]): void {
    if (!this.isAlive) return;

    this.syncGaitToDistanceCovered();

    if (this.biteCooldown > 0) this.biteCooldown--;
    if (this.slashCooldown > 0) this.slashCooldown--;
    if (this.pounceCooldown > 0) this.pounceCooldown--;
    this.animator.tick();
    this.resolvePendingBlow();
    this.advancePounceLunge();

    if (this.recallArrived) {
      this.isMoving = false;
      if (this.fadeFrames > 0) this.fadeFrames--;
      return;
    }

    if (this.collapsing) {
      this.isMoving = false;
      if (!this.animator.isPlaying) this.beginRecall();
      return;
    }

    if (this.recalling) {
      this.runHome();
      return;
    }

    this.expireOffLimits();

    // The leash is evaluated before the target list, not alongside it: no mob is
    // ever a reason to be further from the cat than this.
    const distToCat = Math.hypot(this.x - this.owner.x, this.y - this.owner.y);
    if (distToCat > TILE_SIZE * LEASH_BREAK_TILES) this.breakLeash();
    else if (distToCat < TILE_SIZE * LEASH_RESUME_TILES) this.leashed = false;

    if (this.isTooWoundedToFight) this.disengageWounded();
    const holdingBack = this.leashed || this.isTooWoundedToFight;
    const target = holdingBack ? null : this.pickTarget();
    if (target === null) {
      this.standBy(distToCat);
      return;
    }

    this.following = false;
    this.engage(target);
  }

  /**
   * Whether he has taken enough that he stops picking fights and sticks to the
   * cat — see {@link MONGO_WOUNDED_RETREAT}.
   */
  private get isTooWoundedToFight(): boolean {
    if (MONGO_WOUNDED_RETREAT === 'off') return false;
    return this.maxHp > 0 && this.hp <= this.maxHp * MONGO_RETREAT_HP_FRACTION;
  }

  /**
   * Drops the fight he was in on the frame the wound threshold is crossed.
   *
   * Without this the target is merely never re-picked: `pickTarget` is skipped,
   * so the mob he held stays in the field and the cached route to it stays on
   * the books, and the first frame he heals back over the line he resumes a
   * chase the player thought he had broken off.
   */
  private disengageWounded(): void {
    if (this.target === null) return;
    this.target = null;
    this.engageStallFrames = 0;
    this.clearAStarPath();
  }

  /**
   * The player asking, by pressing recall at a pet who is already recalling, for
   * him to be brought home now.
   *
   * Honoured only once the run home has had time to *be* a run home. The press
   * means "he is not coming", and that is not a claim a player can have formed
   * in the two frames a double-tap takes — see {@link recallFrames}. A pet who
   * has already decided for himself that he is stuck is answered immediately.
   */
  requestRescue(): void {
    if (!this.acceptsRescueRequest) return;
    this.needsRescue = true;
  }

  /**
   * Whether asking would do anything — so the button can grey itself out rather
   * than look live and swallow the press.
   *
   * The same rule `collapsing` is excluded by: a control that answers nothing
   * for a second and a half reads as a dropped input, and the fix for that is to
   * stop claiming to be live, not to shorten the window.
   */
  get acceptsRescueRequest(): boolean {
    if (!this.recalling || this.recallArrived) return false;
    return this.recallFrames >= RECALL_RESCUE_GRACE_FRAMES;
  }

  /**
   * Accept a teleport home: forget the walk that failed.
   *
   * Every piece of state undone here is private to him — the cached route and
   * its verdict, the stall counters, the mob he was walking at, the latches that
   * remember he was mid-return. The system does the moving and cannot reach any
   * of it, and a rescued raptor still holding a route to the corner he was stuck
   * in walks straight back into it.
   */
  onRescued(): void {
    this.needsRescue = false;
    this.homeStallFrames = 0;
    this.engageStallFrames = 0;
    this.target = null;
    this.navigationGoal = null;
    this.leashed = false;
    this.following = false;
    this.clearAStarPath();
    // The gait is paced by ground covered, and the jump is not ground he walked.
    // Left unsampled it reads back as many times his own speed on the landing
    // frame, which is the undersampled strobe `syncGaitToDistanceCovered` exists
    // to keep him out of.
    this.gaitSampleX = this.x;
    this.gaitSampleY = this.y;
  }

  /**
   * Snap the leash: come home, and *let go of the fight that pulled him out*.
   *
   * Dropping the target is what makes the band a band. The persist radius is
   * measured cat-to-mob in a straight line while the leash is measured
   * cat-to-Mongo along the route he actually walks, so a mob 6 tiles away around
   * a pillar can put him at 8 — held, that target is still legal the moment he
   * gets home, and he turns straight back around into the same lap forever.
   * Re-acquiring has to start from scratch, against the tighter engage radius.
   */
  private breakLeash(): void {
    if (this.leashed) return;
    this.leashed = true;
    const dropped = this.target;
    if (dropped !== null) {
      // Held off until it has closed on the cat by a tile, or the timer runs out.
      // A break says only that the gap opened, and the player is the faster
      // mover — so the ordinary cause is her backing out of a fight, and holding
      // off the mob currently biting the party would leave the pet standing
      // beside them doing nothing. One that is chasing clears the bar within a
      // few frames; one sitting out past a detour never does.
      this.offLimits.set(dropped, {
        framesLeft: LEASH_BREAK_FORGET_FRAMES,
        liftAtCatDistance: Math.max(
          TILE_SIZE * LEASH_BAN_LIFT_MIN_TILES,
          this.catDistanceTo(dropped) - TILE_SIZE * LEASH_BAN_LIFT_APPROACH_TILES,
        ),
        // Nothing is wrong with this mob — he simply cannot have it and stay with
        // the cat — so if it comes to her he should absolutely take it again.
        refusesPartyThreatLift: false,
      });
    }
    this.target = null;
    this.engageStallFrames = 0;
    this.clearAStarPath();
  }

  /**
   * The mob he should be fighting, or null to fall back on following the cat.
   *
   * Keeps the one he already has while it is alive and still inside the persist
   * band, and only otherwise goes looking. New quarry has to be *visible* to
   * him: without that gate he picks the nearest mob in the bubble whether or not
   * anything connects the two tiles, which puts him at a wall with his nose to
   * an enemy nobody can see, ignoring the one around the corner.
   */
  private pickTarget(): Mob | null {
    // Cleared here and refilled during this frame's scan, so `abandonUnreachable`
    // — which runs later in the same frame, out of `engage` — reads a fresh
    // answer and never a stale mob reference.
    this.partyThreatExemptionsUsed.clear();
    const held = this.target;
    const heldRank = held === null ? PRIORITY_NONE : this.rankOf(held);
    if (held !== null && this.isValidTarget(held, ENGAGE_PERSIST_TILES, heldRank)) {
      // Held targets are kept — see the field comment on `target` — with exactly
      // one thing allowed to break the hold: something has started on the cat.
      // Peeling him off a rat to answer that is the entire promise of "he
      // defends the party first", and a hold that outranked it would mean the
      // promise only applied to a pet who happened to be idle.
      if (heldRank >= PRIORITY_PARTY_THREAT) return held;
      const threat = this.nearestPartyThreat();
      if (threat === null) return held;
      return this.commitToTarget(threat, held);
    }

    let best: Mob | null = null;
    let bestRank = PRIORITY_NONE;
    let bestDist = Infinity;
    for (const mob of this.allMobs) {
      // Ranked before it is validated, because the rank is one of the inputs to
      // whether it is valid: a mob fighting the owner is exempt from the
      // unreachable-route ban. Two field reads, so this costs nothing.
      const rank = this.rankOf(mob);
      if (rank < bestRank) continue;
      if (!this.isValidTarget(mob, ENGAGE_RADIUS_TILES, rank)) continue;
      const distance = Math.hypot(mob.x - this.x, mob.y - this.y);
      if (rank === bestRank && distance >= bestDist) continue;
      // Last, because it is the only expensive test here.
      if (!this.canNoticeCandidate(mob, rank)) continue;
      bestRank = rank;
      bestDist = distance;
      best = mob;
    }

    return this.commitToTarget(best, held);
  }

  /** Which tier `mob` falls into; see the `PRIORITY_*` constants. */
  private rankOf(mob: Mob): number {
    if (mob.currentTarget === this.owner) return PRIORITY_PARTY_THREAT;
    if (mob.wasRecentlyHurtBy(this.owner)) return PRIORITY_OWNER_QUARRY;
    return PRIORITY_NEAREST;
  }

  /**
   * The nearest mob that is currently fighting the cat, or null.
   *
   * No sight test, on purpose and cheaply: a mob whose target is the owner is
   * top tier, and top tier is exempt from the perception gate anyway — see
   * {@link canNoticeCandidate}. That is what makes this affordable to run every
   * frame while he already has a target.
   */
  private nearestPartyThreat(): Mob | null {
    let nearest: Mob | null = null;
    let nearestDist = Infinity;
    for (const mob of this.allMobs) {
      if (mob.currentTarget !== this.owner) continue;
      if (!this.isValidTarget(mob, ENGAGE_RADIUS_TILES, PRIORITY_PARTY_THREAT)) continue;
      const distance = Math.hypot(mob.x - this.x, mob.y - this.y);
      if (distance >= nearestDist) continue;
      nearestDist = distance;
      nearest = mob;
    }
    return nearest;
  }

  /**
   * The perception gate on new quarry, lifted for a mob already in a fight with
   * his owner.
   *
   * Sight is the right gate for picking a fight — without it he walks to a wall
   * with his nose to an enemy nobody can see. It is the wrong gate for answering
   * one: the cat being bitten through a doorway is a thing he is told about by
   * her, not something he has to see for himself, and this is the same exemption
   * `canNotice` already makes for a mob that has hurt *him*.
   */
  private canNoticeCandidate(mob: Mob, rank: number): boolean {
    if (rank >= PRIORITY_PARTY_THREAT) return true;
    return this.canNotice(mob);
  }

  /** Adopts `chosen`, resetting the per-target state `held` left behind. */
  private commitToTarget(chosen: Mob | null, held: Mob | null): Mob | null {
    if (chosen !== held) {
      // The cached route leads to the mob he just gave up on; walking it while
      // steering at a new one is the "chasing two things at once" stagger.
      this.clearAStarPath();
      this.engageStallFrames = 0;
      if (chosen !== null) {
        this.lastKnownTargetX = chosen.x;
        this.lastKnownTargetY = chosen.y;
      }
    }
    this.target = chosen;
    return chosen;
  }

  /**
   * Whether `mob` is something he may fight, from within `radiusTiles` of the
   * cat.
   *
   * `rank` is an input rather than decoration: a mob fighting the owner clears
   * the hold-off list outright. Both bans are claims that stop being true the
   * moment a mob closes on the cat, and one of them cannot say so by itself — a
   * leash-break ban lifts on cat-distance and a mob standing on her satisfies
   * that, but {@link abandonUnreachable} sets `liftAtCatDistance` to a value no
   * distance can ever satisfy, so it always runs its full term. Without this the
   * top tier's whole promise fails in the commonest case it exists for: he
   * cannot route to a mob across a diagonal gap and bans it, the mob then walks
   * over and starts biting the cat, and he stands at her shoulder for three
   * seconds refusing to peel it — on the strength of a routing verdict the mob
   * has just disproved with its feet.
   *
   * The exemption is spent once per ban, not granted afresh every frame; see
   * {@link TargetBan.refusesPartyThreatLift} for what that costs when it is not.
   */
  private isValidTarget(mob: Mob, radiusTiles: number, rank = PRIORITY_NEAREST): boolean {
    if (mob === this || !mob.isAlive || !mob.isPetAttackable) return false;
    const fromCat = this.catDistanceTo(mob);
    const ban = this.offLimits.get(mob);
    if (ban !== undefined) {
      const exempt = rank >= PRIORITY_PARTY_THREAT && !ban.refusesPartyThreatLift;
      const banHolds = !exempt && fromCat > ban.liftAtCatDistance;
      if (banHolds) return false;
      if (exempt) this.partyThreatExemptionsUsed.add(mob);
      this.offLimits.delete(mob);
    }
    return fromCat <= TILE_SIZE * radiusTiles;
  }

  /** Centre-to-centre distance from the cat to `mob`, in pixels. */
  private catDistanceTo(mob: Mob): number {
    const catCx = this.owner.x + TILE_SIZE * CENTER_OFFSET;
    const catCy = this.owner.y + TILE_SIZE * CENTER_OFFSET;
    return Math.hypot(
      mob.x + TILE_SIZE * CENTER_OFFSET - catCx,
      mob.y + TILE_SIZE * CENTER_OFFSET - catCy,
    );
  }

  private expireOffLimits(): void {
    for (const [mob, ban] of this.offLimits) {
      if (ban.framesLeft <= 1 || !mob.isAlive) this.offLimits.delete(mob);
      else ban.framesLeft--;
    }
  }

  /** Gives up on a target he cannot get to, so the next frame picks another. */
  private abandonUnreachable(target: Mob): void {
    this.offLimits.set(target, {
      framesLeft: NO_ROUTE_FORGET_FRAMES,
      liftAtCatDistance: NO_EARLY_LIFT,
      // Only if the exemption is what let him try in the first place. Keyed on
      // the exemption having actually been *used* rather than on the target's
      // rank, because those are not the same test and the difference is the
      // whole feature: a mob banned for the first time has no prior ban for the
      // exemption to have lifted, so ranking on it would mark every party threat
      // as having spent an attempt it was never granted — and he would refuse to
      // peel the mob biting his owner for the full ban, which is the behaviour
      // the exemption exists to prevent.
      refusesPartyThreatLift: this.partyThreatExemptionsUsed.has(target),
    });
    this.target = null;
    this.engageStallFrames = 0;
    this.clearAStarPath();
    this.isMoving = false;
  }

  /**
   * Nothing to fight: close the gap to the cat if it has opened, otherwise stand
   * at ease.
   *
   * Deliberately not `doWander`, which drifts back toward the *spawn* tile — for
   * a pet that has followed the cat across the floor, that is a constant tug
   * away from the player.
   */
  private standBy(distToCat: number): void {
    if (distToCat > TILE_SIZE * RETURN_THRESHOLD_TILES) this.following = true;
    else if (distToCat <= TILE_SIZE * RETURN_STOP_TILES) this.following = false;

    if (!this.following) {
      this.homeStallFrames = 0;
      this.isMoving = false;
      if (!this.animator.isPlaying) this.faceToward(this.owner);
      return;
    }

    // Not while a blow is playing. The commonest way to end up here is his own
    // bite killing the thing he was biting, and walking off mid-swing slides a
    // raptor across the floor with his jaws still closing on empty air.
    if (this.animator.isPlaying) {
      // Standing through his own swing is not a stall — he chose it.
      this.homeStallFrames = 0;
      this.isMoving = false;
      return;
    }

    this.setNavigationGoal('cat');
    const preX = this.x;
    const preY = this.y;
    this.followTargetAStar(this.owner.x, this.owner.y, this.speed, TILE_SIZE * RETURN_STOP_TILES);
    this.trackHomewardWalk(Math.hypot(this.x - preX, this.y - preY), distToCat);
  }

  /**
   * Records one frame of walking toward the cat, and latches
   * {@link needsRescue} when the walk is never going to arrive.
   *
   * Shared by the follow walk and the recall run, because both fail the same
   * way: geometry between him and the cat that A* cannot route around — a sealed
   * boss door, a one-tile pocket, a diagonal gap — after which
   * `followTargetAStar` degrades to pressing straight into it.
   *
   * A frame is lost when he covered no ground *or* when the last search for a
   * route home came back empty; it counts as progress only when he has a route
   * and is moving along it. Pixels rather than `isMoving`, which
   * `followTargetCollide` sets true on the branch where neither the direct step
   * nor the unstick moved him at all.
   *
   * Falling behind on open ground is deliberately *not* a stall — he has a route
   * and he is walking it, he is simply slower than the cat. Counting it would
   * teleport a juvenile to her heels every couple of seconds for the crime of
   * having short legs. {@link RESCUE_DISTANCE_TILES} is what catches that case,
   * at a distance the player will read as the pet catching up.
   */
  private trackHomewardWalk(coveredPx: number, distToCat: number): void {
    const wentNowhere = coveredPx <= MOVEMENT_PROGRESS_EPSILON_PX;
    if (wentNowhere || this.astarSearchFailed) this.homeStallFrames++;
    else this.homeStallFrames = 0;

    const strandedFarFromCat = distToCat > TILE_SIZE * RESCUE_DISTANCE_TILES;
    if (this.homeStallFrames > HOME_STALL_LIMIT_FRAMES || strandedFarFromCat) {
      this.needsRescue = true;
    }
  }

  /** Throws away the cached route, and its verdict, when he changes his mind about where he is going. */
  private setNavigationGoal(goal: 'cat' | 'target'): void {
    if (this.navigationGoal === goal) return;
    this.navigationGoal = goal;
    this.clearAStarPath();
  }

  private runHome(): void {
    this.recallFrames++;
    this.setNavigationGoal('cat');
    const distance = Math.hypot(this.owner.x - this.x, this.owner.y - this.y);
    if (distance < TILE_SIZE * RECALL_ARRIVE_TILES) {
      this.isMoving = false;
      this.recallArrived = true;
      this.fadeFrames = MONGO_FADE_FRAMES;
      return;
    }
    const speed = this.speed * RECALL_SPEED_MULTIPLIER;
    const preX = this.x;
    const preY = this.y;
    this.followTargetAStar(this.owner.x, this.owner.y, speed, TILE_SIZE * RECALL_STOP_TILES);
    this.trackHomewardWalk(Math.hypot(this.x - preX, this.y - preY), distance);
  }

  private engage(target: Mob): void {
    const distance = Math.hypot(target.x - this.x, target.y - this.y);
    const attack = this.chooseAttack(distance, target);

    if (attack === 'pounce') {
      this.beginAttack('pounce', target);
      return;
    }

    const biteRangePx = TILE_SIZE * BITE_RANGE_TILES;
    if (distance > biteRangePx && !this.animator.isPlaying) {
      this.setNavigationGoal('target');
      this.updateLastKnown(target);
      const preX = this.x;
      const preY = this.y;
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        biteRangePx * FOLLOW_STOP_RANGE_RATIO,
      );
      // Measured in pixels actually covered, not from `isMoving` — which
      // `followTargetCollide` sets true even on the branch where both the direct
      // step and the perpendicular unstick moved him nothing. Reading the flag
      // catches a raptor parked on a stale last-known position but not one
      // grinding against geometry A* was willing to route him through, and the
      // second is the wall-walking the player reported.
      const covered = Math.hypot(this.x - preX, this.y - preY);
      if (covered > MOVEMENT_PROGRESS_EPSILON_PX) this.engageStallFrames = 0;
      else this.engageStallFrames++;
      if (this.astarSearchFailed || this.engageStallFrames > ENGAGE_STALL_LIMIT_FRAMES) {
        this.abandonUnreachable(target);
        return;
      }
    } else {
      this.isMoving = false;
      // Inside reach and unable to see him is a real stall, and it is the one
      // the chase branch's counter cannot see. The reach test is a straight line
      // that ignores walls while the attack gate is sight, so the two disagree
      // across a corner: close enough not to walk, too blind to bite. Zeroing
      // the counter here — as "he is in position" implies — left him nose to the
      // masonry forever, because the persist band keeps handing him the target.
      const inReachButBlind = attack === null && !this.hasLOS(target);
      if (inReachButBlind) this.engageStallFrames++;
      else this.engageStallFrames = 0;
      if (this.engageStallFrames > ENGAGE_STALL_LIMIT_FRAMES) {
        this.abandonUnreachable(target);
        return;
      }
    }

    // Held still mid-swing: an arc that flips direction halfway through reads as
    // the sprite glitching rather than as the raptor turning.
    if (!this.animator.isPlaying) this.faceToward(target);
    if (attack !== null) this.beginAttack(attack, target);
  }

  /**
   * Which blow to throw, if any. Longest-reaching option first, so the pounce is
   * taken while the gap is still worth closing and the rake beats the bite at
   * the range only it can make.
   */
  private chooseAttack(distance: number, target: Mob): MongoAttack | null {
    if (this.animator.isPlaying) return null;
    const tiles = distance / TILE_SIZE;
    // Every blow needs sight, not just distance. The leap aimed through a wall
    // plays its whole airborne window against the masonry; a target a tile away
    // round a corner is inside both melee reaches, and on a frame where the
    // pathfinding budget denied his search there is nothing else left to notice
    // the wall between them.
    if (!this.hasLOS(target)) return null;
    if (
      this.stats.pounceUnlocked &&
      this.pounceCooldown === 0 &&
      tiles >= POUNCE_MIN_TILES &&
      tiles <= POUNCE_MAX_TILES
    ) {
      return 'pounce';
    }
    if (
      this.stats.slashUnlocked &&
      this.slashCooldown === 0 &&
      tiles <= SLASH_RANGE_TILES * ATTACK_TRIGGER_RANGE_RATIO
    ) {
      return 'slash';
    }
    if (this.biteCooldown === 0 && tiles <= BITE_RANGE_TILES * ATTACK_TRIGGER_RANGE_RATIO) {
      return 'bite';
    }
    return null;
  }

  private beginAttack(attack: MongoAttack, target: Mob): void {
    this.faceToward(target);
    this.animator.play(attack);
    this.isMoving = false;
    if (attack === 'bite') {
      this.biteCooldown = BITE_COOLDOWN_FRAMES;
      this.pending = {
        attack,
        target,
        framesLeft: mongoImpactFrame(MONGO_BITE_FRAMES, MONGO_BITE_IMPACT_PROGRESS),
      };
      return;
    }
    if (attack === 'slash') {
      this.slashCooldown = SLASH_COOLDOWN_FRAMES;
      this.pending = {
        attack,
        target,
        framesLeft: mongoImpactFrame(MONGO_SLASH_FRAMES, MONGO_SLASH_IMPACT_PROGRESS),
      };
      return;
    }
    this.pounceCooldown = POUNCE_COOLDOWN_FRAMES;
    this.pounceAimX = target.x;
    this.pounceAimY = target.y;
    this.pending = {
      attack,
      target,
      framesLeft: mongoImpactFrame(MONGO_POUNCE_FRAMES, MONGO_POUNCE_IMPACT_PROGRESS),
    };
  }

  /**
   * Carries him through the air on a pounce.
   *
   * Runs over exactly the window `mongoAttackTiming` declares airborne, so the
   * frames where his feet are off the ground in the art are the frames he is
   * actually travelling in the world.
   */
  private advancePounceLunge(): void {
    if (this.animator.currentAction !== 'pounce') return;
    const progress = this.animator.progress;
    if (progress < MONGO_POUNCE_AIRBORNE_START || progress > MONGO_POUNCE_AIRBORNE_END) return;
    const dx = this.pounceAimX - this.x;
    const dy = this.pounceAimY - this.y;
    const distance = Math.hypot(dx, dy);
    if (distance < TILE_SIZE * POUNCE_LANDING_RANGE_TILES) return;
    const speed = this.speed * POUNCE_LUNGE_SPEED_MULTIPLIER;
    const step = Math.min(speed, distance - TILE_SIZE * POUNCE_LANDING_RANGE_TILES);
    this.moveWithCollision((dx / distance) * step, (dy / distance) * step);
  }

  /** Lands the pending blow, re-checking range at the moment of contact. */
  private resolvePendingBlow(): void {
    const pending = this.pending;
    if (pending === null) return;
    pending.framesLeft--;
    if (pending.framesLeft > 0) return;
    this.pending = null;

    const { target, attack } = pending;
    if (!target.isAlive) return;
    const reachTiles =
      attack === 'bite'
        ? BITE_RANGE_TILES
        : attack === 'slash'
          ? SLASH_RANGE_TILES
          : POUNCE_LANDING_RANGE_TILES;
    const distance = Math.hypot(target.x - this.x, target.y - this.y);
    if (distance > TILE_SIZE * reachTiles * ATTACK_TRIGGER_RANGE_RATIO) return;

    const damage =
      attack === 'bite'
        ? this.stats.biteDamage
        : attack === 'slash'
          ? this.stats.slashDamage
          : this.stats.pounceDamage;
    // He attacks in his own name, so the victim's alert list records *him* and
    // it fights back against the raptor rather than the cat behind it. The XP
    // still reaches the cat through `xpCreditTarget`.
    // Measured off the victim rather than taken from `damage`, so overkill on a
    // mob with three hit points left is not paid for as a full bite.
    const targetHpBeforeBlow = target.hp;
    target.takeDamageFrom(damage, this, 'melee');
    this.damageDealtPendingXp += targetHpBeforeBlow - target.hp;
    target.retaliateMob = this;
    this.lastAttack = attack;
    this.attackSoundPending = true;
  }

  /**
   * Sets the leg cadence from the ground he actually covered last frame.
   *
   * Measured rather than intended, so it picks up everything that scales his
   * movement after `speed` is chosen — wading a river at 36%, a slow effect at
   * 35%, collision slides — none of which reading `this.speed` could see. A
   * raptor creeping through water with his legs going at full tilt is the same
   * class of error as the strobe, just pointed the other way.
   *
   * Still not true *stride* sync, and cannot be: the ratio is taken against his
   * listed speed rather than against the stride the art bakes, because that
   * stride is unreachable. A juvenile's leg is half a tile long, so his stride
   * is 0.31 tiles, and covering the 3.75 tiles a second his speed asks for
   * means twelve strides a
   * second — ninety-odd sprite frames out of an eight-frame row, on a display
   * that samples sixty times. The row is then undersampled rather than played:
   * frames skipped, legs jumping between non-adjacent poses, which is exactly
   * what made him look like he was vibrating. Nor can the art be redrawn around
   * it — a stride long enough to sync would step further than the leg extends,
   * and the reach gate rejects that. The mismatch is between his size and his
   * speed, and neither is negotiable. He skates; every character in this game
   * skates, and feet that slide read far better than a raptor that strobes.
   */
  private syncGaitToDistanceCovered(): void {
    const coveredPx = Math.hypot(this.x - this.gaitSampleX, this.y - this.gaitSampleY);
    this.gaitSampleX = this.x;
    this.gaitSampleY = this.y;
    const baseSpeed = this.stats.speed;
    const speedRatio = baseSpeed > 0 ? coveredPx / baseSpeed : 1;
    // Ceiling, because not everything that moves him is a stride. The cat leaning
    // on her pet shoves him three quarters of the overlap in one frame — nine
    // pixels against his own two — and unbounded that reads back as five times
    // his speed, which skips three frames of eight and is the strobe again,
    // reachable by standing next to him. Nothing he does under his own power
    // exceeds the recall sprint, so that is the bound.
    const framesPerTick = Math.min(
      MONGO_WALK_FRAMES_PER_TICK_AT_BASE_SPEED * speedRatio,
      MAX_WALK_FRAMES_PER_TICK,
    );
    this.walkFrameSpeed = (TWO_PI * framesPerTick) / MONGO_WALK_FRAMES;
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    if (!this.isAlive) return;
    const sx = this.x - camX;
    const sy = this.y - camY;

    ctx.save();
    if (this.damageFlash > 0) ctx.filter = 'brightness(3)';

    const action = this.animator.currentAction;
    drawMongoSprite(ctx, sx, sy, tileSize, {
      stage: this.stats.stage,
      walkFrame: this.walkFrame,
      isMoving: this.isMoving,
      facingX: this.facingX,
      facingY: this.facingY,
      action,
      actionProgress: this.animator.progress,
      alpha: this.fadeAlpha,
    });

    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    // Anchored on the sheet's own headroom rather than the tile: his art stands
    // well above the tile he occupies, and a bar at the default offset is drawn
    // across his back.
    this.renderMobHealthBar(ctx, sx, sy - tileSize * MONGO_HEAD_CLEARANCE_TILES[this.stats.stage]);
  }

  /** Fades out over the despawn once the recall run has landed. */
  private get fadeAlpha(): number {
    if (!this.recallArrived) return 1;
    return Math.max(0, this.fadeFrames / MONGO_FADE_FRAMES);
  }

  /** True once the fade has finished and the scene may remove him. */
  get despawnComplete(): boolean {
    return this.recallArrived && this.fadeFrames === 0;
  }

  /** Game frames the collapse one-shot runs for, for callers that need to wait it out. */
  static get collapseFrames(): number {
    return mongoActionDuration('collapse');
  }

  /**
   * The mob he is fighting right now, or null.
   *
   * Read-only and public purely so the target-priority rules are checkable from
   * outside: `scripts/verify-mongo.ts` asserts he peels the mob attacking his
   * owner rather than the nearer one, and which mob he chose is otherwise
   * invisible to anything but the eye.
   */
  get engagedTarget(): Mob | null {
    return this.target;
  }

  /** The one-shot currently playing, for the preview harness and for audio. */
  get currentAction(): MongoAction | null {
    return this.animator.currentAction;
  }
}
