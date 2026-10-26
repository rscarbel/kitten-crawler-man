/**
 * Anything a building interior's Y-sorted pass can draw: crawlers, mobs, room
 * occupants, club staff, and the club's furniture.
 *
 * `y` is the world-pixel line the figure sorts on — for a person their sprite
 * origin, for a prop the top of the tile row it stands on. The pass draws in
 * ascending `y`, so a figure further down the room is painted over one further
 * up, which is what lets a crawler stand in front of a counter.
 */
export interface InteriorFigure {
  y: number;
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void;
}
