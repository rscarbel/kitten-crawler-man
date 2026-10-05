/**
 * The HUD: one surface in the `hud` band, used by every gameplay scene, drawn
 * from a `HudModel` the scene builds each frame. Where everything goes comes
 * from `hudLayout`, so the same screen puts every piece on the same pixels in
 * the dungeon and inside a building.
 *
 * A second surface in the `toast` band carries what must stay readable over
 * the scene's own panels: the toast stack, and the top band while a scene
 * lifts it over a counter or a conversation it raised.
 */

import { contains, type Rect } from '../core/geom';
import type { Surface, Ui, UiRoot } from '../core/UiRoot';
import { coinPill } from './coinPill';
import { dock, summonCard } from './dock';
import { lootBannerEntry } from './lootBanner';
import { hotbar } from './hotbar';
import { hudLayout, type HudGeometry } from './hudLayout';
import type { CrawlerId, DockButtonId, HudModel } from './hudModel';
import { minimapFrame } from './minimapFrame';
import { renderToasts, type HudToasts } from './toasts';
import { renderTopBand, type TopBandEntry } from './topBand';
import { unitFrame } from './unitFrame';

export interface HudHost {
  /** Unique per `UiRoot`; a scene leaves it to the default. */
  readonly id?: string;
  /** Whether the HUD shows and takes input: not under the death screen, the pause menu or a loading screen. */
  visible(): boolean;
  model(): HudModel;
  toasts(): HudToasts;
  /**
   * The top band is drawn over the scene's own panels this frame (a fight's
   * bars stay readable over the shop counter the room raised).
   */
  liftTopBand?(): boolean;
}

/** What the HUD drew last frame, for code that aims at it: tutorial arrows, flying coins, gates. */
export interface HudFrame {
  readonly geometry: HudGeometry;
  /** CSS pixels per UI unit when it was drawn. */
  readonly uiScale: number;
  /** The coin pill as drawn (it sizes to its number). */
  readonly coins: Rect;
  /** Every dock button drawn, by id. */
  readonly dock: ReadonlyMap<DockButtonId, Rect>;
  /** The skill-point badges drawn on the level discs. */
  readonly skillBadges: readonly Rect[];
}

function crawlerColor(ui: Ui, id: CrawlerId): string {
  return ui.theme.palette.crawler[id];
}

/** The id the HUD mounts under. */
const HUD_SURFACE_ID = 'hud';

/** The id the HUD's toast-band companion mounts under. */
export const HUD_OVERLAY_SURFACE_ID = 'hud-overlay';

/**
 * Every surface open above the HUD that the player has to deal with: menus,
 * dialogs, panels. The HUD's own toast overlay only reports, so it is left
 * out, as is anything in `alsoIgnore` (a scene's own status layer).
 */
export function surfacesOverHud(ui: UiRoot, alsoIgnore: ReadonlySet<string> = NO_IDS): string[] {
  return ui
    .openSurfaceIdsAbove('hud')
    .filter((id) => id !== HUD_OVERLAY_SURFACE_ID && !alsoIgnore.has(id));
}

const NO_IDS: ReadonlySet<string> = new Set();

/** A rect in UI units, in canvas CSS pixels. */
export function toCssRect(rect: Rect, uiScale: number): Rect {
  return { x: rect.x * uiScale, y: rect.y * uiScale, w: rect.w * uiScale, h: rect.h * uiScale };
}

export class HudSurface implements Surface {
  readonly id: string;
  readonly band = 'hud';
  readonly haltsWorld = false;
  /** The last frame drawn, or null before the first. */
  private drawn: HudFrame | null = null;
  /** The top band's entries last frame, for the overlay that lifts the band. */
  private lastBand: readonly TopBandEntry[] = [];

  constructor(private readonly host: HudHost) {
    this.id = host.id ?? HUD_SURFACE_ID;
  }

  isOpen(): boolean {
    return this.host.visible();
  }

  /** The last frame the HUD drew. */
  get frame(): HudFrame | null {
    return this.drawn;
  }

  /**
   * Whether a point in CSS pixels lands on the pause button or a skill-point
   * badge as last drawn: the two HUD controls that stay live under a
   * conversation that halts the world.
   */
  controlUnderHalt(x: number, y: number): 'pause' | 'skill-points' | null {
    const frame = this.drawn;
    if (frame === null) return null;
    const at = { x: x / frame.uiScale, y: y / frame.uiScale };
    const hits = (r: Rect): boolean => contains(r, at.x, at.y);
    const pause = frame.dock.get('pause');
    if (pause !== undefined && hits(pause)) return 'pause';
    return frame.skillBadges.some(hits) ? 'skill-points' : null;
  }

  /** A dock button's rect as last drawn, in CSS pixels, or null while it is not shown. */
  cssDockRect(id: DockButtonId): Rect | null {
    const frame = this.drawn;
    const rect = frame?.dock.get(id);
    return frame === null || rect === undefined ? null : toCssRect(rect, frame.uiScale);
  }

  render(ui: Ui): void {
    const model = this.host.model();
    const geometry = hudLayout({
      viewport: ui.viewport,
      size: ui.size,
      density: ui.density,
      miniMapExpanded: model.minimap?.expanded ?? false,
      build: model.dock.some((button) => button.id === 'build'),
    });
    const [active, companion] = model.crawlers;
    const skillBadges = [
      unitFrame(ui, geometry.frames.active, active, {
        active: true,
        color: crawlerColor(ui, active.id),
        skillPoints: model.skillPoints,
      }),
      unitFrame(ui, geometry.frames.companion, companion, {
        active: false,
        color: crawlerColor(ui, companion.id),
        skillPoints: model.skillPoints,
      }),
    ].filter((badge): badge is Rect => badge !== null);
    const coins = coinPill(ui, geometry.coins, model.coins);
    if (model.minimap !== null) {
      minimapFrame(ui, geometry.miniMap, model.minimap, { touch: ui.density === 'touch' });
    }
    const docked = dock(ui, geometry.buttons, model.dock, {
      keyHints: ui.density === 'pointer',
    });
    if (model.summon !== null) summonCard(ui, geometry.buttons.summon, model.summon);
    const bandEntries = topBandEntries(model);
    if (this.host.liftTopBand?.() !== true) {
      renderTopBand(
        ui,
        geometry.topBand,
        bandEntries,
        geometry.topBandObstacles,
        geometry.topBandFloor,
      );
    }
    if (model.hotbar !== null) hotbar(ui, geometry.hotbar, model.hotbar);
    this.drawn = { geometry, uiScale: ui.uiScale, coins, dock: docked, skillBadges };
    this.lastBand = bandEntries;
  }

  /**
   * The `toast`-band companion: the toast stack, and the top band whenever
   * the host lifts it over its own panels.
   */
  overlay(): Surface {
    return {
      id: this.id === HUD_SURFACE_ID ? HUD_OVERLAY_SURFACE_ID : `${this.id}-overlay`,
      band: 'toast',
      haltsWorld: false,
      isOpen: () => !this.host.toasts().isEmpty || this.liftedTopBand(),
      render: (ui) => {
        const frame = this.drawn;
        if (frame === null) return;
        if (this.liftedTopBand()) {
          renderTopBand(
            ui,
            frame.geometry.topBand,
            this.lastBand,
            frame.geometry.topBandObstacles,
            frame.geometry.topBandFloor,
          );
        }
        renderToasts(ui, this.host.toasts(), frame.geometry.toastAnchor);
      },
    };
  }

  private liftedTopBand(): boolean {
    return this.host.visible() && this.host.liftTopBand?.() === true;
  }
}

/** The scene's bars, then the safe room's call to collect, the band's lowest. */
function topBandEntries(model: HudModel): TopBandEntry[] {
  return model.lootBanner === null
    ? [...model.topBand]
    : [...model.topBand, lootBannerEntry(model.lootBanner)];
}
