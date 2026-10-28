/**
 * Watches on the left wrist, each a round face on the back of the wrist and
 * a band round it: the male crawler's silver smartwatch with its dark glass,
 * and the female crawler's slim gold watch with its champagne dial. Like every one-sided thing on
 * the rig, a profile row mirrored to face left shows it on the other wrist.
 */

import type { BipedForearmFrame } from '../../art/biped/bipedParts';
import { angleBetween, TWO_PI } from '../../art/biped/geometry';
import { bareSegmentEdges } from '../../art/biped/limbs';
import { drawnSide, type ViewSpec } from '../../art/biped/rig';
import { rgba } from '../../art/bipedArt';
import { defineGarment } from '../garmentDef';
import { humanEveryView } from './views';

type Ctx = CanvasRenderingContext2D;

/** What one watch is made of and how wide its band stands, against the smartwatch's. */
interface WatchLook {
  readonly metal: string;
  readonly metalShade: string;
  readonly face: string;
  readonly faceGlint: string;
  /** How far the band stands proud of the wrist either side, in figure units. */
  readonly bandProud: number;
  /** The face's radius as a share of the band's length. */
  readonly faceRadiusShare: number;
}

export const SMARTWATCH_FACE = '#171a21';

/** Where the band sits along the forearm, 0 at the elbow and 1 at the wrist. */
const BAND_FROM = 0.86;
const BAND_TO = 0.97;
/**
 * Where the face is turned away, only the band shows, and it is the band's
 * own width rather than the face's: drawn at the face's width a band of
 * bright steel reads as the watch case seen from behind.
 */
const STRAP_ONLY_SHARE = 0.5;
/** The links' shaded edge, along the arm side away from the key. */
const BAND_SHADE_SHARE = 0.4;
/** The face's rim of steel round the dark glass. */
const BEZEL = 0.006;
/** The glass catches the key on its upper left. */
const GLINT_SHARE = 0.35;
const GLINT_ALPHA = 0.9;

/**
 * Whether the face, on the back of his left wrist, is turned toward the
 * camera. His hanging arm turns the back of the wrist forward and out:
 * head-on it faces the camera; from behind only the band shows; edge-on the
 * left wrist is his far one, its back turned away, so again only the band.
 */
function faceTowardCamera(view: ViewSpec): boolean {
  return !view.profile && !view.showsBack;
}

function paintWatch(ctx: Ctx, frame: BipedForearmFrame, watch: WatchLook): void {
  if (frame.piece !== 'arm') return;
  const { chain, view } = frame;
  if (frame.drawn !== drawnSide('left', view)) return;
  const angle = angleBetween(chain.joint, chain.end);
  const length = Math.hypot(chain.end.x - chain.joint.x, chain.end.y - chain.joint.y);
  const edges = bareSegmentEdges('forearm', BAND_TO, view.profile, frame.look.limbs);
  const plus = edges.plus + watch.bandProud;
  const minus = edges.minus + watch.bandProud;
  const faceShows = faceTowardCamera(view);
  const to = length * BAND_TO;
  const bandLength = length * (BAND_TO - BAND_FROM) * (faceShows ? 1 : STRAP_ONLY_SHARE);
  const from = to - bandLength;

  ctx.save();
  ctx.translate(chain.joint.x, chain.joint.y);
  ctx.rotate(angle);
  ctx.fillStyle = watch.metal;
  ctx.fillRect(from, -minus, to - from, plus + minus);
  ctx.fillStyle = watch.metalShade;
  ctx.fillRect(
    from,
    plus - (plus + minus) * BAND_SHADE_SHARE,
    to - from,
    (plus + minus) * BAND_SHADE_SHARE,
  );
  if (!faceShows) {
    ctx.restore();
    return;
  }
  const faceRadius = (to - from) * watch.faceRadiusShare;
  const faceX = (from + to) / 2;
  ctx.fillStyle = watch.metal;
  ctx.beginPath();
  ctx.arc(faceX, 0, faceRadius + BEZEL, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = watch.face;
  ctx.beginPath();
  ctx.arc(faceX, 0, faceRadius, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = rgba(watch.faceGlint, GLINT_ALPHA);
  ctx.beginPath();
  ctx.arc(
    faceX - faceRadius * GLINT_SHARE,
    -faceRadius * GLINT_SHARE,
    faceRadius * GLINT_SHARE,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.restore();
}

function watchPainter(watch: WatchLook): (ctx: Ctx, frame: BipedForearmFrame) => void {
  return (ctx, frame) => paintWatch(ctx, frame, watch);
}

const SMARTWATCH_LOOK: WatchLook = {
  metal: '#c3c8d0',
  metalShade: '#7c828c',
  face: SMARTWATCH_FACE,
  faceGlint: '#5f6b7e',
  bandProud: 0.008,
  faceRadiusShare: 0.75,
};

export const SMARTWATCH = defineGarment({
  id: 'smartwatch',
  name: 'Smartwatch',
  wearer: 'human',
  base: true,
  layer: 'over',
  region: ['forearm'],
  paint: { forearm: humanEveryView(watchPainter(SMARTWATCH_LOOK)) },
});

/**
 * A slim gold watch: a fine bracelet that sits close to the wrist and a small
 * pale dial, so at the tile it is a glint of gold rather than the
 * smartwatch's dark block.
 */
export const GOLD_WATCH_DEEP = '#7a5a22';
const GOLD_WATCH_LOOK: WatchLook = {
  metal: '#e2c072',
  metalShade: GOLD_WATCH_DEEP,
  face: '#f3e7cc',
  faceGlint: '#ffffff',
  bandProud: 0.004,
  faceRadiusShare: 0.6,
};

export const GOLD_WATCH = defineGarment({
  id: 'gold_watch',
  name: 'Gold watch',
  wearer: 'human',
  base: true,
  layer: 'over',
  region: ['forearm'],
  paint: { forearm: humanEveryView(watchPainter(GOLD_WATCH_LOOK)) },
});
