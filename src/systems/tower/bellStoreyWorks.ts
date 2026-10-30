/**
 * The bell storey. Two great bells hang in the open shaft across the middle
 * of the room, and the only ways over it are three beams a cat walks. The
 * bells swing east and west together, a full swing every two bars of the
 * tower's music, kept to the clock of whichever of its stems is playing (and
 * to the same tempo on the storey's own clock when none is): the west bell
 * swings between the west and middle beams, the east bell between the middle
 * and east beams, and each bell sounds, live, as it reaches the top of its
 * swing over a beam, on the bar's downbeat.
 *
 * The swing never jumps. Its clock runs on at the storey's own pace and is
 * pulled toward the playing stem's beat a little faster or slower each frame,
 * so a stem starting, stopping, changing or looping moves the bells smoothly
 * back onto the music, and every ground warning still fills through all of
 * its beats.
 *
 * A bell crossing a beam sweeps whoever is on that beam's span off it: a
 * little damage, and set down on the floor at the beam's nearer end. Every
 * strike is warned on the ground first, in the red every ground warning is
 * drawn in, its fill growing for a fixed number of beats so the hit lands as
 * the fill meets its outline. The warning is counted in beats, not seconds,
 * so whatever the tempo the warning always leads the strike by the same
 * share of the bar and the beams always stand open for most of each bar.
 *
 * The counterweight's catch needs both plates south of the shaft held at
 * once. The cellmate sits on one of them if, and only if, she has been fed;
 * Belle takes the other. When the catch lets go the counterweight falls, the
 * grate on the ringers' walk is hauled clear, and the kitchen's portcullis
 * rises (`portcullisRaised`). A storey built after that is built with the
 * weight already down.
 */

import type { AudioManager } from '../../audio/AudioManager';
import { MUSIC_STEM_SETS, TOWER_SPLIT_BAR_S, TOWER_SPLIT_BEAT_S } from '../../audio/music/stemSets';
import type { MusicBusId } from '../../audio/sounds';
import { TILE_SIZE } from '../../core/constants';
import type { InteriorFigure } from '../../core/rendering/InteriorFigure';
import type { CatAlly } from '../../creatures/CatAlly';
import {
  BELL_COUNTERWEIGHT,
  BELL_COUNTERWEIGHT_SET_ID,
  BELL_STOREY_BEAMS,
  BELL_STOREY_BEAM_ROWS,
  BELL_STOREY_PLATES,
  type TowerTile,
} from '../../map/town/interiors/townCenterTower';
import type { DamageSource, Player } from '../../Player';
import { drawDangerRegion } from '../../sprites/dangerTelegraph';
import {
  drawGearTrain,
  drawSwingingBell,
  GEAR_TOOTH_SHARE,
  type GearTrainPose,
} from '../../sprites/art/townInterior/rooms/towerWorks';
import type { CompanionDirective } from '../CompanionSystem';
import type { SystemContext } from '../GameSystem';
import {
  StoreyWorks,
  tileCentrePx,
  tileOfBody,
  tileOriginPx,
  type StoreyWorksDeps,
} from './storeyWorks';

/** A full swing, there and back, in bars of the tower's music. */
const SWING_PERIOD_BARS = 2;
const SWING_PERIOD_S = SWING_PERIOD_BARS * TOWER_SPLIT_BAR_S;
/** How many beats ahead of a strike its ground warning appears, and how long either side of it the bell sweeps the beam. */
const WARNING_LEAD_BEATS = 2;
const STRIKE_HALF_WINDOW_BEATS = 0.3;
/** How long the strike's flash lingers after it, in beats. */
const STRIKE_FLASH_BEATS = 0.4;
const BELL_DAMAGE = 5;
const BELL_DAMAGE_SOURCE: DamageSource = { kind: 'environmental', hazard: 'towerBell' };

/** The rows of a beam a bell's mouth sweeps through: its middle, not its ends. */
const STRUCK_ROWS = { y0: BELL_STOREY_BEAM_ROWS.y0 + 1, y1: BELL_STOREY_BEAM_ROWS.y1 - 1 } as const;

/** Where a bell's headstock pivots, in tiles, and how far below it the mouth swings. */
const PIVOT_ROW_TILES = 5.4;
const MOUTH_DROP_TILES = 4;
const BELL_HANG_TILES = 2.2;
const BELL_SIZE_TILES = 1.7;
const BELL_SORT_ROW = BELL_STOREY_BEAM_ROWS.y1;

const { west: WEST_BEAM, middle: MIDDLE_BEAM, east: EAST_BEAM } = BELL_STOREY_BEAMS;

interface Bell {
  /** The beams it swings between: over `west` at the swing's west end, over `east` at its east end. */
  readonly west: number;
  readonly east: number;
}

const WEST_BELL: Bell = { west: WEST_BEAM, east: MIDDLE_BEAM };
const EAST_BELL: Bell = { west: MIDDLE_BEAM, east: EAST_BEAM };
const BELLS: readonly Bell[] = [WEST_BELL, EAST_BELL];

/** A strike due on one beam: which bell, which end of its swing, and how far off it is in beats. */
interface Strike {
  readonly bell: Bell;
  readonly beam: number;
  /** Beats until the strike; negative once it has passed. */
  readonly inBeats: number;
  /** Names this one strike on this beam among every strike the storey's clock has run through. */
  readonly id: StrikeId;
}

type StrikeId = `${number}@${number}`;

const HALF = 0.5;
const FULL_TURN = Math.PI * 2;
const FRAMES_PER_SECOND = 60;
const FRAME_S = 1 / FRAMES_PER_SECOND;
/** The most the swing's clock runs fast or slow while it catches up with the music, as a share of its pace. */
const MAX_CATCH_UP_SHARE = 0.2;
const MAX_CATCH_UP_S = FRAME_S * MAX_CATCH_UP_SHARE;
const BEAM_END_NORTH_ROW = BELL_STOREY_BEAM_ROWS.y0 - 1;
const BEAM_END_SOUTH_ROW = BELL_STOREY_BEAM_ROWS.y1 + 1;

const TOWER_STEMS: readonly MusicBusId[] = MUSIC_STEM_SETS.tower_split;

/** A bell's pivot, in tiles: the middle of the span between the beams it swings over. */
function pivotXTiles(bell: Bell): number {
  return (bell.west + bell.east + 1) * HALF;
}

/**
 * The gear train on the shaft's north lip, which the bells drive: a drive
 * gear on the end of each bell's axle, both meshed with one great gear set
 * between the headstocks, and a chain off a sprocket behind the east drive
 * gear, down the void beside the middle beam to the pulley the
 * counterweight's rope hangs from. It turns on the swing's own clock, so the
 * whole train rocks with the bells.
 */
const DRIVE_GEAR_OFFSET_TILES = 1.55;
const DRIVE_GEAR_RADIUS_TILES = 0.42;
const DRIVE_GEAR_TEETH = 8;
const GREAT_GEAR_RADIUS_TILES = 0.62;
const GREAT_GEAR_TEETH = 12;
const SPROCKET_RADIUS_TILES = 0.22;
/** How far above its weight's tile the counterweight's rope starts, where its pulley carries it. */
const WEIGHT_ROPE_RISE_TILES = 1;
/** Where along a tooth's pitch its middle falls, and where the middle of the gap after it falls. */
const TOOTH_MIDDLE_SHARE = GEAR_TOOTH_SHARE * HALF;
const GAP_MIDDLE_SHARE = GEAR_TOOTH_SHARE + (1 - GEAR_TOOTH_SHARE) * HALF;

const WEST_DRIVE_X = pivotXTiles(WEST_BELL) + DRIVE_GEAR_OFFSET_TILES;
const EAST_DRIVE_X = pivotXTiles(EAST_BELL) - DRIVE_GEAR_OFFSET_TILES;
const GREAT_GEAR_X = (WEST_DRIVE_X + EAST_DRIVE_X) * HALF;
const MESH_DISTANCE = DRIVE_GEAR_RADIUS_TILES + GREAT_GEAR_RADIUS_TILES;
const GREAT_GEAR_Y =
  PIVOT_ROW_TILES - Math.sqrt(MESH_DISTANCE ** 2 - (GREAT_GEAR_X - WEST_DRIVE_X) ** 2);
const DRIVE_PITCH = FULL_TURN / DRIVE_GEAR_TEETH;
const GREAT_PITCH = FULL_TURN / GREAT_GEAR_TEETH;
const GREAT_TURN_PER_DRIVE_TURN = -DRIVE_GEAR_TEETH / GREAT_GEAR_TEETH;

/** The direction from the west drive gear to the great gear, where their teeth meet. */
const WEST_MESH_DIRECTION = Math.atan2(GREAT_GEAR_Y - PIVOT_ROW_TILES, GREAT_GEAR_X - WEST_DRIVE_X);
const EAST_MESH_DIRECTION = Math.atan2(PIVOT_ROW_TILES - GREAT_GEAR_Y, EAST_DRIVE_X - GREAT_GEAR_X);
/** Each gear's turn at rest, set so a tooth of one sits in a gap of the other wherever two meet. */
const WEST_DRIVE_REST = WEST_MESH_DIRECTION - DRIVE_PITCH * TOOTH_MIDDLE_SHARE;
const GREAT_REST = WEST_MESH_DIRECTION + Math.PI - GREAT_PITCH * GAP_MIDDLE_SHARE;
const GREAT_PITCH_AT_EAST_MESH = ((((EAST_MESH_DIRECTION - GREAT_REST) / GREAT_PITCH) % 1) + 1) % 1;
const EAST_DRIVE_REST = EAST_MESH_DIRECTION + Math.PI + GREAT_PITCH_AT_EAST_MESH * DRIVE_PITCH;

const CHAIN_X = EAST_DRIVE_X - SPROCKET_RADIUS_TILES;
const ROPE_X = BELL_COUNTERWEIGHT.weightTile.x + HALF;
const PULLEY_Y = BELL_COUNTERWEIGHT.weightTile.y - WEIGHT_ROPE_RISE_TILES;
const PULLEY_RADIUS_TILES = (CHAIN_X - ROPE_X) * HALF;
const PULLEY_X = ROPE_X + PULLEY_RADIUS_TILES;
/** Sorted behind the bells and behind anyone on the shaft's north lip or out on the beams. */
const GEAR_TRAIN_SORT_ROW = BELL_STOREY_BEAM_ROWS.y0 - 1;

/** What the bell storey is handed about the cellmate. */
export interface BellStoreyCellmate {
  readonly body: () => CatAlly | null;
  /** Gives her a standing order, or (null) sends her back to following. */
  readonly order: (directive: CompanionDirective | null) => void;
}

export interface BellStoreyWorksDeps extends StoreyWorksDeps {
  readonly cellmate: BellStoreyCellmate;
  readonly audio: AudioManager | null;
}

export class BellStoreyWorks extends StoreyWorks {
  /** Seconds the swing has run since the storey was built, plus wherever the music first set it. */
  private swingClockS: number;
  private lastSwingS: number | null = null;
  private readonly struckBy = new Map<Player, StrikeId>();
  private plateForCellmate: string | null = null;
  private cellmateSettled = false;
  private readonly stopListening: () => void;

  constructor(private readonly bellDeps: BellStoreyWorksDeps) {
    super(bellDeps);
    this.swingClockS = this.stemPositionS() ?? 0;
    if (bellDeps.progress.portcullisRaised) {
      bellDeps.mechanisms.plates.settleOpen(BELL_COUNTERWEIGHT_SET_ID);
    }
    this.stopListening = bellDeps.bus.on('plateSetOpened', (opened) => {
      if (opened.set !== BELL_COUNTERWEIGHT_SET_ID) return;
      this.plateForCellmate = null;
      this.bellDeps.cellmate.order(null);
    });
  }

  enter(_ctx: SystemContext): void {
    if (this.deps.progress.phase === 'archive') this.moment({ kind: 'archive_crossed' });
  }

  /** How far into its recording a tower stem stands, or null when none is sounding. */
  private stemPositionS(): number | null {
    const music = this.bellDeps.audio?.music ?? null;
    const track = music?.audibleTrack ?? null;
    const position = music?.audiblePositionS ?? null;
    if (track === null || position === null || !TOWER_STEMS.includes(track)) return null;
    return position;
  }

  /** One frame of the swing's clock, eased toward the stem's beat when one is sounding. */
  private advanceSwingClock(): void {
    let stepS = FRAME_S;
    const stemS = this.stemPositionS();
    if (stemS !== null) {
      const behindS = BellStoreyWorks.nearestInPeriod(stemS - (this.swingClockS + FRAME_S));
      stepS += Math.max(-MAX_CATCH_UP_S, Math.min(MAX_CATCH_UP_S, behindS));
    }
    this.swingClockS += stepS;
  }

  /** `seconds` moved by whole swings to lie within half a swing of zero. */
  private static nearestInPeriod(seconds: number): number {
    return seconds - Math.round(seconds / SWING_PERIOD_S) * SWING_PERIOD_S;
  }

  /** The west-to-east share of the swing: 0 at the west end (the downbeat of each odd bar), 1 at the east. */
  private static swingShare(seconds: number): number {
    return HALF - HALF * Math.cos((seconds / SWING_PERIOD_S) * FULL_TURN);
  }

  /** The strikes due within the warning lead or just past, on every beam. */
  private strikes(seconds: number): Strike[] {
    const strikes: Strike[] = [];
    const periodBeats = SWING_PERIOD_S / TOWER_SPLIT_BEAT_S;
    const nowBeats = seconds / TOWER_SPLIT_BEAT_S;
    for (const bell of BELLS) {
      for (const [beam, atBeats] of [
        [bell.west, 0],
        [bell.east, periodBeats * HALF],
      ] as const) {
        const inBeats =
          BellStoreyWorks.nearestInPeriod((atBeats - nowBeats) * TOWER_SPLIT_BEAT_S) /
          TOWER_SPLIT_BEAT_S;
        const halfSwingsRun = Math.round((nowBeats + inBeats) / (periodBeats * HALF));
        strikes.push({ bell, beam, inBeats, id: `${beam}@${halfSwingsRun}` });
      }
    }
    return strikes;
  }

  update(ctx: SystemContext): void {
    this.advanceSwingClock();
    const seconds = this.swingClockS;
    this.ringOnTheBeat(seconds);
    for (const strike of this.strikes(seconds)) {
      if (Math.abs(strike.inBeats) > STRIKE_HALF_WINDOW_BEATS) continue;
      for (const crawler of this.deps.presentCrawlers()) this.sweep(crawler, strike);
    }
    this.seatCellmate(ctx);
  }

  renderWorld(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const strike of this.strikes(this.swingClockS)) {
      const flashing = strike.inBeats < 0 && strike.inBeats > -STRIKE_FLASH_BEATS;
      if (strike.inBeats > WARNING_LEAD_BEATS || (strike.inBeats < 0 && !flashing)) continue;
      const tiles: TowerTile[] = [];
      for (let y = STRUCK_ROWS.y0; y <= STRUCK_ROWS.y1; y++) tiles.push({ x: strike.beam, y });
      const fill = flashing ? 1 : 1 - strike.inBeats / WARNING_LEAD_BEATS;
      drawDangerRegion(ctx, tiles, TILE_SIZE, camX, camY, 1, {
        fillProgress: fill,
        locked: strike.inBeats < STRIKE_HALF_WINDOW_BEATS,
        strikeFlash: flashing ? 1 + strike.inBeats / STRIKE_FLASH_BEATS : 0,
      });
    }
  }

  roomFigures(): InteriorFigure[] {
    const angle = BellStoreyWorks.bellAngle(this.swingClockS);
    const bells = BELLS.map((bell): InteriorFigure => {
      const pivotX = pivotXTiles(bell) * TILE_SIZE;
      const pivotY = PIVOT_ROW_TILES * TILE_SIZE;
      return {
        y: BELL_SORT_ROW * TILE_SIZE,
        render: (ctx, camX, camY, tileSize) =>
          drawSwingingBell(
            ctx,
            pivotX - camX,
            pivotY - camY,
            BELL_SIZE_TILES * tileSize,
            angle,
            BELL_HANG_TILES * tileSize,
          ),
      };
    });
    const gearTrain: InteriorFigure = {
      y: GEAR_TRAIN_SORT_ROW * TILE_SIZE,
      render: (ctx, camX, camY, tileSize) =>
        drawGearTrain(ctx, BellStoreyWorks.gearTrainPose(angle, camX, camY, tileSize), tileSize),
    };
    return [gearTrain, ...bells];
  }

  /**
   * How far the bells hang from plumb, in radians, at `seconds` into the
   * swing. Both bells swing together, so it is the same for each.
   */
  private static bellAngle(seconds: number): number {
    const share = BellStoreyWorks.swingShare(seconds);
    const mouthOffsetTiles = (WEST_BELL.east - WEST_BELL.west) * (share - HALF);
    return -Math.asin(Math.max(-1, Math.min(1, mouthOffsetTiles / MOUTH_DROP_TILES)));
  }

  /** The gear train turned as far as the bells have swung, in screen pixels. */
  private static gearTrainPose(
    bellAngle: number,
    camX: number,
    camY: number,
    tileSize: number,
  ): GearTrainPose {
    const px = (tiles: number): number => tiles * tileSize;
    const screenX = (tiles: number): number => px(tiles) - camX;
    const screenY = (tiles: number): number => px(tiles) - camY;
    const pivotY = screenY(PIVOT_ROW_TILES);
    const chainTravel = -bellAngle * px(SPROCKET_RADIUS_TILES);
    const driveGear = (x: number, rest: number) => ({
      x: screenX(x),
      y: pivotY,
      radius: px(DRIVE_GEAR_RADIUS_TILES),
      teeth: DRIVE_GEAR_TEETH,
      angle: rest + bellAngle,
    });
    return {
      shafts: [
        { x0: screenX(pivotXTiles(WEST_BELL)), x1: screenX(WEST_DRIVE_X), y: pivotY },
        { x0: screenX(EAST_DRIVE_X), x1: screenX(pivotXTiles(EAST_BELL)), y: pivotY },
      ],
      gears: [
        driveGear(WEST_DRIVE_X, WEST_DRIVE_REST),
        driveGear(EAST_DRIVE_X, EAST_DRIVE_REST),
        {
          x: screenX(GREAT_GEAR_X),
          y: screenY(GREAT_GEAR_Y),
          radius: px(GREAT_GEAR_RADIUS_TILES),
          teeth: GREAT_GEAR_TEETH,
          angle: GREAT_REST + bellAngle * GREAT_TURN_PER_DRIVE_TURN,
        },
      ],
      chain: { x: screenX(CHAIN_X), y0: pivotY, y1: screenY(PULLEY_Y), travel: chainTravel },
      pulley: {
        x: screenX(PULLEY_X),
        y: screenY(PULLEY_Y),
        radius: px(PULLEY_RADIUS_TILES),
        angle: chainTravel / px(PULLEY_RADIUS_TILES),
      },
    };
  }

  dispose(): void {
    this.stopListening();
  }

  /** Each bell sounds as it reaches either end of its swing, which falls on a bar's downbeat. */
  private ringOnTheBeat(seconds: number): void {
    const last = this.lastSwingS;
    this.lastSwingS = seconds;
    if (last === null) return;
    const halfPeriod = SWING_PERIOD_S * HALF;
    const swingEnd = Math.floor(seconds / halfPeriod);
    if (swingEnd === Math.floor(last / halfPeriod)) return;
    const atEastEnd = swingEnd % 2 !== 0;
    for (const bell of BELLS) {
      const beam = atEastEnd ? bell.east : bell.west;
      this.play('bellToll', tileCentrePx({ x: beam, y: BELL_STOREY_BEAM_ROWS.y0 }));
    }
  }

  /** A bell crossing `strike.beam` sweeps a crawler standing on its span, once a strike. */
  private sweep(crawler: Player, strike: Strike): void {
    const feet = tileOfBody(crawler);
    if (feet.x !== strike.beam || feet.y < STRUCK_ROWS.y0 || feet.y > STRUCK_ROWS.y1) return;
    if (this.struckBy.get(crawler) === strike.id) return;
    this.struckBy.set(crawler, strike.id);
    crawler.takeDamage(BELL_DAMAGE, BELL_DAMAGE_SOURCE);
    this.play('bellStrike', tileCentrePx(feet));
    const middle = (BELL_STOREY_BEAM_ROWS.y0 + BELL_STOREY_BEAM_ROWS.y1) * HALF;
    const endRow = feet.y < middle ? BEAM_END_NORTH_ROW : BEAM_END_SOUTH_ROW;
    const landing = tileOriginPx({ x: strike.beam, y: endRow });
    crawler.x = landing.x;
    crawler.y = landing.y;
    this.moment({ kind: 'bell_struck' });
  }

  /**
   * Once she has been fed, the cellmate sits on whichever counterweight plate
   * Belle is not on, east until Belle takes it; unfed, she only follows.
   */
  private seatCellmate(ctx: SystemContext): void {
    const { progress } = this.deps;
    if (!progress.tunaSent || progress.portcullisRaised) return;
    const body = this.bellDeps.cellmate.body();
    if (body === null) return;
    const catFeet = tileOfBody(ctx.cat);
    const { west, east } = BELL_STOREY_PLATES;
    const belleOnEast = catFeet.x === east.at.x && catFeet.y === east.at.y;
    const plate = belleOnEast ? west : east;
    if (this.plateForCellmate !== plate.id) {
      this.plateForCellmate = plate.id;
      this.cellmateSettled = false;
      this.bellDeps.cellmate.order(this.deps.mechanisms.plates.holdSpot(plate.id));
    }
    const settled =
      this.deps.mechanisms.plates.isPlateHeld(plate.id) && tileOfBody(body).x === plate.at.x;
    if (settled && !this.cellmateSettled) this.moment({ kind: 'cellmate_holding_plate' });
    this.cellmateSettled = settled;
  }
}
