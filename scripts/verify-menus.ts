#!/usr/bin/env tsx
/**
 * Every menu that takes the keyboard away from play can be answered by the
 * keyboard alone, and every close button a menu draws can be tapped on a
 * phone. The rules live in `menuFocusAudit` and `closeButtonAudit`; this
 * script stands up the places menus open and runs them against each one:
 *
 *  - a deliberately ringless halting surface, which the audit must flag, so
 *    an audit that has stopped seeing the bug fails instead of passing, and
 *    likewise a close button pushed off a phone;
 *  - every UI-gallery sheet and fixture, before and after its scripted input,
 *    and each settled fixture again on phones both ways up, at every UI size,
 *    with and without a notch;
 *  - the real `DungeonScene` (the town) and `BuildingInteriorScene`, headless,
 *    with each surface they mount opened in turn through the game's own
 *    openers and settled until its entrance has played; and the same scenes
 *    replayed on a notched phone each way up, whose close buttons must be
 *    tappable and must be there wherever the desktop shows one.
 *
 * The parent process audits the desktop gallery itself; every scene, split
 * into the town, the club and the other rooms on each platform, and the
 * gallery's phone matrix, split in parts, run in child processes beside it
 * and report back, and the parent prints every section and decides the run.
 *
 * Every panel, modal and system surface a scene mounts must be opened by this
 * script unless both of its keyboard claims are fixed `false` or another case
 * audits it (a room's common menus, opened once in the General Store), so a
 * menu added to a scene without an opener here fails the gate instead of
 * escaping it.
 *
 * Run: npm run verify:menus [-- [--only=<substring>] [--verbose]]
 *
 * `--only=<substring>` runs just the cases whose label or section title
 * contains the substring, and fails if nothing matches. Labels are:
 *
 *  - `gallery <sheet>` and `gallery <sheet>/<fixture>`, in the sections
 *    `UI gallery` and `close buttons on phones` (sheets: widgets, shop,
 *    inventory, choice, paged, dialogs, construction, pause, hud; fixtures by
 *    their gallery names, e.g. `gallery dialogs/poker-bust`);
 *  - `town <surface id>` in `the town (DungeonScene)`, e.g. `town pause`;
 *  - `<room> <surface id>` in `<room> (BuildingInteriorScene)`, the rooms
 *    being General Store, Herb & Remedy, Old Lori's Cottage, tower and
 *    Cloak & Dagger, e.g. `Cloak & Dagger poker-table`;
 *  - `title with a save` and `title without a save` in `the title screen`.
 *
 * Beside the audits, `the Skills tab: proficiency skills` checks the rules the
 * proficiency cards show (`skillsTabChecks.ts`): who can learn each skill, what
 * a duplicate book does, the level ceiling and which hits each skill boosts.
 *
 * So `--only=shop` takes every shop fixture and every scene's shop surfaces,
 * `--only=gallery` the whole gallery, `--only=Cloak` the club. A selected
 * scene case is replayed on the phones too (`close buttons on phones, in the
 * scenes`). A filtered run skips the whole-run coverage checks (every surface
 * opened, every phone-only surface reached), which only a full run can make.
 *
 * Passing output is one line per section; `--verbose` prints every case, and
 * a section with a failure prints its cases whatever the flag.
 */

import { exitFixtureOnTile } from '../src/systems/interiorExitFixtures';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Surface } from '../src/ui/core/UiRoot.js';
import type { FocusClaimant } from './menuFocusAudit.js';
import type { UiSize } from '../src/core/input/Settings.js';
import type { SafeAreaInsets, ViewportInput } from '../src/ui/core/viewport.js';
import type { MenusKit } from '../src/systems/kits/MenusKit.js';
import type { ChestKit } from '../src/systems/kits/ChestKit.js';
import type { CutsceneScript } from '../src/systems/cutscene/cutsceneSteps.js';
import type { CutsceneKit } from '../src/systems/kits/CutsceneKit.js';
import { CAROLINE_CHARACTER_NAME } from '../src/ai/characters';
import type { AIInteractionStage } from '../src/ai/interactions/AIInteractionStage.js';
import type { AIChallengeSystem } from '../src/systems/AIChallengeSystem.js';
import type { AchievementUISystem } from '../src/systems/AchievementUISystem.js';
import type { AchievementManager } from '../src/core/progression/AchievementManager.js';
import { SPIDER_QUEST_NAME } from '../src/systems/SpiderQuestSystem';
import type { ResidentId } from '../src/core/state/residentIds.js';
import { buildingDisplayName } from '../src/map/buildingIds.js';
import { PetNameBook, petWords } from '../src/core/party/petNames.js';
import { useDevPlayerIdentity } from '../src/dev/devPlayerIdentity.js';
import { plainDeathMessage } from '../src/ui/DeathExplanations.js';

export {};

/** A notched phone held sideways: the notch and the home indicator eat the edges. */
const NOTCH_LANDSCAPE_INSETS: SafeAreaInsets = { t: 0, r: 47, b: 21, l: 47 };
/** The same phone upright: the notch takes the top, the home indicator the bottom. */
const NOTCH_PORTRAIT_INSETS: SafeAreaInsets = { t: 47, r: 0, b: 34, l: 0 };

/**
 * The phones the scenes are replayed on, each in a process of its own: touch
 * density and the platform are decided once per page load, so a desktop
 * process cannot become a phone. Notched and at the largest UI size, the
 * tightest room each way up.
 */
const PHONE_PASS_IDS = ['portrait-notched', 'landscape-notched'] as const;
const SCENE_PLATFORMS = ['desktop', ...PHONE_PASS_IDS] as const;
type ScenePlatform = (typeof SCENE_PLATFORMS)[number];
/**
 * The scenes split three ways, the town, the club and every other room with
 * the title screen, so each part on each platform runs in a child process of
 * its own beside the gallery, which the parent process audits meanwhile. The
 * town and the club each hold surfaces with no ring that wait out the whole
 * entrance budget, which makes them the longest parts.
 */
const SCENE_SHARDS = ['town', 'club', 'rooms'] as const;
type SceneShard = (typeof SCENE_SHARDS)[number];
interface ScenePass {
  readonly platform: ScenePlatform;
  readonly shard: SceneShard;
}
type PhonePassId = (typeof PHONE_PASS_IDS)[number];
const PHONE_SCENE_PASSES: Record<
  PhonePassId,
  { readonly width: number; readonly height: number; readonly safeArea: SafeAreaInsets }
> = {
  'portrait-notched': { width: 390, height: 844, safeArea: NOTCH_PORTRAIT_INSETS },
  'landscape-notched': { width: 844, height: 390, safeArea: NOTCH_LANDSCAPE_INSETS },
};
const PHONE_SCENE_UI_SIZE: UiSize = 'large';
const SCENE_PASS_FLAG = '--scene-pass=';
const GALLERY_PASS_FLAG = '--phone-gallery-part=';
/**
 * The gallery's phone matrix, every settled fixture on every phone, is split
 * into this many parts, each audited in a child process of its own.
 */
const PHONE_GALLERY_PARTS = 3;
const SCENE_PASS_SEPARATOR = ':';
const ONLY_FLAG = '--only=';
const VERBOSE_FLAG = '--verbose';

function scenePassName(pass: ScenePass): string {
  return `${pass.platform}${SCENE_PASS_SEPARATOR}${pass.shard}`;
}

function scenePassFromArgs(): ScenePass | null {
  const arg = process.argv.find((candidate) => candidate.startsWith(SCENE_PASS_FLAG));
  if (arg === undefined) return null;
  const name = arg.slice(SCENE_PASS_FLAG.length);
  const [platformName, shardName] = name.split(SCENE_PASS_SEPARATOR);
  const platform = SCENE_PLATFORMS.find((candidate) => candidate === platformName);
  const shard = SCENE_SHARDS.find((candidate) => candidate === shardName);
  if (platform === undefined || shard === undefined) {
    throw new Error(`verify:menus: no scene pass "${name}"`);
  }
  return { platform, shard };
}

/** Set in a child process that audits one part of the scenes on one platform and reports back. */
const scenePass = scenePassFromArgs();

function galleryPartFromArgs(): number | null {
  const arg = process.argv.find((candidate) => candidate.startsWith(GALLERY_PASS_FLAG));
  if (arg === undefined) return null;
  const part = Number(arg.slice(GALLERY_PASS_FLAG.length));
  if (!Number.isInteger(part) || part < 0 || part >= PHONE_GALLERY_PARTS) {
    throw new Error(`verify:menus: no phone gallery part "${arg}"`);
  }
  return part;
}

/** Set in a child process that audits one part of the gallery's phone matrix and reports back. */
const galleryPart = galleryPartFromArgs();
/** The process that starts the others, prints every section and decides the run. */
const isParent = scenePass === null && galleryPart === null;
/** The phone this process replays the scenes on, or null on a desktop. */
const phonePass =
  scenePass === null || scenePass.platform === 'desktop' ? null : scenePass.platform;

function onlyFromArgs(): string | null {
  const arg = process.argv.find((candidate) => candidate.startsWith(ONLY_FLAG));
  if (arg === undefined) return null;
  const only = arg.slice(ONLY_FLAG.length);
  if (only === '') throw new Error(`verify:menus: ${ONLY_FLAG} needs a substring`);
  return only;
}

/** The `--only` substring, or null for the full run. */
const only = onlyFromArgs();
const verbose = process.argv.includes(VERBOSE_FLAG);

/** Whether a case runs: its label or one of its section titles holds the `--only` substring. */
function selects(label: string, ...sectionTitles: readonly string[]): boolean {
  if (only === null) return true;
  return label.includes(only) || sectionTitles.some((title) => title.includes(only));
}

// Before any game module loads: the platform is decided once, at import.
Object.defineProperty(globalThis, 'navigator', {
  value:
    phonePass === null
      ? { maxTouchPoints: 0, userAgent: 'Desktop' }
      : { maxTouchPoints: 1, userAgent: 'iPhone' },
  configurable: true,
});

const DESKTOP = { width: 1280, height: 800, devicePixelRatio: 1 } as const;
const SCREEN =
  phonePass === null ? DESKTOP : { ...PHONE_SCENE_PASSES[phonePass], devicePixelRatio: 1 };
const { installBrowserShim } = await import('./browserShim.js');
const { settleArrival } = await import('./settleArrival.js');
installBrowserShim(SCREEN);
const WORLD_SEED = 7;
const { mulberry32 } = await import('../src/sprites/person/rng.js');
Math.random = mulberry32(WORLD_SEED);

const { auditCloseButtons, missingCloseButtons, openMenuSurfaceIds, surfacesWithCloseButtons } =
  await import('./closeButtonAudit.js');
const { motion } = await import('../src/ui/theme/tokens.js');
const { auditFocus, claimsKeyboard, mountedSurfaces, neverClaimsKeyboard } =
  await import('./menuFocusAudit.js');
const { gameContext } = await import('./nodeGameContext.js');
const { loadSprites } = await import('../src/core/spriteAssets/SpriteLoader.js');
const { setViewportSize } = await import('../src/core/rendering/Viewport.js');
const { settings } = await import('../src/core/input/Settings.js');
const { UiRoot } = await import('../src/ui/core/UiRoot.js');
const { NO_INSETS } = await import('../src/ui/core/viewport.js');
const { MOUSE_POINTER_ID, PRIMARY_BUTTON } = await import('../src/ui/core/pointer.js');
const { GALLERY_SHEETS, GalleryModel } = await import('../src/dev/uiGallery/model.js');
const { createUiGallery } = await import('../src/dev/uiGallery/screens.js');
const { DIALOG_FIXTURES } = await import('../src/dev/uiGallery/dialogs.js');
const { INVENTORY_FIXTURES } = await import('../src/dev/uiGallery/inventory.js');
const { SHOP_FIXTURES } = await import('../src/dev/uiGallery/shop.js');
const { CONSTRUCTION_FIXTURES } = await import('../src/dev/uiGallery/construction.js');
const { PAUSE_FIXTURES } = await import('../src/dev/uiGallery/pause.js');
const { HUD_FIXTURES } = await import('../src/dev/uiGallery/hud.js');

type Root = InstanceType<typeof UiRoot>;
type GallerySheet = (typeof GALLERY_SHEETS)[number];
type FixtureList = typeof DIALOG_FIXTURES;
type FixtureRig = Parameters<NonNullable<FixtureList[number]['interact']>>[0];
type HitRegion = ReturnType<Root['regions']>[number];

const FRAME_MS = 16;
const MS_PER_SECOND = 1000;
/** Long enough for every open, hover and tab tween to settle. */
const SETTLE_MS = 1000;

const failures: string[] = [];
/** Whether `--only` matched any case; a filter that matches nothing is a typo, not a pass. */
let anySelected = false;
function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}

function describeClaimants(claimants: readonly FocusClaimant[]): string {
  if (claimants.length === 0) return 'nothing claims the keyboard';
  return claimants
    .map(
      (claimant) => `${claimant.id} (${claimant.ringlessReason ?? `ring of ${claimant.ringSize}`})`,
    )
    .join(', ');
}

interface SectionLog {
  readonly title: string;
  readonly startedAt: number;
  readonly failuresBefore: number;
  readonly lines: string[];
  cases: number;
}

let openSection: SectionLog | null = null;

/** Sections a scene pass ran, handed to the parent to print. */
const finishedSections: SectionReport[] = [];

/** One line per section, and its cases when asked or when one of them failed. */
function printSection(report: SectionReport): void {
  const skippedByFilter = report.cases === 0 && report.failed === 0;
  if (skippedByFilter) return;
  const outcome = report.failed === 0 ? 'ok' : `${report.failed} failure(s)`;
  const seconds = report.seconds.toFixed(1);
  console.log(`── ${report.title}: ${report.cases} case(s), ${outcome} (${seconds}s)`);
  if (verbose || report.failed > 0) for (const line of report.lines) console.log(line);
}

function endSection(): void {
  const done = openSection;
  if (done === null) return;
  openSection = null;
  const report: SectionReport = {
    title: done.title,
    cases: done.cases,
    failed: failures.length - done.failuresBefore,
    seconds: (performance.now() - done.startedAt) / MS_PER_SECOND,
    lines: done.lines,
  };
  if (isParent) printSection(report);
  else finishedSections.push(report);
}

function section(title: string): void {
  endSection();
  openSection = {
    title,
    startedAt: performance.now(),
    failuresBefore: failures.length,
    lines: [],
    cases: 0,
  };
}

/** One case's line, printed with its section's when verbose or failing. */
function detail(line: string): void {
  openSection?.lines.push(`  ${line}`);
}

function countCase(): void {
  if (openSection !== null) openSection.cases++;
}

// ── Phone passes ───────────────────────────────────────────────────────────

/** One opened state of a scene: the menus open in it and those that drew a close button. */
interface CloseButtonState {
  readonly label: string;
  readonly open: readonly string[];
  readonly withClose: readonly string[];
}

/** One section's outcome, printed by the parent process whichever process ran it. */
interface SectionReport {
  readonly title: string;
  readonly cases: number;
  readonly failed: number;
  readonly seconds: number;
  readonly lines: readonly string[];
}

/** What a scene pass hands back to the parent run. */
interface ScenePassReport {
  readonly states: readonly CloseButtonState[];
  readonly failures: readonly string[];
  readonly sections: readonly SectionReport[];
  /** Whether `--only` selected any of the pass's cases. */
  readonly selected: boolean;
}

interface ChildPassResult {
  readonly name: string;
  readonly status: number | null;
  readonly output: string;
}

const SCENE_REPORT_MARKER = 'verify:menus scene report ';
/** Lines of a scene pass's own output shown when it fails to report. */
const SCENE_OUTPUT_TAIL_LINES = 40;

/**
 * Surfaces only the scenes open, with no gallery fixture of their own; each
 * must be reached on every phone, so a scene opener that stops working on a
 * phone cannot drop one out of the audit unnoticed.
 */
const PHONE_REQUIRED_SURFACES = [
  'travel-menu',
  'notice-board',
  'market-stall',
  'village-priced-menu',
  'village-services-picker',
  'construction-picker',
  'priced-menu',
  'club-bar-shop',
  'club-market-shop',
  'mercenary-desk',
  'follower-menu',
  'chest-reward',
  'quest-reward',
  'run-complete',
] as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isCloseButtonState(value: unknown): value is CloseButtonState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'label' in value &&
    typeof value.label === 'string' &&
    'open' in value &&
    isStringArray(value.open) &&
    'withClose' in value &&
    isStringArray(value.withClose)
  );
}

function isSectionReport(value: unknown): value is SectionReport {
  return (
    typeof value === 'object' &&
    value !== null &&
    'title' in value &&
    typeof value.title === 'string' &&
    'cases' in value &&
    typeof value.cases === 'number' &&
    'failed' in value &&
    typeof value.failed === 'number' &&
    'seconds' in value &&
    typeof value.seconds === 'number' &&
    'lines' in value &&
    isStringArray(value.lines)
  );
}

function isScenePassReport(value: unknown): value is ScenePassReport {
  return (
    typeof value === 'object' &&
    value !== null &&
    'states' in value &&
    Array.isArray(value.states) &&
    value.states.every(isCloseButtonState) &&
    'failures' in value &&
    isStringArray(value.failures) &&
    'sections' in value &&
    Array.isArray(value.sections) &&
    value.sections.every(isSectionReport) &&
    'selected' in value &&
    typeof value.selected === 'boolean'
  );
}

function parseScenePassReport(output: string): ScenePassReport | null {
  const line = output.split('\n').find((candidate) => candidate.startsWith(SCENE_REPORT_MARKER));
  if (line === undefined) return null;
  const parsed: unknown = JSON.parse(line.slice(SCENE_REPORT_MARKER.length));
  return isScenePassReport(parsed) ? parsed : null;
}

/** Runs this script again in a child process with `flag`, alongside the parent's own work. */
function runChildPass(name: string, flag: string): Promise<ChildPassResult> {
  const forwarded = only === null ? [] : [`${ONLY_FLAG}${only}`];
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [...process.execArgv, fileURLToPath(import.meta.url), flag, ...forwarded],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    const collect = (chunk: unknown): void => {
      output += String(chunk);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('close', (status) => resolve({ name, status, output }));
  });
}

const closeButtonStates: CloseButtonState[] = [];

/**
 * Notes which menus are open and which drew a close button. On a phone the
 * close buttons are audited in place too; whether one a desktop shows is
 * missing here is decided by the desktop run, which holds both sides.
 */
function recordCloseButtons(ui: Root, label: string): void {
  closeButtonStates.push({
    label,
    open: openMenuSurfaceIds(ui),
    withClose: [...surfacesWithCloseButtons(ui)],
  });
  if (phonePass !== null) failures.push(...auditCloseButtons(ui, `${phonePass} ${label}`));
}

await loadSprites('src/images/');
setViewportSize(SCREEN.width, SCREEN.height);
const ctx = gameContext(SCREEN.width, SCREEN.height);
/**
 * The audits read hit regions, focus and layout, never a pixel of the frame,
 * so everything paints into a context whose raster calls do nothing: paths,
 * transforms, clips and text measurement still run, and the canvas keeps the
 * size layout reads from it, but no pixel is filled. Rasterising, above all
 * node-canvas's software shadow blur and the scenes' sprites, costs more
 * than everything else a frame does.
 */
const RASTER_METHODS = [
  'fill',
  'stroke',
  'fillRect',
  'strokeRect',
  'clearRect',
  'fillText',
  'strokeText',
  'drawImage',
  'putImageData',
] as const satisfies readonly (keyof CanvasRenderingContext2D)[];
function withoutRaster(target: CanvasRenderingContext2D): void {
  for (const method of RASTER_METHODS) {
    Object.defineProperty(target, method, { value: () => undefined });
  }
}
withoutRaster(ctx);
if (phonePass !== null) settings.setUiSize(PHONE_SCENE_UI_SIZE);

const DESKTOP_VIEWPORT: ViewportInput = {
  cssWidth: DESKTOP.width,
  cssHeight: DESKTOP.height,
  density: 'pointer',
  uiSize: 'medium',
  safeArea: NO_INSETS,
};

/** A bare root with its own clock, for surfaces mounted outside any scene; the desktop unless told otherwise. */
function bareRoot(viewport: ViewportInput = DESKTOP_VIEWPORT): {
  readonly root: Root;
  frame(): void;
  settle(): void;
} {
  let clock = 0;
  const root = new UiRoot({
    audio: null,
    viewport: () => viewport,
    now: () => clock,
    warn: () => undefined,
  });
  const frame = (): void => {
    clock += FRAME_MS;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    root.frame(ctx);
  };
  return {
    root,
    frame,
    settle: () => {
      clock += SETTLE_MS;
      frame();
    },
  };
}

const PHONE_SCENES_SECTION = 'close buttons on phones, in the scenes';

const scenePasses = isParent
  ? SCENE_PLATFORMS.flatMap((platform) =>
      SCENE_SHARDS.map((shard) => {
        const name = scenePassName({ platform, shard });
        return runChildPass(name, `${SCENE_PASS_FLAG}${name}`);
      }),
    )
  : [];
const galleryParts = isParent
  ? Array.from({ length: PHONE_GALLERY_PARTS }, (_, part) =>
      runChildPass(`phone gallery part ${part + 1}`, `${GALLERY_PASS_FLAG}${part}`),
    )
  : [];

/** Prints a child's report, or fails the run when it has none; returns the report. */
function collectChildReport(result: ChildPassResult): ScenePassReport | null {
  const passReport = parseScenePassReport(result.output);
  if (passReport === null) {
    const tail = result.output.trimEnd().split('\n').slice(-SCENE_OUTPUT_TAIL_LINES).join('\n');
    console.error(tail);
    failures.push(`${result.name}: the child pass exited ${result.status} without a report`);
    return null;
  }
  if (passReport.selected) anySelected = true;
  return passReport;
}

/** A child's last words: its sections, failures and close-button states, as one line for the parent. */
function reportToParent(): never {
  endSection();
  const report: ScenePassReport = {
    states: closeButtonStates,
    failures,
    sections: finishedSections,
    selected: anySelected,
  };
  console.log(`${SCENE_REPORT_MARKER}${JSON.stringify(report)}`);
  process.exit(0);
}

if (scenePass === null) {
  useDevPlayerIdentity();

  // ── Self test ──────────────────────────────────────────────────────────────

  if (isParent) section('self test: the audit flags a menu a keyboard cannot reach');
  if (isParent) {
    const panelRect = { x: 100, y: 100, w: 300, h: 200 };
    const buttonRect = { x: 120, y: 240, w: 120, h: 40 };
    const ringless: Surface = {
      id: 'ringless-fake',
      band: 'modal',
      haltsWorld: true,
      isOpen: () => true,
      render: (ui) => {
        ui.block(panelRect);
        ui.hit('ok', buttonRect, { onTap: () => undefined, focusable: false });
      },
    };
    const floating: Surface = {
      id: 'floating-fake',
      band: 'system',
      haltsWorld: false,
      isOpen: () => true,
      render: (ui) => void ui.hit('tip', buttonRect, { onTap: () => undefined, focusable: false }),
    };
    const rig = bareRoot();
    rig.root.mount(ringless);
    rig.frame();
    const caught = auditFocus(rig.root, 'self test').failures;
    for (const failure of caught) detail(`caught: ${failure}`);
    countCase();
    check(
      caught.some((failure) => failure.includes('"ringless-fake"')),
      'self test: a halting modal with only an unfocusable button is not flagged',
    );
    rig.root.mount(floating);
    rig.frame();
    const stolen = auditFocus(rig.root, 'self test').failures;
    for (const failure of stolen) detail(`caught: ${failure}`);
    countCase();
    check(
      stolen.some((failure) => failure.includes('focus belongs to "floating-fake"')),
      'self test: a non-halting surface that steals focus from a halting one is not flagged',
    );
    rig.root.unmount(floating);
    rig.root.unmount(ringless);

    // A pause button that Escape stands in for passes only while Escape gets through.
    const shortcutOnly: Surface = {
      id: 'shortcut-fake',
      band: 'panel',
      haltsWorld: false,
      locksKeyboard: true,
      isOpen: () => true,
      render: (ui) =>
        void ui.hit('pause', buttonRect, { onTap: () => undefined, keyboardShortcut: 'Escape' }),
    };
    const escapeTaker: Surface = {
      id: 'escape-taker-fake',
      band: 'hud',
      haltsWorld: false,
      blocksEscape: true,
      isOpen: () => true,
      render: () => undefined,
    };
    const shortcutRig = bareRoot();
    shortcutRig.root.mount(shortcutOnly);
    shortcutRig.frame();
    const reached = auditFocus(shortcutRig.root, 'self test').failures;
    countCase();
    check(
      reached.length === 0,
      `self test: a pause button Escape stands in for is flagged: ${reached.join('; ')}`,
    );
    shortcutRig.root.mount(escapeTaker);
    shortcutRig.frame();
    const shadowed = auditFocus(shortcutRig.root, 'self test').failures;
    for (const failure of shadowed) detail(`caught: ${failure}`);
    countCase();
    check(
      shadowed.some((failure) => failure.includes('"shortcut-fake"')),
      'self test: a shortcut button whose Escape another surface takes is not flagged',
    );
  }

  // ── UI gallery ─────────────────────────────────────────────────────────────

  const SHEET_FIXTURES: Readonly<Partial<Record<GallerySheet, FixtureList>>> = {
    dialogs: DIALOG_FIXTURES,
    inventory: INVENTORY_FIXTURES,
    shop: SHOP_FIXTURES,
    construction: CONSTRUCTION_FIXTURES,
    pause: PAUSE_FIXTURES,
    hud: HUD_FIXTURES,
  };

  function centre(region: HitRegion): { x: number; y: number } {
    return { x: region.rect.x + region.rect.w / 2, y: region.rect.y + region.rect.h / 2 };
  }

  function galleryRig(
    sheet: GallerySheet,
    fixture: string | null,
    viewport: ViewportInput = DESKTOP_VIEWPORT,
    walksFixtures = false,
  ) {
    const bare = bareRoot(viewport);
    const { root } = bare;
    const model = new GalleryModel();
    model.sheet = sheet;
    model.screenFixture = fixture;
    // A walk switches fixtures on one rig, so it needs every fixture of its sheet.
    const focus = { sheet, fixture: walksFixtures ? null : fixture };
    for (const surface of createUiGallery(model, null, focus).surfaces) root.mount(surface);
    const gesture = (kind: 'down' | 'move' | 'up', region: HitRegion): void => {
      const point = centre(region);
      root.pointer({
        kind,
        pointerId: MOUSE_POINTER_ID,
        source: 'mouse',
        x: point.x,
        y: point.y,
        cssX: point.x * root.uiScale,
        cssY: point.y * root.uiScale,
        button: PRIMARY_BUTTON,
        deltaY: 0,
      });
    };
    const region = (id: string): HitRegion | null =>
      root.regions().find((candidate) => candidate.id === id) ?? null;
    const rig: FixtureRig = {
      region,
      need: (id) => {
        const found = region(id);
        if (found === null) throw new Error(`verify:menus: no region "${id}" was registered`);
        return found;
      },
      hover: (target) => gesture('move', target),
      tap: (target) => {
        gesture('down', target);
        gesture('up', target);
      },
      key: (key) => void root.key(key, {}),
      frame: () => bare.frame(),
      settle: () => bare.settle(),
    };
    return { root, rig, model };
  }

  const SKILLS_TAB_SECTION = 'the Skills tab: proficiency skills';
  if (isParent && selects(SKILLS_TAB_SECTION)) {
    anySelected = true;
    section(SKILLS_TAB_SECTION);
    const { runSkillsTabChecks } = await import('./skillsTabChecks.js');
    for (const outcome of runSkillsTabChecks()) {
      countCase();
      detail(`${outcome.ok ? 'ok' : 'FAIL'} ${outcome.message}`);
      check(outcome.ok, `skills tab: ${outcome.message}`);
    }
  }

  const GALLERY_SECTION = 'UI gallery';
  const PHONE_GALLERY_SECTION = 'close buttons on phones';
  /** Every gallery state, as `[sheet, fixture]`; a sheet with no fixtures is one state of its own. */
  interface GalleryState {
    readonly sheet: GallerySheet;
    readonly fixture: string | null;
    readonly label: string;
  }
  const galleryStates = GALLERY_SHEETS.flatMap((sheet): GalleryState[] => {
    const fixtures = SHEET_FIXTURES[sheet] ?? [];
    if (fixtures.length === 0) return [{ sheet, fixture: null, label: `gallery ${sheet}` }];
    return fixtures.map((fixture) => ({
      sheet,
      fixture: fixture.name,
      label: `gallery ${sheet}/${fixture.name}`,
    }));
  });
  for (const state of galleryStates) {
    if (selects(state.label, GALLERY_SECTION, PHONE_GALLERY_SECTION)) anySelected = true;
  }

  if (isParent) section(GALLERY_SECTION);
  if (isParent) {
    let galleryClaimants = 0;
    const audit = (root: Root, label: string): void => {
      const outcome = auditFocus(root, label);
      failures.push(...outcome.failures);
      galleryClaimants += outcome.claimants.length;
      detail(`${label}: ${describeClaimants(outcome.claimants)}`);
      countCase();
    };
    const selected = (label: string): boolean => selects(label, GALLERY_SECTION);
    for (const sheet of GALLERY_SHEETS) {
      const fixtures = (SHEET_FIXTURES[sheet] ?? []).filter((fixture) =>
        selected(`gallery ${sheet}/${fixture.name}`),
      );
      const bare = (SHEET_FIXTURES[sheet] ?? []).length === 0;
      if (bare && !selected(`gallery ${sheet}`)) continue;
      if (!bare && fixtures.length === 0) continue;
      // One rig walks the sheet's fixtures: only the shown fixture's surfaces are open.
      const walk = galleryRig(sheet, null, DESKTOP_VIEWPORT, true);
      if (bare) {
        walk.rig.frame();
        walk.rig.settle();
        audit(walk.root, `gallery ${sheet}`);
      }
      for (const fixture of fixtures) {
        walk.model.screenFixture = fixture.name;
        walk.rig.frame();
        walk.rig.settle();
        audit(walk.root, `gallery ${sheet}/${fixture.name}`);
        const interact = fixture.interact;
        if (interact === undefined) continue;
        const fresh = galleryRig(sheet, fixture.name);
        fresh.rig.frame();
        fresh.rig.settle();
        interact(fresh.rig);
        fresh.rig.frame();
        fresh.rig.settle();
        audit(fresh.root, `gallery ${sheet}/${fixture.name} (after its input)`);
      }
    }
    if (only === null) {
      check(galleryClaimants > 0, 'the gallery audit saw no surface that claims the keyboard');
    }
  }

  // ── Close buttons on phones ────────────────────────────────────────────────

  /** Phone screens in CSS pixels, both ways up, down to the shortest landscape. */
  const PHONE_SCREENS = [
    { w: 844, h: 390 },
    { w: 667, h: 375 },
    { w: 568, h: 320 },
    { w: 390, h: 844 },
    { w: 360, h: 640 },
  ] as const;
  const PHONE_UI_SIZES: readonly UiSize[] = ['small', 'medium', 'large'];
  function phoneViewports(): { readonly label: string; readonly input: ViewportInput }[] {
    const viewports: { label: string; input: ViewportInput }[] = [];
    for (const screen of PHONE_SCREENS) {
      const landscape = screen.w > screen.h;
      const notch = landscape ? NOTCH_LANDSCAPE_INSETS : NOTCH_PORTRAIT_INSETS;
      for (const uiSize of PHONE_UI_SIZES) {
        for (const [inset, safeArea] of [
          ['', NO_INSETS],
          [' notched', notch],
        ] as const) {
          viewports.push({
            label: `${screen.w}x${screen.h} ${uiSize}${inset}`,
            input: { cssWidth: screen.w, cssHeight: screen.h, density: 'touch', uiSize, safeArea },
          });
        }
      }
    }
    return viewports;
  }

  if (isParent)
    section('self test: the close audit flags a close button pushed off a phone screen');
  if (isParent) {
    /** A panel whose ✕ starts `overhang` of its own width past the right edge of the safe area. */
    const overhangingClose = (id: string, overhang: number): Surface => ({
      id,
      band: 'panel',
      haltsWorld: true,
      isOpen: () => true,
      close: () => undefined,
      render: (ui) => {
        const side = ui.theme.size.control;
        const x = ui.viewport.x + ui.viewport.w - side * (1 - overhang);
        ui.hit('close', { x, y: ui.viewport.y, w: side, h: side }, { onTap: () => undefined });
      },
    });
    const HALF_OFF = 0.5;
    const WHOLLY_OFF = 1;
    const cases = [
      { surface: overhangingClose('half-off-close-fake', HALF_OFF), what: 'half past the edge' },
      { surface: overhangingClose('off-screen-close-fake', WHOLLY_OFF), what: 'wholly off screen' },
    ];
    for (const { surface, what } of cases) {
      const bare = bareRoot(phoneViewports()[0].input);
      bare.root.mount(surface);
      bare.frame();
      const found = auditCloseButtons(bare.root, 'self test', new Set([surface.id]));
      countCase();
      check(found.length > 0, `self test: a close button ${what} on a phone is not flagged`);
    }
  }

  if (galleryPart !== null) {
    section(`${PHONE_GALLERY_SECTION}, part ${galleryPart + 1} of ${PHONE_GALLERY_PARTS}`);
    const phones = phoneViewports();
    const failuresByPhone = new Map<string, number>();
    let audited = 0;
    // Settled fixtures only: replaying each fixture's scripted input on every phone would take most of an hour.
    const auditState = (sheet: GallerySheet, fixture: string | null, label: string): void => {
      const settled = (viewport?: ViewportInput): Root => {
        const gallery = galleryRig(sheet, fixture, viewport);
        gallery.rig.frame();
        gallery.rig.settle();
        return gallery.root;
      };
      const expected = surfacesWithCloseButtons(settled());
      for (const phone of phones) {
        const found = auditCloseButtons(settled(phone.input), `${phone.label} ${label}`, expected);
        failures.push(...found);
        failuresByPhone.set(phone.label, (failuresByPhone.get(phone.label) ?? 0) + found.length);
        audited++;
        countCase();
      }
    };
    galleryStates.forEach((state, index) => {
      const inThisPart = index % PHONE_GALLERY_PARTS === galleryPart;
      if (inThisPart && selects(state.label, PHONE_GALLERY_SECTION)) {
        auditState(state.sheet, state.fixture, state.label);
      }
    });
    for (const [phone, count] of failuresByPhone) {
      detail(`${phone}: ${count === 0 ? 'ok' : `${count} failure(s)`}`);
    }
    if (only === null) check(audited > 0, 'the close-button audit saw no gallery state');
    reportToParent();
  }
  // ── The scene passes ───────────────────────────────────────────────────────

  endSection();
  for (const result of await Promise.all(galleryParts)) {
    const partReport = collectChildReport(result);
    if (partReport === null) continue;
    failures.push(...partReport.failures);
    for (const partSection of partReport.sections) printSection(partSection);
  }
  const reports = new Map<string, ScenePassReport>();
  for (const result of await Promise.all(scenePasses)) {
    const passReport = collectChildReport(result);
    if (passReport !== null) reports.set(result.name, passReport);
  }
  const reportsOn = (platform: ScenePlatform): ScenePassReport[] =>
    SCENE_SHARDS.flatMap((shard) => reports.get(scenePassName({ platform, shard })) ?? []);

  const desktopReports = reportsOn('desktop');
  for (const desktopReport of desktopReports) {
    failures.push(...desktopReport.failures);
    for (const sceneSection of desktopReport.sections) printSection(sceneSection);
  }
  const desktopStates = desktopReports.flatMap((desktopReport) => desktopReport.states);
  const desktopComplete = desktopReports.length === SCENE_SHARDS.length;

  if (desktopStates.length > 0) {
    section(PHONE_SCENES_SECTION);
    for (const id of PHONE_PASS_IDS) {
      const phoneReports = reportsOn(id);
      if (phoneReports.length < SCENE_SHARDS.length) continue;
      const passFailures = phoneReports.flatMap((phoneReport) => phoneReport.failures);
      const phoneStateList = phoneReports.flatMap((phoneReport) => phoneReport.states);
      const phoneStates = new Map(phoneStateList.map((state) => [state.label, state]));
      for (const desktop of desktopStates) {
        const phone = phoneStates.get(desktop.label);
        if (phone === undefined) {
          passFailures.push(`${id} ${desktop.label}: never reached on the phone`);
          continue;
        }
        passFailures.push(
          ...missingCloseButtons(
            `${id} ${desktop.label}`,
            new Set(desktop.withClose),
            phone.open,
            new Set(phone.withClose),
          ),
        );
      }
      const openedOnPhone = new Set(phoneStateList.flatMap((state) => state.open));
      const required = only === null && desktopComplete ? PHONE_REQUIRED_SURFACES : [];
      for (const surfaceId of required) {
        if (!openedOnPhone.has(surfaceId))
          passFailures.push(`${id}: "${surfaceId}" was never open on the phone`);
      }
      failures.push(...passFailures);
      const outcome = passFailures.length === 0 ? 'ok' : `${passFailures.length} failure(s)`;
      detail(`${id}: ${phoneStateList.length} states, ${outcome}`);
      countCase();
    }
    endSection();
  }

  if (!anySelected) {
    throw new Error(
      `verify:menus: --only=${only ?? ''} matches no case; see the labels in this script's header`,
    );
  }
  const seconds = (performance.now() / MS_PER_SECOND).toFixed(1);
  if (failures.length > 0) {
    console.error(`\nverify:menus — ${failures.length} failure(s) in ${seconds}s\n`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exit(1);
  }
  const scope = only === null ? '' : ` (only cases matching "${only}")`;
  console.log(
    `\nverify:menus — every menu that takes the keyboard can be answered by it${scope}, in ${seconds}s`,
  );
  process.exit(0);
}

// ── Scenes ─────────────────────────────────────────────────────────────────

/** One surface a scene mounts, raised the way the game raises it and taken down again. */
interface Opener<S> {
  readonly surfaceId: string;
  open(scene: S): void;
  close(scene: S): void;
}

/** A gameplay scene as the audit drives it. */
interface SceneUnderAudit {
  readonly ui: Root;
  update(): void;
  render(ctx: CanvasRenderingContext2D): void;
}

/** The openers `--only` selects in a scene whose cases are labelled `<label> <surface id>`. */
function selectedOpeners<S>(
  label: string,
  sectionTitle: string,
  openers: readonly Opener<S>[],
): Opener<S>[] {
  return openers.filter((candidate) =>
    selects(`${label} ${candidate.surfaceId}`, sectionTitle, PHONE_SCENES_SECTION),
  );
}

/** Frames an entrance may take before the surface's controls are up: the longest count-up or reveal. */
const MAX_SETTLE_FRAMES = 600;
/** Frames run after a close, so a surface that eases out has gone before the next opens. */
const CLOSE_FRAMES = 4;

const { beginFigureFrame } = await import('../src/sprites/figure/figureFrameCache.js');
const { beginEnvironmentArtFrame } = await import('../src/map/environmentArtCache.js');
const { closeAboveDarkness } = await import('../src/systems/lighting/aboveDarkness.js');

/**
 * One game frame, with the frame boundaries `SceneManager` opens before each
 * render: without them the figure cache's bake budget is never refreshed, so
 * every figure in a crowded room is painted from scratch on every frame.
 */
function step(scene: SceneUnderAudit): void {
  scene.update();
  beginFigureFrame();
  beginEnvironmentArtFrame();
  closeAboveDarkness();
  scene.render(ctx);
}

/** Runs frames until `surfaceId` has a focusable control, has closed, or the entrance budget is spent. */
function settle(scene: SceneUnderAudit, surfaceId: string): void {
  for (let frame = 0; frame < MAX_SETTLE_FRAMES; frame++) {
    const hasRing = scene.ui
      .regions()
      .some((region) => region.surfaceId === surfaceId && region.focusable);
    if (hasRing) return;
    step(scene);
    if (!scene.ui.isOpen(surfaceId)) return;
  }
}

/** Longer than any surface's opening motion, so a close button is audited where it comes to rest. */
const ENTRANCE_MS = motion.slow;

/**
 * Runs frames until the surface's opening motion has played out, on the
 * scene's own clock, which is `performance.now`. The last frame starts after
 * the deadline, so however few frames a loaded machine manages in between,
 * the one audited is drawn with the motion finished.
 */
function settleEntrance(scene: SceneUnderAudit, surfaceId: string): void {
  const deadline = performance.now() + ENTRANCE_MS;
  let settledFrameDrawn = false;
  while (!settledFrameDrawn && scene.ui.isOpen(surfaceId)) {
    settledFrameDrawn = performance.now() >= deadline;
    step(scene);
  }
}

/**
 * Opens each surface in turn, audits the settled frame, closes it, and checks
 * every panel, modal and system surface the scene mounts was either opened or
 * can never claim the keyboard.
 */
function auditScene<S extends SceneUnderAudit>(
  label: string,
  scene: S,
  openers: readonly Opener<S>[],
  coveredElsewhere: Readonly<Partial<Record<string, string>>> = {},
): void {
  const opened = new Set<string>();
  for (const opener of openers) {
    countCase();
    const startedAt = performance.now();
    opener.open(scene);
    scene.render(ctx);
    const stateLabel = `${label} ${opener.surfaceId}`;
    if (!scene.ui.isOpen(opener.surfaceId)) {
      failures.push(`${stateLabel}: its opener did not open it`);
      opener.close(scene);
      continue;
    }
    // Counted before settling as well as after: a surface that runs its course
    // and closes on its own, a fade, was still opened and audited open.
    for (const id of scene.ui.openSurfaceIds()) opened.add(id);
    settle(scene, opener.surfaceId);
    for (const id of scene.ui.openSurfaceIds()) opened.add(id);
    const settledNote = scene.ui.isOpen(opener.surfaceId) ? '' : ' [closed itself while settling]';
    let caseLine = '';
    if (phonePass === null) {
      const outcome = auditFocus(scene.ui, stateLabel);
      failures.push(...outcome.failures);
      caseLine = `${stateLabel}: ${describeClaimants(outcome.claimants)}${settledNote}`;
    }
    settleEntrance(scene, opener.surfaceId);
    recordCloseButtons(scene.ui, stateLabel);
    if (phonePass !== null) {
      const open = openMenuSurfaceIds(scene.ui).join(', ') || 'no menu';
      const closers = [...surfacesWithCloseButtons(scene.ui)].join(', ') || 'nothing';
      const closedNote = scene.ui.isOpen(opener.surfaceId) ? '' : ' [closed itself]';
      caseLine = `${stateLabel}: ${open} open, close buttons on ${closers}${closedNote}`;
    }
    opener.close(scene);
    for (let frame = 0; frame < CLOSE_FRAMES; frame++) step(scene);
    const mounted = mountedSurfaces(scene.ui);
    const leftOpen = scene.ui.openSurfaceIds().filter((id) => {
      const surface = mounted.get(id);
      return surface !== undefined && claimsKeyboard(surface);
    });
    check(leftOpen.length === 0, `${stateLabel}: closing it left ${leftOpen.join(', ')} open`);
    const seconds = ((performance.now() - startedAt) / MS_PER_SECOND).toFixed(1);
    detail(`${caseLine} (${seconds}s)`);
  }
  // Only the full run opens every opener, so only it can say a surface was never opened.
  if (only !== null) return;
  const notedElsewhere: string[] = [];
  for (const [id, surface] of mountedSurfaces(scene.ui)) {
    if (opened.has(id) || neverClaimsKeyboard(surface)) continue;
    const elsewhere = coveredElsewhere[id];
    if (elsewhere !== undefined) {
      notedElsewhere.push(`${id} (${elsewhere})`);
      continue;
    }
    failures.push(
      `${label}: "${id}" may claim the keyboard but the audit never opened it — add an opener`,
    );
  }
  if (notedElsewhere.length > 0) {
    detail(`not opened in the ${label}: ${notedElsewhere.join(', ')}`);
  }
}

// ── The title screen ───────────────────────────────────────────────────────

const { SceneManager } = await import('../src/core/Scene.js');
const { InputManager } = await import('../src/core/input/InputManager.js');
const { TitleScene, CHARACTER_CREATION_SURFACE_ID } =
  await import('../src/scenes/title/TitleScene.js');
const { TITLE_MENU_SURFACE_ID } = await import('../src/scenes/title/titleMenu.js');
const CREATED_CRAWLER_NAME = 'Morgan';

const auditsRooms = scenePass.shard === 'rooms';
const TITLE_SECTION = 'the title screen';
// Without a save first, before any identity is set, so a stray `playerIdentity()`
// read on the title or the creation screen throws here as it would for a new player.
const titleCases = [false, true]
  .map((withSave) => ({ withSave, label: `title ${withSave ? 'with a save' : 'without a save'}` }))
  .filter(({ label }) => auditsRooms && selects(label, TITLE_SECTION, PHONE_SCENES_SECTION));
if (titleCases.length > 0) {
  anySelected = true;
  section(TITLE_SECTION);
}
for (const { withSave, label } of titleCases) {
  countCase();
  // The boot sets a saved run's identity before the title paints its heroes.
  if (withSave) useDevPlayerIdentity();
  const resumed = { continued: false };
  const onContinue = withSave
    ? (): void => {
        resumed.continued = true;
      }
    : undefined;
  const sceneManager = new SceneManager();
  // Held dormant: with no audio context there is no gesture to wait for, and the audit wants the menu as a first-time player meets it.
  const title = new TitleScene(new InputManager(), sceneManager, {}, onContinue, {
    startState: 'dormant',
    keyboardAnchor: null,
  });
  sceneManager.replace(title);
  step(title);
  check(
    title.ui.isOpen(TITLE_MENU_SURFACE_ID),
    `${label}: the menu is not open on the first frame`,
  );
  if (phonePass === null) {
    const outcome = auditFocus(title.ui, label);
    failures.push(...outcome.failures);
    detail(`${label}: ${describeClaimants(outcome.claimants)}`);
  }
  settleEntrance(title, TITLE_MENU_SURFACE_ID);
  recordCloseButtons(title.ui, label);
  check(title.ui.key('Enter') === 'consumed', `${label}: Enter does not reach the menu`);
  if (withSave) {
    check(title.state === 'dive', `${label}: Enter does not take the focused primary choice`);
    for (let frame = 0; frame < MAX_SETTLE_FRAMES && !resumed.continued; frame++) step(title);
    check(resumed.continued, `${label}: the primary choice never continued the save`);
  } else {
    createCrawlerByKeyboard(title, label);
  }
  title.onExit();
}

/**
 * A new game opens the character creation screen before any dive; walks it
 * with the keyboard alone, auditing each page's focus scope, through to the
 * dive into the first floor.
 */
function createCrawlerByKeyboard(title: InstanceType<typeof TitleScene>, label: string): void {
  const creation = title.characterCreation;
  check(
    title.ui.isOpen(CHARACTER_CREATION_SURFACE_ID) && title.state !== 'dive',
    `${label}: a new game does not open the character creation screen before the dive`,
  );
  const auditPage = (): void => {
    step(title);
    if (phonePass !== null) return;
    const outcome = auditFocus(title.ui, `${label} creation ${creation.page ?? 'closed'}`);
    failures.push(...outcome.failures);
  };
  const press = (key: string, mods: { readonly shift?: boolean } = {}): void => {
    title.ui.key(key, mods);
    step(title);
  };
  auditPage();
  for (const key of CREATED_CRAWLER_NAME) press(key);
  press('Enter');
  check(creation.page === 'body', `${label}: Enter on a typed name does not move on to the body`);
  auditPage();
  // The ring starts at Back, then the two bodies.
  press('Tab');
  press('Tab');
  press('Enter');
  check(creation.page === 'figure', `${label}: the keyboard cannot choose a body`);
  auditPage();
  // Back, then the two figures; Begin joins the ring once one is picked, ahead of them.
  press('Tab');
  press('Tab');
  press('Enter');
  press('Tab', { shift: true });
  press('Enter');
  check(
    !creation.isOpen && title.state === 'dive',
    `${label}: the keyboard cannot pick a figure and begin the run`,
  );
  // The menu fades through the dive but is still on screen: taking a new game again must not reopen creation.
  press('Enter');
  check(
    !creation.isOpen && !title.ui.isOpen(CHARACTER_CREATION_SURFACE_ID),
    `${label}: a menu press during the dive reopens the character creation screen`,
  );
}

// Every scene below starts a run, so it has the dev crawler's identity.
useDevPlayerIdentity();

// ── The town ───────────────────────────────────────────────────────────────

const { TILE_SIZE } = await import('../src/core/constants.js');
const { GameMap } = await import('../src/map/GameMap.js');
const { level3 } = await import('../src/levels/level3.js');
const { DungeonScene } = await import('../src/scenes/DungeonScene.js');
const { speakerLines } = await import('../src/dialog/line.js');

type Town = InstanceType<typeof DungeonScene>;
type ConversationRequest = Parameters<Town['conversation']['open']>[0];

/** Arrival screens poll their loaders across ticks of the event loop, not frames. */
const MAX_ARRIVAL_FRAMES = 3000;
const { ARRIVAL_LOADING_SURFACE_ID: ARRIVAL_SURFACE } =
  await import('../src/scenes/ArrivalLoader.js');
const { ARRIVAL_BANNER_SURFACE_ID: ARRIVAL_BANNER } =
  await import('../src/systems/DungeonIntroSystem.js');
const SAMPLE_LEVEL = 2;
const SAMPLE_SKILL_LEVEL = 1;
const SAMPLE_QUANTITY_MAX = 5;

const noop = (): void => undefined;

/**
 * The pipe board's question opened straight on its gate: the town has no
 * bathroom, so there is no pipe wall to work.
 */
const PIPE_BOARD_AUDIT_REQUEST = { activity: 'The Clogged Bathroom', onPick: noop };

/**
 * The grate's and a structure's popovers open only with a boarded grate or a
 * built structure in reach, which the town does not stand up headless. Both
 * are the one `StructurePopover`, audited open in the gallery.
 */
const STRUCTURE_POPOVER_IN_GALLERY =
  'a StructurePopover, audited as gallery construction/structure-popover';

/** A one-line conversation that holds the world, as a quest beat does. */
function haltingRequest(): ConversationRequest {
  return {
    lines: [speakerLines('dave').line('The audit wants a word, crawler.')],
    reward: null,
    questRelated: false,
    ending: { kind: 'close', onClosed: noop },
    dismiss: { kind: 'allowed', onDismissed: noop },
    haltsWorld: true,
    anchor: null,
    locksKeyboard: true,
  };
}

function opener<S>(
  surfaceId: string,
  open: (scene: S) => void,
  close: (scene: S) => void,
): Opener<S> {
  return { surfaceId, open, close };
}

const SAMPLE_QUANTITY = {
  title: 'Audit',
  max: SAMPLE_QUANTITY_MAX,
  initial: 1,
  unitLabel: 'boards',
  confirmLabel: 'Take',
  onConfirm: noop,
  onCancel: noop,
};

/** Buy-ins' worth of coins the poker openers hand the party: one to sit, one to rebuy. */
const POKER_AUDIT_BUY_INS = 2;
const POKER_AUDIT_STEP_MS = 50;
/** Ceiling on table steps spent waiting for the party's first decision. */
const POKER_AUDIT_MAX_STEPS = 2000;
/** The first regular's seat, clockwise from the player: always filled at a fresh table. */
const POKER_AUDIT_INFO_SEAT = 1;

const SAMPLE_CONFIRM = {
  message: 'Are you sure?',
  yesLabel: 'Yes',
  noLabel: 'No',
  onYes: noop,
  onNo: noop,
};

/** The overlays `MenusKit` mounts, the same in every scene that has one. */
function menusKitOpeners<S>(menusOf: (scene: S) => MenusKit): Opener<S>[] {
  const closePause = (scene: S): void => menusOf(scene).pauseScreen.close();
  const pauseConfirm = (surfaceId: string, kind: 'reset' | 'difficulty' | 'bindings') =>
    opener<S>(
      surfaceId,
      (scene) => {
        const pause = menusOf(scene).pauseScreen;
        pause.open();
        pause['confirm'] = kind;
      },
      closePause,
    );
  return [
    opener<S>(
      'inventory',
      (scene) => menusOf(scene).inventoryScreen.open({ tab: 'bag' }),
      (scene) => menusOf(scene).closePanels(),
    ),
    opener<S>(
      'quest-reward',
      (scene) => menusOf(scene).questReward.open({ questTitle: 'Audit', sections: [] }),
      (scene) => {
        menusOf(scene).questReward['current'] = null;
      },
    ),
    opener<S>(
      'level-up',
      (scene) =>
        menusOf(scene).levelUpDialog.enqueue({
          name: 'Audit',
          newLevel: SAMPLE_LEVEL,
          perkDescription: null,
          renderIcon: noop,
        }),
      (scene) => menusOf(scene).levelUpDialog.acknowledge(),
    ),
    opener<S>(
      'reward-granted',
      (scene) =>
        menusOf(scene).rewardGrantedDialog.enqueue({
          kind: 'item',
          name: 'Audit',
          description: 'A reward for reading closely.',
          renderIcon: noop,
        }),
      (scene) => menusOf(scene).rewardGrantedDialog.acknowledge(),
    ),
    opener<S>(
      'skill-book-prompt',
      (scene) =>
        menusOf(scene).skillBookPrompt.open(
          { bookId: 'skill_book_nine_lives', skillId: 'nine_lives' },
          SAMPLE_SKILL_LEVEL,
        ),
      (scene) => menusOf(scene).skillBookPrompt.close(),
    ),
    opener<S>(
      'craft-explainers',
      (scene) => void menusOf(scene).craftExplainers.open('construction'),
      (scene) => menusOf(scene).craftExplainers.close(),
    ),
    opener<S>(
      'item-picker',
      (scene) => menusOf(scene).itemQuantityDialog.open(SAMPLE_QUANTITY),
      (scene) => menusOf(scene).itemQuantityDialog.close(),
    ),
    opener<S>(
      'pet-name-prompt',
      (scene) =>
        menusOf(scene).petNamePrompt.open({
          kind: 'deinonychus',
          portrait: noop,
          keyboardAnchor: null,
          onNamed: noop,
        }),
      // A name is required, so the prompt has no close of its own; the scene's teardown is the one way out.
      (scene) => menusOf(scene).petNamePrompt.dispose(),
    ),
    opener<S>('pause', (scene) => menusOf(scene).pauseScreen.open(), closePause),
    pauseConfirm('pause-reset-confirm', 'reset'),
    pauseConfirm('pause-difficulty-confirm', 'difficulty'),
    pauseConfirm('pause-bindings-confirm', 'bindings'),
  ];
}

/** Longer than the audit settles and plays an entrance for, so the cutscene is still running when audited. */
const CUTSCENE_AUDIT_WAIT_FRAMES = MAX_SETTLE_FRAMES * 2;

/** The slice of any scene's cutscene kit the audit drives, whatever world actions the scene has. */
interface AuditedCutsceneKit extends Pick<CutsceneKit, 'dispose'> {
  readonly director: { play(script: CutsceneScript): void };
}

/**
 * A cutscene holding the party still with nothing to read, the state its own
 * surface is the topmost claimant in: a talk inside one is the conversation,
 * audited on its own.
 */
function cutsceneOpener<S>(kitOf: (scene: S) => AuditedCutsceneKit): Opener<S> {
  return opener<S>(
    'cutscene',
    (scene) => kitOf(scene).director.play([{ kind: 'wait', frames: CUTSCENE_AUDIT_WAIT_FRAMES }]),
    (scene) => kitOf(scene).dispose(),
  );
}

/** The Reward Chest, opened by a paid award waiting in the human's queue. */
function rewardChestOpener<S>(
  achievementUIOf: (scene: S) => AchievementUISystem,
  achievementsOf: (scene: S) => AchievementManager,
): Opener<S> {
  return opener<S>(
    'reward-chest',
    (scene) => {
      achievementsOf(scene).queuePresentation({
        origin: { kind: 'chest', source: 'caroline' },
        title: 'Audit',
        subtitle: '',
        crawler: 'human',
        rarity: 'Common',
        rewards: [{ kind: 'coins', amount: 1 }],
      });
      achievementUIOf(scene).openRewards();
    },
    (scene) => achievementUIOf(scene).dismiss(),
  );
}

/** The AI's question and, where the scene runs challenges, its offer card. */
function aiInteractionOpeners<S>(
  stageOf: (scene: S) => AIInteractionStage,
  challengesOf: ((scene: S) => AIChallengeSystem) | null,
): Opener<S>[] {
  const openers = [
    opener<S>(
      'ai-question',
      (scene) =>
        void stageOf(scene).ask({
          question: 'Audit: save the cat or the loot?',
          choices: ['The cat', 'The loot'],
          askedBy: CAROLINE_CHARACTER_NAME,
        }),
      (scene) => stageOf(scene).dismissQuestion(),
    ),
  ];
  if (challengesOf === null) return openers;
  return [
    ...openers,
    opener<S>(
      'ai-challenge-offer',
      (scene) =>
        void challengesOf(scene).propose({
          template: 'untouched',
          title: 'Audit',
          count: 1,
          mobType: 'any',
          seconds: SAMPLE_CHALLENGE_SECONDS,
          rewardRarity: 'Common',
          pitch: '',
          taunt: 'Audited.',
          offeredBy: CAROLINE_CHARACTER_NAME,
        }),
      (scene) => stageOf(scene).declineChallenge(),
    ),
  ];
}

const SAMPLE_CHALLENGE_SECONDS = 60;

function townOpeners(): Opener<Town>[] {
  const menu = opener<Town>;
  const briar = (scene: Town) => {
    const kit = scene['briarHollowKit'];
    if (kit === null) throw new Error('the town has no Briar Hollow kit');
    return kit;
  };
  const defences = (scene: Town) => {
    const kit = briar(scene).defences;
    if (kit === null) throw new Error('the town has no construction kit');
    return kit;
  };
  const services = (scene: Town) => {
    const kit = briar(scene).services;
    if (kit === null) throw new Error('the town has no village services');
    return kit;
  };
  return [
    ...menusKitOpeners<Town>((scene) => scene['menus']),
    rewardChestOpener<Town>(
      (scene) => scene['achievementUI'],
      (scene) => scene['humanAchievements'],
    ),
    ...aiInteractionOpeners<Town>(
      (scene) => scene['aiInteractions'],
      (scene) => scene['aiChallenges'],
    ),
    cutsceneOpener<Town>((scene) => scene['cutscenes']),
    menu(
      'wipe-hold',
      (scene) =>
        scene['wipeHold'].begin(
          {
            wipe: () => new Promise<void>(() => undefined),
            wipeStatus: 'erasing',
            wipeAccountLabel: null,
            refusedOtherAccount: false,
          },
          () => undefined,
        ),
      // A real hold never lets go: the page reloads once the wipe lands.
      (scene) => {
        scene['wipeHold']['wipe'] = null;
      },
    ),
    menu(
      'conversation',
      (scene) => void scene['conversation'].open(haltingRequest()),
      (scene) => scene['conversation'].close(),
    ),
    chestRewardOpener<Town>((scene) => scene['chestKit']),
    menu(
      'quest-switch-confirm',
      (scene) => scene['questSwitchConfirm'].open(SAMPLE_CONFIRM),
      (scene) => scene['questSwitchConfirm'].close(),
    ),
    menu(
      'death-screen',
      (scene) => {
        scene['combat'].deathScreen.activate(
          plainDeathMessage('The audit found you wanting.'),
          'checkpoint',
        );
        scene['gameOver'] = true;
      },
      (scene) => {
        scene['gameOver'] = false;
        scene['combat'].deathScreen.reset();
      },
    ),
    menu(
      'level-complete',
      (scene) => scene['levelCompleteScreen'].activate('Taloncrest', null, noop),
      (scene) => {
        scene['levelCompleteScreen']['active'] = false;
      },
    ),
    menu(
      'run-complete',
      (scene) =>
        scene['runCompleteScreen'].activate(
          {
            framesPlayed: 0,
            deaths: 0,
            damageDealt: 0,
            damageTaken: 0,
            potionsUsed: 0,
            goldEarned: 0,
            achievementsUnlocked: 0,
            achievementsTotal: 0,
            humanLevel: 1,
            catLevel: 1,
            deinonychusLevel: null,
            deinonychusWords: petWords(new PetNameBook(), 'deinonychus'),
            totalKills: 0,
            bossesDefeated: 0,
            mercenariesHired: 0,
            mercenariesLost: 0,
            deinonychusPets: 0,
            cowPets: 0,
            midgePets: 0,
            topKills: [],
          },
          { onKeepExploring: noop, onMainMenu: noop },
        ),
      (scene) => {
        scene['runCompleteScreen']['active'] = false;
      },
    ),
    menu(
      'chat',
      (scene) => scene['triggerOpenChat'](),
      (scene) => scene['chat'].cancel(),
    ),
    menu(
      'notice-board',
      (scene) => scene['openNoticeBoard'](),
      (scene) => scene['noticeBoard']?.close(),
    ),
    menu(
      'market-stall',
      (scene) => {
        const market = scene['market'];
        const stall = market?.['stalls'][0];
        if (market === null || stall === undefined) throw new Error('the town has no market');
        const active = scene['active']();
        active.x = stall.tiles[0].x * TILE_SIZE;
        active.y = stall.tiles[0].y * TILE_SIZE;
        market.tryInteract(active);
      },
      (scene) => scene['marketPanel']?.close(),
    ),
    menu(
      'siege-loss-explainer',
      (scene) => {
        const assault = briar(scene).assault;
        if (assault === null) throw new Error('the town has no siege');
        assault['lossExplainer'] = 'bell_fell';
      },
      (scene) => briar(scene).assault?.dismissLossExplainer(),
    ),
    menu(
      'travel-menu',
      (scene) => scene['travelMenu'].open(scene['active']()),
      (scene) => scene['travelMenu'].close(),
    ),
    menu(
      'fortune-teller',
      (scene) => scene['fortuneTeller']?.openWith(scene['townDialogContext']()),
      (scene) => scene['fortuneTeller']?.close(),
    ),
    menu(
      'defend-tutorial',
      (scene) => {
        scene['defendQuest']['phase'] = 'tutorial';
        scene['defendQuest']['tutorialPage'] = 0;
      },
      (scene) => {
        scene['defendQuest']['phase'] = 'inactive';
      },
    ),
    menu(
      'spider-tutorial',
      (scene) => {
        scene['spiderQuest']['phase'] = 'keyboard_hero_tutorial';
      },
      (scene) => {
        scene['spiderQuest']['phase'] = 'inactive';
      },
    ),
    menu(
      'spider-hack-failed',
      (scene) => {
        scene['spiderQuest']['phase'] = 'hacking_failed';
      },
      (scene) => {
        scene['spiderQuest']['phase'] = 'inactive';
      },
    ),
    menu(
      'keyboard-hero',
      (scene) => scene['spiderQuest']['_startHacking']('normal'),
      (scene) => {
        scene['spiderQuest']['phase'] = 'inactive';
      },
    ),
    menu(
      'pipe-board',
      (scene) => {
        const bathroom = scene.cloggedBathroom;
        bathroom.generateBoardNow();
        bathroom['boardOpen'] = true;
      },
      (scene) => scene.cloggedBathroom.closePipeBoard(),
    ),
    menu(
      'pipe-board-restart',
      (scene) => {
        const bathroom = scene.cloggedBathroom;
        bathroom.generateBoardNow();
        bathroom['boardOpen'] = true;
        // The confirm is the board's own state, reached only through its
        // "Start over" button, so the board is drawn once and the button pressed.
        scene.render(ctx);
        const restart = scene.ui
          .regions()
          .find((region) => region.surfaceId === 'pipe-board' && region.id.endsWith('/restart'));
        if (restart?.onTap === undefined)
          throw new Error('the pipe board drew no Start over button');
        restart.onTap({ x: restart.rect.x, y: restart.rect.y, button: 0, source: 'keyboard' });
      },
      (scene) => {
        scene.ui.escape();
        scene.cloggedBathroom.closePipeBoard();
      },
    ),
    menu(
      'pipe-board-difficulty',
      (scene) => scene.cloggedBathroom.difficultyGate.open(PIPE_BOARD_AUDIT_REQUEST),
      (scene) => scene.cloggedBathroom.difficultyGate.cancel(),
    ),
    menu(
      'pipe-board-difficulty-discard',
      (scene) => {
        const bathroom = scene.cloggedBathroom;
        const board = bathroom.generateBoardNow('easy');
        const firstTurnable = board.tiles.findIndex((tile) => !tile.decoy && !tile.bolted);
        bathroom.turnPipeTile(firstTurnable, 'clockwise');
        bathroom.difficultyGate.open(PIPE_BOARD_AUDIT_REQUEST);
        bathroom.difficultyGate.choose('hard');
      },
      (scene) => {
        const bathroom = scene.cloggedBathroom;
        bathroom.difficultyGate.back();
        bathroom.difficultyGate.cancel();
        bathroom.restartPipeBoard();
      },
    ),
    menu(
      'prison-difficulty',
      (scene) => {
        const doors = scene['gameMap'].buildingEntries;
        if (doors.length === 0) throw new Error('the town has no door to stand the picker on');
        const door = doors[0];
        scene['prisonDifficulty'].open({ activity: buildingDisplayName(door.id), onPick: noop });
      },
      (scene) => scene['prisonDifficulty'].cancel(),
    ),
    menu(
      'spider-terminal-difficulty',
      (scene) => scene.spiderTerminalDifficulty.open({ activity: SPIDER_QUEST_NAME, onPick: noop }),
      (scene) => scene.spiderTerminalDifficulty.cancel(),
    ),
    menu(
      'pipe-board-explainer',
      (scene) => scene.cloggedBathroom.openPipeBoardExplainer(),
      (scene) => scene.cloggedBathroom.dismissPipeBoardExplainer(),
    ),
    menu(
      'stairwell',
      (scene) => {
        scene['stairwell']['_menuOpen'] = true;
      },
      (scene) => scene['stairwell'].closeMenu(),
    ),
    menu(
      'building-entry',
      (scene) => {
        const building = scene['building'];
        const door = scene['gameMap'].buildingEntries.find((entry) => entry.type === 'store');
        if (building === null || door === undefined) throw new Error('the town has no store door');
        const active = scene['active']();
        active.x = door.doorTile.x * TILE_SIZE;
        active.y = door.doorTile.y * TILE_SIZE;
        building['onDoor'] = false;
        building.detect(active);
      },
      (scene) => scene['building']?.closeMenu(),
    ),
    menu(
      'construction-menu',
      (scene) => scene['menus'].constructionMenu.openWith(defences(scene)['menuSource']),
      (scene) => void defences(scene).dismissDialog(),
    ),
    menu(
      'construction-picker',
      (scene) => defences(scene)['picker'].open(SAMPLE_QUANTITY),
      (scene) => defences(scene)['picker'].close(),
    ),
    menu(
      'construction-confirm',
      (scene) => defences(scene)['confirm'].open(SAMPLE_CONFIRM),
      (scene) => defences(scene)['confirm'].close(),
    ),
    menu(
      'village-priced-menu',
      (scene) =>
        services(scene).panel.open(
          () => ({ title: 'Audit', bark: 'Audit day.', byline: null, emblem: null, options: [] }),
          () => ({ ok: false, line: 'Nothing for sale.' }),
          { onBlocked: null, blockedLine: null, rebuyGuardTicks: 0, sell: null, liveRows: false },
        ),
      (scene) => services(scene).panel.close(),
    ),
    menu(
      'village-services-picker',
      (scene) => {
        // The picker is Fenna's question and closes on the next tick she is not being talked to.
        const villagers = briar(scene).villagers;
        const fenna = villagers?.villagerFor('fenna') ?? null;
        if (villagers === null || fenna === null) throw new Error('the town has no Fenna');
        const active = scene['active']();
        active.x = fenna.x;
        active.y = fenna.y;
        villagers.talkTo(fenna, active);
        services(scene).picker.open(SAMPLE_QUANTITY);
      },
      (scene) => {
        services(scene).picker.close();
        scene['conversation'].close();
      },
    ),
    menu(
      'follower-menu',
      (scene) => scene['followerMenu'].open(),
      (scene) => scene['followerMenu'].close(),
    ),
  ];
}

const town = new GameMap({
  mapSize: level3.mapSize,
  tileHeight: TILE_SIZE,
  mapType: 'overworld',
  worldSeed: WORLD_SEED,
});

const TOWN_SECTION = 'the town (DungeonScene)';
// Only a scene pass gets this far: the parent and the gallery parts have exited above.
const townSelected =
  scenePass.shard === 'town' ? selectedOpeners('town', TOWN_SECTION, townOpeners()) : [];
if (townSelected.length > 0) {
  anySelected = true;
  section(TOWN_SECTION);
  const sceneManager = new SceneManager();
  const street = new DungeonScene(level3, new InputManager(), sceneManager, {
    existingMap: town,
    worldSeed: WORLD_SEED,
  });
  sceneManager.replace(street);
  street.render(ctx);
  const arrival = ARRIVAL_SURFACE;
  check(street.ui.isOpen(arrival), 'the town raises no arrival screen to audit');
  const arrivalOutcome = auditFocus(street.ui, `town ${arrival}`);
  failures.push(...arrivalOutcome.failures);
  detail(`town ${arrival}: ${describeClaimants(arrivalOutcome.claimants)}`);
  for (let frame = 0; frame < MAX_ARRIVAL_FRAMES && street.ui.isOpen(arrival); frame++) {
    street.render(ctx);
    await new Promise((resolve) => setImmediate(resolve));
  }
  check(!street.ui.isOpen(arrival), "the town's arrival screen never finished");
  step(street);
  check(street.ui.isOpen(ARRIVAL_BANNER), 'the town raises no arrival banner to audit');
  const bannerOutcome = auditFocus(street.ui, `town ${ARRIVAL_BANNER}`);
  failures.push(...bannerOutcome.failures);
  detail(`town ${ARRIVAL_BANNER}: ${describeClaimants(bannerOutcome.claimants)}`);
  for (let frame = 0; frame < MAX_ARRIVAL_FRAMES && street.ui.isOpen(ARRIVAL_BANNER); frame++) {
    step(street);
  }
  check(!street.ui.isOpen(ARRIVAL_BANNER), "the town's arrival banner never finished");
  auditScene('town', street, townSelected, {
    [arrival]: 'audited above, while the town loads',
    [ARRIVAL_BANNER]: 'audited above, as the town is announced',
    'grate-spikes': STRUCTURE_POPOVER_IN_GALLERY,
    'structure-menu': STRUCTURE_POPOVER_IN_GALLERY,
  });
}

// ── Interiors ──────────────────────────────────────────────────────────────

const { HumanPlayer } = await import('../src/creatures/HumanPlayer.js');
const { CatPlayer } = await import('../src/creatures/CatPlayer.js');
const { POKER_STAKES } = await import('../src/systems/casino/poker/pokerStakes.js');
const { ClubWheelSystem } = await import('../src/systems/ClubWheelSystem.js');
const { WHEEL_MIN_BET, boardForBet } = await import('../src/systems/casino/wheel/wheelBoard.js');
const { ClubSlotsSystem, SLOTS_SURFACE_ID, SLOTS_RULES_SURFACE_ID } =
  await import('../src/systems/ClubSlotsSystem.js');
const { playUntilBust, playUntilGameOver } = await import('../src/dev/uiGallery/dialogs/poker.js');
const { snapPlayer } = await import('../src/core/save/PlayerSnapshot.js');
const { teachBoth } = await import('../src/core/labour/CraftSkills.js');
const { createShopStock } = await import('../src/economy/shopStock.js');
const { BuildingInteriorScene } = await import('../src/scenes/BuildingInteriorScene.js');
const { indoorsConstructionSource } =
  await import('../src/systems/briarHollow/ConstructionSystem.js');

type Interior = InstanceType<typeof BuildingInteriorScene>;
type Entry = (typeof town.buildingEntries)[number];

const SAMPLE_READABLE = {
  id: 'audit-notice',
  title: 'Audit Notice',
  where: 'Pinned by the door',
  anchor: 'board',
  medium: 'sheet',
  body: ['Every menu must answer the keyboard.'],
} as const;

/** A building entered and past its arrival loading screen, ready to be audited. */
async function enter(entry: Entry): Promise<Interior> {
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(1, 0, TILE_SIZE);
  human.isActive = true;
  teachBoth(human, cat, 'construction');
  const room = new BuildingInteriorScene(
    entry,
    snapPlayer(human),
    snapPlayer(cat),
    level3.xpDiminishingTiers,
    level3.arrivalLoadingScreen,
    new InputManager(),
    new SceneManager(),
    noop,
    createShopStock(),
  );
  // The room's own loading screen, audited while it is up the way the town's
  // is: it is the one surface a player meets before any other in the room.
  room.render(ctx);
  if (room.ui.isOpen(ARRIVAL_SURFACE)) {
    const arrivalOutcome = auditFocus(room.ui, `${entry.id} ${ARRIVAL_SURFACE}`);
    failures.push(...arrivalOutcome.failures);
    detail(`${entry.id} ${ARRIVAL_SURFACE}: ${describeClaimants(arrivalOutcome.claimants)}`);
  }
  if (!(await settleArrival(room, ctx))) {
    throw new Error(`${entry.id}'s arrival screen never finished`);
  }
  return room;
}

function building(label: string, predicate: (entry: Entry) => boolean): Entry {
  const entry = town.buildingEntries.find(predicate);
  if (entry === undefined) throw new Error(`the town has no ${label}`);
  return entry;
}

/** The chest card, shown for an emptied chest the way an opened one shows it. */
function chestRewardOpener<S>(kitOf: (scene: S) => ChestKit): Opener<S> {
  return opener<S>(
    'chest-reward',
    (scene) =>
      kitOf(scene)['dialog'].open(
        {
          tileX: 0,
          tileY: 0,
          type: 'wooden',
          state: 'opened',
          loot: null,
          unlockFrame: 0,
          sparkleFrame: 0,
          tryLockedTimer: 0,
          lock: { kind: 'none' },
        },
        null,
      ),
    (scene) => kitOf(scene).discard(),
  );
}

/** Opens the service the resident keeps in this room, found as the talk router finds it. */
function openResidentService(scene: Interior, residentId: ResidentId): void {
  const occupants = scene['occupants'];
  const keeper = occupants?.people.find((person) => person.residentId === residentId);
  const service = keeper === undefined ? undefined : occupants?.serviceOf(keeper);
  if (keeper === undefined || service === undefined) {
    throw new Error(`${residentId} keeps no service in this room`);
  }
  scene['openService'](keeper, 0, null, service);
}

/** What every room can raise, whatever the building. */
function roomOpeners(): Opener<Interior>[] {
  const menu = opener<Interior>;
  return [
    chestRewardOpener<Interior>((scene) => scene['chestKit']),
    ...menusKitOpeners<Interior>((scene) => scene['menus']),
    rewardChestOpener<Interior>(
      (scene) => scene['achievementUI'],
      (scene) => scene['humanAchievements'],
    ),
    ...aiInteractionOpeners<Interior>((scene) => scene['aiInteractions'], null),
    cutsceneOpener<Interior>((scene) => scene['cutscenes']),
    menu(
      'conversation',
      (scene) => void scene['conversation'].open(haltingRequest()),
      (scene) => scene['conversation'].close(),
    ),
    menu(
      'construction-menu',
      (scene) =>
        scene['menus'].constructionMenu.openWith(
          indoorsConstructionSource(
            scene['human'],
            scene['cat'],
            () => scene.briarHollowState.unlocks,
          ),
        ),
      (scene) => scene['menus'].constructionMenu.close(),
    ),
    menu(
      'chat',
      (scene) => scene['openChat'](),
      (scene) => scene['chat'].cancel(),
    ),
    menu(
      'death-screen',
      (scene) => scene['raiseDeathScreen'](),
      (scene) => {
        scene['gameOver'] = false;
        scene['combat'].deathScreen.reset();
      },
    ),
    menu(
      'follower-menu',
      (scene) => scene['followerMenu'].open(),
      (scene) => scene['followerMenu'].close(),
    ),
    menu(
      'readable',
      (scene) => scene['readablePanel'].openWith(SAMPLE_READABLE),
      (scene) => scene['readablePanel'].close(),
    ),
    menu(
      'exit-building',
      (scene) => {
        scene['exitMenuOpen'] = true;
      },
      (scene) => scene['closeExitMenu'](),
    ),
  ];
}

interface InteriorCase {
  readonly label: string;
  readonly entry: Entry;
  readonly openers: readonly Opener<Interior>[];
}

function interiorCases(): InteriorCase[] {
  const menu = opener<Interior>;
  const club = (scene: Interior) => {
    const system = scene['club'];
    if (system === null) throw new Error('the club built no club');
    return system;
  };
  const closeClub = (scene: Interior): void => {
    club(scene).closeAll(scene.pm.active());
    scene['conversation'].close();
  };
  const wheelOf = (scene: Interior) => {
    const wheel = club(scene)['games'].wheel;
    if (!(wheel instanceof ClubWheelSystem)) throw new Error('the club seated no wheel');
    return wheel;
  };
  const slotsOf = (scene: Interior) => {
    const slots = club(scene)['games'].slots;
    if (!(slots instanceof ClubSlotsSystem)) throw new Error('the club seated no slot machine');
    return slots;
  };
  const casinoSeat = (scene: Interior) => ({
    active: () => scene.pm.active(),
    companion: () => scene.pm.inactive(),
  });
  const closeWheel = (scene: Interior): void => {
    wheelOf(scene).resetForReview();
    closeClub(scene);
  };
  /** Seats the party at the penny table, with a rebuy's worth left in the purse. */
  const seatAtPoker = (scene: Interior) => {
    const poker = club(scene)['poker'];
    const active = scene.pm.active();
    active.coins += POKER_STAKES.penny.buyIn * POKER_AUDIT_BUY_INS;
    poker.buyIn('penny', active, scene.pm.inactive());
    poker.dismissRules();
    const table = poker.pokerTable;
    if (table === null) throw new Error('the poker table did not seat the party');
    return { poker, table };
  };
  return [
    {
      label: 'General Store',
      entry: building('taloncrest_general_store', (entry) => entry.type === 'store'),
      openers: [
        ...roomOpeners(),
        menu(
          'shop',
          (scene) => scene['shop']?.open(),
          (scene) => scene['shop']?.close(),
        ),
      ],
    },
    {
      label: 'Herb & Remedy',
      entry: building('taloncrest_apothecary', (entry) => entry.id === 'taloncrest_apothecary'),
      openers: [
        menu(
          'priced-menu',
          (scene) => openResidentService(scene, 'apothecary_fen'),
          (scene) => scene['servicePanel']?.close(),
        ),
        // Last in its room: the fade cannot be called back, and it ends in the
        // room's exit, after which nothing else here is opened.
        menu(
          'exit-fixture-fade',
          (scene) => {
            const active = scene.pm.active();
            const exits = scene['exitFixtures'];
            exits.place(
              exitFixtureOnTile('rope_ladder', {
                x: Math.round(active.x / TILE_SIZE),
                y: Math.round(active.y / TILE_SIZE),
              }),
            );
            exits.tryInteract(active);
            // The ladder asks the door mat's question first; Exit is the climb.
            scene['leaveByExitMenu']();
            exits.update();
          },
          noop,
        ),
      ],
    },
    {
      label: "Old Lori's Cottage",
      entry: building(
        'taloncrest_old_lady_cottage',
        (entry) => entry.id === 'taloncrest_old_lady_cottage',
      ),
      openers: [
        menu(
          'fortune-teller',
          (scene) => openResidentService(scene, 'old_lori'),
          (scene) => scene['readingPanel']?.close(),
        ),
      ],
    },
    {
      label: 'The Barracks',
      entry: building('taloncrest_barracks', (entry) => entry.id === 'taloncrest_barracks'),
      openers: [
        menu(
          'mercenary-desk',
          (scene) => scene['openDesk']('mercenary_guild'),
          (scene) => scene['mercenaryDesk']?.close(),
        ),
        menu(
          'mercenary-desk-dismiss',
          (scene) => scene['mercenaryDesk']?.dismissConfirm.open(SAMPLE_CONFIRM),
          (scene) => scene['mercenaryDesk']?.dismissConfirm.close(),
        ),
      ],
    },
    {
      label: 'tower',
      entry: building('tower', (entry) => entry.type === 'tower'),
      openers: [
        menu(
          'tower-stairs',
          (scene) => {
            const stairs = scene['towerStairs'];
            if (stairs !== null) stairs['_upMenuOpen'] = true;
          },
          (scene) => scene['towerStairs']?.closeMenu(),
        ),
      ],
    },
    {
      label: CLUB_LABEL,
      entry: building(CLUB_LABEL, (entry) => entry.type === 'club'),
      openers: [
        menu('club-bar-shop', (scene) => club(scene)['barShop'].open(), closeClub),
        menu('club-market-shop', (scene) => club(scene)['marketShop'].open(), closeClub),
        menu(
          'blackjack-rules',
          (scene) => club(scene)['casino'].openTable(scene.pm.active(), scene.pm.inactive()),
          closeClub,
        ),
        menu(
          'club-casino',
          (scene) => {
            const casino = club(scene)['casino'];
            casino.openTable(scene.pm.active(), scene.pm.inactive());
            casino.dismissRules();
          },
          closeClub,
        ),
        menu(
          'casino-game-picker',
          (scene) => {
            club(scene)['gamePickerOpen'] = true;
          },
          closeClub,
        ),
        menu('poker-buy-in', (scene) => club(scene)['poker'].openBuyIn(), closeClub),
        menu('poker-table', (scene) => void seatAtPoker(scene), closeClub),
        menu('poker-rules', (scene) => seatAtPoker(scene).poker.openRules(), closeClub),
        menu('poker-history', (scene) => seatAtPoker(scene).poker.openHistory(), closeClub),
        menu(
          'poker-seat-info',
          (scene) => {
            const { poker } = seatAtPoker(scene);
            if (!poker.openSeatInfo(POKER_AUDIT_INFO_SEAT)) {
              throw new Error('the poker table had nobody to open a seat card on');
            }
          },
          closeClub,
        ),
        menu(
          'poker-leave-confirm',
          (scene) => {
            const { poker, table } = seatAtPoker(scene);
            for (let step = 0; step < POKER_AUDIT_MAX_STEPS && !table.awaitingPlayer; step++) {
              table.update(POKER_AUDIT_STEP_MS);
            }
            poker.requestLeave(scene.pm.active());
          },
          closeClub,
        ),
        menu(
          'poker-bust',
          (scene) => {
            const { table } = seatAtPoker(scene);
            if (!playUntilBust(table)) throw new Error('the poker table never busted the party');
          },
          closeClub,
        ),
        menu(
          'poker-game-over',
          (scene) => {
            const { table } = seatAtPoker(scene);
            if (!playUntilGameOver(table)) throw new Error('the poker game never ended');
          },
          closeClub,
        ),
        menu(SLOTS_SURFACE_ID, (scene) => slotsOf(scene).open(casinoSeat(scene)), closeClub),
        menu(
          SLOTS_RULES_SURFACE_ID,
          (scene) => {
            const slots = slotsOf(scene);
            slots.open(casinoSeat(scene));
            slots.openRules();
          },
          closeClub,
        ),
        menu('wheel-warning', (scene) => wheelOf(scene).open(casinoSeat(scene)), closeWheel),
        menu(
          'wheel-confirm',
          (scene) => wheelOf(scene).openPromptForReview(casinoSeat(scene), 'confirm'),
          closeWheel,
        ),
        menu('wheel', (scene) => wheelOf(scene).openWheelForReview(casinoSeat(scene)), closeWheel),
        menu(
          'wheel-prize',
          (scene) => {
            const board = boardForBet(WHEEL_MIN_BET);
            const index = board.findIndex((wedge) => wedge.prizeId === 'epic_charm_frost');
            wheelOf(scene).presentPrizeForReview(casinoSeat(scene), index);
          },
          closeWheel,
        ),
        // Never the real wipe: the review landing plays Permanent Death with storage left alone.
        menu(
          'wheel-permanent-death',
          (scene) => wheelOf(scene).openPermanentDeathForReview(casinoSeat(scene)),
          closeWheel,
        ),
      ],
    },
  ];
}

const CLUB_LABEL = 'Cloak & Dagger';
const cases = interiorCases();
for (const { label, entry, openers } of cases) {
  const roomShard: SceneShard = label === CLUB_LABEL ? 'club' : 'rooms';
  if (roomShard !== scenePass.shard) continue;
  const roomSection = `${label} (BuildingInteriorScene)`;
  const roomSelected = selectedOpeners(label, roomSection, openers);
  if (roomSelected.length === 0) continue;
  anySelected = true;
  section(roomSection);
  const room = await enter(entry);
  step(room);
  const auditedHere = new Set(openers.map((candidate) => candidate.surfaceId));
  const elsewhere: Record<string, string> = {
    [ARRIVAL_SURFACE]: 'audited above, while the room loads',
  };
  for (const other of cases) {
    if (other.label === label) continue;
    for (const candidate of other.openers) {
      if (!auditedHere.has(candidate.surfaceId)) {
        elsewhere[candidate.surfaceId] = `audited in the ${other.label}`;
      }
    }
  }
  auditScene(label, room, roomSelected, elsewhere);
}

// ── Report ─────────────────────────────────────────────────────────────────

reportToParent();
