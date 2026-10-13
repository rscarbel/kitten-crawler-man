import type { Surface } from '../../ui/core/UiRoot';
import type { CasinoSeat } from '../ClubCasinoSystem';

/**
 * A casino game the club's game picker opens but whose host lives in its own
 * system. The club mounts its surfaces beside the card tables', pumps it while
 * the club's modals tick, counts its wagers toward the VIP lounge perk, and
 * keeps the casino music on while any of its surfaces is up.
 */
export interface CasinoGameHost {
  /** Opens the game's first surface; called as the picker closes. */
  open(seat: CasinoSeat): void;
  readonly anySurfaceOpen: boolean;
  readonly coinsWageredThisVisit: number;
  /** Runs once per club tick, open or not, for anything with its own clock. */
  update(): void;
  /** Every surface the game shows, in stacking order; mounted once with the club's. */
  surfaces(seat: CasinoSeat): Surface[];
  /** The scene is being torn down under the game: settle anything owed and shut at once. */
  forceClose?(): void;
}

/** The picker's games that are not card tables. */
export interface CasinoGameHosts {
  slots: CasinoGameHost;
  wheel: CasinoGameHost;
}

/** Holds a game's place in the picker until its host is built: choosing it opens nothing. */
export function idleCasinoGameHost(): CasinoGameHost {
  return {
    open: () => undefined,
    anySurfaceOpen: false,
    coinsWageredThisVisit: 0,
    update: () => undefined,
    surfaces: () => [],
  };
}
