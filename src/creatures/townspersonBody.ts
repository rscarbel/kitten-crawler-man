/**
 * What a `Townsperson` is drawn as: a look from one of the citizen casts, or a
 * bespoke resident painter from `BESPOKE_RESIDENT_FIGURES`. Everything that
 * draws, warms or times a townsperson's walk asks this module, so the two
 * kinds can never drift into separate code paths.
 */

import {
  citizenHurryGait,
  prewarmCitizenHurry,
  citizenSpeechStyle,
  citizenWalkCyclePx,
  citizenWalkFrames,
  drawCitizenSprite,
  prewarmAndPinCitizenTalk,
  prewarmCitizenFigure,
  type CitizenFigure,
  type CitizenSpriteState,
  type GaitRow,
} from './citizenFigure';
import {
  bespokeResidentFigure,
  type BespokeResidentFigureId,
  type TileOffset,
} from './bespokeResidentFigures';
import {
  DEFAULT_ROUTINE_POSE_TIMING,
  routinePoseTiming,
  type RoutinePoseId,
  type RoutinePoseTiming,
} from './routinePose';
import type { CitizenSpeechStyle } from '../dialog/speakers';
import type { DrawnFigureRow } from '../sprites/figure/figureDef';

export type TownspersonBody =
  | { readonly kind: 'citizen'; readonly figure: CitizenFigure }
  | { readonly kind: 'bespoke'; readonly id: BespokeResidentFigureId };

function unhandledBody(body: never): never {
  throw new Error(`unhandled townsperson body ${JSON.stringify(body)}`);
}

/** World pixels one walk cycle covers for this body drawn at `tileSize`. */
export function townspersonWalkCyclePx(body: TownspersonBody, tileSize: number): number {
  switch (body.kind) {
    case 'citizen':
      return citizenWalkCyclePx(body.figure, tileSize);
    case 'bespoke':
      return bespokeResidentFigure(body.id).walkCyclePx(tileSize);
    default:
      return unhandledBody(body);
  }
}

/** Frames in this body's walk row. */
export function townspersonWalkFrames(body: TownspersonBody): number {
  switch (body.kind) {
    case 'citizen':
      return citizenWalkFrames(body.figure);
    case 'bespoke':
      return bespokeResidentFigure(body.id).walkFrames;
    default:
      return unhandledBody(body);
  }
}

/** The row this body hurries in, drawn at `tileSize`: a bespoke painter has no run, so it hurries in its walk. */
export function townspersonHurryGait(body: TownspersonBody, tileSize: number): GaitRow {
  switch (body.kind) {
    case 'citizen':
      return citizenHurryGait(body.figure, tileSize);
    case 'bespoke': {
      const figure = bespokeResidentFigure(body.id);
      return { action: 'walk', cyclePx: figure.walkCyclePx(tileSize), frames: figure.walkFrames };
    }
    default:
      return unhandledBody(body);
  }
}

/** Warms the row this body hurries in; a bespoke painter hurries in its walk, warm with the rest. */
export function prewarmTownspersonHurry(body: TownspersonBody): void {
  if (body.kind === 'citizen') prewarmCitizenHurry(body.figure);
}

/** The dialog style this body speaks in. */
export function townspersonSpeechStyle(body: TownspersonBody): CitizenSpeechStyle {
  switch (body.kind) {
    case 'citizen':
      return citizenSpeechStyle(body.figure);
    case 'bespoke':
      return bespokeResidentFigure(body.id).speechStyle;
    default:
      return unhandledBody(body);
  }
}

/** Draws the body with its tile top-left at `sx`,`sy`, returning the row drawn. */
export function drawTownspersonBody(
  ctx: CanvasRenderingContext2D,
  body: TownspersonBody,
  sx: number,
  sy: number,
  tileSize: number,
  state: CitizenSpriteState,
): DrawnFigureRow | undefined {
  switch (body.kind) {
    case 'citizen':
      return drawCitizenSprite(ctx, body.figure, sx, sy, tileSize, state);
    case 'bespoke':
      return bespokeResidentFigure(body.id).draw(ctx, sx, sy, tileSize, state);
    default:
      return unhandledBody(body);
  }
}

/** Warms the body's rows ahead of its first draw. */
export function prewarmTownspersonBody(body: TownspersonBody): void {
  switch (body.kind) {
    case 'citizen':
      prewarmCitizenFigure(body.figure);
      return;
    case 'bespoke':
      bespokeResidentFigure(body.id).prewarm();
      return;
    default:
      unhandledBody(body);
  }
}

/**
 * Warms and pins the `talk` row a conversation is about to freeze this body
 * into, returning it for `unpinCitizenTalk`, or null when nothing needs
 * pinning: a bespoke resident's prewarm warms its talk row with the rest, and
 * the row stays in use for as long as the conversation draws it.
 */
export function prewarmAndPinTownspersonTalk(
  body: TownspersonBody,
  facingX: number,
  facingY: number,
): DrawnFigureRow | null {
  switch (body.kind) {
    case 'citizen':
      return prewarmAndPinCitizenTalk(body.figure, facingX, facingY);
    case 'bespoke':
      return null;
    default:
      return unhandledBody(body);
  }
}

/** How long one play of a routine pose runs for this body, and where its sound lands. */
export function townspersonRoutineTiming(
  body: TownspersonBody,
  pose: RoutinePoseId,
): RoutinePoseTiming {
  switch (body.kind) {
    case 'citizen':
      return DEFAULT_ROUTINE_POSE_TIMING[pose];
    case 'bespoke':
      return routinePoseTiming(bespokeResidentFigure(body.id).routinePoses[pose], pose);
    default:
      return unhandledBody(body);
  }
}

/** The middle of a figure's tile, where a shot from a body with no painted weapon starts. */
const TILE_MIDDLE: TileOffset = { x: 0.5, y: 0.5 };

/** Where a shot leaves this body on its release beat, in tiles from its tile's top-left. */
export function townspersonReleasePoint(
  body: TownspersonBody,
  facingX: number,
  facingY: number,
): TileOffset {
  switch (body.kind) {
    case 'citizen':
      return TILE_MIDDLE;
    case 'bespoke':
      return bespokeResidentFigure(body.id).releasePoint?.(facingX, facingY) ?? TILE_MIDDLE;
    default:
      return unhandledBody(body);
  }
}
