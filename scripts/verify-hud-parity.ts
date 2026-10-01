/**
 * Gates that walking through a door moves no HUD button: for the same screen
 * and the same buttons on show, the scene outside (`DungeonUIRenderer`'s rect
 * functions, as `DungeonScene` feeds them) and a building's interior
 * (`interiorHudLayout`) put Pause, Bag, Build, the achievement chip, the
 * Journal, the Follower button and the HUD panel's collapse toggle on the same
 * pixels.
 *
 * Every desktop and phone size it checks is tried in portrait and landscape,
 * with the minimap normal and expanded, the HUD panel expanded and collapsed
 * (where the platform can collapse it), the Build slot held or not, the
 * loot-box banner up or not, and the Follower button offered or refused — the
 * Big Top maze refuses it, and hiding it must move nothing else. Switch and
 * Summon are compared too.
 *
 * Then the door itself (`hudParityDoor.ts`): the real scenes, on a phone,
 * carry the minimap and HUD panel toggles through it both ways.
 *
 *   npm run verify:hud-parity
 *
 * The platform is fixed when the game's modules load, so the script runs
 * itself once per platform in a child process.
 */

import { spawnSync } from 'node:child_process';

/** `door` is the scene round trip, run on a phone. */
const PLATFORMS = ['desktop', 'mobile', 'door'] as const;
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
    console.error('verify:hud-parity FAILED');
    process.exit(1);
  }
  console.log('verify:hud-parity passed');
  process.exit(0);
}

if (platformArg === 'door') {
  await import('./hudParityDoor');
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
const { MiniMapSystem } = await import('../src/systems/MiniMapSystem');
const { hotbarStripRect } = await import('../src/ui/InventoryPanel');
const { hudKeepouts, hudReportedPanelRect, hudToggleRect } = await import('../src/ui/HUD');
const { interiorHudLayout } = await import('../src/scenes/interiorHudLayout');
const { desktopSummonButtonRect } = await import('../src/ui/hudButtons/hudButtonLayout');

type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

const DESKTOP_SIZES: ReadonlyArray<readonly [number, number]> = [
  [1920, 1080],
  [1280, 720],
  [1024, 768],
  [800, 600],
  [640, 340],
];
const PHONE_SIZES: ReadonlyArray<readonly [number, number]> = [
  [320, 568],
  [375, 667],
  [390, 844],
  [430, 932],
];
const VIEWPORTS = (isMobile ? PHONE_SIZES : DESKTOP_SIZES).flatMap(([w, h]) => [
  [w, h] as const,
  [h, w] as const,
]);
const BOOLEANS = [false, true] as const;
/** Where the loot-box banner stands when a safe room shows it: the left edge, mid-screen. */
const BANNER_LEFT = 12;
const BANNER_W = 96;
const BANNER_H = 88;
/** Mismatches printed before the rest are only counted. */
const FAILURES_LISTED = 20;

/** The minimap needs a map to exist; the layout only reads its size and expanded state. */
const tinyMap = new GameMap({
  tileHeight: TILE_SIZE,
  prebuiltStructure: [[{ tileId: '0#0', type: FloorTypeValue.tile_floor }]],
});

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function describe(rect: Rect | null): string {
  return rect === null ? 'none' : `(${rect.x},${rect.y} ${rect.w}×${rect.h})`;
}

const failures: string[] = [];
let layouts = 0;
let comparisons = 0;

for (const [width, height] of VIEWPORTS) {
  for (const miniMapExpanded of BOOLEANS) {
    for (const hudCollapsed of isMobile ? BOOLEANS : [false]) {
      for (const build of BOOLEANS) {
        for (const banner of BOOLEANS) {
          for (const followOffered of BOOLEANS) {
            layouts++;
            setViewportSize(width, height);
            const lootBoxBanner: Rect | null = banner
              ? { x: BANNER_LEFT, y: height / 2 - BANNER_H / 2, w: BANNER_W, h: BANNER_H }
              : null;

            // Outside, as `DungeonScene` tells the renderer each frame.
            UI.resetColumnLayoutState();
            const miniMap = new MiniMapSystem(tinyMap);
            if (miniMapExpanded) miniMap.toggle();
            const toggleClearOfX = miniMap.screenRect.x;
            UI.setHudPanelRect(hudReportedPanelRect(hudCollapsed));
            UI.setHudPanelKeepouts(hudKeepouts(hudCollapsed, isMobile, toggleClearOfX));
            // No floor with a collapse timer has buildings to go into.
            UI.setLevelTimerShown(false);
            UI.setBuildSlotReserved(build);
            UI.setLootBoxBannerRect(lootBoxBanner);
            const outdoorFollower = isMobile
              ? UI.mobileFollowerButtonRect(miniMap)
              : UI.followerButtonRect();
            const outdoor: Record<string, Rect | null> = {
              pause: UI.pauseButtonRect(miniMap),
              bag: UI.bagButtonRect(miniMap),
              build: build ? UI.buildButtonRect(miniMap) : null,
              chip: UI.achievementChipRect(miniMap),
              journal: UI.journalButtonRect(miniMap),
              follower: followOffered ? outdoorFollower : null,
              hudToggle: hudToggleRect(hudCollapsed, isMobile, toggleClearOfX),
              switchButton: isMobile ? UI.mobileSwitchButtonRect() : null,
              summon: isMobile ? UI.mobileSummonButtonRect() : desktopSummonButtonRect(height),
            };

            const interior = interiorHudLayout({
              viewportWidth: width,
              viewportHeight: height,
              mobile: isMobile,
              hudCollapsed,
              miniMapExpanded,
              hotbarBandHeight: height - hotbarStripRect().y,
              followButton: followOffered,
              summonButton: true,
              buildButton: build,
              journalButton: true,
              lootBoxBanner,
            });
            const indoor: Record<string, Rect | null> = {
              pause: interior.pause,
              bag: interior.bag,
              build: interior.build,
              chip: interior.achievementChip,
              journal: interior.journal,
              follower: interior.follow,
              hudToggle: interior.hudToggle,
              switchButton: interior.switchButton,
              summon: interior.summon,
            };

            const label = [
              `${platformName} ${width}x${height}`,
              miniMapExpanded ? 'minimap expanded' : 'minimap',
              ...(isMobile ? [hudCollapsed ? 'hud collapsed' : 'hud expanded'] : []),
              ...(build ? ['build'] : []),
              ...(banner ? ['loot banner'] : []),
              followOffered ? 'follower' : 'follower refused',
            ].join(', ');
            for (const [name, rect] of Object.entries(outdoor)) {
              comparisons++;
              const inside = indoor[name] ?? null;
              if (!sameRect(rect, inside)) {
                failures.push(
                  `${label}: ${name} is ${describe(rect)} outside but ${describe(inside)} inside`,
                );
              }
            }
          }
        }
      }
    }
  }
}

console.log(
  `hud parity (${platformName}): ${layouts} layouts, ${comparisons} button rects compared`,
);
if (failures.length > 0) {
  for (const failure of failures.slice(0, FAILURES_LISTED)) console.error(`  FAIL ${failure}`);
  if (failures.length > FAILURES_LISTED) {
    console.error(`  … and ${failures.length - FAILURES_LISTED} more`);
  }
  process.exit(1);
}
