/**
 * Gates that walking through a door, or a button coming and going, moves no
 * HUD button.
 *
 * The layout half: the dungeon and every building draw their HUD from the one
 * `hudLayout`, so for each window, density, UI size and minimap size it checks that the
 * pieces a scene may or may not offer never move the rest — holding the Build
 * slot moves none of the pieces ahead of it in the dock (Pause, Bag, the
 * Follower button, Summon, the switch), nor the hotbar, the minimap or the unit
 * frames.
 *
 * The door half (`hudParityDoor.ts`): the real `DungeonScene` and
 * `BuildingInteriorScene`, on a phone and on a desktop, carry the minimap
 * toggle through a door both ways, and every shared HUD piece stands on the
 * same pixels on both sides of it.
 *
 *   npm run verify:hud-parity
 *
 * Each door run is its own child process: the platform is decided once, when
 * the game's modules load.
 */

import { spawnSync } from 'node:child_process';

const doorArg = process.argv.find((arg) => arg.startsWith('--door='))?.split('=')[1];
if (doorArg !== undefined) {
  process.env.HUD_DOOR_DEVICE = doorArg;
  await import('./hudParityDoor');
  process.exit(0);
}

const { hudLayout } = await import('../src/ui/hud/hudLayout');
const { NO_INSETS, resolveViewport } = await import('../src/ui/core/viewport');

type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

const VIEWPORTS: ReadonlyArray<readonly [number, number]> = [
  [1920, 1080],
  [1280, 720],
  [1024, 768],
  [800, 600],
  [640, 340],
  [320, 568],
  [390, 844],
  [430, 932],
].flatMap(([w, h]) => [[w, h] as const, [h, w] as const]);
const DENSITIES = ['pointer', 'touch'] as const;
const UI_SIZES = ['small', 'medium', 'large'] as const;
const BOOLEANS = [false, true] as const;
const FAILURES_LISTED = 20;

function same(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

const failures: string[] = [];
let comparisons = 0;
for (const density of DENSITIES) {
  for (const uiSize of UI_SIZES) {
    for (const [width, height] of VIEWPORTS) {
      const resolved = resolveViewport({
        cssWidth: width,
        cssHeight: height,
        density,
        uiSize,
        safeArea: NO_INSETS,
      });
      for (const miniMapExpanded of BOOLEANS) {
        const layout = (build: boolean): ReturnType<typeof hudLayout> =>
          hudLayout({
            viewport: resolved.safe,
            size: resolved.size,
            density,
            miniMapExpanded,
            build,
          });
        const without = layout(false);
        const withBuild = layout(true);
        const steady: Record<string, readonly [Rect | null, Rect | null]> = {
          pause: [without.buttons.pause, withBuild.buttons.pause],
          bag: [without.buttons.bag, withBuild.buttons.bag],
          follower: [without.buttons.follower, withBuild.buttons.follower],
          summon: [without.buttons.summon, withBuild.buttons.summon],
          switch: [without.buttons.switchButton, withBuild.buttons.switchButton],
          hotbar: [without.hotbar.strip, withBuild.hotbar.strip],
          minimap: [without.miniMap, withBuild.miniMap],
          frames: [without.framesBlock, withBuild.framesBlock],
        };
        const label = `${density} ${uiSize} ${width}x${height}${miniMapExpanded ? ' expanded' : ''}`;
        for (const [name, [before, after]] of Object.entries(steady)) {
          comparisons++;
          if (!same(before, after)) failures.push(`${label}: holding the Build slot moves ${name}`);
        }
      }
    }
  }
}
console.log(`hud parity (layout): ${comparisons} rects compared`);
for (const failure of failures.slice(0, FAILURES_LISTED)) console.error(`  FAIL ${failure}`);

let failed = failures.length > 0;
for (const device of ['phone', 'desktop'] as const) {
  const child = spawnSync(
    process.execPath,
    [...process.execArgv, process.argv[1] ?? '', `--door=${device}`],
    { stdio: 'inherit' },
  );
  if (child.status !== 0) failed = true;
}
if (failed) {
  console.error('verify:hud-parity FAILED');
  process.exit(1);
}
console.log('verify:hud-parity passed');
