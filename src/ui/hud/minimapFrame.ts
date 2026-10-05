/**
 * The minimap's frame, top right: a rounded window onto whichever map the
 * scene paints into it, with an expand glyph in the corner whose tooltip says
 * how to work it.
 *
 * On a touch screen the map itself is the control: a tap expands or
 * collapses it and a drag pans the expanded one. With a mouse the expanded
 * map drags to pan and the glyph toggles.
 */

import { inset, type Rect } from '../core/geom';
import type { DragPoint, Ui } from '../core/UiRoot';
import { UiStateSlot } from '../core/uiState';
import { iconButton, iconButtonSize } from '../widgets/iconButton';
import { fillRounded, roundRectPath, strokeRounded } from '../widgets/paint';
import type { MinimapModel } from './hudModel';

/** A finger travels this far on the expanded map before it pans, so a tap still collapses it. */
export const MINIMAP_DRAG_SLOP = 5;
const FRAME_BORDER_WIDTH = 1;

const LAST_DRAG = new UiStateSlot<{ x: number; y: number }>('minimapDrag', () => ({ x: 0, y: 0 }));

export interface MinimapFrameOptions {
  /** A finger taps the map itself to expand or collapse it. */
  readonly touch: boolean;
}

export function minimapFrame(
  ui: Ui,
  rect: Rect,
  model: MinimapModel,
  opts: MinimapFrameOptions,
): void {
  const { ctx, theme } = ui;
  const corner = theme.radius.lg;
  const last = ui.state(LAST_DRAG, 'minimap');
  const pan = model.pan;
  const drag =
    model.expanded && pan !== undefined
      ? {
          onStart: (point: DragPoint): void => {
            last.x = point.startX;
            last.y = point.startY;
          },
          onMove: (point: DragPoint): void => {
            pan(point.x - last.x, point.y - last.y);
            last.x = point.x;
            last.y = point.y;
          },
        }
      : undefined;
  // The map claims its square either way, so a press on it never walks the
  // crawler; a finger taps it to expand or collapse it, a mouse uses the glyph.
  ui.hit('minimap', rect, {
    onTap: opts.touch ? () => model.toggle() : undefined,
    onDrag: drag,
    dragSlop: MINIMAP_DRAG_SLOP,
    focusable: false,
  });

  ctx.save();
  ctx.shadowColor = theme.elevation.hud.color;
  ctx.shadowBlur = theme.elevation.hud.blur;
  ctx.shadowOffsetY = theme.elevation.hud.offsetY;
  fillRounded(ctx, rect, corner, theme.palette.surface.sunken);
  ctx.restore();
  ctx.save();
  roundRectPath(ctx, rect, corner);
  ctx.clip();
  model.paint(ctx, rect);
  ctx.restore();
  strokeRounded(ctx, rect, corner, theme.palette.border.strong, FRAME_BORDER_WIDTH);

  const glyphSide = iconButtonSize(ui, 'sm');
  const glyphArea = inset(rect, theme.space.xs);
  iconButton(
    ui,
    {
      x: glyphArea.x + glyphArea.w - glyphSide,
      y: glyphArea.y,
      w: glyphSide,
      h: glyphSide,
    },
    {
      id: 'minimap/expand',
      icon: model.expanded ? 'minimize' : 'maximize',
      label: model.hint,
      size: 'sm',
      variant: 'ghost',
      onTap: () => model.toggle(),
    },
  );
}
