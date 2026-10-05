#!/usr/bin/env tsx
/**
 * Headless checks for Mongo's explainer: when it opens, how it pages and
 * closes, and whether what it says is still true of the pet.
 *
 *  1. It opens after the reward queue drains — never under a reward the player
 *     has not dismissed yet — and exactly once.
 *  2. The only automatic opener is the Krakaren chest's first grant. The circus
 *     quest hands back a pet the player already knows; the pause menu's
 *     Abilities tab is the one other way in.
 *  3. The explainers' host, driven through a `UiRoot`: Next walks forward and
 *     closes off the last page, Skip on the first page closes, Back and the
 *     arrow keys walk the pages, a click anywhere is consumed while it is
 *     open, and Escape closes it only while it wants Escape.
 *  4. It ranks below the award cards in the surface stack both scenes mount,
 *     which alone decides draw order and what a press reaches.
 *  5. The copy reads the live key bindings, uses touch wording on a phone, and
 *     says what is actually true of him: he fights at any health, and a
 *     knockout demands a full heal before he can be sent back in.
 *
 * Check 2 reads the source, because the trigger is a line inside a scene no
 * headless harness can construct; the scene-level behaviour still wants a look
 * in the browser — open the Krakaren chest, and hand Mongo back in the circus.
 *
 * Run: npx tsx scripts/verify-mongo-explainer.ts
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { gameContext } from './nodeGameContext.js';
import { keybindings } from '../src/core/Keybindings.js';
import { RewardGrantedDialog } from '../src/ui/RewardGrantedDialog.js';
import type { GrantedReward } from '../src/core/GrantedReward.js';
import { BANDS, UiRoot, type HitRegion } from '../src/ui/core/UiRoot.js';
import { MOUSE_POINTER_ID, PRIMARY_BUTTON } from '../src/ui/core/pointer.js';
import { NO_INSETS } from '../src/ui/core/viewport.js';
import { CraftExplainers } from '../src/ui/screens/dialogs/CraftExplainers.js';
import { explainerPage } from '../src/ui/screens/dialogs/explainerPages.js';
import { mongoExplainerPages } from '../src/ui/screens/dialogs/mongoExplainer.js';
import { buildSiegeRig } from './villageSiegeHarness.js';

const VIEWPORT_W = 1280;
const VIEWPORT_H = 720;
const FRAME_MS = 16;
/** Comfortably past the reward dialog's reveal animation. */
const REVEAL_FRAMES = 120;
const PAGE_COUNT = 3;
const REBOUND_SUMMON_KEY = 'g';
const HOST_SURFACE_ID = 'craft-explainers';
const RIG_SEED = 7919;
const RIG_ASSAULT_LEVEL = 6;

const failures: string[] = [];
let checks = 0;
function check(condition: boolean, message: string): void {
  checks++;
  if (!condition) failures.push(message);
}

installCanvasGlobals();
const ctx = gameContext(VIEWPORT_W, VIEWPORT_H);

// ---------------------------------------------------------------- 1. drain hook

const reward = (name: string): GrantedReward => ({
  kind: 'ability',
  name,
  description: `${name} was granted.`,
  renderIcon: () => undefined,
});

/** Plays the reveal out, then presses the card's OK. */
function dismissShowingReward(dialog: RewardGrantedDialog): void {
  for (let i = 0; i < REVEAL_FRAMES; i++) dialog.update();
  dialog.acknowledge();
}

{
  const dialog = new RewardGrantedDialog();
  let opened = 0;
  dialog.enqueue(reward('Mongo'));
  dialog.enqueue(reward('Magic Missile'));
  dialog.afterQueueDrains(() => opened++);
  check(opened === 0, 'drain hook ran while the first reward was still showing');
  dismissShowingReward(dialog);
  check(dialog.isShowing, 'dismissing the first reward closed the whole queue');
  check(opened === 0, 'drain hook ran with a second reward still queued');
  dismissShowingReward(dialog);
  check(!dialog.isShowing, 'the reward queue never drained');
  check(opened === 1, `drain hook ran ${opened} times once the queue drained, expected 1`);
  dialog.enqueue(reward('Later'));
  dismissShowingReward(dialog);
  check(opened === 1, 'drain hook ran again on a later, unrelated drain');

  let immediate = 0;
  dialog.afterQueueDrains(() => immediate++);
  check(immediate === 1, 'drain hook registered on an idle dialog did not run at once');
}

// ---------------------------------------------------------------- 2. the trigger

const MONGO_OPEN = "craftExplainers.open('mongo')";

function collectSources(dir: string, out: Map<string, string>): Map<string, string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      collectSources(path, out);
      continue;
    }
    if (entry.endsWith('.ts')) out.set(path, readFileSync(path, 'utf8'));
  }
  return out;
}

{
  const sources = collectSources('src', new Map());
  const openers = [...sources.entries()].filter(([, text]) => text.includes(MONGO_OPEN));
  const openerFiles = openers.map(([path]) => path).sort();
  const expectedFiles = ['src/scenes/DungeonScene.ts', 'src/systems/kits/MenusKit.ts'];
  check(
    JSON.stringify(openerFiles) === JSON.stringify(expectedFiles),
    `the explainer is opened from ${openerFiles.join(', ') || 'nowhere'}; expected exactly ${expectedFiles.join(', ')}`,
  );

  const scene = sources.get('src/scenes/DungeonScene.ts') ?? '';
  const sceneOpens = scene.split(MONGO_OPEN).length - 1;
  check(sceneOpens === 1, `DungeonScene opens the explainer ${sceneOpens} times, expected 1`);
  const krakarenBranchStart = scene.indexOf('chest.bossRoomIndex === this.krakarenBossRoomIdx');
  const nextBranch = scene.indexOf('chest.bossRoomIndex', krakarenBranchStart + 1);
  const opener = scene.indexOf(MONGO_OPEN);
  check(
    krakarenBranchStart >= 0 && opener > krakarenBranchStart && opener < nextBranch,
    'the scene opens the explainer outside the Krakaren chest branch of grantChestContents',
  );
  const drainedOpen =
    /afterQueueDrains\(\s*\(\)\s*=>\s*this\.menus\.craftExplainers\.open\('mongo'\)/;
  check(
    drainedOpen.test(scene),
    'the Krakaren grant opens the explainer directly instead of after the reward queue drains',
  );

  const menus = sources.get('src/systems/kits/MenusKit.ts') ?? '';
  check(
    /mongo:\s*\(\)\s*=>\s*void this\.craftExplainers\.open\('mongo'\)/.test(menus),
    "MenusKit's opener is not the pause screen's How Mongo works guide",
  );

  const circus = sources.get('src/systems/CircusQuestSystem.ts') ?? '';
  check(
    circus.length > 0,
    'CircusQuestSystem.ts was not found, so the circus check proves nothing',
  );
  check(!circus.includes(MONGO_OPEN), 'the circus quest opens the Mongo explainer');
}

// ---------------------------------------------------------------- 3. the frame

interface HostRig {
  readonly root: UiRoot;
  readonly host: CraftExplainers;
  /** Gestures no surface claimed: a click that reaches here fell through the explainer. */
  readonly worldTaps: { count: number };
  frame(): void;
  region(suffix: string): HitRegion | null;
  tap(point: { readonly x: number; readonly y: number }): void;
}

function hostRig(wantsEscape: () => boolean): HostRig {
  let clock = 0;
  const worldTaps = { count: 0 };
  const root = new UiRoot({
    audio: null,
    viewport: () => ({
      cssWidth: VIEWPORT_W,
      cssHeight: VIEWPORT_H,
      density: 'pointer',
      uiSize: 'medium',
      safeArea: NO_INSETS,
    }),
    handleWorldPointer: (gesture) => {
      if (gesture.tap) worldTaps.count++;
    },
    now: () => clock,
    warn: () => undefined,
  });
  const host = new CraftExplainers();
  host.register('mongo', {
    title: 'How Mongo works',
    pages: () =>
      ['one', 'two', 'three'].map((subtitle) =>
        explainerPage({ subtitle, lines: [subtitle], drawIllustration: () => undefined }),
      ),
  });
  root.mount(host.surface({ id: HOST_SURFACE_ID, wantsEscape }));
  const tap = (point: { readonly x: number; readonly y: number }): void => {
    const scale = root.uiScale;
    for (const kind of ['down', 'up'] as const) {
      root.pointer({
        kind,
        pointerId: MOUSE_POINTER_ID,
        source: 'mouse',
        x: point.x,
        y: point.y,
        cssX: point.x * scale,
        cssY: point.y * scale,
        button: PRIMARY_BUTTON,
        deltaY: 0,
      });
    }
  };
  return {
    root,
    host,
    worldTaps,
    frame: () => {
      clock += FRAME_MS;
      root.frame(ctx);
    },
    region: (suffix) =>
      root.regions().find((region) => region.id.endsWith(`${HOST_SURFACE_ID}/${suffix}`)) ?? null,
    tap,
  };
}

/** Draws a frame, then taps the control named `suffix`. Returns false when it was not drawn. */
function press(rig: HostRig, suffix: string): boolean {
  rig.frame();
  const region = rig.region(suffix);
  if (region === null) return false;
  rig.tap({ x: region.rect.x + region.rect.w / 2, y: region.rect.y + region.rect.h / 2 });
  return true;
}

{
  const rig = hostRig(() => true);
  const { host } = rig;
  check(!host.isOpen && host.open('mongo'), 'the host did not open the registered explainer');
  check(host.isOpen && host.currentPage === 0, 'the explainer did not open on its first page');
  rig.frame();
  check(rig.root.isOpen(HOST_SURFACE_ID), 'the host surface is not open while the explainer is');
  rig.tap({ x: 1, y: 1 });
  check(rig.worldTaps.count === 0 && host.isOpen, 'a click on the backdrop fell through');
  check(press(rig, 'next') && press(rig, 'next'), 'Next was not drawn');
  check(host.currentPage === 2, `two Nexts landed on page ${host.currentPage + 1}, not 3`);
  check(press(rig, 'back'), 'Back was not drawn past the first page');
  check(host.currentPage === 1, 'Back did not step back a page');
  rig.frame();
  rig.root.key('ArrowRight', {});
  check(host.currentPage === 2, 'the right arrow did not turn the page');
  rig.root.key('ArrowLeft', {});
  check(host.currentPage === 1, 'the left arrow did not turn the page back');
  check(press(rig, 'next') && press(rig, 'next'), 'Next was not drawn on the later pages');
  check(!host.isOpen, 'Next on the last page did not close the explainer');
  rig.frame();
  rig.tap({ x: 1, y: 1 });
  check(rig.worldTaps.count === 1, 'a closed explainer still swallowed a click');

  host.open('mongo');
  check(press(rig, 'skip') && !host.isOpen, 'Skip on the first page did not close the explainer');

  host.open('mongo');
  rig.frame();
  check(
    rig.root.key('Escape', {}) === 'consumed' && !host.isOpen,
    'Escape did not close the explainer',
  );
  check(!host.open('processing'), 'the host opened an explainer nobody registered');
}

{
  // While an award card is drawn over the explainer, Escape is not aimed at it.
  const rig = hostRig(() => false);
  rig.host.open('mongo');
  rig.frame();
  rig.root.key('Escape', {});
  check(rig.host.isOpen, 'Escape closed the explainer while it did not want Escape');
}

// ---------------------------------------------------------------- 3b. stacking

{
  // Each scene mounts the kit's surfaces and keeps no click chain of its own,
  // so the stack those surfaces form is the one order that decides what draws
  // on top, what a press reaches and where Escape goes. In it a reward card and
  // a level-up sit in a band above the explainer's.
  for (const scene of ['src/scenes/DungeonScene.ts', 'src/scenes/BuildingInteriorScene.ts']) {
    const text = readFileSync(scene, 'utf8');
    check(text.includes('this.menus.surfaces('), `${scene} does not mount the kit's surfaces`);
    check(
      !text.includes('handleClick(mx: number, my: number'),
      `${scene} still routes clicks through a handleClick chain of its own`,
    );
  }
  const siegeRig = buildSiegeRig({ seed: RIG_SEED, assaultLevel: RIG_ASSAULT_LEVEL });
  const surfaces = siegeRig.menus.surfaces({
    pauseFrame: () => {
      throw new Error('the stacking check never draws the pause screen');
    },
    togglePause: () => undefined,
  });
  siegeRig.dispose();
  const mountIndex = (id: string): number => surfaces.findIndex((surface) => surface.id === id);
  const bandRank = (id: string): number =>
    BANDS.findIndex((band) => band === surfaces[mountIndex(id)]?.band);
  check(mountIndex('mongo-explainer') < 0, 'MenusKit still mounts a separate Mongo explainer');
  for (const award of ['reward-granted', 'level-up']) {
    for (const explainer of [HOST_SURFACE_ID, 'skill-book-prompt']) {
      check(
        bandRank(award) >= 0 && bandRank(explainer) >= 0 && bandRank(award) > bandRank(explainer),
        `MenusKit.surfaces: "${award}" is not in a band above "${explainer}"`,
      );
    }
  }
  // Within the modal band, a surface mounted later stacks over one that opened
  // on the same frame, so the explainer is mounted after the skill-book prompt.
  check(
    mountIndex('skill-book-prompt') >= 0 &&
      mountIndex(HOST_SURFACE_ID) > mountIndex('skill-book-prompt'),
    'MenusKit.surfaces: the explainer is not mounted after the skill-book prompt',
  );
}

// ---------------------------------------------------------------- 4. the copy

{
  const desktop = mongoExplainerPages('juvenile', false);
  const phone = mongoExplainerPages('juvenile', true);
  check(
    desktop.length === PAGE_COUNT,
    `desktop has ${desktop.length} pages, expected ${PAGE_COUNT}`,
  );
  check(phone.length === PAGE_COUNT, `phone has ${phone.length} pages, expected ${PAGE_COUNT}`);

  const desktopText = desktop.flatMap((page) => page.lines).join(' ');
  const phoneText = phone.flatMap((page) => page.lines).join(' ');
  const summonKey = `[${keybindings.labelFor('buildSummon')}]`;
  const switchKey = `[${keybindings.labelFor('switchCharacter')}]`;
  check(desktopText.includes(summonKey), `desktop copy never names the Summon key ${summonKey}`);
  check(desktopText.includes(switchKey), `desktop copy never names the switch key ${switchKey}`);
  check(!phoneText.includes(summonKey), 'phone copy tells a touch player to press a key');
  check(phoneText.includes('Tap'), 'phone copy has no touch wording');
  check(desktopText.includes('indoors'), 'the copy does not say he follows the party indoors');

  check(
    desktopText.includes('at any health'),
    'the copy does not say he fights at any health, all the way down',
  );
  check(
    desktopText.includes('heal all the way to full'),
    'the copy does not say a knockout requires a full heal before he can be sent back in',
  );

  const defaults = keybindings.keysFor('buildSummon');
  keybindings.rebind('buildSummon', 0, REBOUND_SUMMON_KEY);
  const rebound = mongoExplainerPages('juvenile', false)
    .flatMap((page) => page.lines)
    .join(' ');
  const reboundLabel = `[${keybindings.labelForKey(REBOUND_SUMMON_KEY)}]`;
  check(
    rebound.includes(reboundLabel),
    `after rebinding Summon to ${reboundLabel} the copy still does not say it`,
  );
  keybindings.resetAction('buildSummon');
  check(
    JSON.stringify(keybindings.keysFor('buildSummon')) === JSON.stringify(defaults),
    'the gate failed to restore the Summon binding it changed',
  );
}

if (failures.length > 0) {
  console.error(`verify:mongo-explainer — ${failures.length} of ${checks} checks failed:`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`verify:mongo-explainer — all ${checks} checks passed`);
