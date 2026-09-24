import { Mob } from './Mob';
import type { LootDrop, PlayerDamageType } from './Mob';
import type { DamageSource, Player } from '../Player';
import { TILE_SIZE } from '../core/constants';
import { normalize } from '../utils';
import type { GolemRockThrow } from '../systems/RockThrowSystem';
import type { HirelingShot } from '../systems/HirelingBoltSystem';
import {
  getMercenaryTemplate,
  type MercenaryTemplateId,
  type MercenaryTemplate,
} from '../core/mercenaryTemplates';
import { MERCENARY_ART, type MercenaryArt } from '../sprites/mercenaryArt';
import {
  SPEECH_DURATION_FRAMES,
  TimedSpeech,
  drawTimedSpeechBubble,
  type TimedBubbleStyle,
} from '../sprites/speechBubble';
import type {
  MercenaryDrawState,
  MercenaryKit,
  MercenaryKitContext,
} from './mercenaries/MercenaryKit';
import { createMercenaryKit } from './mercenaries/mercenaryKits';
import { MercenaryBarker } from './mercenaries/MercenaryBarker';
import { MERCENARY_VOICES, type MercenaryBarkTrigger } from './mercenaries/mercenaryVoices';
import {
  HIRELING_HEAL_FLASH_FRAMES,
  HirelingSurvival,
  type HirelingHeal,
} from './mercenaries/hirelingSurvival';
import { drawTriageSparkleSprite } from '../sprites/crocodilianSprite';
import { HIRELING_STUCK_MIN_STEP_PX } from './mercenaries/hirelingCatchUp';

/**
 * A mercenary hired at the Desperado Club's "Meat Shields" desk — a friendly
 * `Mob` that follows the active player and fights nearby hostiles, never the
 * players.
 *
 * This class is the shell every hire shares: following, the leash, the aggro
 * scan, speech, death and drawing. How a hire fights lives in its kit
 * (`src/creatures/mercenaries/`), and how it looks in its entry in
 * `MERCENARY_ART`.
 *
 * It does **not** recall at low HP the way Mongo does: a hireling fights on,
 * takes half of every blow, drinks its own draughts and heals up between
 * fights (`HirelingSurvival`). At zero HP it goes down rather than dying, and a
 * crawler standing over it can bring it back; left too long, it dies, and its
 * death ends the contract with no refund. Its owner is reassigned each frame by
 * `MercenarySystem` so it trails whichever character is active.
 */

const CENTER_OFFSET = 0.5;
const FOLLOW_STOP_RANGE_RATIO = 0.7;
/**
 * How far past the follow band's stop still counts as arrived: the path's own
 * close-in stops a hair outside it, and a latch waiting for the exact stop
 * would never let go.
 */
const FOLLOW_ARRIVAL_SLACK_PX = 1;
const DAMAGE_FLASH_BRIGHTNESS = 'brightness(3)';

/** Below this share of its health the hireling says so. */
const LOW_HP_BARK_FRACTION = 0.35;
/** It must heal back past this before it will complain again. */
const LOW_HP_REARM_FRACTION = 0.6;
/** Quiet this long, with nothing hostile in range, before an idle line. */
const IDLE_QUIET_FRAMES = 600;
/** How far from a wounded ally to look for whoever did it. */
const ATTACKER_SEARCH_TILES = 3;

/** Lingers long enough to be noticed as a body before it starts to fade. */
const CORPSE_LINGER_FRAMES = 240;
const CORPSE_FADE_FRAMES = 90;

/** Longer lines stay up longer, so a sentence can be read before it goes. */
const SPEECH_FRAMES_PER_CHARACTER = 4;
const MAX_SPEECH_FRAMES = 420;

/** The orange of the `MEAT SHIELDS` desk, so every hireling's bubble reads as one brand. */
const MERCENARY_SPEECH_STYLE: TimedBubbleStyle = { border: '#e06040', text: '#ffe8dc' };

const NO_THROWS: readonly GolemRockThrow[] = [];
const NO_SHOTS: readonly HirelingShot[] = [];

/**
 * Where the shell is in a hireling's life; `gone` is terminal.
 *
 * `downed` is not a death: `isAlive` is false there, so nothing targets,
 * follows or ticks it, but the body keeps its grid slot through
 * `rendersWhenDead` and it can still come back to `alive`.
 */
export type MercenaryLifePhase = 'alive' | 'downed' | 'dying' | 'corpse' | 'gone';

/** The floating label over a hireling that just healed. */
const HEAL_TEXT_PREFIX = '+';

/**
 * The kit's view of its hireling, rebuilt from the shell's fields on every
 * read so it is always the current frame's.
 */
class ShellKitContext implements MercenaryKitContext {
  constructor(readonly merc: Mercenary) {}

  get owner(): Player {
    return this.merc.owner;
  }

  get allMobs(): readonly Mob[] {
    return this.merc.allMobs;
  }

  get allies(): readonly Player[] {
    return this.merc.allies;
  }

  get cat(): Player {
    return this.merc.cat;
  }

  isInSafeRoom(entity: { readonly x: number; readonly y: number }): boolean {
    return this.merc.safeRoomTest(entity);
  }

  bark(trigger: MercenaryBarkTrigger): void {
    this.merc.bark(trigger);
  }
}

export class Mercenary extends Mob {
  readonly xpValue = 0; // ally — no XP on death
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName: string;
  description: string;
  override readonly audioTag: string;
  /** A fallen hireling leaves a body that fades, so kill resolution keeps it drawn. */
  override readonly rendersWhenDead = true;
  /**
   * A figure that comes apart on death, like the golem, names its rubble here;
   * every other hireling falls over instead and leaves this null.
   */
  override readonly bodyPartKey: string | null;

  /** The player this merc currently trails — reassigned each frame to the active character. */
  owner: Player;
  /** All mobs in the scene — set each frame by MercenarySystem so the merc can pick a target. */
  allMobs: Mob[] = [];
  /** The party's side, less this hireling — set each frame by MercenarySystem. */
  allies: readonly Player[] = [];
  /** The cat crawler — set each frame by MercenarySystem. */
  cat: Player;
  /** Whether a point is inside a safe room — injected by MercenarySystem. */
  safeRoomTest: (entity: { readonly x: number; readonly y: number }) => boolean = () => false;

  readonly template: MercenaryTemplate;
  readonly kit: MercenaryKit;
  private readonly art: MercenaryArt;
  private readonly barker: MercenaryBarker;
  private readonly kitContext: ShellKitContext;
  /** What the hireling is saying; drawn by `renderSpeech`. */
  readonly speech = new TimedSpeech();
  /** Its resistance, recovery, draughts and revive window. */
  readonly survival = new HirelingSurvival();

  /**
   * Frames until the next attack may start. Shared by every kit: the shell
   * ticks it down and kits set it when they swing.
   */
  attackCooldown = 0;
  readonly strikeRangePx: number;
  private readonly aggroRangePx: number;
  private readonly leashPx: number;

  private animPhase = 0;
  /** The hostile being fought, for telling a fresh fight from one already joined. */
  private engaged: Mob | null = null;
  /**
   * Latched when the owner gets further than the follow band's start and held
   * until the hireling is back within its stop. Two thresholds re-read from
   * the raw distance each frame are not a band: against an owner drifting away
   * slowly the hireling steps, falls back inside the start, stops, and steps
   * again, flickering its walk every few frames and parking at the start.
   */
  private followingOwner = false;
  private quietFrames = 0;
  private lowHpLatched = false;
  /** Each ally's HP as of last frame, so a wound shows as a drop. */
  private readonly lastHpByAlly = new Map<Player, number>();
  private corpseFrames = 0;
  /** Where the hireling stood last tick, for a gait paced by ground covered. */
  private gaitSampleX: number;
  private gaitSampleY: number;
  /** Pixels covered between the last two ticks. */
  private lastStepPx = 0;
  /** Whether last tick's think asked the path to carry it home to its owner. */
  private walkingHome = false;
  /**
   * Frames spent walking home to the owner without covering ground, which
   * `MercenarySystem` reads to decide it is stuck and put it back beside them.
   */
  followStallFrames = 0;

  /**
   * Rocks thrown but not yet handed to `RockThrowSystem`, which drains this
   * every frame. A merc that dies mid-throw must not take the boulder with it.
   */
  private pendingThrows: GolemRockThrow[] = [];
  /** Bolts and waves not yet handed to `HirelingBoltSystem`, for the same reason. */
  private pendingShots: HirelingShot[] = [];

  constructor(
    tileX: number,
    tileY: number,
    tileSize: number,
    owner: Player,
    templateId: MercenaryTemplateId,
    name: string,
  ) {
    const template = getMercenaryTemplate(templateId);
    super(tileX, tileY, tileSize, template.hp, template.speed);
    this.template = template;
    this.owner = owner;
    this.cat = owner;
    this.kit = createMercenaryKit(template);
    this.art = MERCENARY_ART[template.art];
    this.bodyPartKey = this.art.goreBodyPartKey ?? null;
    this.barker = new MercenaryBarker(MERCENARY_VOICES[template.voice]);
    this.kitContext = new ShellKitContext(this);
    this.audioTag = template.audioTag;
    this.displayName = name;
    this.description = `A Meat Shields ${template.role.toLowerCase()}. Contract runs to the end of the floor.`;
    this.aggroRangePx = tileSize * this.kit.engageRadiusTiles;
    this.strikeRangePx = tileSize * this.kit.strikeRangeTiles;
    this.leashPx = tileSize * this.kit.leashRadiusTiles;
    this.gaitSampleX = this.x;
    this.gaitSampleY = this.y;
  }

  override get cullMarginTiles(): number {
    return this.art.cullMarginTiles ?? super.cullMarginTiles;
  }

  override clearAirborneAttacks(): void {
    this.kit.clearAirborne();
    this.pendingThrows = [];
    this.pendingShots = [];
  }

  /**
   * Hands over every rock thrown since the last call and clears the queue.
   * `RockThrowSystem` finds this structurally, so a golem hireling's boulders
   * fly by exactly the same path a wild golem's do.
   */
  takePendingThrows(): readonly GolemRockThrow[] {
    if (this.pendingThrows.length === 0) return NO_THROWS;
    const throws = this.pendingThrows;
    this.pendingThrows = [];
    return throws;
  }

  /** Hands over every bolt and wave loosed since the last call; `HirelingBoltSystem` drains it. */
  takePendingShots(): readonly HirelingShot[] {
    if (this.pendingShots.length === 0) return NO_SHOTS;
    const shots = this.pendingShots;
    this.pendingShots = [];
    return shots;
  }

  /** A hired ally — never hostile to the players. */
  override get isHostile(): boolean {
    return false;
  }

  /**
   * Ticked wherever the party is, like Mongo. Left to the activation radius,
   * a hire that fell a screen behind stopped thinking at exactly the moment it
   * needed to walk home, and stood frozen out of sight for the rest of the floor.
   */
  override get exemptFromAiActivationRadius(): boolean {
    return true;
  }

  /** Walks with the party, so it steps around its owner on the way to a fight. */
  override get yieldsToParty(): boolean {
    return true;
  }

  /** No loot on death — the merc is the coin sink, not a source. */
  protected override rollLootItems(): LootDrop['items'] {
    return [];
  }

  /**
   * Both damage doors are softened through the hireling's ledger — see
   * `DamageLedger` for why both — and neither lets anything through to a
   * body that is down: it is waiting for a revive, not being finished off.
   */
  override takeDamage(amount: number, source?: DamageSource): boolean {
    if (this.survival.downed) return false;
    const isStatusTick = source?.kind === 'status';
    return super.takeDamage(this.survival.soften(amount, isStatusTick), source);
  }

  override takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: PlayerDamageType | null = 'melee',
  ): void {
    if (this.survival.downed) return;
    // Free to charge nothing: this door returns void, so no caller is waiting
    // to be told whether the blow connected.
    super.takeDamageFrom(this.survival.soften(amount, true), attacker, damageType);
  }

  get isDowned(): boolean {
    return this.survival.downed;
  }

  /**
   * Called by `MercenarySystem` the frame HP reaches zero. The hireling drops
   * where it stood with a cry for help, and everything it was doing stops.
   *
   * `isKnockedOut` is the crawlers' own flag for the same state, set here so
   * the body wears the same knockout ring and label a downed crawler does and
   * `canBeHarmed` refuses every blow that reaches `takeDamage`.
   */
  goDown(): void {
    this.hp = 0;
    this.survival.goDown();
    this.isKnockedOut = true;
    this.reviveProgress = 0;
    this.kit.clearAirborne();
    this.engaged = null;
    this.followingOwner = false;
    this.isMoving = false;
    this.clearKnockback();
    this.clearStatusEffects();
    this.art.prewarmForFight?.();
    this.bark('downed');
  }

  /**
   * One frame on the floor.
   *
   * @param crawlerInReach whether a crawler is standing close enough to revive it.
   */
  tickDowned(crawlerInReach: boolean): ReturnType<HirelingSurvival['tickDowned']> {
    const tick = this.survival.tickDowned(crawlerInReach);
    this.reviveProgress = this.survival.reviveProgress;
    return tick;
  }

  /** Back on its feet with the revive's sliver of health, drawn in its idle. */
  getUp(): void {
    this.hp = this.survival.getUp(this.maxHp);
    this.isKnockedOut = false;
    this.reviveProgress = 0;
    this.damageFlash = 0;
    this.bark('revived');
  }

  /**
   * A standing hireling's upkeep for the frame, run once the frame's damage has
   * landed: its recovery and its draughts. Shows and applies whatever heal
   * came of it.
   */
  tickSurvival(): HirelingHeal | null {
    const heal = this.survival.tickStanding(this.hp, this.maxHp);
    if (heal === null) return null;
    this.hp = Math.min(this.maxHp, this.hp + heal.amount);
    this.queueFloatingText(`${HEAL_TEXT_PREFIX}${heal.amount}`, 'buff');
    if (heal.kind === 'potion') this.bark('potion');
    return heal;
  }

  /** Line of sight to a target, through the shared per-mob cache. */
  canSee(target: Player): boolean {
    return this.hasLOS(target);
  }

  /**
   * Whether nothing solid lies between two world points, for a kit that sizes
   * up several bodies at once and cannot spend the single-target cache on each.
   */
  hasClearLine(fromX: number, fromY: number, toX: number, toY: number): boolean {
    return this.map?.hasLineOfSight(fromX, fromY, toX, toY) ?? true;
  }

  /**
   * Whether a straight run between two world points crosses only walkable
   * tiles. A clear line is not enough for a step: it sees over low props.
   */
  hasWalkableLine(fromX: number, fromY: number, toX: number, toY: number): boolean {
    return this.map?.hasWalkableLine(fromX, fromY, toX, toY) ?? true;
  }

  /**
   * Whether the tile under a world point is ground a step could end on: the
   * same walkable-and-not-a-stairwell test `moveWithCollision` makes. A sight
   * line alone cannot say this — it never tests the tile it ends in.
   */
  canStandAt(x: number, y: number): boolean {
    const map = this.map;
    if (map === null) return true;
    const tileX = Math.floor(x / this.tileSize);
    const tileY = Math.floor(y / this.tileSize);
    return map.isWalkable(tileX, tileY) && !map.isStairwellTile(tileX, tileY);
  }

  /** Paths toward a point, stopping `stopPx` short of it. */
  walkTo(x: number, y: number, stopPx: number): void {
    this.followTargetAStar(x, y, this.speed, stopPx);
  }

  /** Steps by a raw offset, respecting walls — for kits that move off the path, like a charge. */
  stepBy(dx: number, dy: number): void {
    this.moveWithCollision(dx, dy);
  }

  faceToward(target: { readonly x: number; readonly y: number }): void {
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    if (dx === 0 && dy === 0) return;
    const heading = normalize(dx, dy);
    this.facingX = heading.x;
    this.facingY = heading.y;
  }

  /** Kits call this after each blow they land, so a finishing blow gets its line. */
  noteBlowLanded(victim: Mob): void {
    if (!victim.isAlive) this.bark('kill');
  }

  /**
   * Says something for `trigger` if the hireling is allowed to speak now.
   * @returns whether anything was said or grunted.
   */
  bark(trigger: MercenaryBarkTrigger): boolean {
    const utterance = this.barker.bark(trigger);
    if (utterance === null) return false;
    if (utterance.text !== null) {
      const readingFrames = utterance.text.length * SPEECH_FRAMES_PER_CHARACTER;
      this.speech.say(utterance.text, {
        italic: utterance.italic,
        durationFrames: Math.min(
          MAX_SPEECH_FRAMES,
          Math.max(SPEECH_DURATION_FRAMES, readingFrames),
        ),
      });
    }
    // The golem's audio cues ride on these two flags: `playMobAudioCues` plays
    // the grunt for a special and the groan for a damage cue.
    if (utterance.grunt === 'grunt') this.specialSoundPending = true;
    if (utterance.grunt === 'frustrated') this.damageSoundPending = true;
    this.kit.onBark?.(this.kitContext, trigger);
    return true;
  }

  /** The player walked up and asked. */
  talkTo(player: Player): void {
    this.faceToward(player);
    this.bark('talk');
  }

  /**
   * Called by `MercenarySystem` the frame HP reaches zero. Last words, and the
   * attack in progress is dropped.
   *
   * Only the kit's swing is cancelled. A bolt or boulder already released this
   * frame is still in the outbox, and the projectile systems drain it after
   * death interception runs, so wiping the outbox here would delete a shot the
   * player watched leave. `clearAirborneAttacks` stays the full wipe for a
   * rewound world.
   */
  beginDeath(): void {
    // A hireling that bled out on the floor has already fallen: its body picks
    // up from the downed pose rather than standing to fall over again.
    const alreadyFallen = this.survival.downed;
    this.survival.downed = false;
    this.isKnockedOut = false;
    this.reviveProgress = 0;
    this.kit.clearAirborne();
    this.engaged = null;
    this.isMoving = false;
    this.corpseFrames = alreadyFallen ? this.art.deathFrames : 0;
    this.bark('death');
  }

  /**
   * `isAlive` is left as plain `hp > 0`: a dying hireling is dead to every
   * system that asks, so nothing keeps fighting it or following its orders.
   * The death animation and fade run off their own frame count instead, and
   * end in `gone`, which never advances further.
   */
  get lifePhase(): MercenaryLifePhase {
    if (this.survival.downed) return 'downed';
    if (this.isAlive) return 'alive';
    if (this.corpseFrames < this.art.deathFrames) return 'dying';
    if (this.corpseFrames < this.corpseTotalFrames) return 'corpse';
    return 'gone';
  }

  private get corpseTotalFrames(): number {
    return this.art.deathFrames + CORPSE_LINGER_FRAMES + CORPSE_FADE_FRAMES;
  }

  override tickCorpse(): void {
    // A downed body is not a corpse yet: it holds its pose, and its clock is
    // the revive window `MercenarySystem` runs.
    if (!this.survival.downed && this.corpseFrames < this.corpseTotalFrames) this.corpseFrames++;
    this.barker.tick();
    this.speech.tick();
  }

  override get corpseExpired(): boolean {
    return this.lifePhase === 'gone';
  }

  /**
   * AI: the `targets` argument is ignored — the merc builds its own list of
   * hostile mobs from `allMobs`, chasing the nearest within aggro range of the
   * owner but never straying past its leash.
   */
  updateAI(_targets: Player[]): void {
    if (!this.isAlive) return;
    this.animPhase++;
    this.syncGaitToGroundCovered();
    this.barker.tick();
    this.speech.tick();
    if (this.attackCooldown > 0) this.attackCooldown--;

    // Judged on the step last tick's walk home produced. Only a walk that was
    // asked for counts: a kit holding the hire still for a special is not stuck.
    const walkedNowhere = this.lastStepPx < HIRELING_STUCK_MIN_STEP_PX;
    this.followStallFrames = this.walkingHome && walkedNowhere ? this.followStallFrames + 1 : 0;
    this.walkingHome = false;

    this.think();
    this.collectProjectiles();
  }

  /**
   * Whether it is fighting: a hostile picked out, and the hire inside its leash
   * where it goes after one. Past the leash `think` sends it walking home even
   * with a target picked — which is what a hire left far behind while the party
   * fights does — and that walk is not a fight anything should wait out.
   */
  get isFighting(): boolean {
    if (this.engaged === null) return false;
    return Math.hypot(this.x - this.owner.x, this.y - this.owner.y) <= this.leashPx;
  }

  /**
   * Called once something other than its own feet has put the hireling on a new
   * tile — a catch-up, a storey change, a script. The route, the walk home and
   * the ground-covered reading all belonged to where it was.
   */
  onTeleported(): void {
    this.clearAStarPath();
    this.followingOwner = false;
    this.followStallFrames = 0;
    this.walkingHome = false;
    this.isMoving = false;
    this.gaitSampleX = this.x;
    this.gaitSampleY = this.y;
    this.lastStepPx = 0;
  }

  /**
   * For a figure with a measured gait, turns the walk phase by the ground
   * covered since last tick rather than a fixed amount. Measured from position,
   * so it also counts slides along a wall and separation shoves, and a hireling
   * grinding into a wall with `isMoving` set does not tread the air.
   */
  private syncGaitToGroundCovered(): void {
    const coveredPx = Math.hypot(this.x - this.gaitSampleX, this.y - this.gaitSampleY);
    this.gaitSampleX = this.x;
    this.gaitSampleY = this.y;
    this.lastStepPx = coveredPx;
    const gait = this.art.gait;
    if (gait === undefined) return;
    this.walkFrameSpeed = Math.min(
      coveredPx * gait.radiansPerPixel(this.tileSize),
      gait.maxRadiansPerTick,
    );
  }

  private think(): void {
    const ctx = this.kitContext;
    this.reactToWounds();
    this.checkLowHp();
    this.kit.tick(ctx);
    // Marked ground outranks even a committed swing: a salute, a dance or a
    // triage channel is a long time to stand under a falling ball. The kit's
    // action is held, not dropped — its timers wait out the flee and it
    // resumes where it stood, and a strike that has stepped out of reach misses
    // as it would against a target that walked away. A charge needs no
    // exemption: marked ground refuses its step like a wall, and a charge that
    // meets a wall ends.
    if (this.stepOffMarkedGround(this.speed)) return;
    // A committed swing owns the frame it is playing on: the hireling finishes
    // what it started before it looks for anything else.
    if (this.kit.update(ctx)) {
      this.survival.noteCombat();
      return;
    }

    const nearest = this.nearestHostileInRange();
    this.updateIdle(nearest !== null);
    const target = this.kit.chooseTarget ? this.kit.chooseTarget(ctx, nearest) : nearest;
    // A fight interrupts the walk home; afterwards the band decides afresh.
    if (target !== null) this.followingOwner = false;
    if (target !== null && this.engaged === null) {
      this.bark('engage');
      this.art.prewarmForFight?.();
    }
    this.engaged = target;
    if (target !== null) this.survival.noteCombat();

    const distToOwner = Math.hypot(this.x - this.owner.x, this.y - this.owner.y);
    if (target === null || distToOwner > this.leashPx) {
      this.followOwner(distToOwner);
      return;
    }

    const targetDist = Math.hypot(target.x - this.x, target.y - this.y);
    this.updateLastKnown(target);
    const approached = this.kit.approach?.(ctx, target, targetDist) ?? false;
    if (!approached) this.closeOn(target, targetDist);

    if (this.attackCooldown > 0) return;
    if (!this.kit.canStartAttack(ctx, target, targetDist)) return;
    this.kit.startAttack(ctx, target, targetDist);
    this.survival.noteCombat();
  }

  /** Whether the hireling is walking back to its owner, latched across its follow band. */
  get isFollowingOwner(): boolean {
    return this.followingOwner;
  }

  private followOwner(distToOwner: number): void {
    const band = this.kit.followBand;
    if (this.restsAgainstParty(this.owner, this.allies)) {
      this.followingOwner = false;
      this.isMoving = false;
      return;
    }
    const stopPx = TILE_SIZE * band.stopTiles;
    if (distToOwner > TILE_SIZE * band.startTiles) this.followingOwner = true;
    else if (distToOwner <= stopPx + FOLLOW_ARRIVAL_SLACK_PX) this.followingOwner = false;
    if (this.followingOwner) {
      this.walkingHome = true;
      this.followTargetAStar(this.owner.x, this.owner.y, this.speed, stopPx);
    } else {
      // Stand at ease rather than wander: `doWander` drifts back toward the
      // merc's spawn tile, which for a bodyguard that has followed the player
      // across the floor means constantly tugging away from them.
      this.isMoving = false;
    }
  }

  private closeOn(target: Mob, targetDist: number): void {
    if (targetDist > this.strikeRangePx) {
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        this.strikeRangePx * FOLLOW_STOP_RANGE_RATIO,
      );
      return;
    }
    this.isMoving = false;
    this.faceToward(target);
  }

  /** The nearest living hostile within engage range of the owner, measured from the hireling. */
  private nearestHostileInRange(): Mob | null {
    const ownerCx = this.owner.x + TILE_SIZE * CENTER_OFFSET;
    const ownerCy = this.owner.y + TILE_SIZE * CENTER_OFFSET;
    // The aggro circle reaches past the wall, so once the party is behind it a
    // target outside is a mob the hireling has to leave the town to reach — see
    // `isInsideTownWall`, not the wider safe-zone radius, which already takes in
    // the gate aprons this rule is meant to keep the hireling out of.
    const ownerInsideWalls = this.map?.isInsideTownWall(this.owner.x, this.owner.y) ?? false;
    let nearest: Mob | null = null;
    let nearestDist = Infinity;
    for (const mob of this.allMobs) {
      if (mob === this || !mob.isAlive || !mob.isHostile) continue;
      // Held out of its fight by a script, it cannot answer a blow; going for it is a free kill.
      if (mob.offLimitsToAllies) continue;
      if (ownerInsideWalls && this.map?.isInsideTownWall(mob.x, mob.y) !== true) continue;
      const dOwner = Math.hypot(
        mob.x + TILE_SIZE * CENTER_OFFSET - ownerCx,
        mob.y + TILE_SIZE * CENTER_OFFSET - ownerCy,
      );
      if (dOwner > this.aggroRangePx) continue;
      const d = Math.hypot(mob.x - this.x, mob.y - this.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = mob;
      }
    }
    return nearest;
  }

  private updateIdle(hostileInRange: boolean): void {
    if (hostileInRange) {
      this.quietFrames = 0;
      return;
    }
    this.quietFrames++;
    if (this.quietFrames >= IDLE_QUIET_FRAMES) this.bark('idle');
  }

  private checkLowHp(): void {
    const fraction = this.hp / this.maxHp;
    if (fraction >= LOW_HP_REARM_FRACTION) this.lowHpLatched = false;
    if (fraction >= LOW_HP_BARK_FRACTION || this.lowHpLatched) return;
    this.lowHpLatched = true;
    this.bark('low_hp');
  }

  /**
   * Compares every ally's HP with last frame's and hands each drop to the kit,
   * with a best guess at who dealt it. The owner is always watched, even when
   * the scene lists no allies.
   */
  private reactToWounds(): void {
    const ctx = this.kitContext;
    let ownerHurt = false;
    let catHurt = false;
    const watched = this.allies.includes(this.owner) ? this.allies : [...this.allies, this.owner];
    for (const friend of watched) {
      const previous = this.lastHpByAlly.get(friend);
      this.lastHpByAlly.set(friend, friend.hp);
      if (previous === undefined || friend.hp >= previous) continue;
      const attacker = this.likelyAttackerOf(friend);
      this.kit.onFriendHurt?.(ctx, friend, attacker);
      if (friend === this.owner) {
        ownerHurt = true;
        this.kit.onOwnerHurt?.(ctx, attacker);
      }
      if (friend === this.cat) catHurt = true;
    }
    if (catHurt && this.bark('cat_hurt')) return;
    if (ownerHurt) this.bark('owner_hurt');
  }

  /**
   * The hostile most likely to have wounded `friend`: one that has noticed
   * them, else the nearest one close by. Null for a wound nobody nearby could
   * have dealt — a burn, a trap.
   */
  private likelyAttackerOf(friend: Player): Mob | null {
    const searchPx = TILE_SIZE * ATTACKER_SEARCH_TILES;
    let best: Mob | null = null;
    let bestScore = Infinity;
    for (const mob of this.allMobs) {
      if (mob === this || !mob.isAlive || !mob.isHostile) continue;
      // Held out of its fight by a script, it wounded nobody and is nobody's to answer.
      if (mob.offLimitsToAllies) continue;
      const d = Math.hypot(mob.x - friend.x, mob.y - friend.y);
      const noticed = mob.currentTarget === friend;
      if (!noticed && d > searchPx) continue;
      // A mob that has noticed the friend always outranks one that has not.
      const score = noticed ? d : d + searchPx;
      if (score < bestScore) {
        bestScore = score;
        best = mob;
      }
    }
    return best;
  }

  private collectProjectiles(): void {
    // Each kind goes to the outbox its own projectile system drains.
    for (const projectile of this.kit.drainProjectiles()) {
      if (projectile.kind === 'rock') this.pendingThrows.push(projectile.rock);
      else this.pendingShots.push(projectile);
    }
  }

  private drawState(): MercenaryDrawState {
    if (this.isAlive) return this.kit.drawState(this);
    // Down, it plays its fall and holds the last frame as the pose it waits in.
    const fallenFrames = this.survival.downed ? this.survival.downedFrames : this.corpseFrames;
    return { row: 'death', progress: Math.min(1, fallenFrames / this.art.deathFrames) };
  }

  /** 1 until the fade begins, then down to 0 as the body goes. */
  private corpseAlpha(): number {
    const fadeStart = this.art.deathFrames + CORPSE_LINGER_FRAMES;
    if (this.corpseFrames <= fadeStart) return 1;
    return Math.max(0, 1 - (this.corpseFrames - fadeStart) / CORPSE_FADE_FRAMES);
  }

  /**
   * Draws whatever the hireling is saying, and whatever its kit left on its
   * allies. Called from the effects pass rather than from `drawSelf`, so a
   * bubble is never hidden behind whoever stands south of the speaker.
   */
  renderSpeech(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.kit.renderEffects?.(ctx, camX, camY);
    const anchorX = this.x - camX + this.tileSize * CENTER_OFFSET;
    const headY = this.y - camY - this.art.headLiftTiles * this.tileSize;
    drawTimedSpeechBubble(ctx, this.speech, anchorX, headY, MERCENARY_SPEECH_STYLE);
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    const sx = this.x - camX;
    const sy = this.y - camY;
    const frame = {
      state: this.drawState(),
      walkFrame: this.walkFrame,
      isMoving: this.isMoving,
      facingX: this.facingX,
      facingY: this.facingY,
      clock: this.animPhase,
    };

    if (this.survival.downed) {
      this.art.draw(ctx, sx, sy, tileSize, frame);
      this.renderKnockedOutOverlay(ctx, sx, sy);
      return;
    }

    if (!this.isAlive) {
      const alpha = this.corpseAlpha();
      if (alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      this.art.draw(ctx, sx, sy, tileSize, frame);
      ctx.restore();
      return;
    }

    ctx.save();
    if (this.damageFlash > 0) ctx.filter = DAMAGE_FLASH_BRIGHTNESS;
    this.art.draw(ctx, sx, sy, tileSize, frame);
    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy - (this.art.healthBarLiftTiles ?? 0) * tileSize);
    this.renderHealFlash(ctx, sx, sy, tileSize);
  }

  /** The medic's triage sparkle, which is what a heal looks like on anyone in the party. */
  private renderHealFlash(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    tileSize: number,
  ): void {
    const framesLeft = this.survival.healFlashFrames;
    if (framesLeft <= 0) return;
    const progress = 1 - framesLeft / HIRELING_HEAL_FLASH_FRAMES;
    drawTriageSparkleSprite(ctx, sx, sy, tileSize, progress);
  }
}
