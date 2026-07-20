/**
 * Shared geometry for the Desperado Club interior.
 *
 * The tile-carving code in `GameMap.generateInterior` and the runtime
 * `DesperadoClubSystem` (station NPCs, dance-floor lights, interaction prompts)
 * must agree on exactly where every room and station sits. Keeping the single
 * source of truth here avoids the two drifting apart into a broken layout.
 *
 * Coordinates are interior tile indices. The interior is walled at its border
 * (x = 0 / x = W-1, y = 0 / y = H-1); the south exit door is carved by the
 * generic interior code at the bottom-centre, so the layout below only covers
 * the club-specific floor, dividers, and stations.
 */
export const CLUB_INTERIOR_W = 24;
export const CLUB_INTERIOR_H = 18;

/** Inclusive tile bounds of the central dance-floor region. */
export const CLUB_DANCE_FLOOR: { x0: number; y0: number; x1: number; y1: number } = {
  x0: 9,
  y0: 6,
  x1: 14,
  y1: 11,
};

/**
 * Short vertical wall segments that carve left/right alcoves out of the open
 * floor without ever sealing a region off — the dance-floor rows stay open on
 * both columns, so every alcove remains reachable from the central floor.
 */
export const CLUB_DIVIDER_WALLS = [
  { x: 6, y0: 1, y1: 5 },
  { x: 6, y0: 12, y1: 16 },
  { x: 17, y0: 1, y1: 5 },
  { x: 17, y0: 12, y1: 16 },
] as const;

/** Identifiers for every interactable club station. */
export type ClubStationId = 'sledge' | 'bar' | 'casino' | 'market' | 'mercenary' | 'vip';

export interface ClubStation {
  id: ClubStationId;
  tile: { x: number; y: number };
  /** Interaction-prompt label shown when the active player is in range. */
  label: string;
}

/**
 * Fixed positions of each station NPC. The Sledge stands in the vestibule
 * between the exit and the dance floor; the others sit in the four corner
 * alcoves and the north-centre VIP nook.
 */
export const CLUB_STATIONS: ReadonlyArray<ClubStation> = [
  { id: 'sledge', tile: { x: 12, y: 14 }, label: 'The Sledge' },
  { id: 'bar', tile: { x: 3, y: 3 }, label: 'Bar' },
  { id: 'market', tile: { x: 3, y: 14 }, label: 'Market' },
  { id: 'casino', tile: { x: 20, y: 3 }, label: 'Casino' },
  { id: 'mercenary', tile: { x: 20, y: 14 }, label: 'Meat Shields' },
  { id: 'vip', tile: { x: 12, y: 2 }, label: 'VIP Lounge' },
];

/** Doctor Bones the skeleton DJ — cosmetic, spins records just north of the dance floor. */
export const CLUB_DJ_TILE = { x: 12, y: 5 } as const;

/** Cosmetic dancers that bob in place on the dance floor. */
export const CLUB_DANCER_TILES: ReadonlyArray<{ x: number; y: number }> = [
  { x: 10, y: 8 },
  { x: 13, y: 8 },
  { x: 11, y: 10 },
  { x: 13, y: 10 },
];
