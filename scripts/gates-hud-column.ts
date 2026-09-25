/**
 * Gates the right-hand HUD column's hanging pieces — the Build button, the
 * achievement chip and the Journal — across short and tall windows, both
 * platforms, both minimap sizes, floors with and without a collapse timer,
 * and with the Build slot reserved and not.
 *
 * Every layout is taken from the real rect functions in `DungeonUIRenderer`
 * and `InventoryPanel`. For each, no column piece may overlap another column
 * piece, the hotbar strip, the level timer (where the floor has one), Pause,
 * Bag or the Follower button, and none may leave the screen.
 *
 * The HUD panel is held to it too — at its real expanded size, collapse
 * toggle included — except at `PANEL_UNAVOIDABLE_VIEWPORT`, where the panel
 * and the minimap leave no room between them.
 *
 * Overlaps among Pause, Bag, the timer and the Follower button themselves are
 * not this gate's business and are not checked: on the shortest windows they
 * already crowd each other (a phone in landscape stacks the Follower button,
 * Pause and Bag down into the hotbar's rows; a 568 × 320 desktop puts the
 * Follower button across Pause). Only what the column places is held to it.
 *
 *   npm run gates:hud-column
 *
 * The platform is fixed when the game's modules load, so the script runs
 * itself once per platform in a child process.
 */

import { spawnSync } from 'node:child_process';

const PLATFORMS = ['desktop', 'mobile'] as const;
type PlatformName = (typeof PLATFORMS)[number];

const platformArg = process.argv.find((arg) => arg.startsWith('--platform='))?.split('=')[1];

if (platformArg === undefined) {
  let failed = false;
  for (const name of PLATFORMS) {
    const child = spawnSync(
      process.execPath,
      [...process.execArgv, process.argv[1] ?? '', `--platform=${name}`],
      { stdio: 'inherit' },
    );
    if (child.status !== 0) failed = true;
  }
  if (failed) {
    console.error('gates:hud-column FAILED');
    process.exit(1);
  }
  console.log('gates:hud-column passed');
  process.exit(0);
}

const platformName: PlatformName = platformArg === 'mobile' ? 'mobile' : 'desktop';
const isMobile = platformName === 'mobile';
Object.defineProperty(globalThis, 'navigator', {
  value: { maxTouchPoints: isMobile ? 1 : 0, userAgent: isMobile ? 'iPhone' : 'Desktop' },
  configurable: true,
});

const { installCanvasGlobals } = await import('./nodeCanvasGlobals.js');
installCanvasGlobals();
const { setViewportSize } = await import('../src/core/Viewport');
const { GameMap } = await import('../src/map/GameMap');
const { FloorTypeValue } = await import('../src/map/tileTypes');
const { TILE_SIZE } = await import('../src/core/constants');
const UI = await import('../src/systems/DungeonUIRenderer');
const { hotbarStripRect } = await import('../src/ui/InventoryPanel');
const { MiniMapSystem } = await import('../src/systems/MiniMapSystem');
const { expandedHudPanelRect } = await import('../src/ui/HUD');
const { siegeHudSlot, siegeHudPanelRect } =
  await import('../src/systems/briarHollow/siegeHudLayout');
const { RESOURCE_HUD_HEIGHT, RESOURCE_HUD_WIDTH } =
  await import('../src/systems/briarHollow/ResourceHud');

type Rect = { x: number; y: number; w: number; h: number };

const VIEWPORTS: ReadonlyArray<readonly [number, number]> = isMobile
  ? [
      [390, 844],
      [844, 390],
      [1280, 500],
      [568, 320],
      [640, 340],
    ]
  : [
      [844, 390],
      [568, 320],
      [1280, 500],
      [1280, 720],
      [640, 340],
    ];

/** Layout constants the column is measured against, as `DungeonUIRenderer` lays them out. */
const PAUSE_TO_BAG_STEP = 34;
const MOBILE_FOLLOWER_H = 52;
const MOBILE_FOLLOWER_W = 80;
const RIGHT_COL_MARGIN = 8;
const MINIMAP_Y = 8;
const BELOW_MAP_GAP = 20;
const TIMER_H = 42;
const MOBILE_BUTTON_GAP = 6;
/**
 * The one viewport with no room at all between the HUD panel and the minimap:
 * a column piece may land on a corner of the panel there, the one surface that
 * is not a button. 640 × 340 is the smallest where avoiding the panel changes
 * the layout, so it is where that avoidance is held to account.
 */
const PANEL_UNAVOIDABLE_VIEWPORT = '568x320';

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const failures: string[] = [];
/** Layouts where the siege panel found no clear place and lies over the HUD panel or the minimap. */
const crowdedLayouts: string[] = [];
let layouts = 0;
/** The minimap needs a map to exist; the column only reads its size and expanded state. */
const tinyMap = new GameMap({
  tileHeight: TILE_SIZE,
  prebuiltStructure: [[{ tileId: '0#0', type: FloorTypeValue.tile_floor }]],
});

for (const [width, height] of VIEWPORTS) {
  for (const expanded of [false, true]) {
    for (const hasTimer of [false, true]) {
      for (const reserved of [false, true]) {
        layouts++;
        setViewportSize(width, height);
        const miniMap = new MiniMapSystem(tinyMap);
        if (expanded) miniMap.toggle();
        UI.setBuildSlotReserved(reserved);
        UI.setLevelTimerShown(hasTimer);
        const pause = UI.pauseButtonRect(miniMap);
        const mmSize = expanded ? miniMap.EXPANDED_SIZE : miniMap.NORMAL_SIZE;
        const fixed: Record<string, Rect> = {
          hotbar: hotbarStripRect(),
          pause,
          bag: { x: pause.x, y: pause.y + PAUSE_TO_BAG_STEP, w: pause.w, h: pause.h },
          follower: isMobile
            ? {
                x: width - MOBILE_FOLLOWER_W - RIGHT_COL_MARGIN,
                y: MINIMAP_Y + mmSize + BELOW_MAP_GAP + TIMER_H + MOBILE_BUTTON_GAP,
                w: MOBILE_FOLLOWER_W,
                h: MOBILE_FOLLOWER_H,
              }
            : UI.followerButtonRect(),
        };
        if (hasTimer) fixed.timer = UI.levelTimerRect(miniMap);
        const hudPanel = expandedHudPanelRect();
        fixed.hudPanel = hudPanel;
        UI.setHudPanelRect(hudPanel);
        const column: Record<string, Rect> = {
          chip: UI.achievementChipRect(miniMap),
          journal: UI.journalButtonRect(miniMap),
        };
        if (reserved) column.build = UI.buildButtonRect(miniMap);
        const label = `${platformName} ${width}x${height}${expanded ? ' expanded' : ''}${hasTimer ? ' timer' : ''}${reserved ? ' build' : ''}`;
        // The siege's panel, at its tallest, is held to the same rules as the
        // column, and must also clear the resource strip and the minimap.
        const siegeSlot = siegeHudSlot(miniMap, hudPanel);
        const siegePanel = siegeHudPanelRect(siegeSlot);
        const strip = UI.topCentreStripSlot(miniMap, hudPanel, RESOURCE_HUD_WIDTH);
        const siegeFixed: Record<string, Rect> = {
          ...fixed,
          ...column,
          // Where the panel takes the strip's place, the strip is not drawn.
          resourceStrip: siegeSlot.hidesResourceStrip
            ? { x: 0, y: 0, w: 0, h: 0 }
            : {
                x: strip.x,
                y: strip.y,
                w: RESOURCE_HUD_WIDTH * strip.scale,
                h: RESOURCE_HUD_HEIGHT * strip.scale,
              },
          minimap: { x: width - RIGHT_COL_MARGIN - mmSize, y: MINIMAP_Y, w: mmSize, h: mmSize },
        };
        const siegeOff =
          siegePanel.x < 0 ||
          siegePanel.y < 0 ||
          siegePanel.x + siegePanel.w > width ||
          siegePanel.y + siegePanel.h > height;
        if (siegeOff) failures.push(`${label}: siege panel is off screen`);
        // Where nothing on the window leaves room, the panel may lie over the
        // HUD panel and the minimap, which the player can shrink; never over a
        // button or the hotbar. The count of such windows is printed.
        if (siegeSlot.crowded) crowdedLayouts.push(label);
        for (const [other, otherRect] of Object.entries(siegeFixed)) {
          const shrinkable = other === 'hudPanel' || other === 'minimap';
          if (siegeSlot.crowded && shrinkable) continue;
          if (overlaps(siegePanel, otherRect))
            failures.push(`${label}: siege panel overlaps ${other}`);
        }
        const columnNames = Object.keys(column);
        for (const [index, name] of columnNames.entries()) {
          const rect = column[name];
          const offscreen =
            rect.x < 0 || rect.y < 0 || rect.x + rect.w > width || rect.y + rect.h > height;
          if (offscreen) failures.push(`${label}: ${name} is off screen`);
          for (const [other, otherRect] of Object.entries(fixed)) {
            const panelIsUnavoidable =
              other === 'hudPanel' && `${width}x${height}` === PANEL_UNAVOIDABLE_VIEWPORT;
            if (panelIsUnavoidable) continue;
            if (overlaps(rect, otherRect)) failures.push(`${label}: ${name} overlaps ${other}`);
          }
          for (const other of columnNames.slice(index + 1)) {
            if (overlaps(rect, column[other])) failures.push(`${label}: ${name} overlaps ${other}`);
          }
        }
      }
    }
  }
}

console.log(`hud column (${platformName}): ${layouts} layouts checked`);
console.log(
  `  siege panel over the HUD panel or minimap (no room anywhere): ${crowdedLayouts.length} — ${crowdedLayouts.join('; ') || 'none'}`,
);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  process.exit(1);
}
