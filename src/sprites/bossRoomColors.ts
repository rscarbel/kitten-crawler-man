/**
 * Boss-room colours: each boss's identity colour (its world label, and the
 * accent its HUD bar carries as game data) and the sealed room's outline.
 */

export const BOSS_IDENTITY_COLOR = {
  the_hoarder: '#c084fc',
  juicer: '#fb923c',
  ball_of_swine: '#f87171',
  krakaren_clone: '#e05090',
} as const;

export const SEALED_ROOM_BORDER_COLOR = {
  /** The entry window is still open: walk in now. */
  entryWindow: '#fbbf24',
  fight: '#ef4444',
  /** Silver, like the chest the seal is waiting on — distinct from the fight's yellow and red. */
  lootSeal: '#e5e7eb',
} as const;
