/**
 * Anything that puts damaging ground under the party's feet — the Hoarder's acid
 * puddles, the Evil Clown's gas clouds — and can therefore tell the AI companion
 * which way to run.
 *
 * A one-method interface rather than a base class because the implementers are
 * whole systems with nothing else in common, and because it is what lets
 * `CompanionSystem` stop naming `BossRoomSystem` specifically.
 */
export interface GroundHazardSource {
  /**
   * Unit vector pointing out of the nearest hazard containing (x, y), or null
   * when that point is safe. Coordinates are the entity's top-left world
   * position, matching `Player.x` / `Player.y`.
   */
  getHazardEscapeVector(x: number, y: number): { dx: number; dy: number } | null;
}
