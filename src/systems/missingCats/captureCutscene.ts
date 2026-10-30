/**
 * The capture at the plaza fountain, as a cutscene: the carrier settles
 * beside Belle to make a show of taking her, krasue drop out of the dark, the
 * carrier is thrown aside, and Belle is lifted away toward the spire before
 * the screen goes black. Every hit lands on the capture jingle's own clock,
 * so what is said after the jingle starts is said over the scene, never
 * holding it.
 *
 * The krasue and the carrier are not creatures of the street: they are
 * painted bodies that exist for the length of the scene ({@link CaptureStaging}),
 * lent to the script as actors by the ids in {@link CAPTURE_ACTOR_IDS}.
 */

import { TILE_SIZE } from '../../core/constants';
import type { AvielChoice } from '../../core/quests/missingCatsProgress';
import type { CrawlerKind } from '../../core/skills/SkillManager';
import {
  CAROLINE_TO_TAKEN_BELLE,
  CAPTURE_PRETENCE,
  captureSprung,
} from '../../dialog/scripts/scenes/missingCats';
import { drawWingedThief, drawWingedThiefShadow } from '../../sprites/art/missingCatsArt';
import { drawKrasueSprite } from '../../sprites/krasueSprite';
import { stagedActor, type CutsceneActor, type StagedBody } from '../cutscene/cutsceneActors';
import type { CutscenePoint } from '../cutscene/cutsceneCamera';
import { WORLD_TICKS_PER_SECOND } from '../cutscene/CutsceneDirector';
import type { CutsceneScript } from '../cutscene/cutsceneSteps';
import {
  CAPTURE_CUE,
  CAPTURE_CUE_FADED_BY_S,
  CAPTURE_KRASUE_LANDS_AT_S,
  CAPTURE_LIFT_OFF_AT_S,
} from '../../audio/missingCatsSoundCues';

/** The bodies the capture lends its script, besides the crawlers. */
export const CAPTURE_ACTOR_IDS = ['capture_krasue', 'capture_carrier'] as const;
export type CaptureActorId = (typeof CAPTURE_ACTOR_IDS)[number];

/** Who the capture's script can name: the crawlers by kind, and its own two bodies. */
export type CaptureScriptActorId = CrawlerKind | CaptureActorId;

/** Neither staged body walks; each is carried by glides. */
const STAGED_WALK_PX_PER_TICK = 0;

const HALF_TILE = TILE_SIZE / 2;
/** Where each body waits out of sight before its entrance, in tiles above Belle. */
const KRASUE_START_TILES_ABOVE = 9;
const CARRIER_START_TILES_ABOVE = 8;
const CARRIER_START_TILES_WEST = 5;
/** The carrier settles this far east of Belle, on the fountain's rim. */
const CARRIER_PERCH_TILES_EAST = 1;
/** The krasue comes down this far above Belle, so it hangs over her rather than on her. */
const KRASUE_HOVER_TILES_ABOVE = 0.6;
/** Where the blow throws the carrier, from its perch. */
const CARRIER_THROWN_TILES_EAST = 4;
const CARRIER_THROWN_TILES_SOUTH = 1.5;
/** The spire, in tiles north of the tower's front door. */
const SPIRE_TILES_ABOVE_DOOR = 5;
/** The krasue rides a little ahead of Belle as they go up, her head above Belle's back. */
const KRASUE_LIFT_LEAD_TILES = 0.5;

const PAN_FRAMES = 45;
const CARRIER_DESCENT_FRAMES = 90;
const KRASUE_DROP_FRAMES = 30;
const THROW_FRAMES = 20;
const LIFT_FRAMES = 240;
const FADE_FRAMES = 120;
const SETTLE_AFTER_PRETENCE_FRAMES = 20;

/** The cue mark the krasue sets off from, so it lands on the drop's hit. */
const KRASUE_SETS_OFF_AT_S =
  CAPTURE_KRASUE_LANDS_AT_S - KRASUE_DROP_FRAMES / WORLD_TICKS_PER_SECOND;
/** The cue mark the fade starts from, so the screen is black as the cue fades out. */
const FADE_STARTS_AT_S = CAPTURE_CUE_FADED_BY_S - FADE_FRAMES / WORLD_TICKS_PER_SECOND;

/** The krasue's shriek as it lands. */
const KRASUE_SHRIEK = { takes: ['krasue_attack'] } as const;

/** The krasue is drawn at this share of a tile; a head with its trailing viscera reads larger than a cat. */
const KRASUE_SIZE_SHARE = 1.1;
/** The carrier is drawn this many tiles across, the same as the thief over the roofs. */
const CARRIER_SIZE_TILES = 1.4;
const CARRIER_SIZE_PX = TILE_SIZE * CARRIER_SIZE_TILES;
/** How fast the krasue bobs and the carrier's wings beat, in radians a tick. */
const FLOAT_RADIANS_PER_TICK = 0.08;
const FLAP_RADIANS_PER_TICK = 0.25;
/** A thrown carrier tumbles: its heading turns this far a tick while it is on the move. */
const TUMBLE_RADIANS_PER_TICK = 0.35;
/** A settled carrier holds its wings half-folded and faces north, toward the spire. */
const SETTLED_FLAP = 0.3;
const FACING_NORTH_RADIANS = -Math.PI / 2;

function stagedAt(at: CutscenePoint): StagedBody {
  return { x: at.x, y: at.y, facingX: 1, facingY: 0, isMoving: false };
}

function offset(at: CutscenePoint, tilesX: number, tilesY: number): CutscenePoint {
  return { x: at.x + tilesX * TILE_SIZE, y: at.y + tilesY * TILE_SIZE };
}

/**
 * The capture's two painted bodies, from the moment the scene is asked for
 * until the party leaves the street. Each tick they bob and beat their wings;
 * the script moves them.
 */
export class CaptureStaging {
  private readonly krasue: StagedBody;
  private readonly carrier: StagedBody;
  private readonly actors: Readonly<Record<CaptureActorId, CutsceneActor>>;
  private ticks = 0;
  private lastCarrier: CutscenePoint;
  private carrierHeading = FACING_NORTH_RADIANS;
  private carrierMoving = false;
  /** Set once the carrier has come to rest on its perch: any move after that is the blow throwing it. */
  private carrierPerched = false;

  /** `belle` is Belle's tile-origin pixels on the fountain. */
  constructor(belle: CutscenePoint) {
    this.krasue = stagedAt(offset(belle, 0, -KRASUE_START_TILES_ABOVE));
    this.carrier = stagedAt(offset(belle, -CARRIER_START_TILES_WEST, -CARRIER_START_TILES_ABOVE));
    this.lastCarrier = { x: this.carrier.x, y: this.carrier.y };
    this.actors = {
      capture_krasue: stagedActor(this.krasue, STAGED_WALK_PX_PER_TICK, 'walker'),
      capture_carrier: stagedActor(this.carrier, STAGED_WALK_PX_PER_TICK, 'walker'),
    };
  }

  actor(id: CaptureActorId): CutsceneActor {
    return this.actors[id];
  }

  update(): void {
    this.ticks++;
    const movedX = this.carrier.x - this.lastCarrier.x;
    const movedY = this.carrier.y - this.lastCarrier.y;
    const moving = movedX !== 0 || movedY !== 0;
    if (!moving && this.carrierMoving) this.carrierPerched = true;
    this.carrierMoving = moving;
    if (!moving) this.carrierHeading = FACING_NORTH_RADIANS;
    else if (this.carrierPerched) this.carrierHeading += TUMBLE_RADIANS_PER_TICK;
    else this.carrierHeading = Math.atan2(movedY, movedX);
    this.lastCarrier = { x: this.carrier.x, y: this.carrier.y };
  }

  /** On the street under every body: the carrier's shadow. */
  renderGround(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    hides: (body: object) => boolean,
  ): void {
    if (hides(this.carrier)) return;
    ctx.save();
    ctx.translate(this.carrier.x + HALF_TILE - camX, this.carrier.y + HALF_TILE - camY);
    drawWingedThiefShadow(ctx, CARRIER_SIZE_PX);
    ctx.restore();
  }

  /** Over the dusk: the carrier's wings and the krasue. */
  renderAir(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    hides: (body: object) => boolean,
  ): void {
    if (!hides(this.carrier)) {
      const flap = this.carrierMoving ? Math.sin(this.ticks * FLAP_RADIANS_PER_TICK) : SETTLED_FLAP;
      ctx.save();
      ctx.translate(this.carrier.x + HALF_TILE - camX, this.carrier.y + HALF_TILE - camY);
      drawWingedThief(ctx, CARRIER_SIZE_PX, this.carrierHeading, flap, false);
      ctx.restore();
    }
    if (!hides(this.krasue)) {
      drawKrasueSprite(
        ctx,
        this.krasue.x - camX,
        this.krasue.y - camY,
        TILE_SIZE * KRASUE_SIZE_SHARE,
        this.ticks * FLOAT_RADIANS_PER_TICK,
        true,
        this.krasue.facingX,
      );
    }
  }
}

export interface CaptureScriptArgs {
  /** Belle's tile-origin pixels on the fountain. */
  readonly belle: CutscenePoint;
  /** The tower's front door, in tile-origin pixels: the spire stands above it. */
  readonly towerDoor: CutscenePoint;
  readonly choice: AvielChoice;
}

/**
 * The capture's steps. Belle is the crawler being steered, so the scene's
 * own actor for her (`cat`) is the one lifted away.
 */
export function captureScript({
  belle,
  towerDoor,
  choice,
}: CaptureScriptArgs): CutsceneScript<never, CaptureScriptActorId> {
  const perch = offset(belle, CARRIER_PERCH_TILES_EAST, 0);
  const spire = offset(towerDoor, 0, -SPIRE_TILES_ABOVE_DOOR);
  return [
    { kind: 'hideActor', who: 'capture_krasue' },
    { kind: 'panCamera', to: belle, frames: PAN_FRAMES },
    {
      kind: 'glideTo',
      who: 'capture_carrier',
      to: perch,
      frames: CARRIER_DESCENT_FRAMES,
      face: 'left',
      then: 'waitForArrival',
    },
    {
      kind: 'conversation',
      request: { lines: CAPTURE_PRETENCE[choice], reward: null, questRelated: true },
    },
    { kind: 'wait', frames: SETTLE_AFTER_PRETENCE_FRAMES },
    { kind: 'playCue', cue: CAPTURE_CUE },
    { kind: 'waitForCue', cue: CAPTURE_CUE, atS: KRASUE_SETS_OFF_AT_S },
    { kind: 'showActor', who: 'capture_krasue' },
    {
      kind: 'glideTo',
      who: 'capture_krasue',
      to: offset(belle, 0, -KRASUE_HOVER_TILES_ABOVE),
      frames: KRASUE_DROP_FRAMES,
      face: null,
      then: 'waitForArrival',
    },
    { kind: 'sound', cue: KRASUE_SHRIEK, at: belle },
    { kind: 'shake', profile: 'heavy' },
    {
      kind: 'glideTo',
      who: 'capture_carrier',
      to: offset(perch, CARRIER_THROWN_TILES_EAST, CARRIER_THROWN_TILES_SOUTH),
      frames: THROW_FRAMES,
      face: null,
      then: 'waitForArrival',
    },
    {
      kind: 'aside',
      request: { lines: captureSprung(choice), reward: null, questRelated: true },
    },
    { kind: 'waitForCue', cue: CAPTURE_CUE, atS: CAPTURE_LIFT_OFF_AT_S },
    { kind: 'glideTo', who: 'cat', to: spire, frames: LIFT_FRAMES, face: 'up', then: 'carryOn' },
    {
      kind: 'glideTo',
      who: 'capture_krasue',
      to: offset(spire, 0, -KRASUE_LIFT_LEAD_TILES),
      frames: LIFT_FRAMES,
      face: null,
      then: 'carryOn',
    },
    { kind: 'awaitAside' },
    { kind: 'carolineMessage', message: CAROLINE_TO_TAKEN_BELLE, world: 'runs' },
    { kind: 'awaitActor', who: 'cat' },
    { kind: 'hideActor', who: 'cat' },
    { kind: 'hideActor', who: 'capture_krasue' },
    { kind: 'waitForCue', cue: CAPTURE_CUE, atS: FADE_STARTS_AT_S },
    { kind: 'fade', to: 1, frames: FADE_FRAMES },
  ];
}
