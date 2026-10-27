/**
 * The Cloak & Dagger's show floor furniture: the dancers' raised stages, the
 * host stand at the door, and the high-top tables the crowd leans on.
 *
 * Painted on the same conventions as the rest of the club's furniture
 * (`clubFurnitureArt.ts`): a 64px logical tile, the frame's bottom tile row as
 * the footprint, and everything above it rising into the tiles behind.
 */

import {
  BRASS,
  BRASS_DARK,
  BRASS_LIGHT,
  CLUB_TILE_SCALE,
  paintContactShadow,
  roundRectPath,
  variantRng,
  verticalGradient,
  type ClubFrameGeometry,
  type Rect,
  type VariantSeed,
} from './clubFurnitureArt';
import { paintClubEmblem, type EmblemInk } from './clubEmblemArt';
import { ANGEL_POLE } from './angelFigure';

type Ctx = CanvasRenderingContext2D;

const T = CLUB_TILE_SCALE;
const TWO_PI = Math.PI * 2;
const HALF = 0.5;
const OUTLINE_INK = 'rgba(10,4,6,0.85)';
const OUTLINE_WIDTH = 1.5;
/** The shared contact shadow is tuned for wide counters; a slim foot needs it laid twice to show. */
const CONTACT_SHADOW_PASSES = 3;

// ── The stage ───────────────────────────────────────────────────────────────

/**
 * How far the stage's top stands above the club floor, in tiles. A figure on
 * the stage is drawn lifted by exactly this, so its feet land on the boards
 * rather than the floor in front of the riser.
 */
export const CLUB_STAGE_RISER_TILES = 0.5625;

/**
 * Where the pole stands, in tiles from the stage's top-left on the floor
 * before the riser's lift: the centre tile's centre, on the ground line a
 * dancer's pole base is anchored to. The deck's brass socket is painted here,
 * so a performer post must put the pole's base on this point.
 */
export const CLUB_STAGE_POLE_SOCKET_TILES = {
  x: 1 + ANGEL_POLE.centreInTileX,
  y: 1 + ANGEL_POLE.floorInTileY,
} as const;

/** The dark band the deck's front edge casts on the club floor below the riser. */
const STAGE_CAST_SHADOW_TILES = 0.1;

const STAGE_SEED: VariantSeed = { base: 17000, stride: 43 };

const STAGE = {
  boardTiles: 0.25,
  /** Each board's tone wanders this far either side of the base, so the deck reads as planks. */
  boardToneJitter: 0.35,
  jointAlpha: 0.55,
  /** The back and side rims are a hairline: the deck's far edges, seen from above. */
  rimWidth: 2.5,
  /** Ambient shadow pooled at each end of the skirt, where it meets the floor beside it. */
  skirtEndShadeTiles: 0.18,
  /** The front lip is the edge the eye reads the height from, so it is the heavy one. */
  lipTiles: 0.06,
  /** Warm wash the footlights throw back across the front of the deck. */
  footwashTiles: 0.5,
  /** A ten-pixel collar seen at the floor's two-to-one foreshortening. */
  /** A twelve-pixel brass flange seen at the floor's two-to-one foreshortening. */
  socketRxTiles: 0.094,
  socketRyTiles: 0.047,
  socketShadowScale: 1.35,
  socketShadowDropTiles: 0.02,
  socketGlintWidth: 1.5,
  /** The flange's far rim, the arc that faces the key light. */
  socketGlintFrom: Math.PI * 1.1,
  socketGlintTo: Math.PI * 1.9,
  socketHoleShare: 0.55,
  /** The far half of the hole's rim, in shadow: what makes it a hole rather than a dot. */
  socketLipWidth: 1,
  /** The lacquer's sheen: one diagonal band of reflected light across the boards. */
  sheenFromShare: 0.3,
  sheenToShare: 0.55,
  streakAlpha: 0.14,
  /** The pool a follow-spot leaves on the boards, centred where the dancer works. */
  spotRadiusTiles: 0.8,
  sheenAlpha: 0.16,
  pleatTiles: 0.16,
  pleatAlpha: 0.35,
  footlights: 7,
  /** A footlight is a little hooded cup on the lip, open toward the deck. */
  hoodRxTiles: 0.07,
  hoodRyTiles: 0.045,
  bulbTiles: 0.03,
  /** How far up the deck each footlight's fan of light reaches. */
  throwTiles: 0.55,
  throwRxTiles: 0.32,
  /** Velvet swagged under the lip: shallow scallops catching the light along its top. */
  swags: 6,
  swagDepthTiles: 0.07,
  swagWidth: 1.5,
  swagAlpha: 0.4,
  kickTiles: 0.04,
} as const;

/**
 * Dark lacquered walnut: warm, but low enough in value that the follow-spot
 * and the footlights, not the boards, are what light the stage in a dark room.
 */
const STAGE_BOARD = { dark: '#3a200f', base: '#4e2e17', light: '#644022' } as const;
/** The deck's back and side edges, where the boards turn down out of the light. */
const STAGE_EDGE = '#1a0d06';
const STAGE_JOINT = '#070304';
const STAGE_SPOT = { core: 'rgba(255,214,150,0.42)', edge: 'rgba(255,190,120,0)' } as const;
const STAGE_SHEEN = '#ffffff';
const CLEAR = 'rgba(255,255,255,0)';
const STAGE_SKIRT = { top: '#3a0c1a', bottom: '#0c0306' } as const;
const STAGE_PLEAT_INK = '#000000';
const STAGE_CAST_SHADOW = { near: 'rgba(0,0,0,0.75)', far: 'rgba(0,0,0,0.05)' } as const;
const SOCKET_HOLE = '#050203';
const SKIRT_END_SHADE = 'rgba(0,0,0,0.55)';
const SOCKET_SHADOW = 'rgba(0,0,0,0.45)';
const SOCKET_FAR_LIP = '#3a2808';
const VELVET_SHEEN = '#ff9ab8';
const LIP_HIGHLIGHT = '#fff6d6';
const FOOTLIGHT = {
  lit: '#fff1c4',
  glow: 'rgba(255,214,140,0.6)',
  glowEdge: 'rgba(255,190,110,0)',
  wash: 'rgba(255,200,130,0.16)',
  throw: 'rgba(255,220,150,0.35)',
  hood: '#1a1008',
} as const;

function lerpChannel(from: number, to: number, share: number): number {
  return Math.round(from + (to - from) * share);
}

const HEX_RADIX = 16;
const RED_SHIFT = 16;
const GREEN_SHIFT = 8;
const CHANNEL_MASK = 0xff;
const HEX_DIGITS = 6;

/** A colour `share` of the way from `from` to `to`, both `#rrggbb`. */
function mixHex(from: string, to: string, share: number): string {
  const a = Number.parseInt(from.slice(1), HEX_RADIX);
  const b = Number.parseInt(to.slice(1), HEX_RADIX);
  const channel = (value: number, shift: number): number => (value >> shift) & CHANNEL_MASK;
  const r = lerpChannel(channel(a, RED_SHIFT), channel(b, RED_SHIFT), share);
  const g = lerpChannel(channel(a, GREEN_SHIFT), channel(b, GREEN_SHIFT), share);
  const bl = lerpChannel(channel(a, 0), channel(b, 0), share);
  const packed = (r << RED_SHIFT) | (g << GREEN_SHIFT) | bl;
  return `#${packed.toString(HEX_RADIX).padStart(HEX_DIGITS, '0')}`;
}

/**
 * A dancer's stage: a deck of lacquered boards with hairline brass rims, a
 * follow-spot's pool and the pole's brass socket in the middle, the riser's
 * front face — a pleated velvet skirt under a heavy brass lip, with a row of
 * footlights — and the shadow the deck's edge casts on the floor in front.
 */
export function drawClubStage(
  ctx: Ctx,
  geo: ClubFrameGeometry,
  variant: number,
  seedTerm: number,
): void {
  const rng = variantRng(STAGE_SEED, variant, seedTerm);
  const riserH = CLUB_STAGE_RISER_TILES * T;
  const shadowTop = geo.footBottom - STAGE_CAST_SHADOW_TILES * T;
  const deckBottom = shadowTop - riserH;
  const deck: Rect = { x: 0, y: 0, w: geo.w, h: deckBottom };

  const boardH = STAGE.boardTiles * T;
  for (let y = deck.y; y < deck.y + deck.h; y += boardH) {
    const tone = HALF + (rng() - HALF) * STAGE.boardToneJitter * 2;
    const toward = tone < HALF ? STAGE_BOARD.dark : STAGE_BOARD.light;
    ctx.fillStyle = mixHex(STAGE_BOARD.base, toward, Math.abs(tone - HALF) * 2);
    ctx.fillRect(deck.x, y, deck.w, Math.min(boardH, deck.y + deck.h - y));
    ctx.globalAlpha = STAGE.jointAlpha;
    ctx.fillStyle = STAGE_JOINT;
    ctx.fillRect(deck.x, y, deck.w, 1);
    const buttX = deck.x + rng() * deck.w;
    ctx.fillRect(buttX, y, 1, boardH);
    ctx.globalAlpha = 1;
  }

  const spotR = STAGE.spotRadiusTiles * T;
  const spotX = deck.x + deck.w * HALF;
  const spotY = (CLUB_STAGE_POLE_SOCKET_TILES.y - CLUB_STAGE_RISER_TILES) * T;
  const spot = ctx.createRadialGradient(spotX, spotY, 0, spotX, spotY, spotR);
  spot.addColorStop(0, STAGE_SPOT.core);
  spot.addColorStop(1, STAGE_SPOT.edge);
  ctx.fillStyle = spot;
  ctx.fillRect(deck.x, deck.y, deck.w, deck.h);

  ctx.save();
  ctx.globalAlpha = STAGE.sheenAlpha;
  const sheen = ctx.createLinearGradient(deck.x, deck.y, deck.x + deck.w, deck.y + deck.h);
  sheen.addColorStop(0, CLEAR);
  sheen.addColorStop(STAGE.sheenFromShare, STAGE_SHEEN);
  sheen.addColorStop(STAGE.sheenToShare, CLEAR);
  ctx.fillStyle = sheen;
  ctx.fillRect(deck.x, deck.y, deck.w, deck.h);
  ctx.restore();

  ctx.fillStyle = STAGE_EDGE;
  const rim = STAGE.rimWidth;
  ctx.fillRect(deck.x, deck.y, deck.w, rim);
  ctx.fillRect(deck.x, deck.y, rim, deck.h);
  ctx.fillRect(deck.x + deck.w - rim, deck.y, rim, deck.h);

  const socketX = CLUB_STAGE_POLE_SOCKET_TILES.x * T;
  const socketY = (CLUB_STAGE_POLE_SOCKET_TILES.y - CLUB_STAGE_RISER_TILES) * T;
  const socketRx = STAGE.socketRxTiles * T;
  const socketRy = STAGE.socketRyTiles * T;
  ctx.fillStyle = SOCKET_SHADOW;
  ctx.beginPath();
  ctx.ellipse(
    socketX,
    socketY + STAGE.socketShadowDropTiles * T,
    socketRx * STAGE.socketShadowScale,
    socketRy * STAGE.socketShadowScale,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  const socket = ctx.createLinearGradient(0, socketY - socketRy, 0, socketY + socketRy);
  socket.addColorStop(0, BRASS_LIGHT);
  socket.addColorStop(1, BRASS_DARK);
  ctx.fillStyle = socket;
  ctx.beginPath();
  ctx.ellipse(socketX, socketY, socketRx, socketRy, 0, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = LIP_HIGHLIGHT;
  ctx.lineWidth = STAGE.socketGlintWidth;
  ctx.beginPath();
  ctx.ellipse(socketX, socketY, socketRx, socketRy, 0, STAGE.socketGlintFrom, STAGE.socketGlintTo);
  ctx.stroke();
  const holeRx = socketRx * STAGE.socketHoleShare;
  const holeRy = socketRy * STAGE.socketHoleShare;
  ctx.fillStyle = SOCKET_HOLE;
  ctx.beginPath();
  ctx.ellipse(socketX, socketY, holeRx, holeRy, 0, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = SOCKET_FAR_LIP;
  ctx.lineWidth = STAGE.socketLipWidth;
  ctx.beginPath();
  ctx.ellipse(socketX, socketY, holeRx, holeRy, 0, Math.PI, TWO_PI);
  ctx.stroke();

  const washTop = deckBottom - STAGE.footwashTiles * T;
  verticalGradient(ctx, { x: deck.x, y: washTop, w: deck.w, h: deckBottom - washTop }, [
    [0, FOOTLIGHT.glowEdge],
    [1, FOOTLIGHT.wash],
  ]);

  paintStageRiser(ctx, { x: 0, y: deckBottom, w: geo.w, h: riserH });

  verticalGradient(ctx, { x: 0, y: shadowTop, w: geo.w, h: geo.footBottom - shadowTop }, [
    [0, STAGE_CAST_SHADOW.near],
    [1, STAGE_CAST_SHADOW.far],
  ]);
}

/** The riser's face: velvet skirt, a heavy brass lip catching the light, footlights below it. */
function paintStageRiser(ctx: Ctx, riser: Rect): void {
  verticalGradient(ctx, riser, [
    [0, STAGE_SKIRT.top],
    [1, STAGE_SKIRT.bottom],
  ]);
  ctx.save();
  ctx.globalAlpha = STAGE.pleatAlpha;
  ctx.fillStyle = STAGE_PLEAT_INK;
  const pleat = STAGE.pleatTiles * T;
  for (let x = riser.x + pleat * HALF; x < riser.x + riser.w; x += pleat) {
    ctx.fillRect(x, riser.y, 1, riser.h);
  }
  ctx.globalAlpha = STAGE.streakAlpha;
  ctx.fillStyle = VELVET_SHEEN;
  for (let x = riser.x + pleat; x < riser.x + riser.w; x += pleat) {
    ctx.fillRect(x, riser.y, 1, riser.h);
  }
  ctx.restore();

  const lip = STAGE.lipTiles * T;
  verticalGradient(ctx, { x: riser.x, y: riser.y, w: riser.w, h: lip }, [
    [0, BRASS_LIGHT],
    [HALF, BRASS],
    [1, BRASS_DARK],
  ]);
  ctx.fillStyle = LIP_HIGHLIGHT;
  ctx.fillRect(riser.x, riser.y, riser.w, 1);
  ctx.strokeStyle = OUTLINE_INK;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.strokeRect(riser.x, riser.y, riser.w, riser.h);
  const kick = STAGE.kickTiles * T;
  ctx.fillStyle = BRASS_DARK;
  ctx.fillRect(riser.x, riser.y + riser.h - kick, riser.w, kick);

  const endShade = STAGE.skirtEndShadeTiles * T;
  for (const [x, from] of [
    [riser.x, 0],
    [riser.x + riser.w - endShade, 1],
  ] as const) {
    const shade = ctx.createLinearGradient(x, 0, x + endShade, 0);
    shade.addColorStop(from, SKIRT_END_SHADE);
    shade.addColorStop(1 - from, 'rgba(0,0,0,0)');
    ctx.fillStyle = shade;
    ctx.fillRect(x, riser.y, endShade, riser.h);
  }

  const swagW = riser.w / STAGE.swags;
  const swagDepth = STAGE.swagDepthTiles * T;
  ctx.strokeStyle = VELVET_SHEEN;
  ctx.globalAlpha = STAGE.swagAlpha;
  ctx.lineWidth = STAGE.swagWidth;
  for (let i = 0; i < STAGE.swags; i++) {
    const left = riser.x + i * swagW;
    ctx.beginPath();
    ctx.moveTo(left, riser.y + lip);
    ctx.quadraticCurveTo(
      left + swagW * HALF,
      riser.y + lip + swagDepth * 2,
      left + swagW,
      riser.y + lip,
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const spacing = riser.w / STAGE.footlights;
  const throwH = STAGE.throwTiles * T;
  const throwRx = STAGE.throwRxTiles * T;
  const hoodRx = STAGE.hoodRxTiles * T;
  const hoodRy = STAGE.hoodRyTiles * T;
  const bulbR = STAGE.bulbTiles * T;
  for (let i = 0; i < STAGE.footlights; i++) {
    const x = riser.x + spacing * (i + HALF);
    const fan = ctx.createRadialGradient(x, riser.y, 0, x, riser.y, throwH);
    fan.addColorStop(0, FOOTLIGHT.throw);
    fan.addColorStop(1, FOOTLIGHT.glowEdge);
    ctx.fillStyle = fan;
    ctx.beginPath();
    ctx.ellipse(x, riser.y, throwRx, throwH, 0, Math.PI, TWO_PI);
    ctx.fill();
    ctx.fillStyle = FOOTLIGHT.lit;
    ctx.beginPath();
    ctx.arc(x, riser.y, bulbR, Math.PI, TWO_PI);
    ctx.fill();
    ctx.fillStyle = FOOTLIGHT.hood;
    ctx.beginPath();
    ctx.ellipse(x, riser.y, hoodRx, hoodRy, 0, 0, Math.PI);
    ctx.fill();
    ctx.strokeStyle = BRASS_LIGHT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x, riser.y, hoodRx, hoodRy, 0, 0, Math.PI);
    ctx.stroke();
  }
}

// ── The host stand ──────────────────────────────────────────────────────────

const HOST_STAND = {
  bodyHalfWidthTiles: 0.54,
  plinthHalfWidthTiles: 0.6,
  plinthHeightTiles: 0.08,
  /** Room under the plinth for the contact shadow to show below it. */
  floorInsetTiles: 0.1,
  /** The writing top sits at a standing host's hip, so their chest and head rise over it. */
  topHeightTiles: 0.95,
  topDepthTiles: 0.3,
  topOverhangTiles: 0.05,
  panelInsetTiles: 0.12,
  panelTopShare: 0.2,
  panelBottomShare: 0.82,
  crestTiles: 0.23,
  /** The front narrows toward the plinth, the lectern shape that reads as a host's stand. */
  frontTaperTiles: 0.1,
  crestYShare: 0.48,
  bookLeftShare: 0.12,
  bookWidthTiles: 0.42,
  bookDepthShare: 0.62,
  bookLines: 2,
  lampXShare: 0.78,
  /** A green glass dome, wide enough to read as a lamp over the top's back rim. */
  lampShadeHalfWTiles: 0.21,
  lampShadeHTiles: 0.12,
  /** How far below the top's back rim the dome's lower edge sits, so it overlaps the rim. */
  lampRimOverlapTiles: 0.04,
  lampFootRxTiles: 0.07,
  lampFootRyTiles: 0.03,
  lampStemPx: 2,
  lampSpillPx: 2,
  bookCoverPx: 1.5,
  bookSpinePx: 2,
  /** The share of the pen, from the nib, that is its dark steel point. */
  penNibShare: 0.25,
  lampGlowTiles: 0.36,
  /** The pen lies on a diagonal beside the book, nib down by the page. */
  penAngle: -0.6,
  penLengthTiles: 0.14,
  penGapTiles: 0.04,
  shadowRxScale: 1.2,
  shadowRyTiles: 0.16,
  radius: 4,
} as const;

const HOST_LACQUER = { light: '#3a2c30', base: '#1c1316', dark: '#0a0608' } as const;
const HOST_VELVET = { top: '#7a1630', bottom: '#2c0611' } as const;
const BOOK = { page: '#efe4c4', line: 'rgba(60,40,30,0.45)', cover: '#3a1e10' } as const;
const PEN_NIB = '#1a1012';
const LAMP = {
  shade: '#1f6a3a',
  shadeLight: '#4fa86a',
  glow: 'rgba(255,224,150,0.5)',
  glowEdge: 'rgba(255,210,120,0)',
  spill: '#ffe6a0',
} as const;
const HOST_CREST: EmblemInk = { fill: BRASS_LIGHT, shade: BRASS_DARK };

/**
 * The maître d's stand by the door: a black-lacquered podium with a velvet
 * front panel carrying the club's domino mask in brass, an open reservation book and
 * a green-shaded lamp on its writing top. The host stands in the row behind,
 * so the stand covers them to the hip.
 */
export function drawHostStand(ctx: Ctx, geo: ClubFrameGeometry): void {
  const cx = geo.w * HALF;
  const floorY = geo.footBottom - HOST_STAND.floorInsetTiles * T;
  const topY = floorY - HOST_STAND.topHeightTiles * T;
  const topBackY = topY - HOST_STAND.topDepthTiles * T;
  const halfW = HOST_STAND.bodyHalfWidthTiles * T;

  for (let pass = 0; pass < CONTACT_SHADOW_PASSES; pass++) {
    paintContactShadow(
      ctx,
      cx,
      floorY,
      HOST_STAND.plinthHalfWidthTiles * HOST_STAND.shadowRxScale * T,
      HOST_STAND.shadowRyTiles * T,
    );
  }

  const plinthHalfW = HOST_STAND.plinthHalfWidthTiles * T;
  const plinthH = HOST_STAND.plinthHeightTiles * T;
  verticalGradient(
    ctx,
    { x: cx - plinthHalfW, y: floorY - plinthH, w: plinthHalfW * 2, h: plinthH },
    [
      [0, BRASS],
      [1, BRASS_DARK],
    ],
  );

  const front: Rect = { x: cx - halfW, y: topY, w: halfW * 2, h: floorY - plinthH - topY };
  const frontGrad = ctx.createLinearGradient(front.x, 0, front.x + front.w, 0);
  frontGrad.addColorStop(0, HOST_LACQUER.light);
  frontGrad.addColorStop(HALF, HOST_LACQUER.base);
  frontGrad.addColorStop(1, HOST_LACQUER.dark);
  ctx.fillStyle = frontGrad;
  const taper = HOST_STAND.frontTaperTiles * T;
  ctx.beginPath();
  ctx.moveTo(front.x, front.y);
  ctx.lineTo(front.x + front.w, front.y);
  ctx.lineTo(front.x + front.w - taper, front.y + front.h);
  ctx.lineTo(front.x + taper, front.y + front.h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = OUTLINE_INK;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();

  const panelInset = HOST_STAND.panelInsetTiles * T;
  const panel: Rect = {
    x: front.x + panelInset,
    y: front.y + front.h * HOST_STAND.panelTopShare,
    w: front.w - panelInset * 2,
    h: front.h * (HOST_STAND.panelBottomShare - HOST_STAND.panelTopShare),
  };
  verticalGradient(ctx, panel, [
    [0, HOST_VELVET.top],
    [1, HOST_VELVET.bottom],
  ]);
  ctx.strokeStyle = BRASS;
  ctx.lineWidth = 1;
  ctx.strokeRect(panel.x, panel.y, panel.w, panel.h);
  paintClubEmblem(
    ctx,
    'mask',
    cx,
    front.y + front.h * HOST_STAND.crestYShare,
    HOST_STAND.crestTiles * T,
    HOST_CREST,
  );

  const overhang = HOST_STAND.topOverhangTiles * T;
  const top: Rect = {
    x: front.x - overhang,
    y: topBackY,
    w: front.w + overhang * 2,
    h: topY - topBackY,
  };
  verticalGradient(ctx, top, [
    [0, HOST_LACQUER.dark],
    [1, HOST_LACQUER.light],
  ]);
  roundRectPath(ctx, top, HOST_STAND.radius);
  ctx.strokeStyle = BRASS;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();
  ctx.fillStyle = BRASS_LIGHT;
  ctx.fillRect(top.x, top.y + top.h - 1, top.w, 1);

  const bookW = HOST_STAND.bookWidthTiles * T;
  const bookH = top.h * HOST_STAND.bookDepthShare;
  const book: Rect = {
    x: top.x + top.w * HOST_STAND.bookLeftShare,
    y: top.y + (top.h - bookH) * HALF,
    w: bookW,
    h: bookH,
  };
  const cover = HOST_STAND.bookCoverPx;
  ctx.fillStyle = BOOK.cover;
  ctx.fillRect(book.x - cover, book.y - cover, book.w + cover * 2, book.h + cover * 2);
  ctx.fillStyle = BOOK.page;
  ctx.fillRect(book.x, book.y, book.w, book.h);
  ctx.fillStyle = BOOK.cover;
  ctx.fillRect(
    book.x + book.w * HALF - HOST_STAND.bookSpinePx * HALF,
    book.y,
    HOST_STAND.bookSpinePx,
    book.h,
  );
  ctx.fillStyle = BOOK.line;
  for (let i = 1; i <= HOST_STAND.bookLines; i++) {
    const ly = book.y + (book.h * i) / (HOST_STAND.bookLines + 1);
    ctx.fillRect(book.x + 2, ly, book.w * HALF - 4, 1);
    ctx.fillRect(book.x + book.w * HALF + 2, ly, book.w * HALF - 4, 1);
  }
  const penLength = HOST_STAND.penLengthTiles * T;
  const penX = book.x + book.w + HOST_STAND.penGapTiles * T;
  const penY = book.y + book.h;
  const nibX = penX + Math.cos(HOST_STAND.penAngle) * penLength;
  const nibY = penY + Math.sin(HOST_STAND.penAngle) * penLength;
  const nibSplitX = penX + (nibX - penX) * HOST_STAND.penNibShare;
  const nibSplitY = penY + (nibY - penY) * HOST_STAND.penNibShare;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.strokeStyle = BRASS_LIGHT;
  ctx.beginPath();
  ctx.moveTo(nibX, nibY);
  ctx.lineTo(nibSplitX, nibSplitY);
  ctx.stroke();
  ctx.strokeStyle = PEN_NIB;
  ctx.beginPath();
  ctx.moveTo(nibSplitX, nibSplitY);
  ctx.lineTo(penX, penY);
  ctx.stroke();

  const lampX = top.x + top.w * HOST_STAND.lampXShare;
  const lampBaseY = top.y + top.h * HALF;
  const glowR = HOST_STAND.lampGlowTiles * T;
  // The shade throws its light down and across onto the open book.
  const poolX = book.x + book.w * HALF;
  const poolY = book.y + book.h * HALF;
  const glow = ctx.createRadialGradient(poolX, poolY, 0, poolX, poolY, glowR);
  glow.addColorStop(0, LAMP.glow);
  glow.addColorStop(1, LAMP.glowEdge);
  ctx.save();
  // The pool of lamplight lands on the writing top only, never on the room behind it.
  ctx.beginPath();
  ctx.rect(top.x, top.y, top.w, top.h);
  ctx.clip();
  ctx.fillStyle = glow;
  ctx.fillRect(top.x, top.y, top.w, top.h);
  ctx.restore();
  // The lamp stands on the writing top and its dome rises over the back rim,
  // so it is painted after the top and reads whole against the room behind.
  const shadeBottom = top.y + HOST_STAND.lampRimOverlapTiles * T;
  const shadeHalfW = HOST_STAND.lampShadeHalfWTiles * T;
  const shadeH = HOST_STAND.lampShadeHTiles * T;
  ctx.fillStyle = BRASS;
  ctx.beginPath();
  ctx.ellipse(
    lampX,
    lampBaseY,
    HOST_STAND.lampFootRxTiles * T,
    HOST_STAND.lampFootRyTiles * T,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.fillRect(
    lampX - HOST_STAND.lampStemPx * HALF,
    shadeBottom,
    HOST_STAND.lampStemPx,
    lampBaseY - shadeBottom,
  );
  const shade = ctx.createLinearGradient(lampX - shadeHalfW, 0, lampX + shadeHalfW, 0);
  shade.addColorStop(0, LAMP.shadeLight);
  shade.addColorStop(1, LAMP.shade);
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.ellipse(lampX, shadeBottom, shadeHalfW, shadeH, 0, Math.PI, TWO_PI);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = OUTLINE_INK;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = LAMP.spill;
  ctx.fillRect(lampX - shadeHalfW + 1, shadeBottom - 1, shadeHalfW * 2 - 2, HOST_STAND.lampSpillPx);
}

// ── The standing table ──────────────────────────────────────────────────────

const STANDING_TABLE = {
  floorInsetTiles: 0.08,
  baseRxTiles: 0.26,
  baseRyTiles: 0.08,
  baseThickTiles: 0.04,
  columnHalfWTiles: 0.045,
  /** Elbow height for a crowd standing round it: a little above the bar's counter. */
  topHeightTiles: 1.02,
  topRxTiles: 0.42,
  topRyTiles: 0.15,
  topThickTiles: 0.05,
  sheenAlpha: 0.18,
  /** The shadow pools tight under the foot: a high-top has no spread to throw it wider. */
  shadowRxTiles: 0.3,
  shadowRyTiles: 0.1,
} as const;

const TABLE_TOP = { light: '#4a3a40', base: '#1e1418', dark: '#0a0608' } as const;
const TABLE_SHEEN = '#ffffff';

/** What stands on one variant of the table, at shares of its top's width. */
interface TableDressing {
  readonly drinks: ReadonlyArray<{ readonly xShare: number; readonly glass: 'coupe' | 'rocks' }>;
  readonly candleXShare: number | null;
}

const TABLE_DRESSINGS: readonly TableDressing[] = [
  {
    drinks: [
      { xShare: -0.35, glass: 'coupe' },
      { xShare: 0.3, glass: 'rocks' },
    ],
    candleXShare: null,
  },
  {
    drinks: [{ xShare: 0.35, glass: 'coupe' }],
    candleXShare: -0.25,
  },
];

/** One dressing per variant: a pair of drinks, or one drink and a candle. */
export const STANDING_TABLE_VARIANTS = TABLE_DRESSINGS.length;

const GLASS = {
  coupeBowlRxTiles: 0.09,
  coupeBowlRyTiles: 0.045,
  coupeStemTiles: 0.11,
  coupeBowlDepthTiles: 0.05,
  rocksHalfWTiles: 0.06,
  rocksHTiles: 0.1,
  rocksFootShare: 0.75,
  rocksFillShare: 0.55,
  rocksMouthFlatten: 0.35,
  iceTiles: 0.035,
  ice: 'rgba(230,245,255,0.7)',
  rim: 'rgba(255,255,255,0.75)',
  glint: '#ffffff',
  coaster: '#e8dcc0',
  coasterRxTiles: 0.085,
  coasterRyTiles: 0.035,
  /** The glint runs along the lip's near, lower-left arc. */
  glintFrom: Math.PI * 0.45,
  glintTo: Math.PI * 0.95,
  coupeDrink: '#e05a7a',
  rocksDrink: '#c88428',
} as const;
const CANDLE = {
  halfWTiles: 0.03,
  heightTiles: 0.1,
  flameTiles: 0.05,
  wax: '#efe6cc',
  flame: '#ffd88a',
  glow: 'rgba(255,200,110,0.55)',
  glowEdge: 'rgba(255,180,90,0)',
  glowTiles: 0.22,
  holder: '#2a1418',
} as const;

function paintCoupe(ctx: Ctx, x: number, baseY: number): void {
  const stem = GLASS.coupeStemTiles * T;
  const bowlY = baseY - stem;
  ctx.strokeStyle = GLASS.rim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  ctx.lineTo(x, bowlY);
  ctx.stroke();
  ctx.fillStyle = GLASS.coupeDrink;
  ctx.beginPath();
  ctx.ellipse(x, bowlY, GLASS.coupeBowlRxTiles * T, GLASS.coupeBowlDepthTiles * T, 0, 0, Math.PI);
  ctx.fill();
  ctx.strokeStyle = GLASS.rim;
  ctx.beginPath();
  ctx.ellipse(
    x,
    bowlY,
    GLASS.coupeBowlRxTiles * T,
    GLASS.coupeBowlRyTiles * T * HALF,
    0,
    0,
    TWO_PI,
  );
  ctx.stroke();
  paintRimGlint(ctx, x, bowlY, GLASS.coupeBowlRxTiles * T, GLASS.coupeBowlRyTiles * T * HALF);
}

/** A tumbler: wider at the rim than the foot, an oval mouth, amber over a cube of ice. */
function paintRocks(ctx: Ctx, x: number, baseY: number): void {
  const rimHalfW = GLASS.rocksHalfWTiles * T;
  const footHalfW = rimHalfW * GLASS.rocksFootShare;
  const h = GLASS.rocksHTiles * T;
  const rimY = baseY - h;
  const liquidY = baseY - h * GLASS.rocksFillShare;
  const liquidHalfW = footHalfW + (rimHalfW - footHalfW) * GLASS.rocksFillShare;
  ctx.fillStyle = GLASS.rocksDrink;
  ctx.beginPath();
  ctx.moveTo(x - footHalfW, baseY);
  ctx.lineTo(x + footHalfW, baseY);
  ctx.lineTo(x + liquidHalfW, liquidY);
  ctx.lineTo(x - liquidHalfW, liquidY);
  ctx.closePath();
  ctx.fill();
  const ice = GLASS.iceTiles * T;
  ctx.fillStyle = GLASS.ice;
  ctx.fillRect(x - ice * HALF, liquidY - ice * HALF, ice, ice);
  ctx.strokeStyle = GLASS.rim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - rimHalfW, rimY);
  ctx.lineTo(x - footHalfW, baseY);
  ctx.lineTo(x + footHalfW, baseY);
  ctx.lineTo(x + rimHalfW, rimY);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, rimY, rimHalfW, rimHalfW * GLASS.rocksMouthFlatten, 0, 0, TWO_PI);
  ctx.stroke();
  paintRimGlint(ctx, x, rimY, rimHalfW, rimHalfW * GLASS.rocksMouthFlatten);
}

/** The near lip of a glass catching the room's light: what tells glass from a dark shape. */
function paintRimGlint(ctx: Ctx, x: number, y: number, rx: number, ry: number): void {
  ctx.strokeStyle = GLASS.glint;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, GLASS.glintFrom, GLASS.glintTo);
  ctx.stroke();
}

function paintCandle(ctx: Ctx, x: number, baseY: number): void {
  const halfW = CANDLE.halfWTiles * T;
  const h = CANDLE.heightTiles * T;
  const flameY = baseY - h - CANDLE.flameTiles * T * HALF;
  const glowR = CANDLE.glowTiles * T;
  const glow = ctx.createRadialGradient(x, flameY, 0, x, flameY, glowR);
  glow.addColorStop(0, CANDLE.glow);
  glow.addColorStop(1, CANDLE.glowEdge);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, flameY, glowR, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = CANDLE.holder;
  ctx.fillRect(x - halfW * 2, baseY - 2, halfW * 4, 2);
  ctx.fillStyle = CANDLE.wax;
  ctx.fillRect(x - halfW, baseY - h, halfW * 2, h);
  ctx.fillStyle = CANDLE.flame;
  ctx.beginPath();
  ctx.ellipse(x, flameY, halfW, CANDLE.flameTiles * T * HALF, 0, 0, TWO_PI);
  ctx.fill();
}

/**
 * A high-top cocktail table: a weighted brass foot, a slim column and a round
 * black top with a brass rim, dressed with drinks or a candle.
 */
export function drawStandingTable(ctx: Ctx, geo: ClubFrameGeometry, variant: number): void {
  const dressing = TABLE_DRESSINGS[variant % TABLE_DRESSINGS.length];
  const cx = geo.w * HALF;
  const floorY = geo.footBottom - STANDING_TABLE.floorInsetTiles * T;
  const topY = floorY - STANDING_TABLE.topHeightTiles * T;
  const topRx = STANDING_TABLE.topRxTiles * T;
  const topRy = STANDING_TABLE.topRyTiles * T;

  for (let pass = 0; pass < CONTACT_SHADOW_PASSES; pass++) {
    paintContactShadow(
      ctx,
      cx,
      floorY,
      STANDING_TABLE.shadowRxTiles * T,
      STANDING_TABLE.shadowRyTiles * T,
    );
  }

  const baseRx = STANDING_TABLE.baseRxTiles * T;
  const baseRy = STANDING_TABLE.baseRyTiles * T;
  const baseThick = STANDING_TABLE.baseThickTiles * T;
  ctx.fillStyle = BRASS_DARK;
  ctx.beginPath();
  ctx.ellipse(cx, floorY, baseRx, baseRy, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = BRASS;
  ctx.beginPath();
  ctx.ellipse(cx, floorY - baseThick, baseRx, baseRy, 0, 0, TWO_PI);
  ctx.fill();

  const columnHalfW = STANDING_TABLE.columnHalfWTiles * T;
  const column = ctx.createLinearGradient(cx - columnHalfW, 0, cx + columnHalfW, 0);
  column.addColorStop(0, BRASS_LIGHT);
  column.addColorStop(HALF, BRASS);
  column.addColorStop(1, BRASS_DARK);
  ctx.fillStyle = column;
  ctx.fillRect(cx - columnHalfW, topY, columnHalfW * 2, floorY - baseThick - topY);

  const topThick = STANDING_TABLE.topThickTiles * T;
  ctx.fillStyle = BRASS_DARK;
  ctx.beginPath();
  ctx.ellipse(cx, topY + topThick, topRx, topRy, 0, 0, TWO_PI);
  ctx.fill();
  const topGrad = ctx.createLinearGradient(cx - topRx, topY - topRy, cx + topRx, topY + topRy);
  topGrad.addColorStop(0, TABLE_TOP.light);
  topGrad.addColorStop(HALF, TABLE_TOP.base);
  topGrad.addColorStop(1, TABLE_TOP.dark);
  ctx.fillStyle = topGrad;
  ctx.beginPath();
  ctx.ellipse(cx, topY, topRx, topRy, 0, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = BRASS;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();
  ctx.save();
  ctx.globalAlpha = STANDING_TABLE.sheenAlpha;
  ctx.fillStyle = TABLE_SHEEN;
  ctx.beginPath();
  ctx.ellipse(
    cx - topRx * HALF * HALF,
    topY - topRy * HALF * HALF,
    topRx * HALF,
    topRy * HALF * HALF,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.restore();

  if (dressing.candleXShare !== null) paintCandle(ctx, cx + dressing.candleXShare * topRx, topY);
  for (const drink of dressing.drinks) {
    const x = cx + drink.xShare * topRx;
    ctx.fillStyle = GLASS.coaster;
    ctx.beginPath();
    ctx.ellipse(x, topY, GLASS.coasterRxTiles * T, GLASS.coasterRyTiles * T, 0, 0, TWO_PI);
    ctx.fill();
    if (drink.glass === 'coupe') paintCoupe(ctx, x, topY);
    else paintRocks(ctx, x, topY);
  }
}
