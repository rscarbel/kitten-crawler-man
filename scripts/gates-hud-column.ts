/**
 * Gates the HUD's dock — Pause, Bag, the Build button, the achievement chip,
 * the Journal, the Follower button, Summon and a phone's switch — across
 * short and tall windows, both densities, every UI size, both minimap sizes,
 * and with the Build slot reserved and not.
 *
 * Every layout is taken from `hudLayout`, the function the HUD draws from, in
 * UI units. For each: no two buttons overlap, none covers the hotbar, the
 * minimap's normal square, an HP meter or the unit frames, and none leaves the
 * screen. The top band's leading bars — a boss and an encounter, the siege's
 * card among them — must stay on screen and clear of every button, the hotbar
 * and the minimap's normal square. Every other bar of a full band is left out
 * where it has no room, and never laid over a button, whose taps it would take.
 *
 *   npm run gates:hud-column
 */

import type { UiSize } from '../src/core/Settings';
import { overlaps, type Rect } from '../src/ui/core/geom';
import type { Density } from '../src/ui/theme/tokens';
import { LEADING_BARS, hudStates, representativeTopBand } from './phoneHudLayouts';

const VIEWPORTS: ReadonlyArray<readonly [number, number]> = [
  [390, 844],
  [844, 390],
  [568, 320],
  [640, 340],
  [1024, 640],
  [1280, 500],
  [1280, 720],
  [1440, 900],
  [1920, 1080],
];
const DENSITIES: readonly Density[] = ['pointer', 'touch'];
const UI_SIZES: readonly UiSize[] = ['small', 'medium', 'large'];

function offScreen(rect: Rect, width: number, height: number): boolean {
  return rect.x < 0 || rect.y < 0 || rect.x + rect.w > width || rect.y + rect.h > height;
}

const failures: string[] = [];
let layouts = 0;

for (const density of DENSITIES) {
  for (const uiSize of UI_SIZES) {
    for (const [cssWidth, cssHeight] of VIEWPORTS) {
      for (const state of hudStates(cssWidth, cssHeight, density, uiSize)) {
        layouts++;
        const { width, height, geometry } = state;
        const label = `${density} ${cssWidth}x${cssHeight} [${state.label}]`;
        const buttons = state.pieces.filter((piece) => piece.kind === 'button');
        const fixed: Rect[] = [geometry.normalMiniMap, ...state.hpBars];
        for (const [index, piece] of buttons.entries()) {
          if (offScreen(piece.rect, width, height)) {
            failures.push(`${label}: ${piece.name} is off screen`);
          }
          for (const other of buttons.slice(index + 1)) {
            if (overlaps(piece.rect, other.rect)) {
              failures.push(`${label}: ${piece.name} overlaps ${other.name}`);
            }
          }
          if (fixed.some((rect) => overlaps(piece.rect, rect))) {
            failures.push(`${label}: ${piece.name} covers the minimap or an HP meter`);
          }
          if (piece.name !== 'hotbar' && overlaps(piece.rect, state.framesBlock)) {
            failures.push(`${label}: ${piece.name} overlaps the unit frames`);
          }
        }
        const leading = representativeTopBand(geometry, LEADING_BARS);
        if (leading.length < LEADING_BARS.length) {
          failures.push(`${label}: only ${leading.length} of the leading bars found room`);
        }
        for (const bar of leading) {
          if (offScreen(bar.rect, width, height))
            failures.push(`${label}: ${bar.name} is off screen`);
          for (const other of buttons) {
            if (overlaps(bar.rect, other.rect)) {
              failures.push(`${label}: ${bar.name} overlaps ${other.name}`);
            }
          }
          if (overlaps(bar.rect, geometry.normalMiniMap)) {
            failures.push(`${label}: ${bar.name} overlaps the minimap`);
          }
        }
        for (const bar of representativeTopBand(geometry)) {
          if (offScreen(bar.rect, width, height))
            failures.push(`${label}: ${bar.name} is off screen in a full band`);
          for (const other of buttons) {
            if (overlaps(bar.rect, other.rect)) {
              failures.push(`${label}: ${bar.name} lies over ${other.name} in a full band`);
            }
          }
        }
      }
    }
  }
}

console.log(`hud column: ${layouts} layouts checked`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  console.error(`gates:hud-column FAILED (${failures.length})`);
  process.exit(1);
}
console.log('gates:hud-column passed');
