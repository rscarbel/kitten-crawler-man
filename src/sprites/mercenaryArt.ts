import type { MercenaryArtId } from '../core/mercenaryTemplates';
import type { MercenaryDrawState, MercenaryRow } from '../creatures/mercenaries/MercenaryKit';
import {
  drawRockGolemSprite,
  prewarmRockGolemApproach,
  ROCK_GOLEM_ALLY_BODY_PART_KEY,
  type GolemAttack,
} from './rockGolemSprite';
import {
  drawGluteusMaxxSprite,
  gluteusMaxxWalkRadiansPerPixel,
  GLUTEUS_MAXX_HEAD_ABOVE_TILE_TILES,
  GLUTEUS_MAXX_MAX_WALK_RADIANS_PER_TICK,
  prewarmGluteusMaxx,
  prewarmGluteusMaxxCrush,
  prewarmGluteusMaxxReactions,
  type MaxxAction,
} from './gluteusMaxxSprite';
import { MAXX_DEATH_TICKS } from './gluteusMaxxTiming';
import {
  BUCKET_BOY_TILES_PER_WALK_CYCLE,
  drawCrocodilianSprite,
  prewarmBucketBoy,
  type BucketBoyRow,
} from './crocodilianSprite';
import { BUCKET_BOY_DEATH_DURATION_MS, BUCKET_BOY_WALK_FRAMES } from './crocodilianTiming';
import {
  drawSplashZoneSprite,
  prewarmSplashZone,
  prewarmSplashZoneCombat,
  splashZoneWalkRadiansPerPixel,
  SPLASH_ZONE_MAX_WALK_RADIANS_PER_TICK,
  type SplashZoneAction,
} from './splashZoneSprite';
import { SPLASH_ZONE_DEATH_TICKS, SPLASH_ZONE_TICKS_PER_SECOND } from './splashZoneTiming';
import { SPLASH_ZONE_STANDING_TOP_ABOVE_TILE } from './art/splashZoneFigure';
import {
  DONG_HEAD_TOP_ABOVE_TILE,
  DONG_WALK_TILES_PER_CYCLE,
  drawDongQuixoteSprite,
  prewarmDongQuixote,
  prewarmDongQuixoteAction,
  type DongAction,
} from './dongQuixoteSprite';
import { DONG_DEATH_MS, DONG_WALK_FRAMES } from './dongQuixoteTiming';
import {
  FRAME_H as DONG_FRAME_H,
  FRAME_W as DONG_FRAME_W,
  TILE_SCALE as DONG_TILE_SCALE,
  TILE_X as DONG_TILE_X,
  TILE_Y as DONG_TILE_Y,
} from './art/dongQuixoteFigure';
import {
  drawCretinSprite,
  prewarmCretin,
  prewarmCretinRows,
  prewarmCretinShield,
  type CretinAction,
  type CretinVariant,
} from './cretinSprite';
import {
  CRETIN_CAST_SHIELD_FRAMES,
  CRETIN_CAST_SHIELD_TICKS_PER_FRAME,
  CRETIN_DEATH_FRAMES,
  CRETIN_DEATH_TICKS_PER_FRAME,
  CRETIN_DRAW_SCALE,
  CRETIN_HURT_FRAMES,
  CRETIN_HURT_TICKS_PER_FRAME,
  CRETIN_PUNCH_FRAMES,
  CRETIN_PUNCH_TICKS_PER_FRAME,
  CRETIN_ROBOT_FRAMES,
  CRETIN_ROBOT_TICKS_PER_FRAME,
  CRETIN_WALK_FRAMES,
  CRETIN_WALK_TILES_PER_CYCLE,
} from './cretinTiming';
import { FIGURE_HEIGHT as CRETIN_FIGURE_HEIGHT_TILES } from './art/cretinArt';
import { CRETIN_TILE_X, CRETIN_TILE_Y, TILE_SCALE as CRETIN_TILE_SCALE } from './art/cretinFigure';

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
  /** Frames the `death` row plays before the body lies still as a corpse. */
  readonly deathFrames: number;
  /**
   * The `BodyPartGoreSystem` registry key a dying hireling scatters rubble
   * from, in place of the shell's fall-over corpse. Null or omitted means the
   * shell's own tip-and-lie death is what the player sees.
   */
  readonly goreBodyPartKey?: string | null;
  /**
   * Warms the rows a hire walks out of the club already needing. Called when
   * the contract is signed, not when the hireling first renders.
   */
  prewarm(): void;
  /**
   * Warms the rows a fight needs that walking out of the club does not — a
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
  /**
   * Tiles the health bar is raised above its usual place over the tile's top
   * edge, for a figure whose head would otherwise sit under it.
   */
  readonly healthBarLiftTiles?: number;
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

const GOLEM_ATTACK_ROWS: Readonly<Partial<Record<MercenaryRow, GolemAttack>>> = {
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
    const attack = GOLEM_ATTACK_ROWS[frame.state.row] ?? null;
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
  deathFrames: TUMBLEDOWN_DEATH_FRAMES,
  goreBodyPartKey: ROCK_GOLEM_ALLY_BODY_PART_KEY,
  prewarm: () => prewarmRockGolemApproach('rock_golem_ally'),
};

/**
 * The one-shot rows Gluteus Maxx paints. A basic swing he has no row for (a
 * `punch`) falls back to a jab; walking and standing are the sprite's own
 * choice from `isMoving`.
 */
const MAXX_ACTION_ROWS: Readonly<Partial<Record<MercenaryRow, MaxxAction>>> = {
  jab_left: 'jab_left',
  jab_right: 'jab_right',
  punch: 'jab_right',
  crush: 'crush',
  hurt: 'hurt',
  death: 'death',
};
/** His widest ink — the crush hop and a gauntlet at full extension — stays within a tile of his own. */
const MAXX_CULL_MARGIN_TILES = 1;

/**
 * Gluteus Maxx's painted figure. His death row ends on the corpse frame, which
 * a progress of 1 selects, so the shell's hold-and-fade shows the body where
 * it fell.
 */
const GLUTEUS_MAXX_ART: MercenaryArt = {
  draw(ctx, sx, sy, tileSize, frame) {
    const action = MAXX_ACTION_ROWS[frame.state.row] ?? null;
    drawGluteusMaxxSprite(ctx, sx, sy, tileSize, {
      walkFrame: frame.walkFrame,
      isMoving: frame.isMoving,
      facingX: frame.facingX,
      facingY: frame.facingY,
      action,
      actionProgress: frame.state.progress,
    });
  },
  cullMarginTiles: MAXX_CULL_MARGIN_TILES,
  headLiftTiles: GLUTEUS_MAXX_HEAD_ABOVE_TILE_TILES,
  healthBarLiftTiles: GLUTEUS_MAXX_HEAD_ABOVE_TILE_TILES,
  deathFrames: MAXX_DEATH_TICKS,
  prewarm: prewarmGluteusMaxx,
  prewarmForFight: () => {
    prewarmGluteusMaxxReactions();
    prewarmGluteusMaxxCrush();
  },
  gait: {
    radiansPerPixel: gluteusMaxxWalkRadiansPerPixel,
    maxRadiansPerTick: GLUTEUS_MAXX_MAX_WALK_RADIANS_PER_TICK,
  },
};

/** The one-shot rows Splash Zone paints; a row he has no art for plays his idle or walk. */
const SPLASH_ZONE_ACTION_ROWS: Readonly<Partial<Record<MercenaryRow, SplashZoneAction>>> = {
  shoot: 'shoot',
  cast_wave: 'cast_wave',
  hurt: 'hurt',
  death: 'death',
};
/** His widest ink — the crossbow held out, the paws flung forward — stays within a tile of his own. */
const SPLASH_ZONE_CULL_MARGIN_TILES = 1;

/**
 * Splash Zone's painted otter. His death row ends on the corpse frame, which a
 * progress of 1 selects, so the shell's hold-and-fade shows him where he fell.
 * The idle bounce runs on the hireling's own clock, so it never falls into step
 * with anything else on screen.
 */
const SPLASH_ZONE_ART: MercenaryArt = {
  draw(ctx, sx, sy, tileSize, frame) {
    drawSplashZoneSprite(ctx, sx, sy, tileSize, {
      walkFrame: frame.walkFrame,
      isMoving: frame.isMoving,
      facingX: frame.facingX,
      facingY: frame.facingY,
      action: SPLASH_ZONE_ACTION_ROWS[frame.state.row] ?? null,
      actionProgress: frame.state.progress,
      idleSeconds: frame.clock / SPLASH_ZONE_TICKS_PER_SECOND,
    });
  },
  cullMarginTiles: SPLASH_ZONE_CULL_MARGIN_TILES,
  headLiftTiles: SPLASH_ZONE_STANDING_TOP_ABOVE_TILE,
  deathFrames: SPLASH_ZONE_DEATH_TICKS,
  prewarm: prewarmSplashZone,
  prewarmForFight: prewarmSplashZoneCombat,
  gait: {
    radiansPerPixel: splashZoneWalkRadiansPerPixel,
    maxRadiansPerTick: SPLASH_ZONE_MAX_WALK_RADIANS_PER_TICK,
  },
};

/** Every hireling row Bucket Boy paints; anything else plays his idle or walk. */
const BUCKET_BOY_ROWS: Readonly<Partial<Record<MercenaryRow, BucketBoyRow>>> = {
  idle: 'idle',
  walk: 'walk',
  flee: 'flee',
  slap: 'slap',
  cast_triage: 'cast_triage',
  cower: 'cower',
  hurt: 'hurt',
  death: 'death',
};
const BUCKET_BOY_TICKS_PER_SECOND = 60;
const BUCKET_BOY_MS_PER_SECOND = 1000;
const BUCKET_BOY_DEATH_TICKS = Math.round(
  (BUCKET_BOY_DEATH_DURATION_MS * BUCKET_BOY_TICKS_PER_SECOND) / BUCKET_BOY_MS_PER_SECOND,
);
/**
 * His crown stands about 1.2 tiles off the ground and the ground line sits
 * near the tile's foot, so his head clears the tile's top edge by this much.
 */
const BUCKET_BOY_HEAD_ABOVE_TILE_TILES = 0.3;
/** His snout and dragged tail reach about a tile past his own either side. */
const BUCKET_BOY_CULL_MARGIN_TILES = 1;
const BUCKET_BOY_FULL_TURN = Math.PI * 2;

/**
 * Bucket Boy's painted crocodilian. The walk is paced by ground covered and
 * capped at one sprite frame per tick: his legs are short and he is quick, so
 * the honest cadence would skip frames of the sixteen-frame row and strobe. The
 * flee row's phase comes from the kit, which moves him while he runs and so
 * knows how far he got, and arrives as the row's `progress`.
 */
const BUCKET_BOY_ART: MercenaryArt = {
  draw(ctx, sx, sy, tileSize, frame) {
    const { row, progress } = frame.state;
    const painted = BUCKET_BOY_ROWS[row] ?? (frame.isMoving ? 'walk' : 'idle');
    const walkFrame = painted === 'flee' ? progress * BUCKET_BOY_FULL_TURN : frame.walkFrame;
    drawCrocodilianSprite(ctx, sx, sy, tileSize, {
      variant: 'bucket_boy',
      row: painted,
      facingX: frame.facingX,
      facingY: frame.facingY,
      walkFrame,
      progress,
      elapsedSeconds: frame.clock / BUCKET_BOY_TICKS_PER_SECOND,
    });
  },
  cullMarginTiles: BUCKET_BOY_CULL_MARGIN_TILES,
  headLiftTiles: BUCKET_BOY_HEAD_ABOVE_TILE_TILES,
  healthBarLiftTiles: BUCKET_BOY_HEAD_ABOVE_TILE_TILES,
  deathFrames: BUCKET_BOY_DEATH_TICKS,
  prewarm: prewarmBucketBoy,
  gait: {
    radiansPerPixel: (tileSize) =>
      BUCKET_BOY_FULL_TURN / (BUCKET_BOY_TILES_PER_WALK_CYCLE * tileSize),
    maxRadiansPerTick: BUCKET_BOY_FULL_TURN / BUCKET_BOY_WALK_FRAMES,
  },
};

/**
 * The rows Dong Quixote paints under the name the kit asks for. A basic swing
 * he has no row for (a `punch`, a jab) falls back to the lance thrust; anything
 * else he has no art for plays his walk or his breathing idle.
 */
const DONG_ACTION_ROWS: Readonly<Partial<Record<MercenaryRow, DongAction>>> = {
  idle: 'idle',
  walk: 'walk',
  thrust: 'thrust',
  punch: 'thrust',
  jab_left: 'thrust',
  jab_right: 'thrust',
  charge_windup: 'charge_windup',
  charge: 'charge',
  charge_recover: 'charge_recover',
  salute: 'salute',
  hurt: 'hurt',
  death: 'death',
};
const DONG_TICKS_PER_SECOND = 60;
const DONG_MS_PER_SECOND = 1000;
const DONG_MS_PER_TICK = DONG_MS_PER_SECOND / DONG_TICKS_PER_SECOND;
const DONG_DEATH_TICKS = Math.round(DONG_DEATH_MS / DONG_MS_PER_TICK);
const DONG_FULL_TURN = Math.PI * 2;
/**
 * The furthest his cell reaches past his own tile on any side — the couched
 * lance ahead, the saluting point above — rounded up to whole tiles, so the
 * whole of him stays on screen until it is off. Either side counts as the
 * right, since the profile is mirrored for a left facing.
 */
const DONG_CULL_MARGIN_TILES = Math.ceil(
  Math.max(
    DONG_TILE_X,
    DONG_TILE_Y,
    DONG_FRAME_W - DONG_TILE_X - DONG_TILE_SCALE,
    DONG_FRAME_H - DONG_TILE_Y - DONG_TILE_SCALE,
  ) / DONG_TILE_SCALE,
);
/** The most his walk may turn in a tick: one frame of the row, so a shove never strobes his legs. */
const DONG_MAX_WALK_RADIANS_PER_TICK = DONG_FULL_TURN / DONG_WALK_FRAMES;

/**
 * Dong Quixote's painted figure. The walk's phase is the shell's walk angle as
 * a share of a turn, which the gait below turns by ground covered; the charge
 * carries its own phase in `progress`, paced by the kit on the ground the
 * charge covers. His death row ends on the corpse frame, which a progress of 1
 * selects, so the shell's hold-and-fade shows him where he fell.
 */
const DONG_QUIXOTE_ART: MercenaryArt = {
  draw(ctx, sx, sy, tileSize, frame) {
    const { row, progress } = frame.state;
    const fallback: DongAction = frame.isMoving ? 'walk' : 'idle';
    const action = DONG_ACTION_ROWS[row] ?? fallback;
    drawDongQuixoteSprite(ctx, sx, sy, tileSize, {
      facingX: frame.facingX,
      facingY: frame.facingY,
      action,
      progress: action === 'walk' ? frame.walkFrame / DONG_FULL_TURN : progress,
      clockMs: frame.clock * DONG_MS_PER_TICK,
    });
  },
  cullMarginTiles: DONG_CULL_MARGIN_TILES,
  headLiftTiles: DONG_HEAD_TOP_ABOVE_TILE,
  healthBarLiftTiles: DONG_HEAD_TOP_ABOVE_TILE,
  deathFrames: DONG_DEATH_TICKS,
  prewarm: () => {
    prewarmDongQuixote();
    // He salutes the moment he first steps out of the club.
    prewarmDongQuixoteAction('salute');
  },
  prewarmForFight: () => {
    // In the order a fight asks for them: the wind-up can come on the very
    // next frame, the run half a second after it.
    for (const action of [
      'charge_windup',
      'thrust',
      'charge',
      'charge_recover',
      'hurt',
      'salute',
      'death',
    ] as const) {
      prewarmDongQuixoteAction(action);
    }
  },
  gait: {
    radiansPerPixel: (tileSize) => DONG_FULL_TURN / (DONG_WALK_TILES_PER_CYCLE * tileSize),
    maxRadiansPerTick: DONG_MAX_WALK_RADIANS_PER_TICK,
  },
};

/**
 * The Cretin row each hireling row plays. Any blow the kit names is drawn as
 * the punch, the only strike a cretin has; a row it has no art for plays its
 * walk or idle.
 */
const CRETIN_ACTION_ROWS: Readonly<Partial<Record<MercenaryRow, CretinAction>>> = {
  idle: 'idle',
  walk: 'walk',
  punch: 'punch',
  jab_left: 'punch',
  jab_right: 'punch',
  slam: 'punch',
  crush: 'punch',
  slap: 'punch',
  cast_shield: 'cast_shield',
  robot: 'robot',
  hurt: 'hurt',
  death: 'death',
};

/** Ticks each row plays for, one pass, so a kit's `progress` turns back into the row's own clock. */
const CRETIN_ROW_TICKS: Readonly<Record<Exclude<CretinAction, 'idle' | 'walk'>, number>> = {
  punch: CRETIN_PUNCH_FRAMES * CRETIN_PUNCH_TICKS_PER_FRAME,
  cast_shield: CRETIN_CAST_SHIELD_FRAMES * CRETIN_CAST_SHIELD_TICKS_PER_FRAME,
  robot: CRETIN_ROBOT_FRAMES * CRETIN_ROBOT_TICKS_PER_FRAME,
  hurt: CRETIN_HURT_FRAMES * CRETIN_HURT_TICKS_PER_FRAME,
  death: CRETIN_DEATH_FRAMES * CRETIN_DEATH_TICKS_PER_FRAME,
};

const CRETIN_FULL_TURN = Math.PI * 2;
/** The figure's feet stand on its tile's bottom edge, one tile below the top edge. */
const CRETIN_TILE_HEIGHT_TILES = 1;
/** Crown to sole on screen, less the tile it stands in: how far the head clears the tile's top. */
const CRETIN_HEAD_ABOVE_TILE_TILES =
  CRETIN_FIGURE_HEIGHT_TILES * CRETIN_DRAW_SCALE - CRETIN_TILE_HEIGHT_TILES;
/**
 * His cell runs about a tile past his own to either side for the robot's
 * straight arm and two and a half up for the shield glyph; rounded up so the
 * whole of it stays on screen until it is off.
 */
const CRETIN_CULL_MARGIN_TILES = Math.ceil(
  Math.max(CRETIN_TILE_X, CRETIN_TILE_Y) / CRETIN_TILE_SCALE,
);

/**
 * A hired Cretin's painted figure. One-shot rows are drawn at the kit's
 * `progress` through them, so the fist lands on screen on the tick the kit
 * lands the blow; the idle breathes on the hireling's own clock. The death row
 * ends on the rubble pile, which a progress of 1 selects, so the shell's
 * hold-and-fade shows the pile where he fell.
 */
function cretinHireArt(variant: CretinVariant, fightRows: readonly CretinAction[]): MercenaryArt {
  return {
    draw(ctx, sx, sy, tileSize, frame) {
      const { row, progress } = frame.state;
      const fallback: CretinAction = frame.isMoving ? 'walk' : 'idle';
      const action = CRETIN_ACTION_ROWS[row] ?? fallback;
      const ticks =
        action === 'idle' || action === 'walk' ? frame.clock : progress * CRETIN_ROW_TICKS[action];
      drawCretinSprite(ctx, sx, sy, tileSize, {
        variant,
        row: action,
        facingX: frame.facingX,
        facingY: frame.facingY,
        walkPhase: frame.walkFrame,
        ticks,
      });
    },
    cullMarginTiles: CRETIN_CULL_MARGIN_TILES,
    headLiftTiles: CRETIN_HEAD_ABOVE_TILE_TILES,
    healthBarLiftTiles: CRETIN_HEAD_ABOVE_TILE_TILES,
    deathFrames: CRETIN_ROW_TICKS.death,
    prewarm: () => prewarmCretin(variant),
    prewarmForFight: () => {
      prewarmCretinRows(variant, fightRows);
      prewarmCretinShield();
    },
    gait: {
      radiansPerPixel: (tileSize) => CRETIN_FULL_TURN / (CRETIN_WALK_TILES_PER_CYCLE * tileSize),
      maxRadiansPerTick: CRETIN_FULL_TURN / CRETIN_WALK_FRAMES,
    },
  };
}

/** In the order a fight asks for them: the punch first, the cast soon after. */
const CRETIN_FIGHT_ROWS: readonly CretinAction[] = ['punch', 'cast_shield', 'hurt', 'death'];
/** Sledge alone dances the robot with the cat once the fight is done. */
const SLEDGE_FIGHT_ROWS: readonly CretinAction[] = [...CRETIN_FIGHT_ROWS, 'robot'];

export const MERCENARY_ART: Readonly<Record<MercenaryArtId, MercenaryArt>> = {
  sledge: cretinHireArt('sledge', SLEDGE_FIGHT_ROWS),
  bomo: cretinHireArt('bomo', CRETIN_FIGHT_ROWS),

  dong_quixote: DONG_QUIXOTE_ART,
  splash_zone: SPLASH_ZONE_ART,
  gluteus_maxx: GLUTEUS_MAXX_ART,
  bucket_boy: BUCKET_BOY_ART,
  tumbledown: TUMBLEDOWN_ART,
};
