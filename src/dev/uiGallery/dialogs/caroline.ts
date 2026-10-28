/**
 * Caroline's frame in every variant on one sheet, over a dark backdrop and a
 * light one: the full box settled, decoding and unfolding, the compact toast
 * and the sheer title line. Each moment is a fixed point on her clock, so the
 * capture never depends on how fast the render ran.
 */

import { crawlerName } from '../../../characters/characters';
import { splitV, type Rect } from '../../../ui/core/geom';
import type { Surface, Ui } from '../../../ui/core/UiRoot';
import { panelWidths } from '../../../ui/theme/tokens';
import {
  CAROLINE_FULLY_OPEN,
  carolineBox,
  carolineOpenAt,
  carolineRevealAt,
  carolineSettled,
  carolineToast,
  measureCarolineBox,
  layoutCarolineToast,
} from '../../../ui/widgets/carolineFrame';
import type { DialogFixture } from './fixture';

/** A fixed moment on her clock, so the scanlines, dot and scrambled glyphs hold still between captures. */
const FIXTURE_NOW_MS = 1234;
/** Part-way through a reveal: some characters locked, the newest still scrambling. */
const DECODING_AT_MS = 900;
/** Part-way through the open: the line drawn, the box half unfolded. */
const UNFOLDING_AT_MS = 200;

const SETTLED_MESSAGE = `${crawlerName('human')}. ${crawlerName('cat')}. Floor 2 is active. The stairwell is 140 tiles north-east.`;
const DECODING_MESSAGE =
  'Objective: the east wing holds a level 9 brute. Classification: optional. Reward: rare.';
const UNFOLDING_MESSAGE = 'Safe room confirmed. Hostiles evicted.';
const TOAST_MESSAGE = 'Boss eliminated. Time: 4 minutes 12 seconds.';
const TITLE_MESSAGE = 'Survival probability is not a fixed value. Raise it.';

type Backdrop = 'dark' | 'light';

function backdropColor(ui: Ui, backdrop: Backdrop): string {
  const { palette } = ui.theme;
  return backdrop === 'dark' ? palette.surface.sunken : palette.text.primary;
}

function framesSurface(id: string, backdrop: Backdrop, shown: () => boolean): Surface {
  return {
    id,
    band: 'panel',
    haltsWorld: false,
    isOpen: shown,
    render: (ui) => {
      const { ctx, theme, viewport, screen } = ui;
      const { space } = theme;
      ctx.save();
      ctx.fillStyle = backdropColor(ui, backdrop);
      ctx.fillRect(screen.x, screen.y, screen.w, screen.h);
      ctx.restore();

      const width = Math.min(viewport.w - space.lg * 2, panelWidths.md);
      const column: Rect = {
        x: viewport.x + (viewport.w - width) / 2,
        y: viewport.y + space.lg,
        w: width,
        h: viewport.h - space.lg * 2,
      };
      const toast = layoutCarolineToast(ui, width, TOAST_MESSAGE);
      const rows = splitV(
        column,
        [
          measureCarolineBox(ui, width, SETTLED_MESSAGE),
          measureCarolineBox(ui, width, DECODING_MESSAGE),
          measureCarolineBox(ui, width, UNFOLDING_MESSAGE),
          toast.h,
          measureCarolineBox(ui, width, TITLE_MESSAGE),
        ],
        space.md,
      );
      const [settled, decoding, unfolding, toastRow, title] = rows;
      carolineBox(ui, settled, {
        message: SETTLED_MESSAGE,
        reveal: carolineSettled(SETTLED_MESSAGE),
        nowMs: FIXTURE_NOW_MS,
        open: CAROLINE_FULLY_OPEN,
      });
      carolineBox(ui, decoding, {
        message: DECODING_MESSAGE,
        reveal: carolineRevealAt(theme, DECODING_MESSAGE, DECODING_AT_MS, false),
        nowMs: FIXTURE_NOW_MS,
        open: CAROLINE_FULLY_OPEN,
      });
      carolineBox(ui, unfolding, {
        message: UNFOLDING_MESSAGE,
        reveal: { shown: 0, decoding: 0 },
        nowMs: FIXTURE_NOW_MS,
        open: carolineOpenAt(theme, UNFOLDING_AT_MS, false),
      });
      carolineToast(ui, { x: column.x + (column.w - toast.w) / 2, y: toastRow.y }, toast, {
        reveal: carolineSettled(TOAST_MESSAGE),
        nowMs: FIXTURE_NOW_MS,
        open: CAROLINE_FULLY_OPEN,
      });
      carolineBox(ui, title, {
        message: TITLE_MESSAGE,
        reveal: carolineSettled(TITLE_MESSAGE),
        nowMs: FIXTURE_NOW_MS,
        open: CAROLINE_FULLY_OPEN,
        sheer: true,
      });
    },
  };
}

function framesFixture(name: string, backdrop: Backdrop): DialogFixture {
  return { name, surfaces: (shown) => [framesSurface(name, backdrop, shown)] };
}

export const FIXTURES: readonly DialogFixture[] = [
  framesFixture('caroline-frames-dark', 'dark'),
  framesFixture('caroline-frames-light', 'light'),
];
