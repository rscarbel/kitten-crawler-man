/**
 * The Wayfinder's Anchor's "Travel Locations" menu: one row per destination,
 * in `TRAVEL_DESTINATIONS` order, each either a Travel button or disabled with
 * the reason it cannot be chosen (still locked, already here, under siege).
 *
 * A thin owner of a `PricedMenuPanel` in its unpriced mode, so it gets the
 * panel's scrolling, keyboard focus ring ('priced-menu'), tap-outside-to-close
 * and phone fitting rather than a second list widget. Choosing a row hands the
 * destination to `onChoose` — `RecallSystem.beginChannelTo` in the game — and
 * closes the menu; closing it any other way starts nothing.
 */

import type { CatPlayer } from '../creatures/CatPlayer';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { GameMap } from '../map/GameMap';
import type { Player } from '../Player';
import {
  TRAVEL_DESTINATIONS,
  travelRefusal,
  type TravelDestinationId,
  type TravelUnlockState,
} from '../systems/travel/travelDestinations';
import { drawAnchorStoneIcon } from './icons/anchorStoneIcon';
import { PricedMenuPanel, type PricedMenu, type PricedOption } from './PricedMenuPanel';

export const TRAVEL_MENU_TITLE = 'Travel Locations';
const TRAVEL_MENU_BARK = 'The stone hums, waiting for a place it knows.';
const TRAVEL_ACTION_LABEL = 'Travel';
/** Free travel still goes through the panel's price field, which unpriced rows ignore. */
const NO_PRICE = 0;

type Caster = HumanPlayer | CatPlayer;

/** Starts the trip; returns whether it started. */
export type TravelChooser = (caster: Caster, destination: TravelDestinationId) => boolean;

/** The menu's rows for a caster standing where they stand now. */
export function buildTravelMenu(
  map: GameMap,
  state: TravelUnlockState,
  caster: { readonly x: number; readonly y: number },
): PricedMenu {
  const options: PricedOption[] = TRAVEL_DESTINATIONS.map((destination) => {
    const refusal = travelRefusal(destination, state, map, caster);
    return {
      key: destination.id,
      label: destination.label,
      price: NO_PRICE,
      desc: destination.description,
      ...(refusal === null ? {} : { unavailable: refusal }),
    };
  });
  return {
    title: TRAVEL_MENU_TITLE,
    bark: TRAVEL_MENU_BARK,
    options,
    unpriced: { actionLabel: TRAVEL_ACTION_LABEL },
    titleIcon: (ctx, x, y, size) => drawAnchorStoneIcon(ctx, x, y, size),
  };
}

function destinationIdFor(key: string): TravelDestinationId | null {
  return TRAVEL_DESTINATIONS.find((destination) => destination.id === key)?.id ?? null;
}

export class TravelMenu {
  private readonly panel = new PricedMenuPanel();
  /** What the last chosen row's `onChoose` answered, read back by `pressTravel`. */
  private lastChoiceStarted = false;

  constructor(
    private readonly map: GameMap,
    private readonly state: TravelUnlockState,
    private readonly onChoose: TravelChooser,
  ) {}

  get isOpen(): boolean {
    return this.panel.isOpen;
  }

  /** The rows on screen right now, or none while closed. */
  get options(): ReadonlyArray<PricedOption> {
    return this.panel.options;
  }

  open(caster: Caster): void {
    this.panel.open(
      () => buildTravelMenu(this.map, this.state, caster),
      (option) => this.choose(option, caster),
    );
  }

  close(): void {
    this.panel.close();
  }

  update(): void {
    this.panel.update();
  }

  render(ctx: CanvasRenderingContext2D, active: Player, companion: Player): void {
    this.panel.render(ctx, active, companion);
  }

  handleClick(mx: number, my: number, active: Player, companion: Player): boolean {
    return this.panel.handleClick(mx, my, active, companion);
  }

  handleWheel(deltaY: number): void {
    this.panel.handleWheel(deltaY);
  }

  /**
   * Presses a row's Travel button exactly as a click would, refused by the
   * same rules. For callers with no pointer: headless checks.
   *
   * @returns whether the trip started — false for a missing or disabled row
   *   as well as for one `onChoose` refused.
   */
  pressTravel(destination: TravelDestinationId, active: Player, companion: Player): boolean {
    this.lastChoiceStarted = false;
    this.panel.pressBuy(destination, active, companion);
    return this.lastChoiceStarted;
  }

  private choose(option: PricedOption, caster: Caster): { ok: boolean; line: string } {
    const destination = destinationIdFor(option.key);
    if (destination === null) return { ok: false, line: '' };
    const started = this.onChoose(caster, destination);
    this.lastChoiceStarted = started;
    // Closed either way: a refused trip has already said why in its toast,
    // and the menu it was chosen from no longer describes a trip on offer.
    this.panel.close();
    return { ok: started, line: '' };
  }
}
