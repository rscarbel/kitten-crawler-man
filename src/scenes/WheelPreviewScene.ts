/**
 * Localhost-only harness for reviewing Donald's Wheel of Fortune, reached via
 * `?wheel` in `devBootScene`. A real `ClubWheelSystem` on its own `UiRoot`,
 * letterboxed into a chosen viewport, with:
 *
 *  - the warning screens, from the top of the flow;
 *  - the wheel screen, with a bet stepper in the header that flips the board;
 *  - a forced-outcome picker covering every wedge face the wheel can show,
 *    applied to the next held spin, or landed straight away;
 *  - Permanent Death on a dry-run wipe that never touches storage, optionally
 *    slow to answer, so the "…" hold can be seen.
 *
 * Plays no audio and saves nothing.
 */

import { setViewportSize, viewportHeight, viewportWidth } from '../core/rendering/Viewport';
import { settings } from '../core/input/Settings';
import { TILE_SIZE } from '../core/constants';
import { createWheelLedger } from '../core/save/WheelLedger';
import type { WipeStatus } from '../core/save/progressPersistence';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { CatPlayer } from '../creatures/CatPlayer';
import type { CasinoSeat } from '../systems/ClubCasinoSystem';
import { ClubWheelSystem } from '../systems/ClubWheelSystem';
import {
  BASE_WHEEL_BOARD,
  WHEEL_UPGRADES,
  boardForBet,
  type WheelBoard,
  type WheelWedge,
} from '../systems/casino/wheel/wheelBoard';
import { contains, type Rect } from '../ui/core/geom';
import { PRIMARY_BUTTON } from '../ui/core/pointer';
import { UiRoot, type KeyModifiers, type WorldGesture } from '../ui/core/UiRoot';
import { NO_INSETS, type ViewportInput } from '../ui/core/viewport';
import type { Density } from '../ui/theme/tokens';
import { previewInk } from '../ui/theme/previewInk';
import type { ProgressWipe } from '../ui/screens/dialogs/wipeHold';
import { worldText } from '../ui/world/worldText';
import { PreviewScene, type PreviewControl } from './PreviewScene';

const BG_COLOR = previewInk.casino.backdrop;
const PANEL_COLOR = previewInk.casino.panel;
const SUBLABEL_COLOR = previewInk.casino.sublabel;

const MARGIN = 24;
const CONTENT_GAP = 16;
const CAPTION_ROOM = 18;
const CAPTION_GAP = 4;
const SMALL_LABEL_SIZE = 10;
const PERCENT = 100;
const HOVER_POINTER_ID = -1;

interface PreviewViewport {
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

const VIEWPORT_MATRIX: ReadonlyArray<PreviewViewport> = [
  { label: '390×844', width: 390, height: 844 },
  { label: '360×640', width: 360, height: 640 },
  { label: '844×390', width: 844, height: 390 },
  { label: '568×320', width: 568, height: 320 },
  { label: '1280×720', width: 1280, height: 720 },
  { label: '1440×900', width: 1440, height: 900 },
];
const DEFAULT_VIEWPORT_INDEX = 4;

/** Enough for every bet many times over, with change to rob. */
const DEV_PURSE = 250_000;
/** The dry-run save's round-trip, so the wheel's pause before it turns can be seen. */
const FAKE_SAVE_MS = 250;
/** A slow wipe answers "retrying" this long before it "succeeds", to show the hold. */
const SLOW_WIPE_RETRY_MS = 14_000;

/** "Draw" is the rigged wheel; every other entry forces one wedge face. */
const FORCED_FACES: ReadonlyArray<WheelWedge | null> = [
  null,
  ...BASE_WHEEL_BOARD.filter(
    (wedge, index, all) => all.findIndex((other) => other.label === wedge.label) === index,
  ),
  ...WHEEL_UPGRADES.map((upgrade) => upgrade.to),
];

function percent(share: number): string {
  return `${Math.round(share * PERCENT)}%`;
}

/** A wipe that never touches storage; when slow, it answers "retrying" for a while first. */
function previewWipe(clock: () => number, slow: () => boolean): ProgressWipe {
  let startedAt: number | null = null;
  return {
    wipe: () => {
      startedAt ??= clock();
      return Promise.resolve();
    },
    get wipeStatus(): WipeStatus {
      if (startedAt === null) return 'idle';
      const elapsed = clock() - startedAt;
      if (slow()) return elapsed >= SLOW_WIPE_RETRY_MS ? 'wiped' : 'retrying';
      return 'wiped';
    },
  };
}

export class WheelPreviewScene extends PreviewScene {
  private readonly human = new HumanPlayer(0, 0, TILE_SIZE);
  private readonly cat = new CatPlayer(1, 0, TILE_SIZE);
  private readonly seat: CasinoSeat = {
    active: () => this.human,
    companion: () => this.cat,
  };
  private viewportIndex = DEFAULT_VIEWPORT_INDEX;
  private density: Density = 'pointer';
  private forcedIndex = 0;
  private slowWipe = false;
  private wheel: ClubWheelSystem;
  private wheelUi: UiRoot;
  private box: { readonly x: number; readonly y: number; readonly scale: number } | null = null;
  private readonly forwardedPointers = new Set<number>();

  constructor() {
    super();
    this.wheel = this.buildWheel();
    this.wheelUi = this.buildWheelUi();
    this.wheel.openWheelForReview(this.seat);
    this.ui.addKeyHook((key, mods) => this.forwardKey(key, mods));
    // A held SPIN lets go on the key's release, which only the outer root hears.
    this.ui.mount({
      id: 'wheel-key-release',
      band: 'hud',
      haltsWorld: false,
      isOpen: () => true,
      render: () => undefined,
      onKeyUp: (key) => this.wheelUi.keyUp(key),
    });
  }

  onExit(): void {
    this.wheelUi.dispose();
  }

  private buildWheel(): ClubWheelSystem {
    this.human.coins = DEV_PURSE;
    const clock = (): number => performance.now();
    return new ClubWheelSystem({
      audio: null,
      audioScope: null,
      ledger: createWheelLedger(),
      saveNow: () =>
        new Promise((resolve) => {
          window.setTimeout(() => resolve('disabled'), FAKE_SAVE_MS);
        }),
      progressWipe: previewWipe(clock, () => this.slowWipe),
      afterPermanentDeath: () => this.reset(),
      grantAttackCow: () => undefined,
      clock,
      forcedOutcome: (board) => this.forcedOutcome(board),
    });
  }

  private buildWheelUi(): UiRoot {
    const wheelUi = new UiRoot({ audio: null, viewport: () => this.wheelViewportInput() });
    for (const surface of this.wheel.surfaces(this.seat)) wheelUi.mount(surface);
    return wheelUi;
  }

  private reset(): void {
    this.wheelUi.dispose();
    this.wheel = this.buildWheel();
    this.wheelUi = this.buildWheelUi();
    this.wheel.openWheelForReview(this.seat);
  }

  private forcedOutcome(board: WheelBoard): { wedgeIndex: number; wedge: WheelWedge } | null {
    const face = FORCED_FACES[this.forcedIndex];
    if (face === null) return null;
    const index = board.findIndex((wedge) => wedge.label === face.label);
    return index < 0 ? null : { wedgeIndex: index, wedge: board[index] };
  }

  private forcedLabel(): string {
    const face = FORCED_FACES[this.forcedIndex];
    return face === null ? 'Draw (rigged)' : face.shortLabel;
  }

  private wheelViewportInput(): ViewportInput {
    const viewport = VIEWPORT_MATRIX[this.viewportIndex];
    return {
      cssWidth: viewport.width,
      cssHeight: viewport.height,
      density: this.density,
      uiSize: settings.uiSize,
      safeArea: NO_INSETS,
    };
  }

  protected previewTitle(): string {
    return 'Wheel of Fortune — Cloak & Dagger review harness';
  }

  protected previewControls(): readonly PreviewControl[] {
    const viewport = VIEWPORT_MATRIX[this.viewportIndex];
    return [
      {
        id: 'viewport',
        label: viewport.label,
        onTap: () => {
          this.viewportIndex = (this.viewportIndex + 1) % VIEWPORT_MATRIX.length;
        },
      },
      {
        id: 'density',
        label: this.density === 'touch' ? 'Touch' : 'Pointer',
        onTap: () => {
          this.density = this.density === 'touch' ? 'pointer' : 'touch';
          this.wheelUi.dispose();
          this.wheelUi = this.buildWheelUi();
        },
      },
      {
        label: 'Warnings',
        onTap: () => {
          this.reset();
          this.wheel.openPromptForReview(this.seat, 'warning');
        },
      },
      { label: 'Wheel', onTap: () => this.reset() },
      { label: 'Bet −', onTap: () => this.wheel.betDownForReview() },
      { label: 'Bet +', onTap: () => this.wheel.betUpForReview() },
      {
        label: '◀',
        id: 'outcome-prev',
        onTap: () => {
          this.forcedIndex = (this.forcedIndex + FORCED_FACES.length - 1) % FORCED_FACES.length;
        },
      },
      { id: 'outcome', label: `Next: ${this.forcedLabel()}`, onTap: () => undefined },
      {
        label: '▶',
        id: 'outcome-next',
        onTap: () => {
          this.forcedIndex = (this.forcedIndex + 1) % FORCED_FACES.length;
        },
      },
      { label: 'Land now', onTap: () => this.landNow() },
      {
        id: 'slow-wipe',
        label: this.slowWipe ? 'Wipe: slow' : 'Wipe: quick',
        selected: this.slowWipe,
        onTap: () => {
          this.slowWipe = !this.slowWipe;
        },
      },
    ];
  }

  protected previewCaptions(): readonly string[] {
    return [
      `screen ${this.wheel.currentScreen} · ${this.wheel.phaseKind}`,
      `bet ${this.wheel.currentBet.toLocaleString()}`,
    ];
  }

  /** Lands on the forced face at once when the current board shows it; else on the first wedge. */
  private landNow(): void {
    if (this.wheel.busy) return;
    const forced = this.forcedOutcome(boardForBet(this.wheel.currentBet));
    this.wheel.landForReview(this.seat, forced?.wedgeIndex ?? 0);
  }

  private forwardKey(key: string, mods: KeyModifiers): boolean {
    return this.wheelUi.key(key, mods) === 'consumed';
  }

  protected handlePreviewWorldPointer(gesture: WorldGesture): void {
    const box = this.box;
    if (box === null) return;
    const viewport = VIEWPORT_MATRIX[this.viewportIndex];
    const cssX = (gesture.cssX - box.x) / box.scale;
    const cssY = (gesture.cssY - box.y) / box.scale;
    const inside = contains({ x: 0, y: 0, w: viewport.width, h: viewport.height }, cssX, cssY);
    const pointerId = gesture.pointerId;
    if (gesture.kind === 'down') {
      if (!inside) return;
      this.forwardedPointers.add(pointerId);
    } else if (gesture.kind === 'wheel') {
      if (!inside) return;
    } else if (!this.forwardedPointers.has(pointerId)) {
      return;
    }
    if (gesture.kind === 'up' || gesture.kind === 'cancel')
      this.forwardedPointers.delete(pointerId);
    const scale = this.wheelUi.uiScale;
    this.wheelUi.pointer({ ...gesture, x: cssX / scale, y: cssY / scale, cssX, cssY });
  }

  private feedHover(): void {
    const mouse = this.ui.mouse;
    const box = this.box;
    if (mouse === null || box === null || mouse.down) {
      if (mouse === null) this.wheelUi.pointerLeft();
      return;
    }
    const viewport = VIEWPORT_MATRIX[this.viewportIndex];
    const outer = this.ui.uiScale;
    const cssX = (mouse.x * outer - box.x) / box.scale;
    const cssY = (mouse.y * outer - box.y) / box.scale;
    if (!contains({ x: 0, y: 0, w: viewport.width, h: viewport.height }, cssX, cssY)) {
      this.wheelUi.pointerLeft();
      return;
    }
    const scale = this.wheelUi.uiScale;
    this.wheelUi.pointer({
      kind: 'move',
      pointerId: HOVER_POINTER_ID,
      source: 'mouse',
      x: cssX / scale,
      y: cssY / scale,
      cssX,
      cssY,
      button: PRIMARY_BUTTON,
      deltaY: 0,
    });
  }

  update(): void {
    this.feedHover();
    if (this.human.coins < DEV_PURSE) this.human.coins = DEV_PURSE;
    this.wheel.update();
    if (!this.wheel.anySurfaceOpen) this.reset();
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    const height = viewportHeight();
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);
    const viewport = VIEWPORT_MATRIX[this.viewportIndex];
    const top = this.headerBottom + CONTENT_GAP;
    const room: Rect = {
      x: MARGIN,
      y: top,
      w: Math.max(1, width - MARGIN * 2),
      h: Math.max(1, height - top - MARGIN - CAPTION_ROOM),
    };
    const scale = Math.min(1, room.w / viewport.width, room.h / viewport.height);
    const box = { x: room.x, y: room.y, scale };
    this.box = box;
    ctx.save();
    ctx.translate(box.x, box.y);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.rect(0, 0, viewport.width, viewport.height);
    ctx.clip();
    ctx.fillStyle = PANEL_COLOR;
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    // The wheel reads the viewport globals, so the simulated size is installed only for its frame.
    setViewportSize(viewport.width, viewport.height);
    this.wheelUi.frame(ctx);
    setViewportSize(width, height);
    ctx.restore();
    const shownAt = scale < 1 ? ` shown at ${percent(scale)}` : '';
    worldText(ctx, `${viewport.label}${shownAt} · ${this.density} · hold SPIN inside to play`, {
      x: box.x,
      y: box.y + viewport.height * scale + CAPTION_GAP,
      width: room.w,
      size: SMALL_LABEL_SIZE,
      color: SUBLABEL_COLOR,
    });
    this.renderChrome(ctx);
  }
}
