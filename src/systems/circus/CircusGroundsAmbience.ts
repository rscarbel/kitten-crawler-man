/**
 * The parts of Grimaldi's grounds that move: the flame lamps' fires, bunting
 * and pennants stirring on their strings, the few festoon bulbs still
 * guttering, the light spilling out of the Big Top's door, the marionette
 * clown swaying under the entry arch, balloons bobbing on their tethers (and
 * one red one drifting loose), and a curtain twitching in the caravan window.
 *
 * All of it is drawn live over the baked structure frames rather than baked as
 * extra sheet rows — an overlay row costs a full frame of memory per cell
 * however little of it is inked, and most of this is a flame or a string.
 * Everything is a pure function of the clock and the quest stage, so nothing
 * here accumulates state a checkpoint would need.
 *
 * Where each piece is drawn is read off the anchors the structure painters
 * leave room for (`circusOverlayAnchors.ts`, the marquee's bulbs and the door
 * mouth in `circusArt.ts`, the king poles and arch height in
 * `circusGroundsLayout.ts`), so the painted half of a prop and its live half
 * cannot drift apart.
 *
 * Once Grimaldi is redeemed the grounds wake: every surviving bulb lights, the
 * door's light warms, and the vine runners baked into the lot die back — the
 * one change that reaches the chunk bake, through `markTileDirty` on the
 * tiles the runners cross and nothing more.
 */

import { TILE_SIZE } from '../../core/constants';
import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import type { GameMap } from '../../map/GameMap';
import {
  BIG_TOP_KING_POLES,
  BIG_TOP_KING_POLE_DEPTH_TILES,
  CIRCUS_ARCH_POST_HEIGHT_TILES,
  CIRCUS_BUNTING_SPANS,
  CIRCUS_FESTOON_SPANS,
  CIRCUS_STRUCTURES,
  type CircusAnchorName,
  type CircusGroundsSite,
  type CircusStructureId,
  type PlacedCircusStructure,
} from '../../map/overworld/circusGroundsLayout';
import { circusVineTiles } from '../../map/tiles/circusDecalTiles';
import { circusGroundsFor } from '../../map/tiles/circusSiteRegistry';
import { tileHash, tileHash01 } from '../../map/tiles/hollowTileHash';
import {
  BIG_TOP_DOOR_MOUTH,
  BIG_TOP_MARQUEE_BULBS,
  BIG_TOP_MARQUEE_BULB_RADIUS_TILES,
  BIG_TOP_TENT,
  CIRCUS_TILE_SCALE,
} from '../../sprites/art/circusArt';
import {
  MARIONETTE,
  MARIONETTE_PIVOT,
  crossbarLayout,
  paintArchCrossbar,
  paintMarionette,
  type CrossbarLayout,
} from '../../sprites/art/circusArchArt';
import {
  CARAVAN_WINDOW,
  FLAME_LAMP_MOUTH,
  FLAME_LAMP_MOUTH_HALF_WIDTH_TILES,
  FLAME_LAMP_TIE,
  PAVILION_PEAK_HEIGHT_TILES,
  PAVILION_POLE_CAP_TILES,
  TICKET_BOOTH_BALLOON_TIE,
  type CircusOverlayAnchor,
} from '../../sprites/art/circusOverlayAnchors';
import type { GlowStop } from '../../sprites/radialGlow';
import { rgba } from '../../sprites/art/town/townArt';
import { getCircusRamp, mix, type RGB } from '../../sprites/art/town/townPalette';
import { mulberry32 } from '../../sprites/person/rng';
import type { TownPropRenderable } from '../townPropRenderable';

type Ctx = CanvasRenderingContext2D;

/** A point in world pixels. */
interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

const BLOOD = getCircusRamp('circus_blood');
const BONE = getCircusRamp('circus_bone');
const BRUISE = getCircusRamp('circus_bruise');
const BRASS = getCircusRamp('circus_brass');
const NAVY = getCircusRamp('circus_navy');
const LIMELIGHT = getCircusRamp('circus_limelight');
const BACKSTAGE = getCircusRamp('circus_backstage');
const ROT_TIMBER = getCircusRamp('circus_rot_timber');
const STAGE_RED = getCircusRamp('circus_stage_red');

const FULL_TURN = Math.PI * 2;
/** Half a tile: from a tile's west edge to its middle. */
const TILE_MIDDLE = 1 / 2;
/** How far past its own anchor a piece's art can reach, in tiles, beyond any span it declares. */
const CULL_MARGIN_TILES = 3;

// ── Anchors ───────────────────────────────────────────────────────────────────

/** A structure's footprint in world pixels: its west edge and its ground line. */
interface Foot {
  readonly left: number;
  readonly ground: number;
  /** World y the structure Y-sorts on: its drawing tile's top, so a piece drawn over it sorts just after it. */
  readonly sortY: number;
}

function footOf(placed: PlacedCircusStructure): Foot {
  const spec = CIRCUS_STRUCTURES[placed.structure];
  return {
    left: placed.rect.x * TILE_SIZE,
    ground: (placed.rect.y + placed.rect.h) * TILE_SIZE,
    sortY: (placed.rect.y + spec.drawTile.dy) * TILE_SIZE,
  };
}

function at(foot: Foot, anchor: CircusOverlayAnchor): WorldPoint {
  return { x: foot.left + anchor.x * TILE_SIZE, y: foot.ground - anchor.up * TILE_SIZE };
}

interface Tie {
  readonly point: WorldPoint;
  readonly sortY: number;
}

function structuresOf(site: CircusGroundsSite, id: CircusStructureId): PlacedCircusStructure[] {
  return site.structures.filter((placed) => placed.structure === id);
}

/** The item at `index`, or undefined past the end: a list the layout may have stood fewer of. */
function itemAt<T>(list: ReadonlyArray<T>, index: number): T | undefined {
  return index < list.length ? list[index] : undefined;
}

function firstOf(
  site: CircusGroundsSite,
  id: CircusStructureId,
): PlacedCircusStructure | undefined {
  return site.structures.find((placed) => placed.structure === id);
}

/** Where every bunting and festoon anchor name lands on this site, or nothing if it was never stood. */
function resolveTies(site: CircusGroundsSite): Map<CircusAnchorName, Tie> {
  const ties = new Map<CircusAnchorName, Tie>();
  const bigTop = firstOf(site, 'big_top');
  if (bigTop !== undefined) {
    const foot = footOf(bigTop);
    const west = itemAt(BIG_TOP_KING_POLES, 0);
    const east = itemAt(BIG_TOP_KING_POLES, 1);
    const pole = (x: number, heightTiles: number): Tie => ({
      point: at(foot, { x, up: BIG_TOP_KING_POLE_DEPTH_TILES + heightTiles }),
      sortY: foot.sortY,
    });
    if (west !== undefined) ties.set('king_pole_west', pole(west.x, west.heightTiles));
    if (east !== undefined) ties.set('king_pole_east', pole(east.x, east.heightTiles));
  }
  const pavilions = ['pavilion_mold_lion', 'pavilion_feats_of_flesh', 'pavilion_fortunes'] as const;
  for (const id of pavilions) {
    const placed = firstOf(site, id);
    if (placed === undefined) continue;
    const foot = footOf(placed);
    const spec = CIRCUS_STRUCTURES[id];
    ties.set(id, {
      point: at(foot, { x: spec.w / 2, up: spec.h / 2 + PAVILION_PEAK_HEIGHT_TILES }),
      sortY: foot.sortY,
    });
  }
  site.torches.forEach((tile, index) => {
    if (tile === null) return;
    const foot: Foot = {
      left: tile.x * TILE_SIZE,
      ground: (tile.y + 1) * TILE_SIZE,
      sortY: tile.y * TILE_SIZE,
    };
    ties.set(`torch_${index}`, { point: at(foot, FLAME_LAMP_TIE), sortY: foot.sortY });
  });
  return ties;
}

// ── Tuning ────────────────────────────────────────────────────────────────────

/** The lamp flame: a few tongues licking up out of the clown's mouth. */
const FLAME = {
  heightTiles: 0.34,
  /** Rates, in radians a second, of the two sines the flame's height rides. */
  rateA: 6.3,
  rateB: 13.7,
  heightSwing: 0.18,
  swaySwing: 0.05,
  tongues: 3,
  glowRadiusTiles: 1.05,
  /** Share of the height swing carried by the slower sine. */
  slowShare: 0.6,
  /** The flame's belly: how wide and how far up its sides bulge, as shares of a tongue. */
  bellyWidth: 0.9,
  bellyHeight: 0.55,
  shortestTongue: 0.7,
  tonguePhaseStep: 2.1,
  glowAlpha: 0.22,
} as const;
const FLAME_OUTER_LIME_SHARE = 0.45;
const FLAME_OUTER: RGB = mix(STAGE_RED.light, LIMELIGHT.mid, FLAME_OUTER_LIME_SHARE);
const FLAME_INNER: RGB = LIMELIGHT.light;
const FLAME_CORE: RGB = LIMELIGHT.accent;
const FLAME_OUTER_ALPHA = 0.9;
const FLAME_INNER_ALPHA = 0.85;
const FLAME_CORE_ALPHA = 0.8;
const FLAME_INNER_SHARE = 0.62;
const FLAME_CORE_SHARE = 0.32;
/** A warm falloff: its shoulder, as an offset out and an alpha there. */
const WARM_GLOW_SHOULDER = { offset: 0.4, alpha: 0.35 } as const;
const FLAME_GLOW_STOPS: ReadonlyArray<GlowStop> = [
  { offset: 0, color: rgba(LIMELIGHT.mid, 1) },
  { offset: WARM_GLOW_SHOULDER.offset, color: rgba(LIMELIGHT.shadow, WARM_GLOW_SHOULDER.alpha) },
  { offset: 1, color: rgba(LIMELIGHT.shadow, 0) },
];

/** Pennant strings: sag, spacing and flutter. */
const STRING_SAG_SHARE = 0.12;
/** `4t(1 - t)` peaks at 1 halfway along. */
const PARABOLA_PEAK_SCALE = 4;
const STRING_SAMPLES = 28;
const STRING_WIDTH_PX = 1;
const STRING_ALPHA = 0.9;
const STRING_COLOUR = rgba(ROT_TIMBER.shadow, STRING_ALPHA);
const PENNANT_SPACING_TILES = 0.42;
const PENNANT_HALF_WIDTH_TILES = 0.11;
const PENNANT_DROP_TILES = 0.26;
const PENNANT_FLUTTER_TILES = 0.07;
const PENNANT_FLUTTER_RATE = 3.1;
const PENNANT_FLUTTER_PHASE_STEP = 0.8;
/** A share of pennants hang torn to half their length, and fewer are gone altogether. */
const PENNANT_TORN_SHARE = 0.18;
const PENNANT_MISSING_SHARE = 0.08;
const PENNANT_TORN_DROP_SHARE = 0.5;
const PENNANT_SHADE_ALPHA = 0.3;
const PENNANT_SHADE_FILL = rgba(BACKSTAGE.shadow, PENNANT_SHADE_ALPHA);
const PENNANT_COLOURS: ReadonlyArray<RGB> = [
  BLOOD.mid,
  BONE.mid,
  BRUISE.light,
  BRASS.mid,
  NAVY.light,
];
const PENNANT_FILLS: ReadonlyArray<string> = PENNANT_COLOURS.map((colour) => rgba(colour, 1));
/** A dropped span hangs limp from its first tie, down to about this far off the ground. */
const DROPPED_LENGTH_SHARE = 0.45;
const DROPPED_MAX_LENGTH_TILES = 2.6;
const DROPPED_SWAY_TILES = 0.12;
const DROPPED_SWAY_RATE = 0.9;
/** Its loose end trails toward where it used to be tied. */
const DROPPED_TRAIL_SHARE = 0.25;

/** The long swallowtail pennant streaming off each king pole and pavilion peak. */
const POLE_PENNANT = {
  lengthTiles: 0.62,
  halfWidthTiles: 0.1,
  segments: 8,
  waveRate: 4.2,
  wavePerSegment: 0.7,
  waveTiles: 0.07,
  forkShare: 0.3,
  outlineAlpha: 0.8,
  stripeAlpha: 0.5,
  stripeTop: 0.3,
  stripeBottom: 0.6,
} as const;
/** The pavilions fly shorter pennants than the Big Top. */
const PAVILION_PENNANT_SCALE = 0.7;

/** Festoon bulbs. */
const BULB_SPACING_TILES = 0.5;
const BULB_RADIUS_TILES = 0.055;
const BULB_SOCKET_RADIUS_TILES = 0.04;
/** Most bulbs are dead; this share still gutters on before the grounds wake. */
const BULB_LIVE_SHARE = 0.14;
const BULB_GLOW_RADIUS_TILES = 0.42;
const BULB_GLOW_ALPHA = 0.55;
/** Dead glass: grey, gone amber-brown with dust. */
const BULB_DEAD: RGB = mix(BACKSTAGE.light, ROT_TIMBER.shadow, 1 / 2);
const BULB_LIT: RGB = LIMELIGHT.light;
const BULB_DEAD_FILL = rgba(BULB_DEAD, 1);
const BULB_SOCKET_FILL = rgba(BACKSTAGE.mid, 1);
const BULB_GLOW_SHOULDER = { offset: 0.35, alpha: 0.4 } as const;
const BULB_GLOW_STOPS: ReadonlyArray<GlowStop> = [
  { offset: 0, color: rgba(LIMELIGHT.light, 1) },
  { offset: BULB_GLOW_SHOULDER.offset, color: rgba(LIMELIGHT.mid, BULB_GLOW_SHOULDER.alpha) },
  { offset: 1, color: rgba(LIMELIGHT.shadow, 0) },
];
/** A guttering bulb's brightness: a stepped noise, so it cuts out rather than pulsing. */
const GUTTER_STEPS_PER_SECOND = 7;
const GUTTER_OUT_SHARE = 0.35;
const GUTTER_DIM = 0.45;
const REDEEMED_SHIMMER = 0.08;
const REDEEMED_SHIMMER_RATE = 2.3;

/** The warm light inside the Big Top's open door. */
const DOOR_SPILL = {
  reachTiles: 2.6,
  /** How much wider than the door the spill has spread at its far end. */
  spread: 2.1,
  alpha: 0.26,
  redeemedAlpha: 0.4,
  flickerRate: 2.7,
  flickerDepth: 0.2,
  mouthGlowTiles: 0.9,
  mouthGlowAlpha: 0.26,
  textureMid: { offset: 0.5, alpha: 0.45 },
  /** How much of each side of the spill fades in, so it has no hard wedge edge. */
  edgeSoftness: 0.3,
} as const;
const DOOR_SPILL_TEXTURE_PX = 64;

/** The marionette's slow swing, and the second, quicker sway riding it. */
const MARIONETTE_SWING = {
  radians: 0.14,
  rate: 0.85,
  flutterRadians: 0.04,
  flutterRate: 2.3,
} as const;
/** How far below its cap the crossbar is hung. */
const CROSSBAR_BELOW_CAP_TILES = 0.1;
/** Where the arch post's cap stands above its own tile's south edge: the post's foot is half a tile into its tile. */
const ARCH_POST_FOOT_UP_TILES = 0.5;

/** Balloons: size, string length, bob and sway. */
const BALLOON = {
  radiusXTiles: 0.16,
  radiusYTiles: 0.2,
  stringTiles: 1.1,
  stringSpreadTiles: 0.28,
  bobTiles: 0.06,
  bobRate: 1.4,
  swayTiles: 0.08,
  swayRate: 0.7,
  /** A faded balloon has gone soft: its bottom sags. */
  sag: 0.08,
  swayPhaseScale: 1.7,
  /** How far along its string toward the balloon the string's bend sits. */
  stringBend: 0.2,
  /** The body's outline: the shoulders' reach and where the widest point sits, as shares of the radii. */
  shoulder: 1.3,
  belly: 0.7,
  outlineAlpha: 0.7,
  shine: { x: -0.35, y: -0.4, rx: 0.25, ry: 0.3, turn: -0.4 },
} as const;
/** How far each balloon's colour has faded toward bone in the sun. */
const BALLOON_FADE = 0.22;
const BALLOON_COLOURS: ReadonlyArray<RGB> = [
  BLOOD.light,
  NAVY.light,
  BRASS.light,
  BRUISE.light,
].map((hue) => mix(hue, BONE.mid, BALLOON_FADE));
const BALLOON_ALPHA = 0.92;
const BALLOON_SHINE_ALPHA = 0.35;
const BALLOON_STRING_ALPHA = 0.6;
const BALLOON_STRING = rgba(BONE.light, BALLOON_STRING_ALPHA);
const BOOTH_BALLOONS = 3;
const ARCH_BALLOONS_PER_POST = 2;

/** The loose red balloon: it rises off the booth, drifts downwind and is gone, then another slips free. */
const LOOSE_BALLOON = {
  periodSeconds: 26,
  riseTiles: 9,
  driftTiles: 6,
  wobbleTiles: 0.5,
  wobbleRate: 1.1,
  fadeInShare: 0.08,
  fadeOutShare: 0.3,
} as const;
const LOOSE_BALLOON_COLOUR: RGB = BLOOD.light;

/** The caravan curtain: closed, with a gap, until it twitches back and something looks out. */
const CURTAIN = {
  periodSeconds: 7.5,
  twitchSeconds: 0.9,
  /** The live half's west edge: where the painted still half stops. */
  stillShare: 0.34,
  closedGapShare: 0.1,
  openGapShare: 0.42,
  folds: 3,
  eyeRadiusTiles: 0.022,
  eyeSpacingTiles: 0.11,
} as const;
/** Stage velvet gone to bruise with damp. */
const CURTAIN_BRUISE_SHARE = 0.4;
const CURTAIN_COLOUR: RGB = mix(STAGE_RED.mid, BRUISE.mid, CURTAIN_BRUISE_SHARE);
const CURTAIN_FOLD: RGB = mix(STAGE_RED.shadow, BRUISE.shadow, CURTAIN_BRUISE_SHARE);
const CURTAIN_EYES: RGB = LIMELIGHT.accent;

/** Salts for the hashes that pick which pennant is torn and which bulb still lights. */
const PENNANT_SALT = 0x9e11a;
const BULB_SALT = 0xb01b;

// ── The system ────────────────────────────────────────────────────────────────

interface Span {
  readonly from: Tie;
  readonly to: Tie;
  readonly dropped: boolean;
  readonly salt: number;
}

interface ArchPaint {
  readonly surface: CanvasSurface;
  readonly layout: CrossbarLayout;
  /** World position of the surface's top-left. */
  readonly origin: WorldPoint;
  readonly sortY: number;
  /** World point the marionette's control bar hangs from. */
  readonly hang: WorldPoint;
}

interface Anchors {
  readonly site: CircusGroundsSite;
  readonly lamps: ReadonlyArray<Tie>;
  readonly pennants: ReadonlyArray<{ readonly tie: Tie; readonly scale: number }>;
  readonly bunting: ReadonlyArray<Span>;
  readonly festoons: ReadonlyArray<Span>;
  readonly arch: ArchPaint | null;
  readonly balloons: ReadonlyArray<{
    readonly tie: Tie;
    readonly count: number;
    readonly salt: number;
  }>;
  readonly looseBalloonFrom: WorldPoint | null;
  readonly curtains: ReadonlyArray<{
    readonly window: { x: number; y: number; w: number; h: number };
    readonly sortY: number;
  }>;
  readonly door: {
    readonly mouth: WorldPoint;
    readonly halfWidth: number;
    readonly sortY: number;
  } | null;
  readonly marquee: { readonly foot: Foot } | null;
}

export class CircusGroundsAmbience {
  private seconds = 0;
  private redeemed = false;
  private anchors: Anchors | null = null;
  private readonly renderables: TownPropRenderable[] = [];
  private marionette: CanvasSurface | null = null;
  private doorSpill: CanvasSurface | null = null;
  private readonly glowSprites = new Map<string, CanvasSurface>();

  /**
   * Advances the clock, picks up the grounds on `gameMap`, and follows the
   * quest into its redeemed state. `redeemed` is read every frame, and the
   * vine runners' tiles are re-baked only on the frame it changes.
   */
  update(gameMap: GameMap, dtSeconds: number, redeemed: boolean): void {
    this.seconds += dtSeconds;
    const site = gameMap.circusGrounds;
    if (site === null) {
      this.anchors = null;
      this.renderables.length = 0;
      return;
    }
    if (this.anchors?.site !== site) this.rebuild(site);
    this.setRedeemed(gameMap, redeemed);
  }

  private setRedeemed(gameMap: GameMap, redeemed: boolean): void {
    this.redeemed = redeemed;
    const record = circusGroundsFor(gameMap.structure);
    if (record === undefined || record.vinesWithered === redeemed) return;
    record.vinesWithered = redeemed;
    for (const tile of circusVineTiles(gameMap.structure)) gameMap.markTileDirty(tile.x, tile.y);
  }

  private rebuild(site: CircusGroundsSite): void {
    const ties = resolveTies(site);
    const spansOf = (
      list: ReadonlyArray<{ from: CircusAnchorName; to: CircusAnchorName; dropped?: boolean }>,
    ): Span[] =>
      list.flatMap((span, index) => {
        const from = ties.get(span.from);
        const to = ties.get(span.to);
        if (from === undefined || to === undefined) return [];
        return [{ from, to, dropped: span.dropped === true, salt: index }];
      });

    const lamps: Tie[] = structuresOf(site, 'flame_lamp').map((placed) => {
      const foot = footOf(placed);
      return { point: at(foot, FLAME_LAMP_MOUTH), sortY: foot.sortY };
    });

    const pennants: Array<{ tie: Tie; scale: number }> = [];
    const bigTopPole = (name: CircusAnchorName): void => {
      const tie = ties.get(name);
      if (tie === undefined) return;
      const cap = BIG_TOP_TENT.poleCapTiles * TILE_SIZE;
      pennants.push({
        tie: { point: { x: tie.point.x, y: tie.point.y - cap }, sortY: tie.sortY },
        scale: 1,
      });
    };
    bigTopPole('king_pole_west');
    bigTopPole('king_pole_east');
    for (const name of [
      'pavilion_mold_lion',
      'pavilion_feats_of_flesh',
      'pavilion_fortunes',
    ] as const) {
      const tie = ties.get(name);
      if (tie === undefined) continue;
      const cap = PAVILION_POLE_CAP_TILES * TILE_SIZE;
      pennants.push({
        tie: { point: { x: tie.point.x, y: tie.point.y - cap }, sortY: tie.sortY },
        scale: PAVILION_PENNANT_SCALE,
      });
    }

    const balloons: Array<{ tie: Tie; count: number; salt: number }> = [];
    let looseBalloonFrom: WorldPoint | null = null;
    for (const booth of structuresOf(site, 'ticket_booth')) {
      const foot = footOf(booth);
      const tie = { point: at(foot, TICKET_BOOTH_BALLOON_TIE), sortY: foot.sortY };
      balloons.push({ tie, count: BOOTH_BALLOONS, salt: balloons.length });
      looseBalloonFrom ??= tie.point;
    }
    const arch = this.paintArch(site);
    // Up the screen the south post's cap is where the sign hangs, so only the
    // north post flies balloons there.
    const archPosts = site.arch?.posts ?? [];
    const balloonPosts = site.arch?.axis === 'east-west' ? archPosts.slice(0, 1) : archPosts;
    for (const post of balloonPosts) {
      const capUp = ARCH_POST_FOOT_UP_TILES + CIRCUS_ARCH_POST_HEIGHT_TILES;
      balloons.push({
        tie: {
          point: { x: (post.x + TILE_MIDDLE) * TILE_SIZE, y: (post.y + 1 - capUp) * TILE_SIZE },
          sortY: post.y * TILE_SIZE,
        },
        count: ARCH_BALLOONS_PER_POST,
        salt: balloons.length,
      });
    }

    const curtains = structuresOf(site, 'clown_caravan').map((placed) => {
      const foot = footOf(placed);
      const topLeft = at(foot, { x: CARAVAN_WINDOW.x, up: CARAVAN_WINDOW.up + CARAVAN_WINDOW.h });
      return {
        window: {
          x: topLeft.x,
          y: topLeft.y,
          w: CARAVAN_WINDOW.w * TILE_SIZE,
          h: CARAVAN_WINDOW.h * TILE_SIZE,
        },
        sortY: foot.sortY,
      };
    });

    const bigTop = firstOf(site, 'big_top');
    const bigTopFoot = bigTop === undefined ? null : footOf(bigTop);
    this.anchors = {
      site,
      lamps,
      pennants,
      bunting: spansOf(CIRCUS_BUNTING_SPANS),
      festoons: spansOf(CIRCUS_FESTOON_SPANS),
      arch,
      balloons,
      looseBalloonFrom,
      curtains,
      door:
        bigTopFoot === null
          ? null
          : {
              mouth: at(bigTopFoot, { x: BIG_TOP_DOOR_MOUTH.x, up: BIG_TOP_DOOR_MOUTH.footUp }),
              halfWidth: BIG_TOP_DOOR_MOUTH.halfWidth * TILE_SIZE,
              sortY: bigTopFoot.sortY,
            },
      marquee: bigTopFoot === null ? null : { foot: bigTopFoot },
    };
    this.buildRenderables();
  }

  /** Paints the arch's crossbar and sign for this site's two posts, or null when fewer than two stood. */
  private paintArch(site: CircusGroundsSite): ArchPaint | null {
    const arch = site.arch;
    const posts = arch?.posts ?? [];
    const first = itemAt(posts, 0);
    const second = itemAt(posts, 1);
    if (arch === null || first === undefined || second === undefined) return null;
    const across = arch.axis === 'north-south';
    const spanTiles = across ? Math.abs(second.x - first.x) : Math.abs(second.y - first.y);
    const scale = CIRCUS_TILE_SCALE;
    const layout = crossbarLayout(spanTiles, across, scale);
    const surface = allocCanvas(layout.width, layout.height);
    const ctx = surfaceContext(surface);
    paintArchCrossbar(
      ctx,
      layout,
      across,
      scale,
      mulberry32(tileHash(first.x, first.y, BULB_SALT)),
    );
    const capUp =
      ARCH_POST_FOOT_UP_TILES + CIRCUS_ARCH_POST_HEIGHT_TILES - CROSSBAR_BELOW_CAP_TILES;
    const westOrNorth = across
      ? first.x < second.x
        ? first
        : second
      : first.y < second.y
        ? first
        : second;
    const capA = {
      x: (westOrNorth.x + TILE_MIDDLE) * TILE_SIZE,
      y: (westOrNorth.y + 1 - capUp) * TILE_SIZE,
    };
    const toWorld = TILE_SIZE / scale;
    const origin = { x: capA.x - layout.capA.x * toWorld, y: capA.y - layout.capA.y * toWorld };
    return {
      surface,
      layout,
      origin,
      sortY: Math.max(first.y, second.y) * TILE_SIZE,
      hang: { x: origin.x + layout.hang.x * toWorld, y: origin.y + layout.hang.y * toWorld },
    };
  }

  private buildRenderables(): void {
    const anchors = this.anchors;
    this.renderables.length = 0;
    if (anchors === null) return;
    const push = (
      x: number,
      y: number,
      reachTiles: number,
      render: (ctx: Ctx, camX: number, camY: number) => void,
    ): void => {
      this.renderables.push({ x, y, cullMarginTiles: reachTiles + CULL_MARGIN_TILES, render });
    };

    if (anchors.marquee !== null) {
      const foot = anchors.marquee.foot;
      push(foot.left, foot.sortY, CIRCUS_STRUCTURES.big_top.w, (ctx, camX, camY) =>
        this.drawMarqueeAndMouth(ctx, anchors, camX, camY),
      );
    }
    anchors.lamps.forEach((lamp, index) => {
      push(lamp.point.x, lamp.sortY, 0, (ctx, camX, camY) =>
        this.drawFlame(ctx, lamp.point, index, camX, camY),
      );
    });
    anchors.pennants.forEach((pennant, index) => {
      // A pennant flies at its pole's cap, which on the Big Top is the king
      // pole's height plus the cap above the tent's sort row, so it is kept
      // while any of that climb is on screen, not only its sort row.
      const capRiseTiles = Math.max(0, (pennant.tie.sortY - pennant.tie.point.y) / TILE_SIZE);
      push(pennant.tie.point.x, pennant.tie.sortY, capRiseTiles, (ctx, camX, camY) =>
        this.drawPolePennant(ctx, pennant.tie.point, pennant.scale, index, camX, camY),
      );
    });
    for (const span of anchors.bunting) {
      const sortY = Math.max(span.from.sortY, span.to.sortY);
      push(span.to.point.x, sortY, spanReachTiles(span), (ctx, camX, camY) =>
        this.drawBunting(ctx, span, camX, camY),
      );
    }
    for (const span of anchors.festoons) {
      const sortY = Math.max(span.from.sortY, span.to.sortY);
      push(span.to.point.x, sortY, spanReachTiles(span), (ctx, camX, camY) =>
        this.drawFestoon(ctx, span, camX, camY),
      );
    }
    const arch = anchors.arch;
    if (arch !== null) {
      const reach = Math.max(arch.layout.width, arch.layout.height) / CIRCUS_TILE_SCALE;
      push(arch.origin.x, arch.sortY, reach, (ctx, camX, camY) =>
        this.drawArch(ctx, arch, camX, camY),
      );
    }
    for (const group of anchors.balloons) {
      push(group.tie.point.x, group.tie.sortY, BALLOON.stringTiles, (ctx, camX, camY) =>
        this.drawBalloons(ctx, group.tie.point, group.count, group.salt, camX, camY),
      );
    }
    for (const curtain of anchors.curtains) {
      push(curtain.window.x, curtain.sortY, 0, (ctx, camX, camY) =>
        this.drawCurtain(ctx, curtain.window, camX, camY),
      );
    }
  }

  /** The live pieces that must Y-sort against bodies: merged into the scene's entity pass. */
  renderEntities(): ReadonlyArray<TownPropRenderable> {
    return this.renderables;
  }

  /**
   * The Big Top's door light on the lot, added onto the chunk-baked ground.
   * The render pipeline calls it straight after the map, before any gore,
   * telegraph or body, because the light is additive and would wash out
   * anything already drawn beneath it.
   */
  renderGround(ctx: Ctx, camX: number, camY: number): void {
    const door = this.anchors?.door;
    if (door === undefined || door === null) return;
    const texture = this.doorSpillTexture();
    const reach = DOOR_SPILL.reachTiles * TILE_SIZE;
    const halfFar = door.halfWidth * DOOR_SPILL.spread;
    const alpha =
      (this.redeemed ? DOOR_SPILL.redeemedAlpha : DOOR_SPILL.alpha) *
      (1 -
        DOOR_SPILL.flickerDepth / 2 +
        (DOOR_SPILL.flickerDepth / 2) * this.wave(DOOR_SPILL.flickerRate, 0));
    ctx.save();
    try {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha;
      ctx.drawImage(
        texture,
        door.mouth.x - halfFar - camX,
        door.mouth.y - camY,
        halfFar * 2,
        reach,
      );
    } finally {
      ctx.restore();
    }
  }

  /** The loose balloon, which floats over everything once it is up. */
  renderAbove(ctx: Ctx, camX: number, camY: number): void {
    const from = this.anchors?.looseBalloonFrom;
    if (from === undefined || from === null) return;
    const cycle = (this.seconds % LOOSE_BALLOON.periodSeconds) / LOOSE_BALLOON.periodSeconds;
    const fadeIn = Math.min(1, cycle / LOOSE_BALLOON.fadeInShare);
    const fadeOut = Math.min(1, (1 - cycle) / LOOSE_BALLOON.fadeOutShare);
    const alpha = Math.min(fadeIn, fadeOut);
    if (alpha <= 0) return;
    const rise = cycle * LOOSE_BALLOON.riseTiles * TILE_SIZE;
    // Eased: it lifts off slowly, then the wind takes it.
    const drift = cycle * cycle * LOOSE_BALLOON.driftTiles * TILE_SIZE;
    const wobble =
      Math.sin(this.seconds * LOOSE_BALLOON.wobbleRate) * LOOSE_BALLOON.wobbleTiles * TILE_SIZE;
    const x = from.x + drift + wobble - camX;
    const y = from.y - BALLOON.stringTiles * TILE_SIZE - rise - camY;
    ctx.save();
    try {
      ctx.globalAlpha = alpha;
      this.drawBalloonBody(ctx, x, y, LOOSE_BALLOON_COLOUR, {
        x: x - wobble * BALLOON_TRAIL_SHARE,
        y: y + BALLOON.stringTiles * TILE_SIZE * LOOSE_STRING_SHARE,
      });
    } finally {
      ctx.restore();
    }
  }

  dispose(): void {
    this.renderables.length = 0;
    this.anchors = null;
    this.marionette = null;
    this.doorSpill = null;
    this.glowSprites.clear();
  }

  // ── Clock ───────────────────────────────────────────────────────────────────

  /** A sine of the clock in [-1, 1]. */
  private wave(rate: number, phase: number): number {
    return Math.sin(this.seconds * rate + phase);
  }

  /** A lit bulb's brightness once the grounds wake: steady, with a faint shimmer. */
  private shimmer(index: number): number {
    const swing = (1 + this.wave(REDEEMED_SHIMMER_RATE, index)) / 2;
    return 1 - REDEEMED_SHIMMER * swing;
  }

  /**
   * A guttering bulb's brightness in [0, 1]: stepped noise off the clock, so
   * it catches, dims and cuts out rather than breathing like a sine.
   */
  private gutter(salt: number): number {
    const step = Math.floor(this.seconds * GUTTER_STEPS_PER_SECOND);
    const roll = tileHash01(step, salt, BULB_SALT);
    if (roll < GUTTER_OUT_SHARE) return 0;
    return roll < GUTTER_OUT_SHARE + GUTTER_DIM / 2 ? GUTTER_DIM : 1;
  }

  // ── Pieces ──────────────────────────────────────────────────────────────────

  private drawFlame(ctx: Ctx, mouth: WorldPoint, index: number, camX: number, camY: number): void {
    const x = mouth.x - camX;
    const y = mouth.y - camY;
    const phase = index * FLAME_PHASE_STEP;
    const lick =
      1 +
      FLAME.heightSwing *
        (this.wave(FLAME.rateA, phase) * FLAME.slowShare +
          this.wave(FLAME.rateB, phase * 2) * (1 - FLAME.slowShare));
    const height = FLAME.heightTiles * TILE_SIZE * lick;
    const halfWidth = FLAME_LAMP_MOUTH_HALF_WIDTH_TILES * TILE_SIZE;
    const sway = this.wave(FLAME.rateA / 2, phase) * FLAME.swaySwing * TILE_SIZE;
    ctx.save();
    try {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = FLAME.glowAlpha * lick;
      this.drawGlow(
        ctx,
        x,
        y - height * FLAME_GLOW_RISE_SHARE,
        FLAME.glowRadiusTiles * TILE_SIZE,
        FLAME_GLOW_STOPS,
      );
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      const tongue = (share: number, colour: RGB, alpha: number, offset: number): void => {
        const h = height * share;
        // A short tongue is still as wide at its root as half the mouth.
        const w = halfWidth * (share + (1 - share) / 2);
        const tipX = x + sway * share + offset;
        ctx.fillStyle = rgba(colour, alpha);
        ctx.beginPath();
        ctx.moveTo(x - w, y);
        const bellyX = w * FLAME.bellyWidth;
        const bellyY = h * FLAME.bellyHeight;
        ctx.quadraticCurveTo(x - bellyX, y - bellyY, tipX, y - h);
        ctx.quadraticCurveTo(x + bellyX, y - bellyY, x + w, y);
        ctx.closePath();
        ctx.fill();
      };
      for (let lick2 = 0; lick2 < FLAME.tongues; lick2++) {
        const side = lick2 - (FLAME.tongues - 1) / 2;
        const lickShare = (1 + this.wave(FLAME.rateB, phase + lick2 * FLAME.tonguePhaseStep)) / 2;
        const share = FLAME.shortestTongue + (1 - FLAME.shortestTongue) * lickShare;
        tongue(share, FLAME_OUTER, FLAME_OUTER_ALPHA, (side * halfWidth) / 2);
      }
      tongue(FLAME_INNER_SHARE, FLAME_INNER, FLAME_INNER_ALPHA, 0);
      tongue(FLAME_CORE_SHARE, FLAME_CORE, FLAME_CORE_ALPHA, 0);
    } finally {
      ctx.restore();
    }
  }

  private drawPolePennant(
    ctx: Ctx,
    cap: WorldPoint,
    scale: number,
    index: number,
    camX: number,
    camY: number,
  ): void {
    const length = POLE_PENNANT.lengthTiles * TILE_SIZE * scale;
    const halfWidth = POLE_PENNANT.halfWidthTiles * TILE_SIZE * scale;
    const x0 = cap.x - camX;
    const y0 = cap.y - camY;
    const top: WorldPoint[] = [];
    const bottom: WorldPoint[] = [];
    for (let segment = 0; segment <= POLE_PENNANT.segments; segment++) {
      const along = segment / POLE_PENNANT.segments;
      // The wave grows toward the free end, where nothing holds the cloth.
      const wave =
        this.wave(POLE_PENNANT.waveRate, index + segment * POLE_PENNANT.wavePerSegment) *
        POLE_PENNANT.waveTiles *
        TILE_SIZE *
        scale *
        along;
      const half = halfWidth * (1 - along * (1 - POLE_PENNANT.forkShare));
      top.push({ x: x0 + along * length, y: y0 - half + wave });
      bottom.push({ x: x0 + along * length, y: y0 + half + wave });
    }
    const tip = top[top.length - 1];
    const tipBottom = bottom[bottom.length - 1];
    ctx.save();
    try {
      ctx.beginPath();
      ctx.moveTo(top[0].x, top[0].y);
      for (const point of top) ctx.lineTo(point.x, point.y);
      // The swallowtail's notch.
      ctx.lineTo(
        (tip.x + tipBottom.x) / 2 - (length * POLE_PENNANT.forkShare) / 2,
        (tip.y + tipBottom.y) / 2,
      );
      for (let point = bottom.length - 1; point >= 0; point--)
        ctx.lineTo(bottom[point].x, bottom[point].y);
      ctx.closePath();
      ctx.strokeStyle = rgba(BACKSTAGE.shadow, POLE_PENNANT.outlineAlpha);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = rgba(index % 2 === 0 ? BLOOD.mid : BRUISE.light, 1);
      ctx.fill();
      ctx.fillStyle = rgba(BONE.light, POLE_PENNANT.stripeAlpha);
      ctx.beginPath();
      // A pale stripe along the pennant's upper edge, the sun side.
      const stripeBottom = halfWidth * POLE_PENNANT.stripeBottom;
      const stripeTop = halfWidth * POLE_PENNANT.stripeTop;
      ctx.moveTo(top[0].x, top[0].y + stripeBottom);
      for (const point of top) ctx.lineTo(point.x, point.y + stripeBottom);
      for (let point = top.length - 1; point >= 0; point--)
        ctx.lineTo(top[point].x, top[point].y + stripeTop);
      ctx.fill();
    } finally {
      ctx.restore();
    }
  }

  /** Points along a span's string, in screen pixels. */
  private stringPoints(span: Span, camX: number, camY: number): WorldPoint[] {
    const a = { x: span.from.point.x - camX, y: span.from.point.y - camY };
    const b = { x: span.to.point.x - camX, y: span.to.point.y - camY };
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const points: WorldPoint[] = [];
    if (span.dropped) {
      // Come untied at the far end: it hangs from the first tie, trailing a
      // little toward where it used to go and swaying in the wind.
      const drop = Math.min(length * DROPPED_LENGTH_SHARE, DROPPED_MAX_LENGTH_TILES * TILE_SIZE);
      const trail = (b.x - a.x) * DROPPED_TRAIL_SHARE * (drop / length);
      const sway = this.wave(DROPPED_SWAY_RATE, span.salt) * DROPPED_SWAY_TILES * TILE_SIZE;
      for (let sample = 0; sample <= STRING_SAMPLES; sample++) {
        const t = sample / STRING_SAMPLES;
        points.push({ x: a.x + trail * t + sway * t * t, y: a.y + drop * t });
      }
      return points;
    }
    const sag = length * STRING_SAG_SHARE;
    for (let sample = 0; sample <= STRING_SAMPLES; sample++) {
      const t = sample / STRING_SAMPLES;
      // A parabola through both ties, at its deepest (`sag`) halfway.
      const hang = sag * PARABOLA_PEAK_SCALE * t * (1 - t);
      points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t + hang });
    }
    return points;
  }

  /** Evenly spaced stations along a polyline, every `spacing` pixels. */
  private stations(
    points: ReadonlyArray<WorldPoint>,
    spacing: number,
  ): Array<{ at: WorldPoint; dirX: number; dirY: number }> {
    const stations: Array<{ at: WorldPoint; dirX: number; dirY: number }> = [];
    let carried = spacing / 2;
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1];
      const b = points[index];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length === 0) continue;
      const dirX = (b.x - a.x) / length;
      const dirY = (b.y - a.y) / length;
      let along = carried;
      while (along <= length) {
        stations.push({ at: { x: a.x + dirX * along, y: a.y + dirY * along }, dirX, dirY });
        along += spacing;
      }
      carried = along - length;
    }
    return stations;
  }

  private strokeString(ctx: Ctx, points: ReadonlyArray<WorldPoint>): void {
    ctx.strokeStyle = STRING_COLOUR;
    ctx.lineWidth = STRING_WIDTH_PX;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points) ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }

  private drawBunting(ctx: Ctx, span: Span, camX: number, camY: number): void {
    const points = this.stringPoints(span, camX, camY);
    this.strokeString(ctx, points);
    const halfWidth = PENNANT_HALF_WIDTH_TILES * TILE_SIZE;
    const drop = PENNANT_DROP_TILES * TILE_SIZE;
    const stations = this.stations(points, PENNANT_SPACING_TILES * TILE_SIZE);
    // One path per colour and one for the shade, however many pennants: a
    // string carries thirty-odd, and a fill per pennant is most of its cost.
    const pennants: Array<{
      readonly colour: number;
      readonly x: number;
      readonly y: number;
      readonly baseX: number;
      readonly baseY: number;
      readonly tipX: number;
      readonly tipY: number;
    }> = [];
    stations.forEach((station, index) => {
      const roll = tileHash01(index, span.salt, PENNANT_SALT);
      if (roll < PENNANT_MISSING_SHARE) return;
      const torn = roll < PENNANT_MISSING_SHARE + PENNANT_TORN_SHARE;
      const length = torn ? drop * PENNANT_TORN_DROP_SHARE : drop;
      const flutter =
        this.wave(PENNANT_FLUTTER_RATE, index * PENNANT_FLUTTER_PHASE_STEP + span.salt) *
        PENNANT_FLUTTER_TILES *
        TILE_SIZE;
      // On a dropped string the pennants hang off a line running down, so
      // they lie along it rather than below it.
      pennants.push({
        colour: index % PENNANT_FILLS.length,
        x: station.at.x,
        y: station.at.y,
        baseX: span.dropped ? 0 : station.dirX * halfWidth,
        baseY: span.dropped ? halfWidth : station.dirY * halfWidth,
        tipX: station.at.x + flutter + (span.dropped ? length : 0),
        tipY: station.at.y + (span.dropped ? 0 : length),
      });
    });
    PENNANT_FILLS.forEach((fill, colour) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      for (const pennant of pennants) {
        if (pennant.colour !== colour) continue;
        ctx.moveTo(pennant.x - pennant.baseX, pennant.y - pennant.baseY);
        ctx.lineTo(pennant.x + pennant.baseX, pennant.y + pennant.baseY);
        ctx.lineTo(pennant.tipX, pennant.tipY);
        ctx.closePath();
      }
      ctx.fill();
    });
    // Each pennant's shade half, away from the sun.
    ctx.fillStyle = PENNANT_SHADE_FILL;
    ctx.beginPath();
    for (const pennant of pennants) {
      ctx.moveTo(pennant.x, pennant.y);
      ctx.lineTo(pennant.x + pennant.baseX, pennant.y + pennant.baseY);
      ctx.lineTo(pennant.tipX, pennant.tipY);
      ctx.closePath();
    }
    ctx.fill();
  }

  private drawFestoon(ctx: Ctx, span: Span, camX: number, camY: number): void {
    const points = this.stringPoints(span, camX, camY);
    this.strokeString(ctx, points);
    const stations = this.stations(points, BULB_SPACING_TILES * TILE_SIZE);
    const radius = BULB_RADIUS_TILES * TILE_SIZE;
    const socket = BULB_SOCKET_RADIUS_TILES * TILE_SIZE;
    const lit: Array<{ at: WorldPoint; brightness: number }> = [];
    // The sockets and the dead glass are one path each; only a lit bulb,
    // whose colour follows its own brightness, is filled on its own.
    const dead = stations.map((station, index) => {
      const salt = span.salt * STATIONS_PER_SPAN_SALT + index;
      const live = tileHash01(index, span.salt, BULB_SALT) < BULB_LIVE_SHARE;
      const brightness = this.redeemed ? this.shimmer(index) : live ? this.gutter(salt) : 0;
      const at = { x: station.at.x, y: station.at.y + socket + radius };
      if (brightness > 0) lit.push({ at, brightness });
      return brightness > 0 ? null : at;
    });
    ctx.fillStyle = BULB_SOCKET_FILL;
    ctx.beginPath();
    for (const station of stations) {
      ctx.moveTo(station.at.x + socket, station.at.y + socket / 2);
      ctx.arc(station.at.x, station.at.y + socket / 2, socket, 0, FULL_TURN);
    }
    ctx.fill();
    ctx.fillStyle = BULB_DEAD_FILL;
    ctx.beginPath();
    for (const at of dead) {
      if (at === null) continue;
      ctx.moveTo(at.x + radius, at.y);
      ctx.arc(at.x, at.y, radius, 0, FULL_TURN);
    }
    ctx.fill();
    for (const bulb of lit) {
      ctx.fillStyle = rgba(mix(BULB_DEAD, BULB_LIT, bulb.brightness), 1);
      ctx.beginPath();
      ctx.arc(bulb.at.x, bulb.at.y, radius, 0, FULL_TURN);
      ctx.fill();
    }
    this.drawBulbGlows(ctx, lit);
  }

  private drawBulbGlows(
    ctx: Ctx,
    lit: ReadonlyArray<{ at: WorldPoint; brightness: number }>,
  ): void {
    if (lit.length === 0) return;
    const glow = BULB_GLOW_RADIUS_TILES * TILE_SIZE;
    ctx.save();
    try {
      ctx.globalCompositeOperation = 'lighter';
      for (const bulb of lit) {
        ctx.globalAlpha = BULB_GLOW_ALPHA * bulb.brightness;
        this.drawGlow(ctx, bulb.at.x, bulb.at.y, glow, BULB_GLOW_STOPS);
      }
    } finally {
      ctx.restore();
    }
  }

  /** The marquee's bulbs, lit where the ambience says, and a warm glow deep in the door's mouth. */
  private drawMarqueeAndMouth(ctx: Ctx, anchors: Anchors, camX: number, camY: number): void {
    const marquee = anchors.marquee;
    if (marquee === null) return;
    const door = anchors.door;
    if (door !== null) {
      const flicker =
        1 -
        DOOR_SPILL.flickerDepth / 2 +
        (DOOR_SPILL.flickerDepth / 2) * this.wave(DOOR_SPILL.flickerRate, 1);
      const mouthY = door.mouth.y - (BIG_TOP_DOOR_MOUTH.height * TILE_SIZE) / 2;
      ctx.save();
      try {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha =
          DOOR_SPILL.mouthGlowAlpha * flicker * (this.redeemed ? REDEEMED_MOUTH_BOOST : 1);
        this.drawGlow(
          ctx,
          door.mouth.x - camX,
          mouthY - camY,
          DOOR_SPILL.mouthGlowTiles * TILE_SIZE,
          FLAME_GLOW_STOPS,
        );
      } finally {
        ctx.restore();
      }
    }
    const radius = BIG_TOP_MARQUEE_BULB_RADIUS_TILES * TILE_SIZE;
    const lit: Array<{ at: WorldPoint; brightness: number }> = [];
    BIG_TOP_MARQUEE_BULBS.forEach((bulb, index) => {
      if (bulb.broken) return;
      // Before the grounds wake only a couple still catch, and gutter out.
      const brightness = this.redeemed
        ? this.shimmer(index)
        : MARQUEE_GUTTERING_BULBS.has(index)
          ? this.gutter(index + MARQUEE_SALT)
          : 0;
      if (brightness <= 0) return;
      const point = at(marquee.foot, bulb);
      const x = point.x - camX;
      const y = point.y - camY;
      ctx.fillStyle = rgba(mix(BULB_DEAD, BULB_LIT, brightness), 1);
      ctx.beginPath();
      ctx.arc(x, y, radius * MARQUEE_GLASS_SHARE, 0, FULL_TURN);
      ctx.fill();
      lit.push({ at: { x, y }, brightness: brightness * MARQUEE_GLOW_SHARE });
    });
    this.drawBulbGlows(ctx, lit);
  }

  private drawArch(ctx: Ctx, arch: ArchPaint, camX: number, camY: number): void {
    const toWorld = TILE_SIZE / CIRCUS_TILE_SCALE;
    ctx.drawImage(
      arch.surface,
      arch.origin.x - camX,
      arch.origin.y - camY,
      arch.layout.width * toWorld,
      arch.layout.height * toWorld,
    );
    const puppet = this.marionetteSurface();
    const swing =
      this.wave(MARIONETTE_SWING.rate, 0) * MARIONETTE_SWING.radians +
      this.wave(MARIONETTE_SWING.flutterRate, 1) * MARIONETTE_SWING.flutterRadians;
    ctx.save();
    try {
      ctx.translate(arch.hang.x - camX, arch.hang.y - camY);
      ctx.rotate(swing);
      ctx.drawImage(
        puppet,
        -MARIONETTE_PIVOT.x * TILE_SIZE,
        -MARIONETTE_PIVOT.y * TILE_SIZE,
        MARIONETTE.widthTiles * TILE_SIZE,
        MARIONETTE.heightTiles * TILE_SIZE,
      );
    } finally {
      ctx.restore();
    }
  }

  private drawBalloons(
    ctx: Ctx,
    tie: WorldPoint,
    count: number,
    salt: number,
    camX: number,
    camY: number,
  ): void {
    const x0 = tie.x - camX;
    const y0 = tie.y - camY;
    for (let balloon = 0; balloon < count; balloon++) {
      const phase = salt * BALLOON_PHASE_STEP + balloon;
      const spread = (balloon - (count - 1) / 2) * BALLOON.stringSpreadTiles * TILE_SIZE;
      const bob = this.wave(BALLOON.bobRate, phase) * BALLOON.bobTiles * TILE_SIZE;
      const sway =
        this.wave(BALLOON.swayRate, phase * BALLOON.swayPhaseScale) * BALLOON.swayTiles * TILE_SIZE;
      const lengthShare = 1 - (balloon % 2) * BALLOON_ALTERNATE_SHORTER;
      const x = x0 + spread + sway;
      const y = y0 - BALLOON.stringTiles * TILE_SIZE * lengthShare + bob;
      const colour = BALLOON_COLOURS[(salt + balloon) % BALLOON_COLOURS.length];
      this.drawBalloonBody(ctx, x, y, colour, { x: x0, y: y0 });
    }
  }

  /** One balloon centred at `(x, y)` in screen pixels, its string running down to `tie`. */
  private drawBalloonBody(ctx: Ctx, x: number, y: number, colour: RGB, tie: WorldPoint): void {
    const rx = BALLOON.radiusXTiles * TILE_SIZE;
    const ry = BALLOON.radiusYTiles * TILE_SIZE;
    ctx.strokeStyle = BALLOON_STRING;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + ry);
    ctx.quadraticCurveTo(x + (tie.x - x) * BALLOON.stringBend, (y + ry + tie.y) / 2, tie.x, tie.y);
    ctx.stroke();
    ctx.beginPath();
    // Gone soft: the bottom sags wider than the top.
    ctx.moveTo(x, y - ry);
    const shoulder = rx * BALLOON.shoulder;
    const belly = rx * (1 + BALLOON.sag);
    const bellyY = y + ry * BALLOON.belly;
    ctx.bezierCurveTo(x + shoulder, y - ry, x + belly, bellyY, x, y + ry);
    ctx.bezierCurveTo(x - belly, bellyY, x - shoulder, y - ry, x, y - ry);
    ctx.closePath();
    ctx.fillStyle = rgba(colour, BALLOON_ALPHA);
    ctx.fill();
    ctx.strokeStyle = rgba(BACKSTAGE.shadow, BALLOON.outlineAlpha);
    ctx.stroke();
    ctx.fillStyle = rgba(BONE.accent, BALLOON_SHINE_ALPHA);
    ctx.beginPath();
    const { shine } = BALLOON;
    ctx.ellipse(
      x + rx * shine.x,
      y + ry * shine.y,
      rx * shine.rx,
      ry * shine.ry,
      shine.turn,
      0,
      FULL_TURN,
    );
    ctx.fill();
  }

  private drawCurtain(
    ctx: Ctx,
    window: { x: number; y: number; w: number; h: number },
    camX: number,
    camY: number,
  ): void {
    const cycle = this.seconds % CURTAIN.periodSeconds;
    // Twitches back, holds a moment, and falls closed again.
    const twitch =
      cycle < CURTAIN.twitchSeconds ? Math.sin((cycle / CURTAIN.twitchSeconds) * Math.PI) : 0;
    const gap = CURTAIN.closedGapShare + (CURTAIN.openGapShare - CURTAIN.closedGapShare) * twitch;
    const x = window.x - camX;
    const y = window.y - camY;
    const liveLeft = x + window.w * CURTAIN.stillShare;
    const panelLeft = liveLeft + window.w * gap;
    const panelWidth = x + window.w - panelLeft;
    if (twitch > EYES_SHOW_AT) {
      // Something in the dark looks out through the gap.
      const eyeX = liveLeft + (panelLeft - liveLeft) / 2;
      const eyeY = y + window.h * EYE_HEIGHT_SHARE;
      const spacing = CURTAIN.eyeSpacingTiles * TILE_SIZE;
      ctx.fillStyle = rgba(CURTAIN_EYES, twitch);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(
          eyeX + (side * spacing) / 2,
          eyeY,
          CURTAIN.eyeRadiusTiles * TILE_SIZE,
          0,
          FULL_TURN,
        );
        ctx.fill();
      }
    }
    if (panelWidth <= 0) return;
    ctx.fillStyle = rgba(CURTAIN_COLOUR, 1);
    ctx.fillRect(panelLeft, y, panelWidth, window.h);
    ctx.strokeStyle = rgba(CURTAIN_FOLD, 1);
    ctx.lineWidth = 1;
    for (let fold = 1; fold <= CURTAIN.folds; fold++) {
      const fx = panelLeft + (panelWidth * fold) / (CURTAIN.folds + 1);
      ctx.beginPath();
      ctx.moveTo(fx, y);
      ctx.lineTo(fx, y + window.h);
      ctx.stroke();
    }
  }

  // ── Cached surfaces ─────────────────────────────────────────────────────────

  /**
   * Draws a radial glow centred at `(x, y)`, from a sprite painted once at
   * exactly this radius and blitted unscaled: dozens of bulbs light at once
   * when the grounds wake, and a stretched blit per bulb is what costs.
   */
  private drawGlow(
    ctx: Ctx,
    x: number,
    y: number,
    radius: number,
    stops: ReadonlyArray<GlowStop>,
  ): void {
    const sprite = this.glowSprite(radius, stops);
    ctx.drawImage(sprite, Math.round(x - radius), Math.round(y - radius));
  }

  private glowSprite(radius: number, stops: ReadonlyArray<GlowStop>): CanvasSurface {
    const key = `${radius}#${stops.map((stop) => `${stop.offset}:${stop.color}`).join('|')}`;
    const cached = this.glowSprites.get(key);
    if (cached !== undefined) return cached;
    const size = Math.ceil(radius * 2);
    const surface = allocCanvas(size, size);
    const ctx = surfaceContext(surface);
    const gradient = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
    for (const stop of stops) gradient.addColorStop(stop.offset, stop.color);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    this.glowSprites.set(key, surface);
    return surface;
  }

  private marionetteSurface(): CanvasSurface {
    if (this.marionette !== null) return this.marionette;
    const scale = CIRCUS_TILE_SCALE;
    const surface = allocCanvas(
      Math.ceil(MARIONETTE.widthTiles * scale),
      Math.ceil(MARIONETTE.heightTiles * scale),
    );
    paintMarionette(surfaceContext(surface), scale);
    this.marionette = surface;
    return surface;
  }

  /** The spill's falloff, painted once: bright at the door, fading and widening across the lot. */
  private doorSpillTexture(): CanvasSurface {
    if (this.doorSpill !== null) return this.doorSpill;
    const size = DOOR_SPILL_TEXTURE_PX;
    const surface = allocCanvas(size, size);
    const ctx = surfaceContext(surface);
    const narrow = size / (2 * DOOR_SPILL.spread);
    ctx.beginPath();
    ctx.moveTo(size / 2 - narrow, 0);
    ctx.lineTo(size / 2 + narrow, 0);
    ctx.lineTo(size, size);
    ctx.lineTo(0, size);
    ctx.closePath();
    const along = ctx.createLinearGradient(0, 0, 0, size);
    along.addColorStop(0, rgba(LIMELIGHT.mid, 1));
    along.addColorStop(
      DOOR_SPILL.textureMid.offset,
      rgba(LIMELIGHT.shadow, DOOR_SPILL.textureMid.alpha),
    );
    along.addColorStop(1, rgba(LIMELIGHT.shadow, 0));
    ctx.fillStyle = along;
    ctx.fill();
    // Soften the sides so the spill has no hard wedge edge.
    ctx.globalCompositeOperation = 'destination-in';
    const across = ctx.createLinearGradient(0, 0, size, 0);
    across.addColorStop(0, 'rgba(0,0,0,0)');
    across.addColorStop(DOOR_SPILL.edgeSoftness, 'rgba(0,0,0,1)');
    across.addColorStop(1 - DOOR_SPILL.edgeSoftness, 'rgba(0,0,0,1)');
    across.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = across;
    ctx.fillRect(0, 0, size, size);
    this.doorSpill = surface;
    return surface;
  }
}

/** How far a span's art reaches from its anchor, in tiles: the whole string. */
function spanReachTiles(span: Span): number {
  return (
    Math.hypot(span.to.point.x - span.from.point.x, span.to.point.y - span.from.point.y) / TILE_SIZE
  );
}

const FLAME_PHASE_STEP = 1.9;
/** The glow centres a little up the flame, where the fire is hottest. */
const FLAME_GLOW_RISE_SHARE = 0.4;
const STATIONS_PER_SPAN_SALT = 97;
const MARQUEE_SALT = 400;
/** Which of the marquee's bulbs still gutter before the grounds wake: two, far apart. */
const MARQUEE_GUTTERING_BULBS: ReadonlySet<number> = new Set(
  Object.values({ nearWest: 3, nearEast: 17 }),
);
const MARQUEE_GLASS_SHARE = 0.72;
const MARQUEE_GLOW_SHARE = 0.7;
const REDEEMED_MOUTH_BOOST = 1.6;
const BALLOON_PHASE_STEP = 2.3;
/** Every other balloon flies on a shorter string, so a bunch reads as a bunch. */
const BALLOON_ALTERNATE_SHORTER = 0.18;
const BALLOON_TRAIL_SHARE = 0.4;
const LOOSE_STRING_SHARE = 0.6;
/** How far through its twitch the curtain is before anything shows in the gap. */
const EYES_SHOW_AT = 0.45;
const EYE_HEIGHT_SHARE = 0.4;
