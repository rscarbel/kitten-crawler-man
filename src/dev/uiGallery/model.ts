/**
 * The mutable fixture state the UI gallery's sheets read and write, so the
 * live `?ui` route is interactive and the render script shows the same thing.
 */

import type { Rect } from '../../ui/core/geom';
import { QuantityPickerState } from '../../ui/QuantityPickerState';
import { SearchInput } from '../../ui/widgets/searchField';

export const GALLERY_SHEETS = [
  'widgets',
  'shop',
  'inventory',
  'choice',
  'paged',
  'dialogs',
  'construction',
  'pause',
  'hud',
] as const;

export type GallerySheet = (typeof GALLERY_SHEETS)[number];

export const GALLERY_SHEET_LABELS: Readonly<Record<GallerySheet, string>> = {
  widgets: 'Widgets',
  shop: 'Shop',
  inventory: 'Inventory',
  choice: 'Choice',
  paged: 'Explainer',
  dialogs: 'Dialogs',
  construction: 'Construction',
  pause: 'Pause',
  hud: 'HUD',
};

/** The interaction states a widget sheet cell can be forced into by the render script. */
export type ForcedState = 'hover' | 'pressed' | 'focused';

/** A cell of the widget sheet whose look depends on input, recorded each frame. */
export interface GalleryCell {
  /** The widget id inside the sheet's surface. */
  readonly widgetId: string;
  readonly state: ForcedState;
  /** The cell's area, for compositing a capture. */
  readonly rect: Rect;
}

export const PLAYER_COINS = 1240;

const STARTING_HP = 72;

/** Everything the sheets read and write. */
export class GalleryModel {
  sheet: GallerySheet = 'widgets';
  lastAction = 'Nothing tapped yet';
  readonly cells: GalleryCell[] = [];
  /** The widget sheet's laid-out height last frame, for sizing a capture canvas. */
  widgetSheetHeight = 0;
  /** The widget sheet's scroll window and offset last frame, for paging a capture through it. */
  sheetView: Rect = { x: 0, y: 0, w: 0, h: 0 };
  sheetOffset = 0;
  /** The widget-sheet cell holding keyboard focus last frame, if any. */
  focusedWidget: string | null = null;

  segmented = 'bag';
  underline = 'all';
  readonly sheetSearch = new SearchInput();
  readonly typedSearch = new SearchInput();
  readonly quantity = new QuantityPickerState({
    max: 20,
    initial: 3,
    costPerUnit: 25,
    available: PLAYER_COINS,
  });

  /** The screen fixture shown on a fixture sheet such as `dialogs`, by name. */
  screenFixture: string | null = null;

  choiceOpen = true;
  pagedOpen = true;

  hp = STARTING_HP;
  readonly hpMax = 120;

  constructor() {
    this.typedSearch.value = 'pot';
    this.typedSearch.active = true;
  }

  record(action: string): void {
    this.lastAction = action;
  }
}
