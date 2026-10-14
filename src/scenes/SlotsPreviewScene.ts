/**
 * Localhost-only harness for reviewing the Desperado slot machine, reached via
 * `?slots` in `devBootScene`. Ships no behaviour to players, and plays no sound.
 *
 * Four tabs:
 *  - **Machine** — a real `ClubSlotsSystem` on the real clock and its own
 *    `UiRoot`, letterboxed into a chosen viewport and playable by mouse and
 *    keys, with a button per forced outcome.
 *  - **Symbols** — every symbol painted large beside its sharp and blur reel
 *    bakes, with what a run of 3, 4 and 5 pays.
 *  - **Layouts** — the phone portrait, phone landscape and desktop cabinets
 *    side by side, each a separate machine staged to the chosen moment.
 *  - **Sim** — a seeded headless run of paid spins at the current bet: RTP,
 *    hit frequency, free spins, jackpots and win tiers. A report, never a gate.
 */

import { setViewportSize, viewportHeight, viewportWidth } from '../core/Viewport';
import { settings } from '../core/Settings';
import { TILE_SIZE } from '../core/constants';
import { createClubMembership } from '../core/ClubMembership';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { CatPlayer } from '../creatures/CatPlayer';
import {
  SLOTS_STAGES,
  openStagedSlots,
  stageSlots,
  type SlotsStage,
  type StagedSlots,
} from '../dev/slotsStaging';
import type { CasinoSeat } from '../systems/ClubCasinoSystem';
import { ClubSlotsSystem } from '../systems/ClubSlotsSystem';
import { FORCED_OUTCOMES, type ForcedOutcome } from '../systems/casino/slots/forcedOutcomes';
import { SlotMachine } from '../systems/casino/slots/SlotMachine';
import { listAt } from '../systems/casino/poker/npc/listAt';
import {
  JACKPOT_FLOOR,
  MAX_BET_PER_LINE,
  jackpotPayableCoins,
  totalBetFor,
  type BetPerLine,
  type WinTier,
} from '../systems/casino/slots/slotBets';
import {
  FREE_SPINS_PER_TRIGGER,
  LINE_PAYS,
  SCATTER_TRIGGER_COUNT,
  SLOT_SYMBOLS,
  isPayingSymbol,
  scatterPayFor,
  type SlotSymbol,
} from '../systems/casino/slots/slotSymbols';
import { bakedSymbol, paintSlotSymbol } from '../ui/casino/slots/slotSymbols';
import { contains, inset, type Rect } from '../ui/core/geom';
import { PRIMARY_BUTTON } from '../ui/core/pointer';
import {
  UiRoot,
  type KeyModifiers,
  type Surface,
  type Ui,
  type WorldGesture,
} from '../ui/core/UiRoot';
import { NO_INSETS, type ViewportInput } from '../ui/core/viewport';
import type { Density } from '../ui/theme/tokens';
import type { TextRole } from '../ui/theme/skins';
import { previewInk } from '../ui/theme/previewInk';
import { worldText } from '../ui/world/worldText';
import { scrollView } from '../ui/widgets/scrollView';
import { lineHeightOf, measureTextHeight, text } from '../ui/widgets/text';
import { PreviewScene, type PreviewControl } from './PreviewScene';

const BG_COLOR = previewInk.casino.backdrop;
const PANEL_COLOR = previewInk.casino.panel;
const SUBLABEL_COLOR = previewInk.casino.sublabel;

const MARGIN = 24;
const SMALL_LABEL_SIZE = 10;
/** Gap between the header and the tab's content, in canvas pixels. */
const CONTENT_GAP = 16;
/** Room under each letterboxed machine for its caption line. */
const MACHINE_CAPTION_ROOM = 18;
const CAPTION_GAP = 4;
/** Space between the side-by-side machines on the Layouts tab. */
const LAYOUT_GAP = 16;

const TABS = ['Machine', 'Symbols', 'Layouts', 'Sim'] as const;
type PreviewTab = (typeof TABS)[number];

const BODY_SURFACE_ID = 'slots-preview-body';
const MACHINE_SURFACE_ID = 'slots-preview-machine';
const RULES_SURFACE_ID = 'slots-preview-rules';

const PERCENT = 100;
const PERCENT_DECIMALS = 2;
const RATIO_DECIMALS = 1;

/** The reels' seed for the live machine; the staged ones use the staging seed. */
const MACHINE_SEED = 0x5107;
/** Deep enough for a long session at the top bet. */
const FUND_BANKROLL = 50000;

// ── Viewports ──────────────────────────────────────────────────────────────

interface PreviewViewport {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly density: Density;
}

const PHONE_PORTRAIT: PreviewViewport = {
  label: '390×844',
  width: 390,
  height: 844,
  density: 'touch',
};
const PHONE_LANDSCAPE: PreviewViewport = {
  label: '844×390',
  width: 844,
  height: 390,
  density: 'touch',
};
const DESKTOP: PreviewViewport = {
  label: '1440×900',
  width: 1440,
  height: 900,
  density: 'pointer',
};

const VIEWPORT_MATRIX: ReadonlyArray<PreviewViewport> = [
  { label: '360×640', width: 360, height: 640, density: 'touch' },
  PHONE_PORTRAIT,
  { label: '568×320', width: 568, height: 320, density: 'touch' },
  PHONE_LANDSCAPE,
  { label: '768×1024', width: 768, height: 1024, density: 'touch' },
  { label: '1280×720', width: 1280, height: 720, density: 'pointer' },
  DESKTOP,
];
const DEFAULT_VIEWPORT_INDEX = Math.max(0, VIEWPORT_MATRIX.indexOf(DESKTOP));

/** The three shapes the cabinet lays out differently for. */
const LAYOUT_VIEWPORTS: ReadonlyArray<PreviewViewport> = [PHONE_PORTRAIT, PHONE_LANDSCAPE, DESKTOP];

/** A pointer id the hover feed uses, apart from every real gesture's. */
const HOVER_POINTER_ID = -1;

// ── Symbols tab ────────────────────────────────────────────────────────────

/** The symbol painted large, in UI units. */
const SYMBOL_LARGE = 120;
/** A reel cell when no machine has been drawn yet to measure one from, in UI units. */
const FALLBACK_CELL_W = 110;
const FALLBACK_CELL_H = 88;
const FOUR_OF_A_KIND = 4;
const FIVE_OF_A_KIND = 5;
const RUN_LENGTHS = [SCATTER_TRIGGER_COUNT, FOUR_OF_A_KIND, FIVE_OF_A_KIND] as const;

// ── Sim tab ────────────────────────────────────────────────────────────────

const SIM_SPINS = 10_000;
/** Paid spins per scene update, so the page keeps drawing while the run goes. */
const SIM_SPINS_PER_UPDATE = 400;
const SIM_SEED = 0x51075;
const REPORTED_TIERS = ['big', 'mega', 'epic', 'jackpot'] as const;

interface SimRun {
  readonly machine: SlotMachine;
  readonly betPerLine: BetPerLine;
  pool: number;
  spins: number;
  wagered: number;
  baseWins: number;
  featureWins: number;
  jackpotPaid: number;
  jackpots: number;
  hits: number;
  triggers: number;
  freeSpinsPlayed: number;
  biggestWin: number;
  readonly tiers: Record<WinTier, number>;
}

function newSimRun(betPerLine: BetPerLine): SimRun {
  return {
    machine: new SlotMachine({ seed: SIM_SEED }),
    betPerLine,
    pool: JACKPOT_FLOOR,
    spins: 0,
    wagered: 0,
    baseWins: 0,
    featureWins: 0,
    jackpotPaid: 0,
    jackpots: 0,
    hits: 0,
    triggers: 0,
    freeSpinsPlayed: 0,
    biggestWin: 0,
    tiers: { none: 0, big: 0, mega: 0, epic: 0, jackpot: 0 },
  };
}

/** One paid spin and every free spin it triggers, settled at once. */
function simulateSpin(run: SimRun): void {
  const { machine } = run;
  const start = machine.spin({ betPerLine: run.betPerLine, jackpotPool: run.pool });
  if (start.kind === 'refused') return;
  run.spins++;
  run.pool = start.jackpotPool;
  run.wagered += start.charged;
  const { outcome } = start;
  run.baseWins += outcome.totalWin - outcome.jackpot.amount;
  run.jackpotPaid += outcome.jackpot.amount;
  if (outcome.jackpot.won) run.jackpots++;
  if (outcome.totalWin > 0) run.hits++;
  if (outcome.scatter.freeSpinsAwarded > 0) run.triggers++;
  run.tiers[outcome.tier]++;
  run.biggestWin = Math.max(run.biggestWin, outcome.totalWin);
  run.pool = machine.settleNow() ?? run.pool;
  machine.drainEvents();
  while (machine.freeSpins !== null) {
    const free = machine.spin({ betPerLine: run.betPerLine, jackpotPool: run.pool });
    if (free.kind === 'refused') break;
    run.freeSpinsPlayed++;
    run.pool = free.jackpotPool;
    run.featureWins += free.outcome.totalWin - free.outcome.jackpot.amount;
    run.jackpotPaid += free.outcome.jackpot.amount;
    if (free.outcome.jackpot.won) run.jackpots++;
    run.biggestWin = Math.max(run.biggestWin, free.outcome.totalWin);
    run.pool = machine.settleNow() ?? run.pool;
    machine.drainEvents();
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function words(id: string): string {
  return id.split(/[_-]/).join(' ');
}

function percentOf(part: number, whole: number): string {
  return `${((part / Math.max(1, whole)) * PERCENT).toFixed(PERCENT_DECIMALS)}%`;
}

function oneIn(count: number, spins: number): string {
  return count === 0 ? 'never' : `1 in ${(spins / count).toFixed(RATIO_DECIMALS)}`;
}

function viewportInputFor(viewport: PreviewViewport, density: Density): ViewportInput {
  return {
    cssWidth: viewport.width,
    cssHeight: viewport.height,
    density,
    uiSize: settings.uiSize,
    safeArea: NO_INSETS,
  };
}

/** The canvas's device pixels per unit of the current transform, so a bake is shown at the size the reels bake it. */
function pixelScale(ctx: CanvasRenderingContext2D): number {
  const transform = ctx.getTransform();
  return Math.max(1, Math.hypot(transform.a, transform.b));
}

function symbolPays(symbol: SlotSymbol): string {
  if (symbol === 'scatter') {
    const pays = RUN_LENGTHS.map((count) => `${count}× ${scatterPayFor(count)}× bet`).join(' · ');
    return `${pays} · ${FREE_SPINS_PER_TRIGGER} free spins from ${SCATTER_TRIGGER_COUNT}`;
  }
  const pay = LINE_PAYS[isPayingSymbol(symbol) ? symbol : 'wild'];
  return `3× ${pay.three} · 4× ${pay.four} · 5× ${pay.five} per coin on the line`;
}

interface LetterBox {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

interface StagedLayout {
  readonly viewport: PreviewViewport;
  readonly staged: StagedSlots;
  readonly ui: UiRoot;
}

// ── Scene ──────────────────────────────────────────────────────────────────

export class SlotsPreviewScene extends PreviewScene {
  private tab: PreviewTab = 'Machine';

  private viewportIndex = DEFAULT_VIEWPORT_INDEX;
  private density: Density = VIEWPORT_MATRIX[DEFAULT_VIEWPORT_INDEX].density;
  private readonly player = new HumanPlayer(0, 0, TILE_SIZE);
  private readonly companion = new CatPlayer(1, 0, TILE_SIZE);
  private readonly seat: CasinoSeat = {
    active: () => this.player,
    companion: () => this.companion,
  };
  private readonly host = new ClubSlotsSystem(
    null,
    null,
    createClubMembership(),
    () => performance.now(),
    {
      seed: MACHINE_SEED,
    },
  );
  private readonly machineUi: UiRoot;
  /** Where the letterboxed machine was last drawn, in canvas CSS pixels. */
  private machineBox: LetterBox | null = null;
  /** Gestures that went down on the machine, so the rest of each reaches it too. */
  private readonly forwardedPointers = new Set<number>();
  private lastForced: string | null = null;

  private stageIndex = 0;
  private stagedLayouts: StagedLayout[] = [];
  private stageError: string | null = null;

  private simRun: SimRun | null = null;

  constructor() {
    super();
    this.player.coins = FUND_BANKROLL;
    this.machineUi = new UiRoot({
      audio: null,
      viewport: () => viewportInputFor(VIEWPORT_MATRIX[this.viewportIndex], this.density),
    });
    this.machineUi.mount(this.host.machineSurface(MACHINE_SURFACE_ID, this.seat));
    this.machineUi.mount(this.host.rulesSurface(RULES_SURFACE_ID));
    this.host.open(this.seat);
    this.ui.mount(this.bodySurface());
    this.ui.addKeyHook((key, mods) => this.forwardKey(key, mods));
  }

  onExit(): void {
    this.host.forceClose();
    this.machineUi.dispose();
    this.disposeStagedLayouts();
  }

  protected previewTitle(): string {
    return 'Slots — Desperado Club review harness';
  }

  protected previewControls(): readonly PreviewControl[] {
    const tabs: PreviewControl[] = TABS.map((tab) => ({
      label: tab,
      selected: tab === this.tab,
      onTap: () => {
        this.tab = tab;
      },
    }));
    switch (this.tab) {
      case 'Machine':
        return [...tabs, ...this.machineControls()];
      case 'Layouts':
        return [...tabs, ...this.stageControls()];
      case 'Sim':
        return [
          ...tabs,
          {
            id: 'run-sim',
            label: `Run ${SIM_SPINS.toLocaleString()} spins`,
            onTap: () => {
              this.simRun = newSimRun(this.host.betPerLine);
            },
          },
        ];
      case 'Symbols':
        return tabs;
    }
  }

  protected previewCaptions(): readonly string[] {
    switch (this.tab) {
      case 'Machine': {
        const machine = this.host.machine;
        const free = machine.freeSpins;
        const feature = free === null ? '' : ` · ${free.remaining} free spins left`;
        return [
          `jackpot pool ${jackpotPayableCoins(this.host.jackpotPool).toLocaleString()}`,
          `phase ${words(machine.phase)}${feature}`,
          `session profit ${this.host.sessionProfit.toLocaleString()}`,
          `wagered ${machine.totalWagered.toLocaleString()} · paid ${machine.totalPaid.toLocaleString()}`,
          `coins ${this.player.coins.toLocaleString()}${this.lastForced === null ? '' : ` · ${this.lastForced}`}`,
        ];
      }
      case 'Layouts':
        return this.stageError === null
          ? [`stage ${SLOTS_STAGES[this.stageIndex]}`]
          : [`stage ${SLOTS_STAGES[this.stageIndex]} failed: ${this.stageError}`];
      case 'Sim': {
        const run = this.simRun;
        if (run === null) return [`bet ${this.host.betPerLine}/line · seed ${SIM_SEED}`];
        return [`bet ${run.betPerLine}/line · seed ${SIM_SEED}`, `${run.spins} of ${SIM_SPINS}`];
      }
      case 'Symbols':
        return [];
    }
  }

  private machineControls(): PreviewControl[] {
    const forced: PreviewControl[] = FORCED_OUTCOMES.map((kind) => ({
      id: `force-${kind}`,
      label: `Force: ${words(kind)}`,
      onTap: () => {
        this.force(kind);
      },
    }));
    const viewports: PreviewControl[] = VIEWPORT_MATRIX.map((viewport, index) => ({
      id: `viewport-${viewport.label}`,
      label: viewport.label,
      selected: index === this.viewportIndex,
      onTap: () => {
        this.viewportIndex = index;
        this.density = viewport.density;
      },
    }));
    return [
      ...forced,
      ...viewports,
      {
        id: 'density',
        label: this.density === 'touch' ? 'Touch' : 'Pointer',
        onTap: () => {
          this.density = this.density === 'touch' ? 'pointer' : 'touch';
        },
      },
      {
        id: 'turbo',
        label: this.host.turbo ? 'Turbo on' : 'Turbo off',
        selected: this.host.turbo,
        onTap: () => {
          this.host.toggleTurbo();
        },
      },
      {
        id: 'fund',
        label: 'Fund',
        onTap: () => {
          this.player.coins = FUND_BANKROLL;
        },
      },
    ];
  }

  private stageControls(): PreviewControl[] {
    return [
      {
        id: 'stage-next',
        label: `Stage: ${words(SLOTS_STAGES[this.stageIndex])}`,
        onTap: () => {
          this.stageIndex = (this.stageIndex + 1) % SLOTS_STAGES.length;
          this.rebuildStagedLayouts();
        },
      },
      {
        id: 'stage-again',
        label: 'Restage',
        onTap: () => {
          this.rebuildStagedLayouts();
        },
      },
    ];
  }

  // ── Machine ────────────────────────────────────────────────────────────

  /** The jackpot is only winnable at the top bet, so forcing one raises the bet first. */
  private force(kind: ForcedOutcome): void {
    if (kind === 'jackpot') this.host.betPerLine = MAX_BET_PER_LINE;
    if (this.player.coins < totalBetFor(this.host.betPerLine)) this.player.coins = FUND_BANKROLL;
    if (!this.host.forceNext(kind)) {
      this.lastForced = `could not force ${words(kind)}`;
      return;
    }
    this.lastForced = this.host.spin()
      ? `forced ${words(kind)}`
      : `${words(kind)} queued for the next spin`;
  }

  private forwardKey(key: string, mods: KeyModifiers): boolean {
    if (this.tab !== 'Machine') return false;
    return this.machineUi.key(key, mods) === 'consumed';
  }

  private machineCss(box: LetterBox, cssX: number, cssY: number): { x: number; y: number } {
    return { x: (cssX - box.x) / box.scale, y: (cssY - box.y) / box.scale };
  }

  /** Presses that land on the letterboxed machine go to its own `UiRoot`, mapped into its viewport. */
  protected handlePreviewWorldPointer(gesture: WorldGesture): void {
    if (this.tab !== 'Machine') return;
    const box = this.machineBox;
    if (box === null) return;
    const viewport = VIEWPORT_MATRIX[this.viewportIndex];
    const local = this.machineCss(box, gesture.cssX, gesture.cssY);
    const inside = contains(
      { x: 0, y: 0, w: viewport.width, h: viewport.height },
      local.x,
      local.y,
    );
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
    const scale = this.machineUi.uiScale;
    this.machineUi.pointer({
      ...gesture,
      x: local.x / scale,
      y: local.y / scale,
      cssX: local.x,
      cssY: local.y,
    });
  }

  /** Feeds the resting mouse to the machine so its controls show hover, which a world handler never sees. */
  private feedMachineHover(): void {
    const mouse = this.ui.mouse;
    const box = this.machineBox;
    if (mouse === null || box === null) {
      this.machineUi.pointerLeft();
      return;
    }
    if (mouse.down) return;
    const viewport = VIEWPORT_MATRIX[this.viewportIndex];
    const outerScale = this.ui.uiScale;
    const local = this.machineCss(box, mouse.x * outerScale, mouse.y * outerScale);
    if (!contains({ x: 0, y: 0, w: viewport.width, h: viewport.height }, local.x, local.y)) {
      this.machineUi.pointerLeft();
      return;
    }
    const scale = this.machineUi.uiScale;
    this.machineUi.pointer({
      kind: 'move',
      pointerId: HOVER_POINTER_ID,
      source: 'mouse',
      x: local.x / scale,
      y: local.y / scale,
      cssX: local.x,
      cssY: local.y,
      button: PRIMARY_BUTTON,
      deltaY: 0,
    });
  }

  // ── Layouts ────────────────────────────────────────────────────────────

  private disposeStagedLayouts(): void {
    for (const layout of this.stagedLayouts) {
      layout.staged.host.forceClose();
      layout.ui.dispose();
    }
    this.stagedLayouts = [];
  }

  private rebuildStagedLayouts(): void {
    this.disposeStagedLayouts();
    this.stageError = null;
    const stage: SlotsStage = SLOTS_STAGES[this.stageIndex];
    for (const viewport of LAYOUT_VIEWPORTS) {
      const staged = openStagedSlots(null);
      try {
        stageSlots(staged, stage);
      } catch (error) {
        this.stageError = error instanceof Error ? error.message : String(error);
      }
      const ui = new UiRoot({
        audio: null,
        viewport: () => viewportInputFor(viewport, viewport.density),
      });
      ui.mount(staged.host.machineSurface(MACHINE_SURFACE_ID, staged.seat));
      ui.mount(staged.host.rulesSurface(RULES_SURFACE_ID));
      this.stagedLayouts.push({ viewport, staged, ui });
    }
  }

  // ── Sim ────────────────────────────────────────────────────────────────

  private advanceSim(): void {
    const run = this.simRun;
    if (run === null) return;
    const target = Math.min(SIM_SPINS, run.spins + SIM_SPINS_PER_UPDATE);
    while (run.spins < target) simulateSpin(run);
  }

  // ── Frame ──────────────────────────────────────────────────────────────

  update(): void {
    this.advanceSim();
    if (this.tab === 'Layouts' && this.stagedLayouts.length === 0) this.rebuildStagedLayouts();
    if (this.tab !== 'Machine') return;
    this.feedMachineHover();
    if (!this.host.anySurfaceOpen) this.host.open(this.seat);
    this.host.update();
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    const height = viewportHeight();
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);
    this.machineBox = null;
    if (this.tab === 'Machine') this.renderMachineTab(ctx, width, height);
    if (this.tab === 'Layouts') this.renderLayoutsTab(ctx, width, height);
    this.renderChrome(ctx);
  }

  /** The machine reads the viewport globals, so the simulated size is installed only for its frame. */
  private paintLetterboxed(
    ctx: CanvasRenderingContext2D,
    ui: UiRoot,
    viewport: PreviewViewport,
    box: LetterBox,
    screen: { readonly width: number; readonly height: number },
  ): void {
    ctx.save();
    ctx.translate(box.x, box.y);
    ctx.scale(box.scale, box.scale);
    ctx.beginPath();
    ctx.rect(0, 0, viewport.width, viewport.height);
    ctx.clip();
    ctx.fillStyle = PANEL_COLOR;
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    setViewportSize(viewport.width, viewport.height);
    ui.frame(ctx);
    setViewportSize(screen.width, screen.height);
    ctx.restore();
  }

  private renderMachineTab(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const viewport = VIEWPORT_MATRIX[this.viewportIndex];
    const top = this.headerBottom + CONTENT_GAP;
    const room: Rect = {
      x: MARGIN,
      y: top,
      w: Math.max(1, width - MARGIN * 2),
      h: Math.max(1, height - top - MARGIN - MACHINE_CAPTION_ROOM),
    };
    const scale = Math.min(1, room.w / viewport.width, room.h / viewport.height);
    const box: LetterBox = { x: room.x, y: room.y, scale };
    this.machineBox = box;
    this.paintLetterboxed(ctx, this.machineUi, viewport, box, { width, height });

    const shownAt = scale < 1 ? ` shown at ${Math.round(scale * PERCENT)}%` : '';
    worldText(
      ctx,
      `${viewport.label}${shownAt} · ${this.density} · bet ${this.host.betPerLine}/line · play by tapping inside, or Space`,
      {
        x: box.x,
        y: box.y + viewport.height * scale + CAPTION_GAP,
        width: room.w,
        size: SMALL_LABEL_SIZE,
        color: SUBLABEL_COLOR,
      },
    );
  }

  private renderLayoutsTab(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const top = this.headerBottom + CONTENT_GAP;
    const roomW = Math.max(1, width - MARGIN * 2);
    const roomH = Math.max(1, height - top - MARGIN - MACHINE_CAPTION_ROOM);
    const gaps = LAYOUT_GAP * (this.stagedLayouts.length - 1);
    const totalWidth = this.stagedLayouts.reduce((sum, layout) => sum + layout.viewport.width, 0);
    const tallest = Math.max(1, ...this.stagedLayouts.map((layout) => layout.viewport.height));
    const scale = Math.min(1, Math.max(0, roomW - gaps) / Math.max(1, totalWidth), roomH / tallest);
    let x = MARGIN;
    for (const layout of this.stagedLayouts) {
      const box: LetterBox = { x, y: top, scale };
      this.paintLetterboxed(ctx, layout.ui, layout.viewport, box, { width, height });
      worldText(ctx, `${layout.viewport.label} · ${layout.viewport.density}`, {
        x,
        y: top + layout.viewport.height * scale + CAPTION_GAP,
        width: Math.max(1, layout.viewport.width * scale),
        size: SMALL_LABEL_SIZE,
        color: SUBLABEL_COLOR,
      });
      x += layout.viewport.width * scale + LAYOUT_GAP;
    }
  }

  // ── Body surface: the Symbols and Sim tabs ─────────────────────────────

  private bodySurface(): Surface {
    return {
      id: BODY_SURFACE_ID,
      band: 'hud',
      haltsWorld: false,
      isOpen: () => this.tab === 'Symbols' || this.tab === 'Sim',
      render: (ui) => {
        this.renderBody(ui);
      },
    };
  }

  private renderBody(ui: Ui): void {
    const { space } = ui.theme;
    const top = this.headerBottom / ui.uiScale + space.md;
    const outer = inset(ui.viewport, space.md);
    const area: Rect = { x: outer.x, y: top, w: outer.w, h: Math.max(0, outer.y + outer.h - top) };
    if (this.tab === 'Symbols') this.renderSymbols(ui, area);
    if (this.tab === 'Sim') this.renderSim(ui, area);
  }

  private reelCell(): { readonly w: number; readonly h: number } {
    const layout = this.host.layout;
    const reel = layout === null ? undefined : listAt(layout.reels, 0);
    if (layout === null || reel === undefined) return { w: FALLBACK_CELL_W, h: FALLBACK_CELL_H };
    return { w: reel.w, h: layout.cellH };
  }

  private renderSymbols(ui: Ui, area: Rect): void {
    const { space } = ui.theme;
    const label = lineHeightOf(ui, 'label');
    const caption = lineHeightOf(ui, 'caption');
    const cell = this.reelCell();
    const artHeight = Math.max(SYMBOL_LARGE, cell.h);
    const rowHeight = label + caption * 2 + space.xs + artHeight + space.lg;
    const pxW = cell.w * pixelScale(ui.ctx);
    const pxH = cell.h * pixelScale(ui.ctx);

    scrollView(ui, area, {
      id: 'symbols',
      contentHeight: SLOT_SYMBOLS.length * rowHeight,
      draw: (content) => {
        SLOT_SYMBOLS.forEach((symbol, index) => {
          let y = content.y + index * rowHeight;
          text(ui, { x: content.x, y, w: content.w, h: label }, { text: symbol, role: 'label' });
          y += label;
          text(
            ui,
            { x: content.x, y, w: content.w, h: caption },
            { text: symbolPays(symbol), role: 'caption' },
          );
          y += caption;
          text(
            ui,
            { x: content.x, y, w: content.w, h: caption },
            {
              text: `painted · sharp bake · blur bake at ${Math.round(pxW)}×${Math.round(pxH)} px`,
              role: 'caption',
            },
          );
          y += caption + space.xs;
          paintSlotSymbol(ui.ctx, symbol, content.x, y, SYMBOL_LARGE, SYMBOL_LARGE);
          let x = content.x + SYMBOL_LARGE + space.lg;
          for (const variant of ['sharp', 'blur'] as const) {
            const baked = bakedSymbol(symbol, variant, pxW, pxH);
            if (baked !== null) ui.ctx.drawImage(baked, x, y, cell.w, cell.h);
            x += cell.w + space.md;
          }
        });
      },
    });
  }

  private simLines(
    run: SimRun,
  ): ReadonlyArray<{ readonly value: string; readonly role: TextRole }> {
    const done = run.spins >= SIM_SPINS;
    const lines: { value: string; role: TextRole }[] = [
      {
        value: `${done ? 'Done' : 'Running'}: ${run.spins} paid spins at ${run.betPerLine}/line (${totalBetFor(run.betPerLine)} a spin), seed ${SIM_SEED}`,
        role: 'label',
      },
      {
        value: `RTP (lines + scatters + free spins): ${percentOf(run.baseWins + run.featureWins, run.wagered)}`,
        role: 'body',
      },
      { value: `  base game: ${percentOf(run.baseWins, run.wagered)}`, role: 'caption' },
      { value: `  free spins: ${percentOf(run.featureWins, run.wagered)}`, role: 'caption' },
      {
        value: `RTP with progressive wins: ${percentOf(run.baseWins + run.featureWins + run.jackpotPaid, run.wagered)}`,
        role: 'body',
      },
      {
        value: `Hit frequency: ${percentOf(run.hits, run.spins)} (${oneIn(run.hits, run.spins)})`,
        role: 'body',
      },
      {
        value: `Free-spin triggers: ${run.triggers} (${oneIn(run.triggers, run.spins)}), ${run.freeSpinsPlayed} free spins played`,
        role: 'body',
      },
      {
        value: `Jackpots: ${run.jackpots}, paying ${run.jackpotPaid.toLocaleString()} coins`,
        role: 'body',
      },
      { value: `Biggest single win: ${run.biggestWin.toLocaleString()} coins`, role: 'body' },
      { value: 'Win tiers on paid spins', role: 'label' },
      ...REPORTED_TIERS.map((tier) => ({
        value: `  ${tier.toUpperCase()}: ${run.tiers[tier]} (${oneIn(run.tiers[tier], run.spins)})`,
        role: 'caption' as const,
      })),
      {
        value: `Wagered ${run.wagered.toLocaleString()} · paid ${run.machine.totalPaid.toLocaleString()} · pool ends at ${jackpotPayableCoins(run.pool).toLocaleString()}`,
        role: 'caption',
      },
    ];
    return lines;
  }

  private renderSim(ui: Ui, area: Rect): void {
    const { space } = ui.theme;
    const run = this.simRun;
    if (run === null) {
      text(
        ui,
        { ...area, h: lineHeightOf(ui, 'body') },
        {
          text: `Not run yet. "Run ${SIM_SPINS.toLocaleString()} spins" plays them headless at the machine's current bet (${this.host.betPerLine}/line).`,
          role: 'body',
        },
      );
      return;
    }
    const width = Math.max(1, area.w - space.md);
    const rows = this.simLines(run).map((line) => ({
      ...line,
      height: measureTextHeight(ui, width, { text: line.value, role: line.role }),
    }));
    const contentHeight = rows.reduce((total, row) => total + row.height, 0);
    scrollView(ui, area, {
      id: 'sim',
      contentHeight,
      draw: (content) => {
        let y = content.y;
        for (const row of rows) {
          text(
            ui,
            { x: content.x, y, w: width, h: row.height },
            { text: row.value, role: row.role, wrap: true },
          );
          y += row.height;
        }
      },
    });
  }
}
