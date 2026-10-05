/**
 * The gallery's surfaces: a stand-in world backdrop, the widget sheet, a
 * choice modal, a paged explainer, and the fixture sheets for the real
 * screens. Shared by `render:ui-gallery` and the `?ui`
 * route so both show exactly the same thing.
 */

import { inset, splitH, type Rect } from '../../ui/core/geom';
import type { Surface, Ui } from '../../ui/core/UiRoot';
import { ITEM_ICONS } from '../../ui/icons/itemIcons';
import type { ItemId } from '../../core/ItemDefs';
import { button } from '../../ui/widgets/button';
import { choiceModalSurface, type ChoiceModalConfig } from '../../ui/widgets/choiceModal';
import { costChips, measureCostChips, type CostEntry } from '../../ui/widgets/costChips';
import { pagedOverlaySurface, type PagedOverlayPage } from '../../ui/widgets/pagedOverlay';
import { scrollView } from '../../ui/widgets/scrollView';
import { stepperKey } from '../../ui/widgets/stepper';
import { tabs, type TabItem } from '../../ui/widgets/tabs';
import { GALLERY_SHEET_LABELS, GALLERY_SHEETS, type GalleryModel } from './model';
import { renderWidgetSheet } from './widgetSheet';
import { dialogGallerySurfaces } from './dialogs';
import { fixtureSheetSurfaces } from './fixturePicker';
import { INVENTORY_FIXTURES } from './inventory';
import { SHOP_FIXTURES } from './shop';
import { CONSTRUCTION_FIXTURES } from './construction';
import { PAUSE_FIXTURES } from './pause';
import { HUD_FIXTURES } from './hud';
import { worldPalette } from '../../ui/theme/worldInk';

/** The chrome's size and density buttons are this many controls wide. */
const CHROME_TOGGLE_CONTROLS = 3;

// ── World backdrop ──────────────────────────────────────────────────────────

const BACKDROP_TOP = worldPalette.galleryBackdrop.top;
const BACKDROP_BOTTOM = worldPalette.galleryBackdrop.bottom;
const BACKDROP_TILE_LINE = worldPalette.galleryBackdrop.tileLine;
const BACKDROP_TORCH = worldPalette.galleryBackdrop.torch;
const BACKDROP_TORCH_FADE = worldPalette.galleryBackdrop.torchFade;
const BACKDROP_TILE = 32;
const TORCH_RADIUS_RATIO = 0.45;
const TORCH_X_RATIO = 0.22;
const TORCH_Y_RATIO = 0.3;

/** A dim tiled floor with a warm glow, so translucent glass reads as it will over the game. */
function backdropSurface(): Surface {
  return {
    id: 'backdrop',
    band: 'world',
    haltsWorld: false,
    isOpen: () => true,
    render: (ui) => {
      const { ctx, screen } = ui;
      const fade = ctx.createLinearGradient(0, screen.y, 0, screen.y + screen.h);
      fade.addColorStop(0, BACKDROP_TOP);
      fade.addColorStop(1, BACKDROP_BOTTOM);
      ctx.fillStyle = fade;
      ctx.fillRect(screen.x, screen.y, screen.w, screen.h);
      ctx.strokeStyle = BACKDROP_TILE_LINE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = screen.x; x < screen.x + screen.w; x += BACKDROP_TILE) {
        ctx.moveTo(x, screen.y);
        ctx.lineTo(x, screen.y + screen.h);
      }
      for (let y = screen.y; y < screen.y + screen.h; y += BACKDROP_TILE) {
        ctx.moveTo(screen.x, y);
        ctx.lineTo(screen.x + screen.w, y);
      }
      ctx.stroke();
      const cx = screen.x + screen.w * TORCH_X_RATIO;
      const cy = screen.y + screen.h * TORCH_Y_RATIO;
      const r = Math.max(screen.w, screen.h) * TORCH_RADIUS_RATIO;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      glow.addColorStop(0, BACKDROP_TORCH);
      glow.addColorStop(1, BACKDROP_TORCH_FADE);
      ctx.fillStyle = glow;
      ctx.fillRect(screen.x, screen.y, screen.w, screen.h);
    },
  };
}

// ── Chrome (live route only) ────────────────────────────────────────────────

export interface GalleryChromeHost {
  readonly uiSizeLabel: string;
  cycleUiSize(): void;
  readonly densityLabel: string;
  toggleDensity(): void;
}

/** The live route's top bar height: one control plus padding. */
export function chromeHeight(ui: Ui): number {
  return ui.theme.size.control + ui.theme.space.sm * 2;
}

function chromeSurface(model: GalleryModel, host: GalleryChromeHost): Surface {
  const items: TabItem[] = GALLERY_SHEETS.map((sheet) => ({
    id: sheet,
    label: GALLERY_SHEET_LABELS[sheet],
  }));
  return {
    id: 'chrome',
    band: 'toast',
    haltsWorld: false,
    isOpen: () => true,
    render: (ui) => {
      const { space, size } = ui.theme;
      const bar: Rect = {
        x: ui.viewport.x,
        y: ui.viewport.y,
        w: ui.viewport.w,
        h: chromeHeight(ui),
      };
      ui.block(bar);
      const row = inset(bar, { l: space.sm, r: space.sm, t: space.sm, b: space.sm });
      const toggleW = size.control * CHROME_TOGGLE_CONTROLS;
      const [tabCell, sizeCell, densityCell] = splitH(row, ['fill', toggleW, toggleW], space.sm);
      tabs(ui, tabCell, {
        id: 'sheets',
        items,
        selected: model.sheet,
        onSelect: (id) => {
          const sheet = GALLERY_SHEETS.find((candidate) => candidate === id);
          if (sheet !== undefined) model.sheet = sheet;
        },
      });
      button(ui, sizeCell, {
        id: 'ui-size',
        label: host.uiSizeLabel,
        size: 'sm',
        variant: 'ghost',
        onTap: () => host.cycleUiSize(),
      });
      button(ui, densityCell, {
        id: 'density',
        label: host.densityLabel,
        size: 'sm',
        variant: 'ghost',
        onTap: () => host.toggleDensity(),
      });
    },
  };
}

// ── Widget sheet ────────────────────────────────────────────────────────────

function widgetSheetSurface(model: GalleryModel, opts: { top: (ui: Ui) => number }): Surface {
  return {
    id: 'widgets',
    band: 'panel',
    haltsWorld: true,
    isOpen: () => model.sheet === 'widgets',
    onKey: (key) =>
      model.sheetSearch.handleKey(key) ||
      model.typedSearch.handleKey(key) ||
      stepperKey(model.quantity, key),
    render: (ui) => {
      const { ctx, screen, theme } = ui;
      ui.block(screen);
      ctx.fillStyle = theme.palette.surface.sunken;
      ctx.fillRect(screen.x, screen.y, screen.w, screen.h);
      const area = inset(ui.viewport, {
        t: opts.top(ui) + theme.space.lg,
        l: theme.space.xl,
        r: theme.space.xl,
        b: theme.space.lg,
      });
      model.sheetView = area;
      const scrolled = scrollView(ui, area, {
        id: 'sheet',
        contentHeight: model.widgetSheetHeight,
        draw: (content) => {
          model.widgetSheetHeight = renderWidgetSheet(ui, content, model);
        },
      });
      model.sheetOffset = scrolled.offset;
    },
  };
}

// ── Choice modal ────────────────────────────────────────────────────────────

const STAIR_COSTS: readonly CostEntry[] = [
  { label: 'Keys', have: 1, need: 1, glyph: 'lock' },
  { label: 'Boards', have: 12, need: 30, item: 'wood_board' },
];

function choiceConfig(ui: Ui, model: GalleryModel): ChoiceModalConfig {
  const chipW = ui.viewport.w;
  return {
    id: 'stairs',
    overline: 'Stairwell',
    title: 'Descend to Floor 3?',
    icon: 'alert',
    body: [
      'The stairwell seals behind you. Anything left on this floor stays here.',
      'Your followers come with you.',
    ],
    extra: {
      height: measureCostChips(ui, STAIR_COSTS, chipW).h,
      draw: (rect) => costChips(ui, rect, { costs: STAIR_COSTS, align: 'center' }),
    },
    buttons: [
      { label: 'Stay', onTap: () => model.record('Stay') },
      { label: 'Descend', icon: 'chevronDown', onTap: () => model.record('Descend') },
    ],
    defaultButton: 1,
  };
}

// ── Paged explainer ─────────────────────────────────────────────────────────

const ILLUSTRATION_HEIGHT = 120;
const ILLUSTRATION_ITEMS: readonly ItemId[] = [
  'health_potion',
  'goblin_dynamite',
  'magic_missile_tome',
  'wood_board',
];
const ILLUSTRATION_BOB = 3;
const ILLUSTRATION_ICON_FILL = 0.6;
const ILLUSTRATION_BOB_MS = 600;

function itemParade(items: readonly ItemId[]): PagedOverlayPage['illustration'] {
  return {
    height: ILLUSTRATION_HEIGHT,
    paint: (ctx, rect, now) => {
      const side = Math.min(rect.h * ILLUSTRATION_ICON_FILL, rect.w / (items.length + 1));
      const gap = (rect.w - side * items.length) / (items.length + 1);
      items.forEach((item, index) => {
        const bob = Math.sin(now / ILLUSTRATION_BOB_MS + index) * ILLUSTRATION_BOB;
        ITEM_ICONS[item](ctx, {
          x: rect.x + gap + index * (side + gap),
          y: rect.y + (rect.h - side) / 2 + bob,
          w: side,
          h: side,
        });
      });
    },
  };
}

const PAGES: readonly PagedOverlayPage[] = [
  {
    overline: 'Basics · 1 of 3',
    title: 'Loot is everything',
    body: 'Everything you pick up lands in your bag. Drag a potion onto the hotbar, or press its number to drink it mid-fight.',
    illustration: itemParade(ILLUSTRATION_ITEMS),
  },
  {
    overline: 'Basics · 2 of 3',
    title: 'Build between floors',
    body: 'Boards, rope and stone become walls, towers and traps. Each structure lists what it needs; green means you have enough.',
    illustration: itemParade(['wood', 'stone', 'rope', 'wood_board']),
  },
  {
    overline: 'Basics · 3 of 3',
    title: 'The show is watching',
    body: 'Viewers love a close call. Survive with less than a fifth of your health and the sponsors start sending boxes.',
  },
];

// ── Assembly ────────────────────────────────────────────────────────────────

export interface UiGallery {
  readonly model: GalleryModel;
  readonly surfaces: readonly Surface[];
}

/**
 * Every gallery surface, in mount order. With a `chrome` host the live
 * route's top bar is included and the widget sheet scrolls; without one the
 * sheet lays out at full height for a tall capture.
 */
export function createUiGallery(model: GalleryModel, chrome: GalleryChromeHost | null): UiGallery {
  const top = (ui: Ui): number => (chrome === null ? 0 : chromeHeight(ui));
  const surfaces: Surface[] = [
    backdropSurface(),
    widgetSheetSurface(model, { top }),
    choiceModalSurface({
      id: 'choice',
      isOpen: () => model.sheet === 'choice' && model.choiceOpen,
      escape: { kind: 'close', onEscape: () => model.record('Escape picks Stay') },
      content: (ui) => choiceConfig(ui, model),
    }),
    pagedOverlaySurface({
      id: 'paged',
      title: 'How to crawl',
      pages: PAGES,
      isOpen: () => model.sheet === 'paged' && model.pagedOpen,
      onDone: () => model.record('Explainer done'),
    }),
  ];
  surfaces.push(...dialogGallerySurfaces(model, chrome !== null));
  surfaces.push(...fixtureSheetSurfaces(model, 'inventory', INVENTORY_FIXTURES, chrome !== null));
  surfaces.push(...fixtureSheetSurfaces(model, 'shop', SHOP_FIXTURES, chrome !== null));
  surfaces.push(
    ...fixtureSheetSurfaces(model, 'construction', CONSTRUCTION_FIXTURES, chrome !== null),
  );
  surfaces.push(...fixtureSheetSurfaces(model, 'pause', PAUSE_FIXTURES, chrome !== null));
  surfaces.push(...fixtureSheetSurfaces(model, 'hud', HUD_FIXTURES, chrome !== null));
  if (chrome !== null) surfaces.push(chromeSurface(model, chrome));
  return { model, surfaces };
}
