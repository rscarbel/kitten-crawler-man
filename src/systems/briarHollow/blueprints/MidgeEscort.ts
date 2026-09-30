/**
 * Midge: Merrit calling her over, leading her from Briar Hollow to Wendell's
 * pasture while the road's ambushers go for her, and her life at Wendell's
 * afterwards.
 *
 * Owned by `BlueprintsQuestSystem`, which starts the call once the grain is
 * in, asks where Midge is (for guidance and the tracker's "Midge is waiting
 * at Merrit's gate."), and hands her to the hostiles' target list through
 * {@link pushEscortTargets}. Her position is never saved: after a load or a
 * rewind she stands at Merrit's pasture gate. Only a door visit carries her
 * live position, through a scene-option record the scenes pass along
 * (`MidgeEscortCarry`).
 *
 * The escort, step by step:
 * - **The call.** Merrit's shout walks Midge out of the herd (the herd raises
 *   an ordinary cow of her coat in her place) and over to the party; she
 *   snaps beside them if the walk takes longer than
 *   {@link MIDGE_CALL_TIMEOUT_SECONDS}.
 * - **Led.** She follows whichever crawler the player steers, in a latched
 *   band, never faster than {@link MIDGE_LED_SPEED}; left past
 *   {@link MIDGE_LEAD_BREAK_TILES} she stops and lows after them until they
 *   come back. She never runs from anything while led — a blow only makes
 *   her flinch where she stands — and while led the road's hostiles may
 *   choose her.
 * - **Scared home.** Beaten down she does not die: she is back at Merrit's
 *   gate at once, whole, not led, and the road's ambushes are all armed again.
 * - **Delivered.** With the steered crawler inside Garrison Green and Midge
 *   within reach, the quest moves on at once and she is Wendell's
 *   (`WendellsMidge`), walking in through the cart gate by herself.
 */

import { TILE_SIZE } from '../../../core/constants';
import { activeDifficultyProfile, applySpawnDifficulty } from '../../../core/difficultyProfiles';
import {
  blueprintsPhaseAtLeast,
  type BlueprintsQuestPhase,
} from '../../../core/blueprintsQuestPhase';
import { isVillageUnderSiege } from '../../../core/villageQuestPhase';
import { Cow, LIVESTOCK_LEVEL, type CowLeadBand } from '../../../creatures/Cow';
import type { Player } from '../../../Player';
import type { ConversationHandle } from '../../../dialog/request';
import { MIDGE_ESCORT_NARRATION } from '../../../dialog/scripts/scenes/midgeEscort';
import { findNearbyWalkableTile } from '../../../map/findWalkableTile';
import type { TilePoint } from '../../../map/town/townPlan';
import { PROGRESS_PRESETS, drawProgressBar } from '../../../ui/Box';
import type { CowPen } from '../cowPen';
import { EscortAmbushSystem } from '../EscortAmbushSystem';
import { IN_VIEW_TILES, MIDGE_COAT, MIDGE_COW_NAME, ROUTINE_WARM_TILES } from '../LivestockSystem';
import type { BlueprintsQuestContext } from './blueprintsContext';
import { garrisonGreen, isInGarrisonGreen, type GarrisonGreen } from './garrisonGreen';
import { merritGateTile } from './escortRoute';
import { WendellsMidge } from './wendellsMidge';

const UPDATES_PER_SECOND = 60;
const TILE_CENTRE = 0.5;

/** Merrit's call gives up waiting for Midge to walk over after this long, and sets her down beside the party. */
export const MIDGE_CALL_TIMEOUT_SECONDS = 15;
/** Midge sets off after the party past this many tiles... */
export const MIDGE_FOLLOW_START_TILES = 3;
/** ...and stops again inside this many, so a crawler standing still never has her shuffling. */
export const MIDGE_FOLLOW_STOP_TILES = 1.5;
/** Left further behind than this, she stops, faces the party and lows until they come back for her. */
export const MIDGE_LEAD_BREAK_TILES = 10;
/** A waiting Midge walks on again once the party is back inside this many tiles. */
export const MIDGE_LEAD_RESUME_TILES = 7;
/**
 * Her pace on the lead, in pixels per update before levelling: a little over
 * the herd's amble (`COW_WALK_SPEED`, 0.5), well under a crawler's
 * (`PLAYER_SPEED`, 2.5), so leading her is a walk the party has to hold back
 * for.
 */
export const MIDGE_LED_SPEED = 0.7;
/** Seconds between her lonely moos while she waits to be fetched. */
export const MIDGE_LONELY_MOO_SECONDS = 6;
/**
 * Her health for the escort. The herd's handful of hit points is sized for
 * one stick of dynamite to be enough; this is tuned by playtest, against the
 * road's nine-body waves.
 */
export const MIDGE_ESCORT_HP = 60;
/**
 * How far one of her path searches reaches. Wider than a mob's default
 * because the road winds round forest and ruins, and a search that stops
 * short sends her straight at the trees between her and the party.
 */
const MIDGE_PATH_BUDGET_TILES = 40;
/** Close enough to the party for the call to count as answered. */
const MIDGE_CALL_ARRIVED_TILES = MIDGE_FOLLOW_STOP_TILES + TILE_CENTRE;
/** Her hurt moo sounds at most this often, however many blows land. */
const MIDGE_HURT_MOO_GAP_SECONDS = 1.5;
/** Her cowbell clanks once per this many seconds of walking on the lead: about one stride. */
const MIDGE_COWBELL_CLANK_SECONDS = 0.8;
/** How far round the spot she is wanted a snapped Midge may be set down. */
const MIDGE_SNAP_SEARCH_TILES = 4;
/** Her health bar: as wide as her tile, a few pixels tall, just over her head. */
const MIDGE_BAR_HEIGHT_PX = 4;
const MIDGE_BAR_RISE_PX = 22;
/**
 * Health under which a Midge that cannot be killed has been beaten down. Not
 * "at one point": a blow stopped a point short is then scaled again by the
 * difficulty's damage scale, so off normal her last point is shaved off in
 * ever smaller fractions and never quite runs out.
 */
const MIDGE_BEATEN_BELOW_HP = 2;

/** How Midge keeps with the party on the lead. */
export const MIDGE_LEAD_BAND: CowLeadBand = {
  followStartTiles: MIDGE_FOLLOW_START_TILES,
  followStopTiles: MIDGE_FOLLOW_STOP_TILES,
  breakTiles: MIDGE_LEAD_BREAK_TILES,
  resumeTiles: MIDGE_LEAD_RESUME_TILES,
  speed: MIDGE_LED_SPEED,
  pathBudgetTiles: MIDGE_PATH_BUDGET_TILES,
};

/** Where the escort has got to. */
type EscortStage =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'called';
      readonly cow: Cow;
      readonly onArrived: () => void;
      updatesLeft: number;
    }
  | { readonly kind: 'waiting'; readonly cow: Cow }
  | { readonly kind: 'led'; readonly cow: Cow };

const NO_STAGE: EscortStage = { kind: 'none' };

function secondsToUpdates(seconds: number): number {
  return Math.round(seconds * UPDATES_PER_SECOND);
}

function tileOf(body: { readonly x: number; readonly y: number }): TilePoint {
  return {
    x: Math.floor(body.x / TILE_SIZE + TILE_CENTRE),
    y: Math.floor(body.y / TILE_SIZE + TILE_CENTRE),
  };
}

function tilesBetween(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y) / TILE_SIZE;
}

export class MidgeEscort {
  /** The road's three ambushes. */
  readonly ambush: EscortAmbushSystem;
  /** Midge at Wendell's, once she lives there. */
  readonly wendells: WendellsMidge;
  private stage: EscortStage = NO_STAGE;
  /** Her health last update, so a blow can be told from the update it landed. */
  private lastHp = 0;
  private hurtMooUpdatesLeft = 0;
  private lonelyMooUpdatesLeft = 0;
  private cowbellUpdatesLeft = 0;
  /** Reused by {@link strayCows}, which the herd asks every update. */
  private readonly strayBuffer: Cow[] = [];
  /** Garrison Green, read from the town plan once: the map never moves it. */
  private readonly green: GarrisonGreen | null;
  /** "Midge got scared and ran back home", waiting for the shared box to be free. */
  private scaredLinePending = false;
  private scaredLineHandle: ConversationHandle | null = null;

  constructor(protected readonly ctx: BlueprintsQuestContext) {
    const crawlers = (): readonly Player[] => [ctx.human, ctx.cat];
    this.ambush = new EscortAmbushSystem({
      gameMap: ctx.gameMap,
      site: ctx.site,
      roster: ctx.roster,
      audio: ctx.audio,
      music: ctx.music,
      crawlers,
      level: ctx.escortLevel,
      difficulty: activeDifficultyProfile,
      sting: () => ctx.cue('escortAmbushSting'),
      announce: ctx.announce,
      carry: ctx.midgeCarry,
    });
    this.green = garrisonGreen(ctx.gameMap);
    this.wendells = new WendellsMidge({
      gameMap: ctx.gameMap,
      roster: ctx.roster,
      crawlers,
      active: ctx.active,
      cue: ctx.cue,
    });
  }

  private get phase(): BlueprintsQuestPhase {
    return this.ctx.state.blueprints.phase;
  }

  private crawlers(): readonly Player[] {
    return [this.ctx.human, this.ctx.cat];
  }

  /** The Midge the escort has out right now, whatever it is doing with her. */
  get midge(): Cow | null {
    return this.stage.kind === 'none' ? null : this.stage.cow;
  }

  /**
   * Merrit's call: Midge walks from the pasture to the party. `onArrived`
   * runs exactly once, when she reaches the party or when the call times out
   * and she is snapped beside them — the moment Merrit opens her "There she
   * is" conversation. With no Midge to walk, it runs at once.
   */
  beginCall(onArrived: () => void): void {
    if (this.stage.kind === 'called') return;
    if (this.stage.kind !== 'none') {
      onArrived();
      return;
    }
    const cow = this.ctx.livestock?.releaseMidge(this.crawlers()) ?? null;
    if (cow === null) {
      onArrived();
      return;
    }
    cow.beginLead(MIDGE_LEAD_BAND, this.ctx.active(), { ignoresBreak: true });
    cow.wardedFromParty = true;
    this.stage = {
      kind: 'called',
      cow,
      onArrived,
      updatesLeft: secondsToUpdates(MIDGE_CALL_TIMEOUT_SECONDS),
    };
  }

  /** Midge's tile while she is out of the pen for the quest; null when she is not. */
  midgeTile(): TilePoint | null {
    const cow = this.midge;
    return cow === null ? null : tileOf(cow);
  }

  /** Whether Midge stands at Merrit's gate waiting to be led again: after a load, a rewind or a scare. */
  get isWaitingAtGate(): boolean {
    return this.stage.kind === 'waiting';
  }

  /** Whether the party has left Midge behind, past the distance she follows from. */
  get isOutOfLeadRange(): boolean {
    return this.stage.kind === 'led' && this.stage.cow.isWaitingForLeader;
  }

  /** Whether Midge is on the lead for the escort itself, where the road's hostiles may choose her. */
  get isEscorting(): boolean {
    return (
      this.stage.kind === 'led' &&
      this.phase === 'escort_midge' &&
      !this.heldForSiege &&
      this.stage.cow.isAlive
    );
  }

  /**
   * Whether the Plea's siege has the escort standing still: Midge stays where
   * she is, off the lead and out of every hostile's reach, and the road's
   * ambushes wait, until the village has fought its own fight.
   */
  get heldForSiege(): boolean {
    return isVillageUnderSiege(this.ctx.pleaPhase());
  }

  /** Whether the "ran back home" line is the box on screen. */
  get isScaredLineOpen(): boolean {
    const handle = this.scaredLineHandle;
    return handle !== null && this.ctx.conversation.isActive(handle);
  }

  /** Every Midge out in the world that is not one of the herd, for petting. */
  get strayCows(): readonly Cow[] {
    const cows = this.strayBuffer;
    cows.length = 0;
    const escorted = this.midge;
    if (escorted !== null) cows.push(escorted);
    const resident = this.wendells.midge;
    if (resident !== null) cows.push(resident);
    return cows;
  }

  /**
   * Adds Midge to `out` while she is being led, so hostiles can choose her —
   * called from the scene's target-list build beside the village's allied
   * defenders. Never as a defend target, which every hostile refuses.
   */
  pushEscortTargets(out: Player[]): void {
    const cow = this.midge;
    if (cow !== null && this.isEscorting) out.push(cow);
  }

  // ── The frame ────────────────────────────────────────────────────────────

  /** Once per gameplay frame: the call, the led follow, the ambush waves and delivery. */
  update(): void {
    const phase = this.phase;
    if (blueprintsPhaseAtLeast(phase, 'midge_delivered')) {
      this.ctx.livestock?.retireMidgeName();
      this.handOverToWendell();
      this.wendells.ensureResident();
      this.wendells.update();
    } else if (this.stage.kind === 'called') {
      this.tickCall(this.stage);
    } else if (phase === 'escort_midge') {
      this.tickEscort();
    } else if (this.stage.kind === 'led') {
      // Answered the call, and waiting on Merrit's word before the road.
      this.stage.cow.setLeader(this.ctx.active());
    }
    const cow = this.midge;
    if (cow !== null) this.warm(cow);
    this.ambush.update({
      midge: cow,
      led: this.isEscorting,
      escorting: phase === 'escort_midge',
      held: this.heldForSiege,
    });
    this.openScaredLine();
    this.writeCarry();
  }

  private tickCall(stage: Extract<EscortStage, { kind: 'called' }>): void {
    const { cow } = stage;
    const active = this.ctx.active();
    cow.setLeader(active);
    stage.updatesLeft--;
    const arrived = tilesBetween(cow, active) <= MIDGE_CALL_ARRIVED_TILES;
    if (!arrived && stage.updatesLeft > 0) return;
    if (!arrived) this.setDownNear(cow, tileOf(active), tileOf(active));
    this.putOnLead(cow);
    stage.onArrived();
  }

  /** The escort proper: Midge found or raised, then waiting, led or walking in. */
  private tickEscort(): void {
    if (this.stage.kind === 'none') this.bringOutForEscort();
    const stage = this.stage;
    switch (stage.kind) {
      case 'waiting':
        this.tickWaiting(stage.cow);
        return;
      case 'led':
        this.tickLed(stage.cow);
        return;
      case 'none':
      case 'called':
        return;
    }
  }

  /**
   * Midge for an escort this scene has not seen her in: out of the herd if
   * she is still one of it (a scene built before she left), else raised
   * anew. Where the party left her if a door carried her, else at Merrit's
   * gate.
   */
  private bringOutForEscort(): void {
    const cow = this.ctx.livestock?.releaseMidge(this.crawlers()) ?? this.raiseMidge();
    if (cow === null) return;
    const carried = this.ctx.midgeCarry.midge;
    if (carried === null) {
      this.sendToGate(cow);
      return;
    }
    this.putOnLead(cow);
    this.moveTo(cow, carried.x, carried.y);
    cow.hp = Math.max(MIDGE_BEATEN_BELOW_HP, Math.min(cow.maxHp, carried.hp));
    this.lastHp = cow.hp;
  }

  /** A Midge of her own coat, levelled and placed like the herd, standing at Merrit's gate. */
  private raiseMidge(): Cow | null {
    const gate = this.gateTile();
    if (gate === null) return null;
    const cow = new Cow(gate.x, gate.y, TILE_SIZE, MIDGE_COAT, 'adult');
    cow.applyMobLevel(LIVESTOCK_LEVEL);
    applySpawnDifficulty(cow);
    cow.name = MIDGE_COW_NAME;
    this.ctx.roster.add(cow);
    return cow;
  }

  /** Hardened for the road and on the lead behind the steered crawler. */
  private putOnLead(cow: Cow): void {
    this.harden(cow);
    cow.beginLead(MIDGE_LEAD_BAND, this.ctx.active(), { ignoresBreak: false });
    this.stage = { kind: 'led', cow };
    this.lonelyMooUpdatesLeft = 0;
  }

  private harden(cow: Cow): void {
    if (cow.maxHp !== MIDGE_ESCORT_HP) cow.hardenTo(MIDGE_ESCORT_HP);
    // Beaten on the road she runs home rather than dying: whatever brings
    // her down stops a point short, and `tickLed` reads that as the scare.
    cow.cannotBeKilled = true;
    cow.wardedFromParty = true;
    cow.healthBarDrawnElsewhere = true;
    cow.name = MIDGE_COW_NAME;
    this.lastHp = cow.hp;
  }

  /** Midge standing at Merrit's gate, whole, held off the lead until the party comes for her. */
  private sendToGate(cow: Cow): void {
    if (!cow.isAlive) {
      const grid = this.ctx.roster.grid;
      grid.remove(cow);
      cow.reviveForCheckpoint();
      grid.insert(cow);
    }
    this.harden(cow);
    cow.hp = cow.maxHp;
    this.lastHp = cow.hp;
    cow.beginLead(MIDGE_LEAD_BAND, null, { ignoresBreak: false });
    const gate = this.gateTile();
    if (gate !== null) this.setDownNear(cow, gate, null);
    this.stage = { kind: 'waiting', cow };
  }

  private tickWaiting(cow: Cow): void {
    cow.hp = cow.maxHp;
    this.lastHp = cow.hp;
    if (this.heldForSiege) return;
    if (tilesBetween(cow, this.ctx.active()) > MIDGE_FOLLOW_START_TILES) return;
    cow.setLeader(this.ctx.active());
    this.stage = { kind: 'led', cow };
    this.lonelyMooUpdatesLeft = 0;
  }

  private tickLed(cow: Cow): void {
    if (this.heldForSiege) {
      cow.setLeader(null);
      this.lastHp = cow.hp;
      return;
    }
    const active = this.ctx.active();
    cow.setLeader(active);
    if (this.hurtMooUpdatesLeft > 0) this.hurtMooUpdatesLeft--;
    if (cow.hp < this.lastHp) {
      cow.flinchInPlace();
      if (this.hurtMooUpdatesLeft === 0) {
        this.ctx.cue('midgeHurtMoo');
        this.hurtMooUpdatesLeft = secondsToUpdates(MIDGE_HURT_MOO_GAP_SECONDS);
      }
    }
    this.lastHp = cow.hp;
    // Dead as well as beaten: an effect that ends a life outright, rather
    // than dealing damage, is not stopped a point short.
    if (!cow.isAlive || cow.hp < MIDGE_BEATEN_BELOW_HP) {
      this.scareHome(cow);
      return;
    }
    this.tickLonelyMoo(cow);
    this.tickCowbell(cow);
    const green = this.green;
    if (green === null) return;
    const activeTile = tileOf(active);
    const partyInTheGreen = isInGarrisonGreen(green, activeTile.x, activeTile.y);
    if (partyInTheGreen && tilesBetween(cow, active) <= MIDGE_LEAD_BREAK_TILES) {
      this.walkIntoTheGreen(cow);
    }
  }

  /** A lonely moo as she stops, then every {@link MIDGE_LONELY_MOO_SECONDS} until she is fetched. */
  private tickLonelyMoo(cow: Cow): void {
    if (!cow.isWaitingForLeader) {
      this.lonelyMooUpdatesLeft = 0;
      return;
    }
    if (this.lonelyMooUpdatesLeft > 0) {
      this.lonelyMooUpdatesLeft--;
      return;
    }
    this.ctx.cue('midgeLonelyMoo');
    this.lonelyMooUpdatesLeft = secondsToUpdates(MIDGE_LONELY_MOO_SECONDS);
  }

  /** Her cowbell, clanking in step while she walks on the lead. */
  private tickCowbell(cow: Cow): void {
    if (!cow.isMoving) {
      this.cowbellUpdatesLeft = 0;
      return;
    }
    if (this.cowbellUpdatesLeft > 0) {
      this.cowbellUpdatesLeft--;
      return;
    }
    this.ctx.cue('cowbellClank');
    this.cowbellUpdatesLeft = secondsToUpdates(MIDGE_COWBELL_CLANK_SECONDS);
  }

  /**
   * Beaten down on the road. She does not die: no death, no burgers, no
   * respawn wait. She is at Merrit's gate at once, whole and off the lead,
   * the road's ambushers lose her, every ambush is armed again, and the
   * narration says what happened.
   */
  private scareHome(cow: Cow): void {
    for (const mob of this.ambush.livingAmbushers) {
      if (mob.currentTarget === cow) mob.currentTarget = null;
    }
    this.ambush.rearm();
    this.sendToGate(cow);
    this.scaredLinePending = true;
  }

  /**
   * The party is in the green and she is near: she is delivered. The quest
   * moves on at once, so a door visit while she is still walking in finds
   * her at Wendell's rather than back at Merrit's gate; the walk in through
   * the cart gate is hers to finish as Wendell's cow (`WendellsMidge`).
   */
  private walkIntoTheGreen(cow: Cow): void {
    const pen = this.wendells.pen;
    if (pen === null) return;
    cow.restoreHerdHp();
    cow.cannotBeKilled = false;
    cow.wardedFromParty = false;
    if (!cow.settleInto(pen)) this.setDownInside(cow, pen);
    this.stage = NO_STAGE;
    this.wendells.adopt(cow);
    this.ctx.cue('midgeSettled');
    this.ctx.setPhase('midge_delivered');
  }

  /** Whatever Midge the escort still holds once she is delivered is Wendell's. */
  private handOverToWendell(): void {
    const cow = this.midge;
    if (cow === null) return;
    this.stage = NO_STAGE;
    cow.endLead();
    this.wendells.adopt(cow);
  }

  // ── Placing her ──────────────────────────────────────────────────────────

  /**
   * Merrit's pasture gate: the lane tile just outside it, where a Midge
   * scared home, rewound or loaded stands waiting.
   */
  private gateTile(): TilePoint | null {
    return merritGateTile(this.ctx.site);
  }

  /** Sets `cow` down on open ground at or round `wanted`, never on `avoid` (the tile a crawler stands on). */
  private setDownNear(cow: Cow, wanted: TilePoint, avoid: TilePoint | null): void {
    const map = this.ctx.gameMap;
    const isAvoided = (x: number, y: number): boolean =>
      avoid !== null && x === avoid.x && y === avoid.y;
    const tile =
      findNearbyWalkableTile(
        map,
        wanted.x,
        wanted.y,
        MIDGE_SNAP_SEARCH_TILES,
        (x, y) => !isAvoided(x, y) && !map.isStairwellTile(x, y),
      ) ?? wanted;
    this.moveTo(cow, tile.x * TILE_SIZE, tile.y * TILE_SIZE);
  }

  /** Sets `cow` down on the open pasture tile nearest her, for a walk in that has taken too long. */
  private setDownInside(cow: Cow, pen: CowPen): void {
    const tile = pen.nearestPassable(tileOf(cow));
    if (tile === null) return;
    this.moveTo(cow, tile.x * TILE_SIZE, tile.y * TILE_SIZE);
  }

  /** Moves her body and her place in the mob grid together. */
  private moveTo(cow: Cow, x: number, y: number): void {
    const previousX = cow.x;
    const previousY = cow.y;
    cow.x = x;
    cow.y = y;
    cow.forceRepath();
    this.ctx.roster.grid.move(cow, previousX, previousY);
  }

  /** Keeps the rows she walks and stands in baked while the party is near enough to see her. */
  private warm(cow: Cow): void {
    const active = this.ctx.active();
    const tiles = tilesBetween(cow, active);
    if (tiles <= ROUTINE_WARM_TILES) cow.warmRoutine(tiles <= IN_VIEW_TILES);
  }

  // ── Narration and the door ───────────────────────────────────────────────

  /**
   * Opens the "ran back home" line once the shared box is free, owned by the
   * handle it returns. It opens by itself, so it never takes the box from
   * whatever the player is already reading.
   */
  private openScaredLine(): void {
    if (!this.scaredLinePending || this.ctx.conversation.isOpen) return;
    this.scaredLinePending = false;
    this.scaredLineHandle = this.ctx.conversation.open({
      lines: [MIDGE_ESCORT_NARRATION.scaredHome],
      reward: null,
      questRelated: true,
      ending: {
        kind: 'close',
        onClosed: () => {
          this.scaredLineHandle = null;
        },
      },
      dismiss: { kind: 'blocked' },
      haltsWorld: true,
      anchor: null,
      locksKeyboard: true,
    });
  }

  /** What a door must carry: Midge's place and health while she is led on the escort, else nothing. */
  private writeCarry(): void {
    const carry = this.ctx.midgeCarry;
    const cow = this.midge;
    carry.midge =
      cow !== null && this.stage.kind === 'led' && this.phase === 'escort_midge'
        ? { x: cow.x, y: cow.y, hp: cow.hp }
        : null;
  }

  // ── Drawing ──────────────────────────────────────────────────────────────

  /** Over every body: Midge's health bar while she is out for the escort. */
  renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const cow = this.midge;
    if (cow === null || !cow.isAlive || this.phase !== 'escort_midge') return;
    drawProgressBar(ctx, {
      x: cow.x - camX,
      y: cow.y - camY - MIDGE_BAR_RISE_PX,
      width: TILE_SIZE,
      height: MIDGE_BAR_HEIGHT_PX,
      value: cow.hp / cow.maxHp,
      ...PROGRESS_PRESETS.hp,
    });
  }

  /** Screen space, over the fog: where the road's ambushers still out of sight are coming from. */
  renderHud(ctx: CanvasRenderingContext2D): void {
    if (this.phase !== 'escort_midge') return;
    this.ambush.renderIncoming(ctx, performance.now());
  }

  // ── Rewind and teardown ──────────────────────────────────────────────────

  /**
   * A death rewind on the same scene, after the roster has been rewound and
   * the quest's state restored: in the escort, Midge back at Merrit's gate,
   * full HP, not led, with every ambush armed again; before it, she is the
   * herd's again; after it, she is in Wendell's pasture.
   */
  onRewind(): void {
    const handle = this.scaredLineHandle;
    if (handle !== null && this.ctx.conversation.isActive(handle)) this.ctx.conversation.close();
    this.scaredLineHandle = null;
    this.scaredLinePending = false;
    this.ambush.onRewind();
    this.ambush.rearm();
    this.ctx.midgeCarry.midge = null;
    const phase = this.phase;
    const delivered = blueprintsPhaseAtLeast(phase, 'midge_delivered');
    // Rewound to before the delivery, Wendell's Midge is the escort's again —
    // or the herd's, which has already taken her back.
    const resident = delivered ? null : this.wendells.release();
    const herd = this.ctx.livestock?.herd ?? [];
    const cow = this.midge ?? (resident !== null && !herd.includes(resident) ? resident : null);
    const stillHere = cow !== null && this.ctx.roster.mobs.includes(cow);
    this.stage = NO_STAGE;
    if (delivered) {
      this.wendells.onRewind();
      this.wendells.ensureResident();
    } else if (phase === 'escort_midge') {
      if (stillHere) this.sendToGate(cow);
      else this.bringOutForEscort();
    }
  }

  /** The scene is being torn down. */
  dispose(): void {
    this.ambush.dispose();
    const handle = this.scaredLineHandle;
    if (handle !== null && this.ctx.conversation.isActive(handle)) this.ctx.conversation.close();
    this.scaredLineHandle = null;
  }
}
