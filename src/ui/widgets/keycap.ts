/** A keyboard key drawn as a small cap: interaction prompts, hotbar corners, the controls list. */

import { centerIn, type Rect } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import { skinsFor } from '../theme/skins';
import { fillRounded, strokeRounded } from './paint';
import { measureText, text } from './text';

export interface KeycapOptions {
  readonly label: string;
  /** Drawn pushed down, flush with its edge. */
  readonly pressed?: boolean;
  /** Smaller type and height, for corners of item slots. */
  readonly small?: boolean;
}

const BORDER_WIDTH = 1;
/** A small cap is this fraction of a full one. */
const SMALL_SCALE = 0.8;

export function keycapSize(
  ui: Ui,
  opts: Pick<KeycapOptions, 'label' | 'small'>,
): { w: number; h: number } {
  const skin = skinsFor(ui.theme).keycap;
  const scale = opts.small === true ? SMALL_SCALE : 1;
  const style = opts.small === true ? ui.theme.type.overline : skin.text.style;
  const h = Math.round(skin.height * scale);
  const w = Math.max(
    Math.round(skin.minWidth * scale),
    Math.ceil(measureText(ui, opts.label, { style }) + skin.padX * 2),
  );
  return { w, h: h + skin.depth };
}

/** Draws the cap at its natural size centred in `rect`. Returns the cap's outline. */
export function keycap(ui: Ui, rect: Rect, opts: KeycapOptions): Rect {
  const skin = skinsFor(ui.theme).keycap;
  const size = keycapSize(ui, opts);
  const outline = centerIn(rect, size.w, size.h);
  const pressed = opts.pressed === true;
  const face: Rect = {
    x: outline.x,
    y: outline.y + (pressed ? skin.depth : 0),
    w: outline.w,
    h: outline.h - skin.depth,
  };
  const { ctx } = ui;
  if (!pressed) {
    fillRounded(ctx, { ...face, y: face.y + skin.depth }, skin.radius, skin.bottomEdge);
  }
  fillRounded(ctx, face, skin.radius, skin.fill);
  strokeRounded(ctx, face, skin.radius, skin.border, BORDER_WIDTH);
  text(ui, face, {
    text: opts.label,
    style: opts.small === true ? ui.theme.type.overline : skin.text.style,
    color: skin.text.color,
    align: 'center',
  });
  return outline;
}
