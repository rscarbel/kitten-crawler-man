/**
 * The cattery before the Warden knows: nine cages down the side walls, the
 * seven town cats and the cellmate sat in theirs, Belle in hers, and the
 * keeper, a krasue that drifts between the room and the observatory window
 * (`catteryKeeper.ts`).
 *
 * Every cage opens the same way: a cat at its latch jostles it a little at a
 * time, and a jostle only counts while the keeper's back is turned. The keeper
 * keeps a slow round, and the round reads three ways at once: where it floats
 * (down among the cages, or up by the window), which way its look washes the
 * floor, and the colour of the latch's bar. A jostle under its eye is seen: it
 * shrieks, swings its look onto the latch and floats over until the latch is
 * well inside its look, so a cat who stays at it is caught; one who slips out
 * of its look waits out its search before it keeps its round again. The fan
 * only ever warms with how near it is to catching her, so an amber fan always
 * means a catch is coming.
 *
 * Its look is also what it sees. Through Belle's cattery chapter, Belle out of
 * her cage in full view of the fan is caught at a glance, and at its edge
 * puts it on its guard, when any sight of her is the catch: it shrieks, the
 * screen goes dark, and she wakes shut in her own cage again with its latch
 * to work from the start, as the keeper turns away to the window, and
 * whoever walks with her is beside her again. Inside her own cage, even with
 * its door open, she is never caught: that is a safe spot to wait out a look.
 * The heaps of feed sacks and casks about the floor stand tall enough to throw
 * a shadow in the fan, so she waits out its look behind one.
 *
 * Belle wakes in her own cage and works her own latch from inside it; until
 * that latch gives she can reach no other. A town cat let out bolts for the
 * stair and is gone, and is one fewer cat bound in the circle later. The
 * cellmate let out comes along with Belle. Every opening is written to the
 * questline's progress as it happens, so the cattery is built as it was left.
 */

import { TILE_SIZE } from '../../core/constants';
import { crawlerCatCageOpen, phaseReached } from '../../core/quests/missingCatsProgress';
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
import { drawKrasueSprite, krasueFloatPhase } from '../../sprites/krasueSprite';
import { TURN_VALVE_ROWS } from '../../sprites/art/humanFigure';
import { drawSightFan } from '../../ui/world/worldSightFan';
import { drawSuspicionMarker } from '../../ui/world/suspicionMarker';
import { SUSPICION_CAPTURE } from '../stealthKeySnatch/detection';
import { CaptureFade } from './captureFade';
import { CatteryKeeper, keeperSightGrid } from './catteryKeeper';
import { TownCats } from '../critters/TownCats';
import type { SystemContext } from '../GameSystem';
import { TimingInteraction, type TimingInteractionDef, type TimingPress } from '../MashInteraction';
import type { WorkChannelBuilder } from '../WorkChannel';
import {
  sameTile,
  StoreyWorks,
  tileCentrePx,
  tileOfBody,
  tileOriginPx,
  type StoreyWorksDeps,
} from './storeyWorks';
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

// ── The keeper ───────────────────────────────────────────────────────────────

/** Its marker floats this far above its tile. */
const MARKER_LIFT_TILES = 1.1;
const MARKER_LIFT_PX = TILE_SIZE * MARKER_LIFT_TILES;
/** How long its `!` stays up after a seen jostle. */
const ALARM_FRAMES = 60;

/** A notice share at which the marker shows the keeper as having seen. */
const FULL_NOTICE = 1;

const RECAGED_TOAST =
  'The Krasue spotted you and you were locked up. Try not to get seen this time.';

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
  private readonly keeper: CatteryKeeper;
  private readonly capture = new CaptureFade();
  private alarmFrames = 0;

  constructor(private readonly cattery: CatteryWorksDeps) {
    super(cattery);
    const map = cattery.map;
    this.cats = new TownCats((x, y) => map.isWalkable(x, y, 'walker'), Math.random);
    this.keeper = new CatteryKeeper(this.sightGrid());
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

  /** Whether the keeper is on the look-out for Belle, so the party has to keep out of its look. */
  get watched(): boolean {
    return this.keeperHunting;
  }

  /**
   * Whether the keeper catches Belle out of her cage: only while her cattery
   * chapter is played. She can climb back up from a later storey, and a catch
   * then would shut her in a cage her chapter has already left behind.
   */
  private get keeperHunting(): boolean {
    return this.deps.progress.phase === 'cattery';
  }

  /** Whether Belle is in the tower and her cage still shut on her, so she stays in it until she works it open. */
  private get belleHeld(): boolean {
    const { progress } = this.deps;
    return phaseReached(progress, 'cattery') && !crawlerCatCageOpen(progress);
  }

  /** Whether Belle is being caught, which holds her input. */
  get playerLocked(): boolean {
    return this.capture.active;
  }

  /** How dark the capture has the screen. */
  get fadeAlpha(): number {
    return this.capture.alpha;
  }

  update(ctx: SystemContext): void {
    this.cats.update();
    this.walkRunaways();
    if (!this.keeperOnWatch) return;
    this.holdCaged(ctx);
    if (this.capture.active) {
      this.stepCapture(ctx);
      return;
    }
    this.stepKeeper(ctx);
    for (const latch of this.latches) latch.work.cue(ctx.active);
  }

  leave(): void {
    if (!this.capture.active) return;
    this.capture.cancel();
    this.keeper.forget();
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
    const { cone } = this.keeper;
    drawSightFan(ctx, {
      origin: { x: cone.origin.x - camX, y: cone.origin.y - camY },
      rim: { kind: 'rays', ends: cone.ends.map((end) => ({ x: end.x - camX, y: end.y - camY })) },
      suspicion: this.noticeShare,
    });
  }

  renderEffects(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (!this.keeperOnWatch) return;
    const alarmed = this.alarmFrames > 0 || this.capture.active;
    const suspicion = alarmed ? FULL_NOTICE : this.noticeShare;
    if (suspicion <= 0) return;
    drawSuspicionMarker(ctx, {
      x: this.keeper.x + TILE_SIZE * HALF - camX,
      y: this.keeper.y - camY - MARKER_LIFT_PX,
      suspicion,
      alarmed,
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
      const keeper = this.keeper;
      figures.push({
        y: keeper.y,
        render: (ctx, camX, camY, tileSize) =>
          drawKrasueSprite(
            ctx,
            keeper.x - camX,
            keeper.y - camY,
            tileSize,
            krasueFloatPhase(keeper.frames),
            keeper.hunting,
            keeper.facingX,
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
      watcher: { isLooking: () => this.keeper.lookingAtRoom },
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
        this.play('keeperShriek', this.keeperCentre);
        this.keeper.hear(at);
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
    this.keeper.lookOver(this.sightGrid());
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

  /** How near the keeper is to catching Belle, 0 to {@link FULL_NOTICE}. */
  private get noticeShare(): number {
    return this.keeper.suspicion / SUSPICION_CAPTURE;
  }

  private get keeperCentre(): { x: number; y: number } {
    return { x: this.keeper.x + TILE_SIZE * HALF, y: this.keeper.y + TILE_SIZE * HALF };
  }

  private sightGrid(): ReturnType<typeof keeperSightGrid> {
    const plan = towerStoreyPlan('cattery');
    return keeperSightGrid(this.deps.map, plan.width, plan.height);
  }

  /**
   * Belle's body centre while she is out in the room and can be seen, else
   * null. Inside her own cage, open or shut, she is where the keeper means her
   * to be, so it has nothing to catch her for there.
   */
  private bellePoint(ctx: SystemContext): { x: number; y: number } | null {
    const belle = ctx.cat;
    if (!this.keeperHunting || this.belleHeld) return null;
    if (!this.present(belle) || !belle.isAlive) return null;
    if (this.inOwnCage(belle)) return null;
    return { x: belle.x + TILE_SIZE * HALF, y: belle.y + TILE_SIZE * HALF };
  }

  /** Where the party's companions stand while the keeper is on the look-out, each its body centre. */
  private companionPoints(): { x: number; y: number }[] {
    if (!this.keeperHunting) return [];
    return this.deps
      .presentCompanions()
      .filter((companion) => companion.isAlive)
      .map((companion) => ({
        x: companion.x + TILE_SIZE * HALF,
        y: companion.y + TILE_SIZE * HALF,
      }));
  }

  private inOwnCage(belle: Player): boolean {
    return sameTile(tileOfBody(belle), TOWER_CATTERY_CAGES.crawler_cat);
  }

  private stepKeeper(ctx: SystemContext): void {
    if (this.alarmFrames > 0) this.alarmFrames--;
    this.keeper.step(this.bellePoint(ctx), this.companionPoints());
    if (!this.keeper.caught) return;
    this.play('keeperShriek', this.keeperCentre);
    this.capture.begin();
  }

  private stepCapture(ctx: SystemContext): void {
    const step = this.capture.step();
    switch (step.kind) {
      case 'none':
        return;
      case 'reset':
        this.recageBelle(ctx);
        return;
      case 'returning':
        this.deps.toast(RECAGED_TOAST);
        return;
      default: {
        const unhandled: never = step;
        throw new Error(`unhandled capture step ${JSON.stringify(unhandled)}`);
      }
    }
  }

  /** Belle, caught, is shut back in her own cage with its latch to work again from the start. */
  private recageBelle(ctx: SystemContext): void {
    const { map, progress } = this.deps;
    const cage = TOWER_CATTERY_CAGES.crawler_cat;
    progress.crawlerCatUncaged = false;
    map.setPlacedInteriorPropVariant(catteryCageId('crawler_cat'), CATTERY_CAGE_VARIANT.shut);
    map.blockTilePermanently(cage.x, cage.y);
    this.keeper.lookOver(this.sightGrid());
    this.keeper.forget();
    this.keeper.turnAway();
    const stale = this.latches.findIndex((latch) => latch.occupant === 'crawler_cat');
    if (stale >= 0) this.latches.splice(stale, 1);
    this.addLatch('crawler_cat');
    this.holdCaged(ctx);
    // Left where the catch found them, a companion still in the look would
    // put the keeper straight back on its guard, and her first step out
    // would be the next catch.
    this.deps.regroupCompanions();
    this.play('cageShut', tileCentrePx(cage));
    this.moment({ kind: 'crawler_cat_recaged' });
  }
}

const CAGE_OCCUPANTS = Object.keys(TOWER_CATTERY_CAGES).filter(isCageOccupant);

function isCageOccupant(value: string): value is CatteryCageOccupant {
  return value in TOWER_CATTERY_CAGES;
}

function isTownCat(occupant: CatteryCageOccupant): occupant is TownCatId {
  return TOWN_CAT_IDS.some((cat) => cat === occupant);
}
