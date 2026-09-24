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
 *  3. The paged frame: Next walks forward and closes off the last page, Skip on
 *     the first page closes, Back walks back, `onClose` fires exactly once, and
 *     a click anywhere is consumed while it is open.
 *  4. It ranks in the same place in each scene's claim list, click chain and
 *     draw order, and a button hidden under it cannot answer a press with its
 *     click sound.
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
import { setViewportSize } from '../src/core/Viewport.js';
import { keybindings } from '../src/core/Keybindings.js';
import { RewardGrantedDialog } from '../src/ui/RewardGrantedDialog.js';
import { drawButton, renderedButtonSoundAt, setButtonMouseState } from '../src/ui/Button.js';
import { HowToPlayOverlay, type HowToPlayPage } from '../src/ui/HowToPlayOverlay.js';
import { buildMongoExplainerPages, MONGO_EXPLAINER_CONFIG } from '../src/ui/MongoExplainer.js';
import type { GrantedReward } from '../src/core/GrantedReward.js';

const VIEWPORT_W = 1280;
const VIEWPORT_H = 720;
/** Comfortably past the reward dialog's reveal animation. */
const REVEAL_FRAMES = 120;
const PAGE_COUNT = 3;
const REBOUND_SUMMON_KEY = 'g';

const failures: string[] = [];
let checks = 0;
function check(condition: boolean, message: string): void {
  checks++;
  if (!condition) failures.push(message);
}

installCanvasGlobals();
setViewportSize(VIEWPORT_W, VIEWPORT_H);
const ctx = gameContext(VIEWPORT_W, VIEWPORT_H);

// ---------------------------------------------------------------- 1. drain hook

const reward = (name: string): GrantedReward => ({
  kind: 'ability',
  name,
  description: `${name} was granted.`,
  renderIcon: () => undefined,
});

/** Plays the reveal out, then presses the dialog's OK button where it was drawn. */
function dismissShowingReward(dialog: RewardGrantedDialog): void {
  for (let i = 0; i < REVEAL_FRAMES; i++) dialog.update();
  dialog.render(ctx);
  // The OK button is centred horizontally near the box's foot; sweep the centre
  // column. Only one press can land: the next reward starts in its reveal, which
  // accepts no press until it is played out.
  for (let y = 0; y < VIEWPORT_H; y++) dialog.handleClick(VIEWPORT_W / 2, y);
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
  const openers = [...sources.entries()].filter(([, text]) =>
    text.includes('mongoExplainer.open('),
  );
  const openerFiles = openers.map(([path]) => path).sort();
  const expectedFiles = ['src/scenes/DungeonScene.ts', 'src/systems/kits/MenusKit.ts'];
  check(
    JSON.stringify(openerFiles) === JSON.stringify(expectedFiles),
    `the explainer is opened from ${openerFiles.join(', ') || 'nowhere'}; expected exactly ${expectedFiles.join(', ')}`,
  );

  const scene = sources.get('src/scenes/DungeonScene.ts') ?? '';
  const sceneOpens = scene.split('mongoExplainer.open(').length - 1;
  check(sceneOpens === 1, `DungeonScene opens the explainer ${sceneOpens} times, expected 1`);
  const krakarenBranchStart = scene.indexOf('chest.bossRoomIndex === this.krakarenBossRoomIdx');
  const nextBranch = scene.indexOf('chest.bossRoomIndex', krakarenBranchStart + 1);
  const opener = scene.indexOf('mongoExplainer.open(');
  check(
    krakarenBranchStart >= 0 && opener > krakarenBranchStart && opener < nextBranch,
    'the scene opens the explainer outside the Krakaren chest branch of grantChestContents',
  );
  const drainedOpen = /afterQueueDrains\(\s*\(\)\s*=>\s*this\.menus\.mongoExplainer\.open\(\)/;
  check(
    drainedOpen.test(scene),
    'the Krakaren grant opens the explainer directly instead of after the reward queue drains',
  );

  const menus = sources.get('src/systems/kits/MenusKit.ts') ?? '';
  check(
    /pauseMenu\.onHowMongoWorks\s*=\s*\(\)\s*=>\s*this\.mongoExplainer\.open\(\)/.test(menus),
    "MenusKit's opener is not the pause menu's How Mongo works hook",
  );

  const circus = sources.get('src/systems/CircusQuestSystem.ts') ?? '';
  check(
    circus.length > 0,
    'CircusQuestSystem.ts was not found, so the circus check proves nothing',
  );
  check(!circus.includes('mongoExplainer'), 'the circus quest touches the Mongo explainer');
}

// ---------------------------------------------------------------- 3. the frame

function blankPage(subtitle: string): HowToPlayPage {
  return { subtitle, lines: [subtitle], drawIllustration: () => undefined };
}

{
  const overlay = new HowToPlayOverlay(null, MONGO_EXPLAINER_CONFIG);
  let closed = 0;
  const pages = [blankPage('one'), blankPage('two'), blankPage('three')];
  overlay.open(pages, () => closed++);
  check(overlay.isOpen && overlay.currentPage === 0, 'the overlay did not open on its first page');
  overlay.renderFrame(ctx, 0);
  check(overlay.handleClick(1, 1), 'a click on the backdrop fell through an open overlay');
  overlay.advance();
  overlay.advance();
  check(overlay.currentPage === 2, `two Nexts landed on page ${overlay.currentPage + 1}, not 3`);
  overlay.back();
  check(overlay.currentPage === 1, 'Back did not step back a page');
  overlay.advance();
  overlay.advance();
  check(!overlay.isOpen, 'Next on the last page did not close the overlay');
  check(closed === 1, `onClose ran ${closed} times after the last page, expected 1`);
  overlay.close();
  check(closed === 1, 'closing an already-closed overlay ran onClose again');
  check(!overlay.handleClick(1, 1), 'a closed overlay still consumed a click');

  overlay.open(pages, () => closed++);
  overlay.back();
  check(!overlay.isOpen && closed === 2, 'Skip on the first page did not close the overlay');

  overlay.open([]);
  check(!overlay.isOpen, 'an overlay opened with no pages claims the screen with nothing on it');
}

// ---------------------------------------------------------------- 3b. stacking

/**
 * Asserts `anchors` appear in `text` in the order given, each searched after the
 * one before it. Every anchor must be found: a renamed line is a failure rather
 * than a vacuous pass.
 */
function checkOrder(text: string, anchors: readonly string[], where: string): void {
  let cursor = 0;
  for (const anchor of anchors) {
    const found = text.indexOf(anchor, cursor);
    check(found >= 0, `${where}: "${anchor}" not found after the previous anchor`);
    if (found < 0) return;
    cursor = found + anchor.length;
  }
}

{
  const REWARD_CLAIM = "modal(this.menus.rewardGrantedDialog.isShowing, 'reward-granted')";
  const EXPLAINER_CLAIM = 'modal(this.menus.mongoExplainer.isOpen, MONGO_EXPLAINER_FOCUS_ID)';
  const SKILL_BOOK_CLAIM = "modal(this.menus.skillBookPrompt.isOpen, 'skill-book-prompt')";
  const REWARD_CLICK = 'this.menus.rewardGrantedDialog.handleClick(mx, my)';
  const EXPLAINER_CLICK = 'this.menus.mongoExplainer.handleClick(mx, my)';
  const SKILL_BOOK_CLICK = 'this.menus.skillBookPrompt.isOpen';
  for (const scene of ['src/scenes/DungeonScene.ts', 'src/scenes/BuildingInteriorScene.ts']) {
    const text = readFileSync(scene, 'utf8');
    checkOrder(text, [REWARD_CLAIM, EXPLAINER_CLAIM, SKILL_BOOK_CLAIM], `${scene} overlayClaims`);
    const clickStart = text.indexOf('handleClick(mx: number, my: number');
    check(clickStart >= 0, `${scene}: handleClick not found`);
    checkOrder(
      text.slice(Math.max(0, clickStart)),
      [REWARD_CLICK, EXPLAINER_CLICK, SKILL_BOOK_CLICK],
      `${scene} handleClick`,
    );
  }
  // Drawn lowest-priority first, so the draw order is the claim order reversed.
  const menus = readFileSync('src/systems/kits/MenusKit.ts', 'utf8');
  const renderStart = menus.indexOf('renderOverlays(ctx: CanvasRenderingContext2D)');
  check(renderStart >= 0, 'MenusKit.renderOverlays not found');
  checkOrder(
    menus.slice(Math.max(0, renderStart)),
    [
      'this.skillBookPrompt.render(ctx)',
      'this.mongoExplainer.render(ctx)',
      'this.rewardGrantedDialog.render(ctx)',
      'this.levelUpDialog.render(ctx)',
    ],
    'MenusKit.renderOverlays',
  );
}

// ---------------------------------------------------------------- 3c. occlusion

{
  // A button hidden under the panel must not answer a press with its click
  // sound, while one drawn over the explainer — a reward or level-up OK — must.
  const HIDDEN_X = VIEWPORT_W / 2;
  const HIDDEN_Y = VIEWPORT_H / 2;
  const PROBE_SIZE = 40;
  const probe = { width: PROBE_SIZE, height: PROBE_SIZE, label: '' };
  setButtonMouseState(0, 0);
  drawButton(ctx, { ...probe, x: HIDDEN_X, y: HIDDEN_Y });
  check(
    renderedButtonSoundAt(HIDDEN_X + 1, HIDDEN_Y + 1) !== null,
    'the probe button never registered, so the occlusion check proves nothing',
  );
  const overlay = new HowToPlayOverlay(null, MONGO_EXPLAINER_CONFIG);
  overlay.open(buildMongoExplainerPages('juvenile', false));
  overlay.renderFrame(ctx, 0);
  check(
    renderedButtonSoundAt(HIDDEN_X + 1, HIDDEN_Y + 1) === null,
    'a button hidden under the explainer still answers a press on the panel with its click sound',
  );
  drawButton(ctx, { ...probe, x: HIDDEN_X, y: HIDDEN_Y });
  check(
    renderedButtonSoundAt(HIDDEN_X + 1, HIDDEN_Y + 1) !== null,
    'a button drawn over the explainer lost its click sound',
  );
  setButtonMouseState(0, 0);
}

// ---------------------------------------------------------------- 4. the copy

{
  const desktop = buildMongoExplainerPages('juvenile', false);
  const phone = buildMongoExplainerPages('juvenile', true);
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
  const rebound = buildMongoExplainerPages('juvenile', false)
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
