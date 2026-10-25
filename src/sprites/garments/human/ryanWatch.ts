/**
 * Ryan's smartwatch on his left wrist: silver, with a round dark face on the
 * back of the wrist and a link band round it. Like every one-sided thing on
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

const STEEL = '#c3c8d0';
const STEEL_SHADE = '#7c828c';
export const RYAN_WATCH_FACE = '#171a21';
const FACE_GLINT = '#5f6b7e';

/** Where the band sits along the forearm, 0 at the elbow and 1 at the wrist. */
const BAND_FROM = 0.86;
const BAND_TO = 0.97;
/**
 * Where the face is turned away, only the band shows, and it is the band's
 * own width rather than the face's: drawn at the face's width a band of
 * bright steel reads as the watch case seen from behind.
 */
const STRAP_ONLY_SHARE = 0.5;
/** The band stands this far proud of the wrist either side. */
const BAND_PROUD = 0.008;
/** The links' shaded edge, along the arm side away from the key. */
const BAND_SHADE_SHARE = 0.4;
/** The round face, centred on the band, a little wider than the band is long. */
const FACE_RADIUS_SHARE = 0.75;
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

function paintForearm(ctx: Ctx, frame: BipedForearmFrame): void {
  if (frame.piece !== 'arm') return;
  const { chain, view } = frame;
  if (frame.drawn !== drawnSide('left', view)) return;
  const angle = angleBetween(chain.joint, chain.end);
  const length = Math.hypot(chain.end.x - chain.joint.x, chain.end.y - chain.joint.y);
  const edges = bareSegmentEdges('forearm', BAND_TO, view.profile, frame.look.limbs);
  const plus = edges.plus + BAND_PROUD;
  const minus = edges.minus + BAND_PROUD;
  const faceShows = faceTowardCamera(view);
  const to = length * BAND_TO;
  const bandLength = length * (BAND_TO - BAND_FROM) * (faceShows ? 1 : STRAP_ONLY_SHARE);
  const from = to - bandLength;

  ctx.save();
  ctx.translate(chain.joint.x, chain.joint.y);
  ctx.rotate(angle);
  ctx.fillStyle = STEEL;
  ctx.fillRect(from, -minus, to - from, plus + minus);
  ctx.fillStyle = STEEL_SHADE;
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
  const faceRadius = (to - from) * FACE_RADIUS_SHARE;
  const faceX = (from + to) / 2;
  ctx.fillStyle = STEEL;
  ctx.beginPath();
  ctx.arc(faceX, 0, faceRadius + BEZEL, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = RYAN_WATCH_FACE;
  ctx.beginPath();
  ctx.arc(faceX, 0, faceRadius, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = rgba(FACE_GLINT, GLINT_ALPHA);
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

export const RYAN_WATCH = defineGarment({
  id: 'ryan_watch',
  name: 'Smartwatch',
  wearer: 'human',
  base: true,
  layer: 'over',
  region: ['forearm'],
  paint: { forearm: humanEveryView(paintForearm) },
});
