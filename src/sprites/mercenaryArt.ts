import type { MercenaryArtId } from '../core/party/mercenaryTemplates';
import type { EyePlacement } from './eyePlacement';
import {
  isKitRow,
  type EarthElementalGuardRow,
  type GolemRow,
  type MercenaryDrawState,
} from '../creatures/mercenaries/MercenaryKit';
import {
  drawRockGolemSprite,
  prewarmRockGolemApproach,
  ROCK_GOLEM_ALLY_BODY_PART_KEY,
  ROCK_GOLEM_SHEET_EYES,
  type GolemAttack,
} from './rockGolemSprite';
import { IVY_ASHGROVE_ART } from './ivyAshgroveSprite';
import { BROTHER_ANSELM_ART } from './brotherAnselmSprite';
import {
  drawEarthElementalSprite,
  prewarmEarthElemental,
  prewarmEarthElementalRows,
  prewarmEarthElementalShield,
  type EarthElementalAction,
  type EarthElementalVariant,
} from './earthElementalSprite';
import {
  EARTH_ELEMENTAL_CAST_SHIELD_FRAMES,
  EARTH_ELEMENTAL_CAST_SHIELD_TICKS_PER_FRAME,
  EARTH_ELEMENTAL_DEATH_FRAMES,
  EARTH_ELEMENTAL_DEATH_TICKS_PER_FRAME,
  EARTH_ELEMENTAL_DRAW_SCALE,
  EARTH_ELEMENTAL_HURT_FRAMES,
  EARTH_ELEMENTAL_HURT_TICKS_PER_FRAME,
  EARTH_ELEMENTAL_PUNCH_FRAMES,
  EARTH_ELEMENTAL_PUNCH_TICKS_PER_FRAME,
  EARTH_ELEMENTAL_WALK_FRAMES,
  EARTH_ELEMENTAL_WALK_TILES_PER_CYCLE,
} from './earthElementalTiming';
import { FIGURE_HEIGHT as EARTH_ELEMENTAL_FIGURE_HEIGHT_TILES } from './art/earthElementalArt';
import {
  EARTH_ELEMENTAL_TILE_X,
  EARTH_ELEMENTAL_TILE_Y,
  TILE_SCALE as EARTH_ELEMENTAL_TILE_SCALE,
} from './art/earthElementalFigure';

const EARTH_ELEMENTAL_HIRE_EYES: EyePlacement = {
  sideForward: 0.15,
  sideHeight: -1.17,
  sideSpacing: 0.05,
  frontMirrors: false,
  frontAcross: 0,
  frontHeight: -1.14,
  frontSpacing: 0.13,
};

/**
 * The one place a hireling's look is chosen: every `MercenaryArtId` maps to a
 * {@link MercenaryArt}, and `Mercenary` draws only through it.
 *
 * A figure's sprite module plugs in by replacing its entry in
 * {@link MERCENARY_ART} with an object that draws the requested
 * {@link MercenaryDrawState} row from its own figure — typically through
 * `drawFigureCached`, picking the front, `_side` or `_away` view from the
 * facing it is handed — and warms its approach rows in `prewarm`. Nothing
 * else in the game needs to change when a figure lands.
 */

/** Everything a hireling's figure is told about the frame it is drawing. */
export interface MercenaryArtFrame {
  readonly state: MercenaryDrawState;
  /** The walk cycle angle from `Player.walkFrame` (radians, 0–2π). */
  readonly walkFrame: number;
  readonly isMoving: boolean;
  readonly facingX: number;
  readonly facingY: number;
  /** Frames the hireling has been alive, for loops driven by its own clock. */
  readonly clock: number;
}

export interface MercenaryArt {
  /** Draws the hireling with its tile's top-left at (sx, sy). */
  draw(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    tileSize: number,
    frame: MercenaryArtFrame,
  ): void;
  /** Tiles past its own the figure's ink reaches, or null for the mob default. */
  readonly cullMarginTiles: number | null;
  /** How far above its tile's top edge the figure's head sits, in tiles, for speech. */
  readonly headLiftTiles: number;
  /** Where the hireling's eyes are, for eye-shine in the dark; see `Mob.eyePlacement`. */
  readonly eyes: EyePlacement;
  /** Frames the `death` row plays before the body lies still as a corpse. */
  readonly deathFrames: number;
  /**
   * The `BodyPartGoreSystem` registry key a dying hireling scatters rubble
   * from, in place of the shell's fall-over corpse. Null or omitted means the
   * shell's own tip-and-lie death is what the player sees.
   */
  readonly goreBodyPartKey?: string | null;
  /**
   * Warms the rows a hire steps away from the desk already needing. Called when
   * the contract is signed, not when the hireling first renders.
   */
  prewarm(): void;
  /**
   * Warms the rows a fight needs that following the party does not — a
   * finisher, the flinch, the fall. Called by the shell each time the hireling
   * picks a fight, so a figure whose cells are costly to paint has them ready
   * before the first blow comes. Omitted when `prewarm` already covers them.
   */
  prewarmForFight?(): void;
  /**
   * Paces the walk cycle by ground actually covered, for a figure whose stride
   * is authored against a fixed distance. Omitted, the shell's fixed per-tick
   * walk advance is used.
   */
  readonly gait?: MercenaryGait;
}

/** A walk cycle measured in ground covered rather than in ticks. */
export interface MercenaryGait {
  /** Walk-phase radians per world pixel covered, at a tile size. */
  radiansPerPixel(tileSize: number): number;
  /** The most the phase may turn in one tick, so a shove never strobes the legs. */
  readonly maxRadiansPerTick: number;
}

/**
 * The golem comes apart the moment it dies, so this is only how long the shell
 * holds the (unpainted) body before the fade: about a second.
 */
const TUMBLEDOWN_DEATH_FRAMES = 60;

/** The golem sheet's attack for each row its kit asks for; null plays its walk or idle. */
const GOLEM_ATTACK_ROWS: Readonly<Record<GolemRow, GolemAttack | null>> = {
  idle: null,
  walk: null,
  death: null,
  slam: 'slam',
  stomp: 'stomp',
  throw: 'throw',
};
/** The golem sheet is two tiles tall, so a one-tile cull margin clips its head. */
const GOLEM_CULL_MARGIN_TILES = 2;
const GOLEM_HEAD_LIFT_TILES = 1;

/**
 * Tumbledown: the rock golem figure, with the golem's own rows. It comes
 * apart into flying rubble on death, the same as a hostile golem, and the
 * golem sheet has no fall of its own — so its death row is never painted;
 * `BodyPartGoreSystem` is what the player sees instead.
 */
const TUMBLEDOWN_ART: MercenaryArt = {
  draw(ctx, sx, sy, tileSize, frame) {
    if (frame.state.row === 'death') return;
    const { row } = frame.state;
    const attack = isKitRow(GOLEM_ATTACK_ROWS, row) ? GOLEM_ATTACK_ROWS[row] : null;
    drawRockGolemSprite(ctx, 'rock_golem_ally', sx, sy, tileSize, {
      walkFrame: frame.walkFrame,
      isMoving: frame.isMoving,
      facingX: frame.facingX,
      facingY: frame.facingY,
      attack,
      attackProgress: attack === null ? 0 : frame.state.progress,
    });
  },
  cullMarginTiles: GOLEM_CULL_MARGIN_TILES,
  headLiftTiles: GOLEM_HEAD_LIFT_TILES,
  eyes: ROCK_GOLEM_SHEET_EYES.rock_golem_ally,
  deathFrames: TUMBLEDOWN_DEATH_FRAMES,
  goreBodyPartKey: ROCK_GOLEM_ALLY_BODY_PART_KEY,
  prewarm: () => prewarmRockGolemApproach('rock_golem_ally'),
};

/** The Earth Elemental row each row of the guard kit plays. */
const EARTH_ELEMENTAL_ACTION_ROWS: Readonly<Record<EarthElementalGuardRow, EarthElementalAction>> =
  {
    idle: 'idle',
    walk: 'walk',
    punch: 'punch',
    cast_shield: 'cast_shield',
    hurt: 'hurt',
    death: 'death',
  };

/** Ticks each row plays for, one pass, so a kit's `progress` turns back into the row's own clock. */
const EARTH_ELEMENTAL_ROW_TICKS: Readonly<
  Record<Exclude<EarthElementalAction, 'idle' | 'walk'>, number>
> = {
  punch: EARTH_ELEMENTAL_PUNCH_FRAMES * EARTH_ELEMENTAL_PUNCH_TICKS_PER_FRAME,
  cast_shield: EARTH_ELEMENTAL_CAST_SHIELD_FRAMES * EARTH_ELEMENTAL_CAST_SHIELD_TICKS_PER_FRAME,
  hurt: EARTH_ELEMENTAL_HURT_FRAMES * EARTH_ELEMENTAL_HURT_TICKS_PER_FRAME,
  death: EARTH_ELEMENTAL_DEATH_FRAMES * EARTH_ELEMENTAL_DEATH_TICKS_PER_FRAME,
};

const EARTH_ELEMENTAL_FULL_TURN = Math.PI * 2;
/** The figure's feet stand on its tile's bottom edge, one tile below the top edge. */
const EARTH_ELEMENTAL_TILE_HEIGHT_TILES = 1;
/** Crown to sole on screen, less the tile it stands in: how far the head clears the tile's top. */
const EARTH_ELEMENTAL_HEAD_ABOVE_TILE_TILES =
  EARTH_ELEMENTAL_FIGURE_HEIGHT_TILES * EARTH_ELEMENTAL_DRAW_SCALE -
  EARTH_ELEMENTAL_TILE_HEIGHT_TILES;
/**
 * His cell runs about a tile past his own to either side for a punch's
 * straight arm and two and a half up for the shield glyph; rounded up so the
 * whole of it stays on screen until it is off.
 */
const EARTH_ELEMENTAL_CULL_MARGIN_TILES = Math.ceil(
  Math.max(EARTH_ELEMENTAL_TILE_X, EARTH_ELEMENTAL_TILE_Y) / EARTH_ELEMENTAL_TILE_SCALE,
);

/**
 * A hired Earth Elemental's painted figure. One-shot rows are drawn at the kit's
 * `progress` through them, so the fist lands on screen on the tick the kit
 * lands the blow; the idle breathes on the hireling's own clock. The death row
 * ends on the rubble pile, which a progress of 1 selects, so the shell's
 * hold-and-fade shows the pile where he fell.
 */
function earthElementalHireArt(
  variant: EarthElementalVariant,
  fightRows: readonly EarthElementalAction[],
): MercenaryArt {
  return {
    draw(ctx, sx, sy, tileSize, frame) {
      const { row, progress } = frame.state;
      const fallback: EarthElementalAction = frame.isMoving ? 'walk' : 'idle';
      const action = isKitRow(EARTH_ELEMENTAL_ACTION_ROWS, row)
        ? EARTH_ELEMENTAL_ACTION_ROWS[row]
        : fallback;
      const ticks =
        action === 'idle' || action === 'walk'
          ? frame.clock
          : progress * EARTH_ELEMENTAL_ROW_TICKS[action];
      drawEarthElementalSprite(ctx, sx, sy, tileSize, {
        variant,
        row: action,
        facingX: frame.facingX,
        facingY: frame.facingY,
        walkPhase: frame.walkFrame,
        ticks,
      });
    },
    cullMarginTiles: EARTH_ELEMENTAL_CULL_MARGIN_TILES,
    headLiftTiles: EARTH_ELEMENTAL_HEAD_ABOVE_TILE_TILES,
    eyes: EARTH_ELEMENTAL_HIRE_EYES,
    deathFrames: EARTH_ELEMENTAL_ROW_TICKS.death,
    prewarm: () => prewarmEarthElemental(variant),
    prewarmForFight: () => {
      prewarmEarthElementalRows(variant, fightRows);
      prewarmEarthElementalShield();
    },
    gait: {
      radiansPerPixel: (tileSize) =>
        EARTH_ELEMENTAL_FULL_TURN / (EARTH_ELEMENTAL_WALK_TILES_PER_CYCLE * tileSize),
      maxRadiansPerTick: EARTH_ELEMENTAL_FULL_TURN / EARTH_ELEMENTAL_WALK_FRAMES,
    },
  };
}

/** In the order a fight asks for them: the punch first, the cast soon after. */
const EARTH_ELEMENTAL_FIGHT_ROWS: readonly EarthElementalAction[] = [
  'punch',
  'cast_shield',
  'hurt',
  'death',
];

export const MERCENARY_ART: Readonly<Record<MercenaryArtId, MercenaryArt>> = {
  crush: earthElementalHireArt('crush', EARTH_ELEMENTAL_FIGHT_ROWS),
  hammer_hands: earthElementalHireArt('hammer_hands', EARTH_ELEMENTAL_FIGHT_ROWS),
  ivy_ashgrove: IVY_ASHGROVE_ART,
  brother_anselm: BROTHER_ANSELM_ART,
  tumbledown: TUMBLEDOWN_ART,
};
