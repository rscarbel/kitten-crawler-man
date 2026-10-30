/**
 * The cattery before the Warden knows: nine cages down the side walls, the
 * seven town cats and the cellmate sat in theirs, Belle in hers, and the
 * keeper, a krasue that drifts between the room and the observatory window.
 *
 * Every cage opens the same way: a cat at its latch jostles it a little at a
 * time, and a jostle only counts while the keeper's back is turned. The keeper
 * keeps a slow round — a long look over the room, a turn, a long gaze up at
 * the window, a turn back — and the round reads three ways at once: where it
 * floats (down among the cages, or up by the window), which way its look
 * washes the floor, and the colour of the latch's bar. A jostle under its eye
 * is seen: it shrieks, and stares on at the room for a while before it turns
 * away again. Nothing is lost but time.
 *
 * Belle wakes in her own cage and works her own latch from inside it; until
 * that latch gives she can reach no other. A town cat let out bolts for the
 * stair and is gone, and is one fewer cat bound in the circle later. The
 * cellmate let out comes along with Belle. Every opening is written to the
 * questline's progress as it happens, so the cattery is built as it was left.
 */

import { TILE_SIZE } from '../../core/constants';
import { phaseReached } from '../../core/quests/missingCatsProgress';
import { TOWN_CAT_IDS, type TownCatId } from '../../core/state/townCatIds';
import type { CatAlly } from '../../creatures/CatAlly';
import {
  catteryCageId,
  CATTERY_CAGE_VARIANT,
  TOWER_CATTERY_CAGES,
  towerStoreyPlan,
  type CatteryCageOccupant,
  type TowerTile,
} from '../../map/town/interiors/townCenterTower';
import type { Player } from '../../Player';
import { drawKrasueSprite } from '../../sprites/krasueSprite';
import { TURN_VALVE_ROWS } from '../../sprites/art/humanFigure';
import { drawSightFan } from '../../ui/world/worldSightFan';
import { drawSuspicionMarker } from '../../ui/world/suspicionMarker';
import { TownCats } from '../critters/TownCats';
import type { SystemContext } from '../GameSystem';
import { TimingInteraction, type TimingInteractionDef, type TimingPress } from '../MashInteraction';
import type { WorkChannelBuilder } from '../WorkChannel';
import { StoreyWorks, tileCentrePx, tileOriginPx, type StoreyWorksDeps } from './storeyWorks';
import type { InteriorFigure } from '../../core/rendering/InteriorFigure';

/** Jostles a latch takes to give. */
const LATCH_PRESSES = 4;
/** From the crawler's centre to the cage's tile centre, in tiles: from the floor in front, or from inside her own. */
const LATCH_REACH_TILES = 1.2;
/** How far a cage's art stands above its tile; the latch's prompt and bar clear it. */
const CAGE_ART_RISE_TILES = 0.6;
const CAGE_ART_RISE_PX = TILE_SIZE * CAGE_ART_RISE_TILES;

const LATCH_DEF: TimingInteractionDef = {
  pressesRequired: LATCH_PRESSES,
  deed: 'jostle the latch',
  humanRows: TURN_VALVE_ROWS,
  barStyle: 'timingClear',
  watchedBarStyle: 'timingWatched',
  reachTiles: LATCH_REACH_TILES,
  artRisePx: CAGE_ART_RISE_PX,
};

// ── The keeper's round ───────────────────────────────────────────────────────

/** Frames of each beat of the keeper's round, in order. */
const KEEPER_LOOK_FRAMES = 200;
const KEEPER_TURN_FRAMES = 45;
const KEEPER_AWAY_FRAMES = 260;
/** How much longer it stares at the room after seeing a paw at a latch. */
const KEEPER_SEEN_STARE_FRAMES = 150;
/** Where it floats while it watches the room, and where it gazes up at the window from. */
const KEEPER_WATCH_POST: TowerTile = { x: 9, y: 8 };
const KEEPER_WINDOW_POST: TowerTile = { x: 9, y: 4 };
/** How far it drifts side to side while it watches, in tiles, and how fast. */
const KEEPER_DRIFT_TILES = 2.5;
const KEEPER_DRIFT_PERIOD_FRAMES = 420;
const KEEPER_FLOAT_SPEED = 0.12;
/** Its look: a wide fan over the floor, which it is looking at the room within. */
const LOOK_HALF_SHARE_OF_PI = 0.42;
const LOOK_HALF_ANGLE = Math.PI * LOOK_HALF_SHARE_OF_PI;
const LOOK_REACH_TILES = 9;
/** The look counts as on the room while it points within this of straight down the room. */
const LOOKING_WITHIN_SHARE_OF_PI = 0.35;
const LOOKING_WITHIN = Math.PI * LOOKING_WITHIN_SHARE_OF_PI;
const FACING_ROOM = Math.PI / 2;
const FACING_WINDOW = -Math.PI / 2;
/** Its marker floats this far above its tile. */
const MARKER_LIFT_TILES = 1.1;
const MARKER_LIFT_PX = TILE_SIZE * MARKER_LIFT_TILES;
/** How long its `!` stays up after a seen jostle. */
const ALARM_FRAMES = 60;

type KeeperBeat = 'look' | 'turn_away' | 'away' | 'turn_back';

const BEAT_FRAMES: Readonly<Record<KeeperBeat, number>> = {
  look: KEEPER_LOOK_FRAMES,
  turn_away: KEEPER_TURN_FRAMES,
  away: KEEPER_AWAY_FRAMES,
  turn_back: KEEPER_TURN_FRAMES,
};
const NEXT_BEAT: Readonly<Record<KeeperBeat, KeeperBeat>> = {
  look: 'turn_away',
  turn_away: 'away',
  away: 'turn_back',
  turn_back: 'look',
};

// ── Freed cats ───────────────────────────────────────────────────────────────

/** How far out from the wall a freed cat first bolts, in tiles, clear of the cages beside hers. */
const BOLT_OUT_TILES = 3;
/** The open row the freed cats run along to the stair: no pillar stands in it. */
const STAIR_RUN_ROW = 4;
const HALF = 0.5;

interface Latch {
  readonly occupant: CatteryCageOccupant;
  readonly tile: TowerTile;
  readonly work: TimingInteraction;
}

interface Runaway {
  readonly cat: TownCatId;
  readonly legs: TowerTile[];
}

/** What the cattery is handed about the cellmate, who is the scene's companion once she is out. */
export interface CatteryCellmate {
  readonly body: () => CatAlly | null;
  /** Brings her out on the cattery, shut in her cage on `tile`. */
  readonly bringOut: (tile: TowerTile) => CatAlly | null;
  /** Lets her out of her cage: from now on she goes where Belle goes. */
  readonly joinCat: () => void;
}

export interface CatteryWorksDeps extends StoreyWorksDeps {
  readonly cellmate: CatteryCellmate;
}

export class CatteryWorks extends StoreyWorks {
  private readonly cats: TownCats;
  private readonly latches: Latch[] = [];
  private readonly runaways: Runaway[] = [];
  private beat: KeeperBeat = 'look';
  private beatFrame = 0;
  private clock = 0;
  private stareFrames = 0;
  private alarmFrames = 0;
  private keeperX: number;
  private keeperY: number;
  private lookAngle = FACING_ROOM;
  private floatPhase = 0;

  constructor(private readonly cattery: CatteryWorksDeps) {
    super(cattery);
    const map = cattery.map;
    this.cats = new TownCats((x, y) => map.isWalkable(x, y, 'walker'), Math.random);
    const post = tileOriginPx(KEEPER_WATCH_POST);
    this.keeperX = post.x;
    this.keeperY = post.y;
    if (!this.keeperOnWatch) return;
    for (const occupant of CAGE_OCCUPANTS) {
      if (cattery.conditions.openCages.has(occupant)) continue;
      this.addLatch(occupant);
      if (isTownCat(occupant))
        this.cats.placeCaged(occupant, tileOriginPx(TOWER_CATTERY_CAGES[occupant]));
    }
  }

  /** The keeper keeps its round, and the cages are worked, until the party comes back up together. */
  private get keeperOnWatch(): boolean {
    return !phaseReached(this.deps.progress, 'ascent');
  }

  /** Whether Belle's chapter here is under way: she is in the tower, and so in her cage until she works it open. */
  private get belleHeld(): boolean {
    const { progress } = this.deps;
    return this.keeperOnWatch && phaseReached(progress, 'cattery') && !progress.crawlerCatUncaged;
  }

  private get keeperLooking(): boolean {
    if (this.stareFrames > 0) return true;
    const offRoom = Math.abs(angleBetween(this.lookAngle, FACING_ROOM));
    return offRoom <= LOOKING_WITHIN;
  }

  update(ctx: SystemContext): void {
    this.cats.update();
    this.walkRunaways();
    if (!this.keeperOnWatch) return;
    this.holdCaged(ctx);
    this.stepKeeper();
    for (const latch of this.latches) latch.work.cue(ctx.active);
  }

  tryInteract(ctx: SystemContext): boolean {
    const crawler = ctx.active;
    if (crawler !== ctx.cat) return false;
    for (const latch of this.latches) {
      if (latch.work.isFinished) continue;
      if (this.belleHeld && latch.occupant !== 'crawler_cat') continue;
      if (latch.work.tryInteract(crawler)) return true;
    }
    return false;
  }

  renderWorld(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (!this.keeperOnWatch) return;
    const isStaring = this.stareFrames > 0;
    drawSightFan(ctx, {
      origin: {
        x: this.keeperX + TILE_SIZE * HALF - camX,
        y: this.keeperY + TILE_SIZE * HALF - camY,
      },
      rim: {
        kind: 'arc',
        facingRad: this.lookAngle,
        halfAngleRad: LOOK_HALF_ANGLE,
        reachPx: LOOK_REACH_TILES * TILE_SIZE,
      },
      suspicion: isStaring ? 1 : 0,
    });
  }

  renderEffects(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (!this.keeperOnWatch || this.alarmFrames <= 0) return;
    drawSuspicionMarker(ctx, {
      x: this.keeperX + TILE_SIZE * HALF - camX,
      y: this.keeperY - camY - MARKER_LIFT_PX,
      suspicion: 1,
      alarmed: true,
      nowMs: performance.now(),
    });
  }

  renderInteractionPrompts(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: WorkChannelBuilder,
  ): void {
    for (const latch of this.latches) latch.work.renderProgress(ctx, camX, camY);
    if (!active.isActive || active.crawlerKind !== 'cat') return;
    for (const latch of this.latches) {
      if (this.belleHeld && latch.occupant !== 'crawler_cat') continue;
      if (latch.work.renderPrompt(ctx, camX, camY, active)) return;
    }
  }

  roomFigures(): InteriorFigure[] {
    const figures: InteriorFigure[] = this.cats.cats.map((cat) => ({
      // A hair above the cage's own line, so a caged cat is drawn inside its bars.
      y: cat.y - 1,
      render: (ctx, camX, camY, tileSize) => cat.draw(ctx, camX, camY, tileSize),
    }));
    if (this.keeperOnWatch) {
      figures.push({
        y: this.keeperY,
        render: (ctx, camX, camY, tileSize) =>
          drawKrasueSprite(
            ctx,
            this.keeperX - camX,
            this.keeperY - camY,
            tileSize,
            this.floatPhase,
            this.stareFrames > 0,
            Math.cos(this.lookAngle) >= 0 ? 1 : -1,
          ),
      });
    }
    return figures;
  }

  dispose(): void {
    this.cats.clear();
  }

  // ── Cages ──────────────────────────────────────────────────────────────────

  private addLatch(occupant: CatteryCageOccupant): void {
    const tile = TOWER_CATTERY_CAGES[occupant];
    const work = new TimingInteraction({
      def: LATCH_DEF,
      footprint: { x: tile.x, y: tile.y, w: 1, h: 1 },
      watcher: { isLooking: () => this.keeperLooking },
      onPress: (press) => this.onLatch(occupant, tile, press),
    });
    this.latches.push({ occupant, tile, work });
  }

  private onLatch(occupant: CatteryCageOccupant, tile: TowerTile, press: TimingPress): void {
    const at = tileCentrePx(tile);
    switch (press.kind) {
      case 'advanced':
        this.play('latchJostle', at);
        return;
      case 'seen':
        this.play('keeperShriek', tileCentrePx(KEEPER_WATCH_POST));
        this.stareFrames = KEEPER_SEEN_STARE_FRAMES;
        this.alarmFrames = ALARM_FRAMES;
        this.moment({ kind: 'latch_seen' });
        return;
      case 'finished':
        this.play('cageOpen', at);
        this.openCage(occupant, tile);
        return;
      default: {
        const unhandled: never = press;
        throw new Error(`unhandled latch press ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private openCage(occupant: CatteryCageOccupant, tile: TowerTile): void {
    const { map, progress } = this.deps;
    map.setPlacedInteriorPropVariant(catteryCageId(occupant), CATTERY_CAGE_VARIANT.open);
    map.unblockTilePermanently(tile.x, tile.y);
    if (occupant === 'crawler_cat') {
      progress.crawlerCatUncaged = true;
      this.moment({ kind: 'crawler_cat_uncaged' });
      return;
    }
    if (isTownCat(occupant)) {
      progress.catsFreed.add(occupant);
      this.releaseTownCat(occupant, tile);
      this.moment({ kind: 'town_cat_freed', cat: occupant });
      return;
    }
    progress.cellmateFreed = true;
    this.cattery.cellmate.joinCat();
    this.moment({ kind: 'cellmate_freed' });
  }

  private releaseTownCat(cat: TownCatId, cage: TowerTile): void {
    const outward = cage.x < towerStoreyPlan('cattery').width * HALF ? 1 : -1;
    const front = { x: cage.x + outward * BOLT_OUT_TILES, y: cage.y };
    const stair = towerStoreyPlan('cattery').stairDown;
    const stairLanding = stair === null ? front : { x: stair.x + 1, y: STAIR_RUN_ROW };
    this.cats.free(cat, tileOriginPx(front));
    this.runaways.push({ cat, legs: [{ x: front.x, y: STAIR_RUN_ROW }, stairLanding] });
  }

  /** Each freed cat runs her legs to the stair once her first bolt has settled, and is gone down it. */
  private walkRunaways(): void {
    for (let index = this.runaways.length - 1; index >= 0; index--) {
      const runaway = this.runaways[index];
      const cat = this.cats.cat(runaway.cat);
      if (cat === null) {
        this.runaways.splice(index, 1);
        continue;
      }
      if (cat.isRunning) continue;
      const next = runaway.legs.shift();
      if (next === undefined) {
        this.cats.remove(runaway.cat);
        this.runaways.splice(index, 1);
        continue;
      }
      cat.runTo(tileOriginPx(next));
    }
  }

  /**
   * Keeps Belle in her cage until her own latch gives, and brings the
   * cellmate out sat in hers; caged, nothing can move the cellmate off it.
   */
  private holdCaged(ctx: SystemContext): void {
    if (this.belleHeld && this.present(ctx.cat)) {
      const cage = TOWER_CATTERY_CAGES.crawler_cat;
      ctx.cat.placeAt(cage.x * TILE_SIZE, cage.y * TILE_SIZE);
    }
    if (this.deps.progress.cellmateFreed || !phaseReached(this.deps.progress, 'cattery')) return;
    if (!this.present(ctx.cat)) return;
    if (this.cattery.cellmate.body() !== null) return;
    this.cattery.cellmate.bringOut(TOWER_CATTERY_CAGES.tower_cattery_cellmate);
  }

  private present(crawler: Player): boolean {
    return this.deps.presentCrawlers().includes(crawler);
  }

  // ── The keeper ─────────────────────────────────────────────────────────────

  private stepKeeper(): void {
    this.clock++;
    this.floatPhase = this.clock;
    if (this.alarmFrames > 0) this.alarmFrames--;
    if (this.stareFrames > 0) {
      this.stareFrames--;
      this.lookAngle = FACING_ROOM;
    } else {
      this.beatFrame++;
      if (this.beatFrame >= BEAT_FRAMES[this.beat]) {
        this.beat = NEXT_BEAT[this.beat];
        this.beatFrame = 0;
      }
      this.lookAngle = this.angleForBeat();
    }
    const watching = this.beat === 'look' || this.beat === 'turn_back' || this.stareFrames > 0;
    const post = tileOriginPx(watching ? KEEPER_WATCH_POST : KEEPER_WINDOW_POST);
    const drift = watching
      ? Math.sin((this.clock / KEEPER_DRIFT_PERIOD_FRAMES) * Math.PI * 2) *
        KEEPER_DRIFT_TILES *
        TILE_SIZE
      : 0;
    this.keeperX += (post.x + drift - this.keeperX) * KEEPER_FLOAT_SPEED;
    this.keeperY += (post.y - this.keeperY) * KEEPER_FLOAT_SPEED;
  }

  private angleForBeat(): number {
    const share = this.beatFrame / BEAT_FRAMES[this.beat];
    switch (this.beat) {
      case 'look':
        return FACING_ROOM;
      case 'away':
        return FACING_WINDOW;
      case 'turn_away':
        return FACING_ROOM + (FACING_WINDOW - FACING_ROOM) * share;
      case 'turn_back':
        return FACING_WINDOW + (FACING_ROOM - FACING_WINDOW) * share;
      default: {
        const unhandled: never = this.beat;
        throw new Error(`unhandled keeper beat ${String(unhandled)}`);
      }
    }
  }
}

const CAGE_OCCUPANTS = Object.keys(TOWER_CATTERY_CAGES).filter(isCageOccupant);

function isCageOccupant(value: string): value is CatteryCageOccupant {
  return value in TOWER_CATTERY_CAGES;
}

function isTownCat(occupant: CatteryCageOccupant): occupant is TownCatId {
  return TOWN_CAT_IDS.some((cat) => cat === occupant);
}

function angleBetween(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}
