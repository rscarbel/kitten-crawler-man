/**
 * Gates a phone's HUD buttons, in the dungeon and inside a building, at every
 * common phone size in portrait and landscape and every HUD state that moves
 * them: minimap normal or expanded, HUD panel expanded or collapsed, the level
 * timer, the Build slot and the siege panel, Follow and Summon.
 *
 * Every rect comes from the functions the renderers draw from
 * (`phoneHudLayouts.ts`). For each layout:
 * - every button is wholly on screen;
 * - no two buttons overlap, and no button covers a surface (the timer, the
 *   name plate, the siege panel, the resource strip);
 * - no button covers either crawler's HP bar.
 *
 *   npm run gates:phone-hud
 */

import type { Rect } from '../src/systems/MobileHUDSystem';

Object.defineProperty(globalThis, 'navigator', {
  value: { maxTouchPoints: 1, userAgent: 'iPhone' },
  configurable: true,
});

const { installCanvasGlobals } = await import('./nodeCanvasGlobals.js');
installCanvasGlobals();
const { dungeonPhoneHudStates, interiorPhoneHudStates } = await import('./phoneHudLayouts');

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

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function describe(rect: Rect): string {
  return `(${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.w)}×${Math.round(rect.h)})`;
}

/**
 * Pieces each scene must report in every layout: a layout missing one would
 * pass every check below by never being measured.
 */
const REQUIRED_PIECES: Record<'dungeon' | 'interior', readonly string[]> = {
  dungeon: ['pause', 'bag', 'follower', 'switch', 'summon', 'journal', 'hotbar', 'minimap'],
  interior: ['pause', 'bag', 'switch', 'achievementChip', 'journal', 'hotbar', 'minimap'],
};

const failures: string[] = [];
let layouts = 0;
let buttonsChecked = 0;

for (const [width, height] of VIEWPORTS) {
  const states = [
    ...dungeonPhoneHudStates(width, height),
    ...interiorPhoneHudStates(width, height),
  ];
  for (const state of states) {
    layouts++;
    const where = `${state.scene} ${width}x${height} [${state.label}]`;
    for (const required of REQUIRED_PIECES[state.scene]) {
      if (!state.pieces.some((piece) => piece.name === required)) {
        failures.push(`${where}: no ${required} rect to check`);
      }
    }
    const tappable = state.pieces.filter((piece) => piece.kind !== 'surface');
    for (const piece of tappable) {
      buttonsChecked++;
      const r = piece.rect;
      const offscreen = r.x < 0 || r.y < 0 || r.x + r.w > width || r.y + r.h > height;
      if (offscreen) failures.push(`${where}: ${piece.name} ${describe(r)} is off screen`);
      if (piece.kind === 'button') {
        for (const bar of state.hpBars) {
          if (overlaps(r, bar)) {
            failures.push(
              `${where}: ${piece.name} ${describe(r)} covers an HP bar ${describe(bar)}`,
            );
          }
        }
      }
    }
    for (const [index, piece] of state.pieces.entries()) {
      for (const other of state.pieces.slice(index + 1)) {
        const bothSurfaces = piece.kind === 'surface' && other.kind === 'surface';
        if (bothSurfaces) continue;
        const allowed =
          (piece.mayOverlap ?? []).includes(other.name) ||
          (other.mayOverlap ?? []).includes(piece.name);
        if (allowed) continue;
        if (overlaps(piece.rect, other.rect)) {
          failures.push(
            `${where}: ${piece.name} ${describe(piece.rect)} overlaps ${other.name} ${describe(other.rect)}`,
          );
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
