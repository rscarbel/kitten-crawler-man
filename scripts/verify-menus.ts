#!/usr/bin/env tsx
/**
 * Every menu that takes the keyboard away from play can be answered by the
 * keyboard alone. The rule itself lives in `menuFocusAudit`; this script
 * stands up the places menus open and runs it against each one:
 *
 *  - a deliberately ringless halting surface, which the audit must flag, so
 *    an audit that has stopped seeing the bug fails instead of passing;
 *  - every UI-gallery sheet and fixture, before and after its scripted input;
 *  - the real `DungeonScene` (the town) and `BuildingInteriorScene`, headless,
 *    with each surface they mount opened in turn through the game's own
 *    openers and settled until its entrance has played.
 *
 * Every panel, modal and system surface a scene mounts must be opened by this
 * script unless both of its keyboard claims are fixed `false` or another case
 * audits it (a room's common menus, opened once in the General Store), so a
 * menu added to a scene without an opener here fails the gate instead of
 * escaping it.
 *
 * Run: npm run verify:menus
 */

import type { Surface } from '../src/ui/core/UiRoot.js';
import type { FocusClaimant } from './menuFocusAudit.js';
import type { MenusKit } from '../src/systems/kits/MenusKit.js';

export {};

// Before any game module loads: the platform is decided once, at import.
Object.defineProperty(globalThis, 'navigator', {
  value: { maxTouchPoints: 0, userAgent: 'Desktop' },
  configurable: true,
});

const DESKTOP = { width: 1280, height: 800, devicePixelRatio: 1 } as const;
const { installBrowserShim } = await import('./browserShim.js');
installBrowserShim(DESKTOP);
const WORLD_SEED = 7;
const { mulberry32 } = await import('../src/sprites/person/rng.js');
Math.random = mulberry32(WORLD_SEED);

const { auditFocus, claimsKeyboard, mountedSurfaces, neverClaimsKeyboard } =
  await import('./menuFocusAudit.js');
const { gameContext } = await import('./nodeGameContext.js');
const { loadSprites } = await import('../src/core/SpriteLoader.js');
const { setViewportSize } = await import('../src/core/Viewport.js');
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

await loadSprites('src/images/');
setViewportSize(DESKTOP.width, DESKTOP.height);
const ctx = gameContext(DESKTOP.width, DESKTOP.height);

/** A bare root at the desktop viewport with its own clock, for surfaces mounted outside any scene. */
function bareRoot(): { readonly root: Root; frame(): void; settle(): void } {
  let clock = 0;
  const root = new UiRoot({
    audio: null,
    viewport: () => ({
      cssWidth: DESKTOP.width,
      cssHeight: DESKTOP.height,
      density: 'pointer',
      uiSize: 'medium',
      safeArea: NO_INSETS,
    }),
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

function galleryRig(sheet: GallerySheet, fixture: string | null) {
  const bare = bareRoot();
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
    const outcome = auditFocus(scene.ui, stateLabel);
    failures.push(...outcome.failures);
    console.log(`  ${stateLabel}: ${describeClaimants(outcome.claimants)}${settledNote}`);
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
      (scene) => services(scene).picker.open(SAMPLE_QUANTITY),
      (scene) => services(scene).picker.close(),
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
  const arrival = 'arrival-loading';
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

function enter(entry: Entry): Interior {
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(1, 0, TILE_SIZE);
  human.isActive = true;
  teachBoth(human, cat, 'construction');
  return new BuildingInteriorScene(
    entry,
    snapPlayer(human),
    snapPlayer(cat),
    level3.xpDiminishingTiers,
    new InputManager(),
    new SceneManager(),
    noop,
    createMarketStock(),
  );
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
      ],
    },
  ];
}

const cases = interiorCases();
for (const { label, entry, openers } of cases) {
  section(`${label} (BuildingInteriorScene)`);
  const room = enter(entry);
  step(room);
  const auditedHere = new Set(openers.map((candidate) => candidate.surfaceId));
  const elsewhere: Record<string, string> = {};
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

if (failures.length > 0) {
  console.error(`\nverify:menus — ${failures.length} failure(s)\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log('\nverify:menus — every menu that takes the keyboard can be answered by it');
