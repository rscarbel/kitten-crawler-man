import type { Surface } from '../../ui/core/UiRoot';
import type { CasinoSeat } from '../ClubCasinoSystem';

/**
 * A casino game the club's game picker opens but whose host lives in its own
 * system. The club mounts its surfaces beside the card tables', pumps it while
 * the club's modals tick, and keeps the casino music on while any of its surfaces is up.
 */
export interface CasinoGameHost {
  /** Opens the game's first surface; called as the picker closes. */
  open(seat: CasinoSeat): void;
  readonly anySurfaceOpen: boolean;
  /** Runs once per club tick, open or not, for anything with its own clock. */
  update(): void;
  /** Every surface the game shows, in stacking order; mounted once with the club's. */
  surfaces(seat: CasinoSeat): Surface[];
  /** The scene is being torn down under the game: settle anything owed and shut at once. */
  forceClose?(): void;
}

/** A free spin the wheel can offer from the picker. */
export interface WheelFreeSpinOffer {
  /** Free spins waiting, counting a taped chain still owed as one. */
  readonly count: number;
  /** Why none can be taken right now, or null when one can. */
  readonly blocked: string | null;
}

/** The wheel's host: a casino game that can also be opened straight onto a free spin. */
export interface WheelGameHost extends CasinoGameHost {
  /** The free spin the picker offers, or null when there is none. */
  readonly freeSpinOffer: WheelFreeSpinOffer | null;
  /**
   * Opens the wheel on a free spin, past the warnings. Returns false when it
   * could not open, so the picker can stay up.
   */
  openFreeSpin(seat: CasinoSeat): boolean;
  /**
   * How the wheel puts the club's game picker back up: after a free spin's
   * visit, and whenever a taped chain resolves, however the wheel was entered.
   */
  bindPicker(reopen: () => void): void;
}

/** The picker's games that are not card tables. */
export interface CasinoGameHosts {
  slots: CasinoGameHost;
  wheel: WheelGameHost;
}

/** Holds a game's place in the picker until its host is built: choosing it opens nothing. */
export function idleCasinoGameHost(): CasinoGameHost {
  return {
    open: () => undefined,
    anySurfaceOpen: false,
    update: () => undefined,
    surfaces: () => [],
  };
}

/** The wheel's place in the picker until its host is built: no free spins, nothing opens. */
export function idleWheelGameHost(): WheelGameHost {
  return {
    ...idleCasinoGameHost(),
    freeSpinOffer: null,
    openFreeSpin: () => false,
    bindPicker: () => undefined,
  };
}
