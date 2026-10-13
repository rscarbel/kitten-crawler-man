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
 *    replayed on a notched phone each way up, in child processes run beside
 *    the desktop pass, whose close buttons must be tappable and must be
 *    there wherever the desktop shows one.
 *
 * Every panel, modal and system surface a scene mounts must be opened by this
 * script unless both of its keyboard claims are fixed `false` or another case
 * audits it (a room's common menus, opened once in the General Store), so a
 * menu added to a scene without an opener here fails the gate instead of
 * escaping it.
 *
 * Run: npm run verify:menus
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Surface } from '../src/ui/core/UiRoot.js';
import type { FocusClaimant } from './menuFocusAudit.js';
import type { UiSize } from '../src/core/Settings.js';
import type { SafeAreaInsets, ViewportInput } from '../src/ui/core/viewport.js';
import type { MenusKit } from '../src/systems/kits/MenusKit.js';

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
type PhonePassId = (typeof PHONE_PASS_IDS)[number];
const PHONE_SCENE_PASSES: Record<
  PhonePassId,
  { readonly width: number; readonly height: number; readonly safeArea: SafeAreaInsets }
> = {
  'portrait-notched': { width: 390, height: 844, safeArea: NOTCH_PORTRAIT_INSETS },
  'landscape-notched': { width: 844, height: 390, safeArea: NOTCH_LANDSCAPE_INSETS },
};
const PHONE_SCENE_UI_SIZE: UiSize = 'large';
const PHONE_PASS_FLAG = '--phone-scenes=';

function isPhonePassId(value: string): value is PhonePassId {
  return PHONE_PASS_IDS.some((id) => id === value);
}

function phonePassFromArgs(): PhonePassId | null {
  const arg = process.argv.find((candidate) => candidate.startsWith(PHONE_PASS_FLAG));
  if (arg === undefined) return null;
  const id = arg.slice(PHONE_PASS_FLAG.length);
  if (!isPhonePassId(id)) throw new Error(`verify:menus: no phone pass "${id}"`);
  return id;
}

/** Set in a child process that replays the scenes on one phone and reports back. */
const phonePass = phonePassFromArgs();

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
const { loadSprites } = await import('../src/core/SpriteLoader.js');
const { setViewportSize } = await import('../src/core/Viewport.js');
const { settings } = await import('../src/core/Settings.js');
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
/** Long enough for every open, hover and tab tween to settle. */
const SETTLE_MS = 1000;

const failures: string[] = [];
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

function section(title: string): void {
  console.log(`\n── ${title}`);
}

// ── Phone passes ───────────────────────────────────────────────────────────

/** One opened state of a scene: the menus open in it and those that drew a close button. */
interface CloseButtonState {
  readonly label: string;
  readonly open: readonly string[];
  readonly withClose: readonly string[];
}

/** What a phone pass hands back to the desktop run. */
interface PhoneReport {
  readonly states: readonly CloseButtonState[];
  readonly failures: readonly string[];
}

interface PhonePassResult {
  readonly id: PhonePassId;
  readonly status: number | null;
  readonly output: string;
}

const PHONE_REPORT_MARKER = 'verify:menus phone report ';
/** Lines of a phone pass's own output shown when it fails to report. */
const PHONE_OUTPUT_TAIL_LINES = 40;

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
  'club-guild',
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

function isPhoneReport(value: unknown): value is PhoneReport {
  return (
    typeof value === 'object' &&
    value !== null &&
    'states' in value &&
    Array.isArray(value.states) &&
    value.states.every(isCloseButtonState) &&
    'failures' in value &&
    isStringArray(value.failures)
  );
}

function parsePhoneReport(output: string): PhoneReport | null {
  const line = output.split('\n').find((candidate) => candidate.startsWith(PHONE_REPORT_MARKER));
  if (line === undefined) return null;
  const parsed: unknown = JSON.parse(line.slice(PHONE_REPORT_MARKER.length));
  return isPhoneReport(parsed) ? parsed : null;
}

/** Replays the scenes on one phone in a child process, alongside the desktop run. */
function runPhoneScenePass(id: PhonePassId): Promise<PhonePassResult> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [...process.execArgv, fileURLToPath(import.meta.url), `${PHONE_PASS_FLAG}${id}`],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    const collect = (chunk: unknown): void => {
      output += String(chunk);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('close', (status) => resolve({ id, status, output }));
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

const phoneScenePasses = phonePass === null ? PHONE_PASS_IDS.map(runPhoneScenePass) : [];

if (phonePass === null) {
  // ── Self test ──────────────────────────────────────────────────────────────

  section('self test: the audit flags a menu a keyboard cannot reach');
  {
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
    console.log(caught.map((failure) => `  caught: ${failure}`).join('\n'));
    check(
      caught.some((failure) => failure.includes('"ringless-fake"')),
      'self test: a halting modal with only an unfocusable button is not flagged',
    );
    rig.root.mount(floating);
    rig.frame();
    const stolen = auditFocus(rig.root, 'self test').failures;
    console.log(stolen.map((failure) => `  caught: ${failure}`).join('\n'));
    check(
      stolen.some((failure) => failure.includes('focus belongs to "floating-fake"')),
      'self test: a non-halting surface that steals focus from a halting one is not flagged',
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
  ) {
    const bare = bareRoot(viewport);
    const { root } = bare;
    const model = new GalleryModel();
    model.sheet = sheet;
    model.screenFixture = fixture;
    for (const surface of createUiGallery(model, null).surfaces) root.mount(surface);
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

  section('UI gallery');
  {
    let galleryClaimants = 0;
    const audit = (root: Root, label: string): void => {
      const outcome = auditFocus(root, label);
      failures.push(...outcome.failures);
      galleryClaimants += outcome.claimants.length;
      console.log(`  ${label}: ${describeClaimants(outcome.claimants)}`);
    };
    for (const sheet of GALLERY_SHEETS) {
      const fixtures = SHEET_FIXTURES[sheet] ?? [];
      // One rig walks the sheet's fixtures: only the shown fixture's surfaces are open.
      const walk = galleryRig(sheet, null);
      if (fixtures.length === 0) {
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
    check(galleryClaimants > 0, 'the gallery audit saw no surface that claims the keyboard');
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

  section('self test: the close audit flags a close button pushed off a phone screen');
  {
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
      check(found.length > 0, `self test: a close button ${what} on a phone is not flagged`);
    }
  }

  section('close buttons on phones');
  {
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
      }
    };
    for (const sheet of GALLERY_SHEETS) {
      const fixtures = SHEET_FIXTURES[sheet] ?? [];
      if (fixtures.length === 0) auditState(sheet, null, `gallery ${sheet}`);
      for (const fixture of fixtures)
        auditState(sheet, fixture.name, `gallery ${sheet}/${fixture.name}`);
    }
    for (const [phone, count] of failuresByPhone) {
      console.log(`  ${phone}: ${count === 0 ? 'ok' : `${count} failure(s)`}`);
    }
    check(audited > 0, 'the close-button audit saw no gallery state');
  }
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

/** Frames an entrance may take before the surface's controls are up: the longest count-up or reveal. */
const MAX_SETTLE_FRAMES = 600;
/** Frames run after a close, so a surface that eases out has gone before the next opens. */
const CLOSE_FRAMES = 4;

function step(scene: SceneUnderAudit): void {
  scene.update();
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

/** Runs frames until the surface's opening motion has played out, on the scene's own clock. */
function settleEntrance(scene: SceneUnderAudit, surfaceId: string): void {
  const start = performance.now();
  while (performance.now() - start < ENTRANCE_MS && scene.ui.isOpen(surfaceId)) step(scene);
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
    opener.open(scene);
    scene.render(ctx);
    const stateLabel = `${label} ${opener.surfaceId}`;
    if (!scene.ui.isOpen(opener.surfaceId)) {
      failures.push(`${stateLabel}: its opener did not open it`);
      opener.close(scene);
      continue;
    }
    settle(scene, opener.surfaceId);
    for (const id of scene.ui.openSurfaceIds()) opened.add(id);
    const settledNote = scene.ui.isOpen(opener.surfaceId) ? '' : ' [closed itself while settling]';
    if (phonePass === null) {
      const outcome = auditFocus(scene.ui, stateLabel);
      failures.push(...outcome.failures);
      console.log(`  ${stateLabel}: ${describeClaimants(outcome.claimants)}${settledNote}`);
    }
    settleEntrance(scene, opener.surfaceId);
    recordCloseButtons(scene.ui, stateLabel);
    if (phonePass !== null) {
      const open = openMenuSurfaceIds(scene.ui).join(', ') || 'no menu';
      const closers = [...surfacesWithCloseButtons(scene.ui)].join(', ') || 'nothing';
      const closedNote = scene.ui.isOpen(opener.surfaceId) ? '' : ' [closed itself]';
      console.log(`  ${stateLabel}: ${open} open, close buttons on ${closers}${closedNote}`);
    }
    opener.close(scene);
    for (let frame = 0; frame < CLOSE_FRAMES; frame++) step(scene);
    const mounted = mountedSurfaces(scene.ui);
    const leftOpen = scene.ui.openSurfaceIds().filter((id) => {
      const surface = mounted.get(id);
      return surface !== undefined && claimsKeyboard(surface);
    });
    check(leftOpen.length === 0, `${stateLabel}: closing it left ${leftOpen.join(', ')} open`);
  }
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
    console.log(`  not opened in the ${label}: ${notedElsewhere.join(', ')}`);
  }
}

// ── The town ───────────────────────────────────────────────────────────────

const { TILE_SIZE } = await import('../src/core/constants.js');
const { SceneManager } = await import('../src/core/Scene.js');
const { InputManager } = await import('../src/core/InputManager.js');
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
const SAMPLE_LEVEL = 2;
const SAMPLE_SKILL_LEVEL = 1;
const SAMPLE_QUANTITY_MAX = 5;

const noop = (): void => undefined;

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
    lines: [speakerLines('mordecai').line('The audit wants a word, crawler.')],
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
          { bookId: 'skill_book_cockroach', skillId: 'cockroach' },
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
    opener<S>('pause', (scene) => menusOf(scene).pauseScreen.open(), closePause),
    pauseConfirm('pause-reset-confirm', 'reset'),
    pauseConfirm('pause-difficulty-confirm', 'difficulty'),
    pauseConfirm('pause-bindings-confirm', 'bindings'),
  ];
}

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
    menu(
      'chest-reward',
      (scene) =>
        scene['chestRewardDialog'].open(
          {
            tileX: 0,
            tileY: 0,
            type: 'wooden',
            state: 'opened',
            loot: null,
            unlockFrame: 0,
            sparkleFrame: 0,
            tryLockedTimer: 0,
            guardBounds: null,
            bossRoomIndex: null,
            hadMobs: false,
          },
          null,
        ),
      (scene) => scene['chestRewardDialog'].discard(),
    ),
    menu(
      'quest-switch-confirm',
      (scene) => scene['questSwitchConfirm'].open(SAMPLE_CONFIRM),
      (scene) => scene['questSwitchConfirm'].close(),
    ),
    menu(
      'death-screen',
      (scene) => {
        scene['combat'].deathScreen.activate('The audit found you wanting.', 'checkpoint');
        scene['gameOver'] = true;
      },
      (scene) => {
        scene['gameOver'] = false;
        scene['combat'].deathScreen.reset();
      },
    ),
    menu(
      'level-complete',
      (scene) => scene['levelCompleteScreen'].activate('The Over City', null, noop),
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
            mongoLevel: null,
            totalKills: 0,
            bossesDefeated: 0,
            hirelingsHired: 0,
            hirelingsLost: 0,
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
      (scene) => scene['spiderQuest']['_startHacking'](),
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
      (scene) => {
        scene.cloggedBathroom['difficultyPickerOpen'] = true;
      },
      (scene) => scene.cloggedBathroom.cancelPipeBoardDifficulty(),
    ),
    menu(
      'pipe-board-difficulty-discard',
      (scene) => {
        const bathroom = scene.cloggedBathroom;
        const board = bathroom.generateBoardNow('easy');
        const firstTurnable = board.tiles.findIndex((tile) => !tile.decoy && !tile.bolted);
        bathroom.turnPipeTile(firstTurnable, 'clockwise');
        bathroom['difficultyPickerOpen'] = true;
        bathroom.choosePipeBoardDifficulty('hard');
      },
      (scene) => {
        const bathroom = scene.cloggedBathroom;
        bathroom.backToPipeBoardDifficulty();
        bathroom.cancelPipeBoardDifficulty();
        bathroom.restartPipeBoard();
      },
    ),
    menu(
      'prison-difficulty',
      (scene) => {
        const doors = scene['gameMap'].buildingEntries;
        if (doors.length === 0) throw new Error('the town has no door to stand the picker on');
        scene['pendingPrisonEntry'] = doors[0];
      },
      (scene) => {
        scene['pendingPrisonEntry'] = null;
      },
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
          () => ({ title: 'Audit', bark: 'Audit day.', options: [] }),
          () => ({ ok: false, line: 'Nothing for sale.' }),
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

section('the town (DungeonScene)');
{
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
  console.log(`  town ${arrival}: ${describeClaimants(arrivalOutcome.claimants)}`);
  for (let frame = 0; frame < MAX_ARRIVAL_FRAMES && street.ui.isOpen(arrival); frame++) {
    street.render(ctx);
    await new Promise((resolve) => setImmediate(resolve));
  }
  check(!street.ui.isOpen(arrival), "the town's arrival screen never finished");
  step(street);
  auditScene('town', street, townOpeners(), {
    [arrival]: 'audited above, while the town loads',
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
const { snapPlayer } = await import('../src/core/PlayerSnapshot.js');
const { teachBoth } = await import('../src/core/CraftSkills.js');
const { createMarketStock } = await import('../src/systems/market/MarketStock.js');
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
    createMarketStock(),
  );
  // The room's own loading screen, audited while it is up the way the town's
  // is: it is the one surface a player meets before any other in the room.
  room.render(ctx);
  if (room.ui.isOpen(ARRIVAL_SURFACE)) {
    const arrivalOutcome = auditFocus(room.ui, `${entry.name} ${ARRIVAL_SURFACE}`);
    failures.push(...arrivalOutcome.failures);
    console.log(
      `  ${entry.name} ${ARRIVAL_SURFACE}: ${describeClaimants(arrivalOutcome.claimants)}`,
    );
  }
  if (!(await settleArrival(room, ctx))) {
    throw new Error(`${entry.name}'s arrival screen never finished`);
  }
  return room;
}

function building(label: string, predicate: (entry: Entry) => boolean): Entry {
  const entry = town.buildingEntries.find(predicate);
  if (entry === undefined) throw new Error(`the town has no ${label}`);
  return entry;
}

/** What every room can raise, whatever the building. */
function roomOpeners(): Opener<Interior>[] {
  const menu = opener<Interior>;
  return [
    ...menusKitOpeners<Interior>((scene) => scene['menus']),
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
      entry: building('General Store', (entry) => entry.type === 'store'),
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
      entry: building('Herb & Remedy', (entry) => entry.name === 'Herb & Remedy'),
      openers: [
        menu(
          'priced-menu',
          (scene) => scene['openService'](0, null, 'merchant'),
          (scene) => scene['servicePanel']?.close(),
        ),
      ],
    },
    {
      label: "Old Hilda's Cottage",
      entry: building("Old Hilda's Cottage", (entry) => entry.name === "Old Hilda's Cottage"),
      openers: [
        menu(
          'fortune-teller',
          (scene) => scene['openService'](0, null, 'priest'),
          (scene) => scene['readingPanel']?.close(),
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
      label: 'Desperado Club',
      entry: building('Desperado Club', (entry) => entry.type === 'club'),
      openers: [
        menu('club', (scene) => club(scene)['openGreeting'](scene.pm.active()), closeClub),
        menu('club-bar-shop', (scene) => club(scene)['barShop'].open(), closeClub),
        menu('club-market-shop', (scene) => club(scene)['marketShop'].open(), closeClub),
        menu(
          'club-vip',
          (scene) => club(scene)['vip'].openPanel(club(scene).coinsWageredThisVisit),
          closeClub,
        ),
        menu('club-guild', (scene) => club(scene)['guild'].openPanel(), closeClub),
        menu(
          'club-guild-dismiss',
          (scene) => club(scene)['guild'].dismissConfirm.open(SAMPLE_CONFIRM),
          (scene) => club(scene)['guild'].dismissConfirm.close(),
        ),
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
            const index = board.findIndex((wedge) => wedge.prizeId === 'platinum_box_frost');
            wheelOf(scene).presentPrizeForReview(casinoSeat(scene), index);
          },
          closeWheel,
        ),
        // Never the real wipe: the review landing plays the Nothing with storage left alone.
        menu(
          'wheel-nothing',
          (scene) => wheelOf(scene).openNothingForReview(casinoSeat(scene)),
          closeWheel,
        ),
      ],
    },
  ];
}

const cases = interiorCases();
for (const { label, entry, openers } of cases) {
  section(`${label} (BuildingInteriorScene)`);
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
  auditScene(label, room, openers, elsewhere);
}

// ── Report ─────────────────────────────────────────────────────────────────

if (phonePass !== null) {
  const report: PhoneReport = { states: closeButtonStates, failures };
  console.log(`${PHONE_REPORT_MARKER}${JSON.stringify(report)}`);
  process.exit(0);
}

section('close buttons on phones, in the scenes');
for (const pass of await Promise.all(phoneScenePasses)) {
  const report = parsePhoneReport(pass.output);
  if (report === null) {
    const tail = pass.output.trimEnd().split('\n').slice(-PHONE_OUTPUT_TAIL_LINES).join('\n');
    console.error(tail);
    failures.push(`${pass.id}: the phone pass exited ${pass.status} without a report`);
    continue;
  }
  const passFailures = [...report.failures];
  const phoneStates = new Map(report.states.map((state) => [state.label, state]));
  for (const desktop of closeButtonStates) {
    const phone = phoneStates.get(desktop.label);
    if (phone === undefined) {
      passFailures.push(`${pass.id} ${desktop.label}: never reached on the phone`);
      continue;
    }
    passFailures.push(
      ...missingCloseButtons(
        `${pass.id} ${desktop.label}`,
        new Set(desktop.withClose),
        phone.open,
        new Set(phone.withClose),
      ),
    );
  }
  const openedOnPhone = new Set(report.states.flatMap((state) => state.open));
  for (const id of PHONE_REQUIRED_SURFACES) {
    if (!openedOnPhone.has(id))
      passFailures.push(`${pass.id}: "${id}" was never open on the phone`);
  }
  failures.push(...passFailures);
  const outcome = passFailures.length === 0 ? 'ok' : `${passFailures.length} failure(s)`;
  console.log(`  ${pass.id}: ${report.states.length} states, ${outcome}`);
}

if (failures.length > 0) {
  console.error(`\nverify:menus — ${failures.length} failure(s)\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log('\nverify:menus — every menu that takes the keyboard can be answered by it');
