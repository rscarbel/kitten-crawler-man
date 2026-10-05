/**
 * Gates a phone's HUD — the same layout in the dungeon and inside a building —
 * at every common phone size in portrait and landscape, at every UI size, and
 * in every HUD state that moves a piece: minimap normal or expanded, and the
 * Build slot. Rects are in UI units, as the HUD lays itself out. The top
 * band is filled with a boss bar, an encounter bar, a countdown and a banner.
 *
 * Every rect comes from `hudLayout`, the function the HUD draws from
 * (`phoneHudLayouts.ts`). For each layout:
 * - every button is wholly on screen;
 * - no two buttons overlap, none covers the minimap's normal square, and none
 *   covers the band's leading bars, a boss and an encounter (buttons and bars
 *   may lie over the part an expanded minimap grew into);
 * - no button covers either crawler's HP meter;
 * - the leading bars always find room, and every bar placed is on screen.
 *
 *   npm run gates:phone-hud
 */

import { overlaps, type Rect } from '../src/ui/core/geom';
import type { UiSize } from '../src/core/Settings';
import { LEADING_BARS, hudStates, representativeTopBand } from './phoneHudLayouts';

/** Common phone viewports in CSS pixels, portrait; each is also checked in landscape. */
const PORTRAIT_PHONES: ReadonlyArray<readonly [number, number]> = [
  [320, 568],
  [360, 640],
  [375, 667],
  [390, 844],
  [414, 896],
  [430, 932],
];
const VIEWPORTS = PORTRAIT_PHONES.flatMap(([w, h]) => [[w, h] as const, [h, w] as const]);

/** Pieces every layout must report: a layout missing one would pass every check by never being measured. */
const REQUIRED_PIECES: readonly string[] = [
  'pause',
  'bag',
  'follower',
  'switch',
  'summon',
  'chip',
  'journal',
  'hotbar',
  'minimap',
];

const UI_SIZES: readonly UiSize[] = ['small', 'medium', 'large'];

function describe(rect: Rect): string {
  return `(${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.w)}×${Math.round(rect.h)})`;
}

function offScreen(rect: Rect, width: number, height: number): boolean {
  return rect.x < 0 || rect.y < 0 || rect.x + rect.w > width || rect.y + rect.h > height;
}

const failures: string[] = [];
let layouts = 0;
let buttonsChecked = 0;

for (const uiSize of UI_SIZES) {
  for (const [cssWidth, cssHeight] of VIEWPORTS) {
    for (const state of hudStates(cssWidth, cssHeight, 'touch', uiSize)) {
      layouts++;
      const { width, height } = state;
      const where = `${cssWidth}x${cssHeight} [${state.label}]`;
      for (const required of REQUIRED_PIECES) {
        if (!state.pieces.some((piece) => piece.name === required)) {
          failures.push(`${where}: no ${required} rect to check`);
        }
      }
      for (const piece of state.pieces.filter((p) => p.kind !== 'surface')) {
        buttonsChecked++;
        if (offScreen(piece.rect, width, height)) {
          failures.push(`${where}: ${piece.name} ${describe(piece.rect)} is off screen`);
        }
        if (piece.kind === 'button') {
          for (const bar of state.hpBars) {
            if (overlaps(piece.rect, bar)) {
              failures.push(
                `${where}: ${piece.name} ${describe(piece.rect)} covers an HP meter ${describe(bar)}`,
              );
            }
          }
        }
      }
      for (const [index, piece] of state.pieces.entries()) {
        for (const other of state.pieces.slice(index + 1)) {
          if (piece.kind === 'surface' && other.kind === 'surface') continue;
          if (overlaps(piece.rect, other.rect)) {
            failures.push(
              `${where}: ${piece.name} ${describe(piece.rect)} overlaps ${other.name} ${describe(other.rect)}`,
            );
          }
        }
      }
      const leading = representativeTopBand(state.geometry, LEADING_BARS);
      if (leading.length < LEADING_BARS.length) {
        failures.push(`${where}: only ${leading.length} of the leading bars found room`);
      }
      for (const bar of representativeTopBand(state.geometry)) {
        if (offScreen(bar.rect, width, height)) {
          failures.push(`${where}: the ${bar.name} bar ${describe(bar.rect)} is off screen`);
        }
      }
    }
  }
}

console.log(
  `phone hud: ${layouts} layouts over ${VIEWPORTS.length} viewports, ${buttonsChecked} tap targets checked`,
);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  console.error(`gates:phone-hud FAILED (${failures.length})`);
  process.exit(1);
}
console.log('gates:phone-hud passed');
