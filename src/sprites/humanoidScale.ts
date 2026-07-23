/**
 * Humanlike NPCs — townsfolk, clowns, and the club's tuxedoed staff and stone
 * golems — are drawn from figures that fill roughly a single tile, while the
 * player sprite overflows its tile and stands markedly taller. Left as-is those
 * NPCs read as dwarfed by the player, which only makes sense for goblins and the
 * smaller monsters. Enlarging them by this factor brings a human-scaled figure
 * up to the player's apparent height. Goblins and monsters keep drawing at tile
 * size, so the size gap now reads as "this creature is small," not a rendering
 * quirk.
 */
export const HUMANOID_NPC_SCALE = 1.4;

/** The draw box after {@link scaleHumanoidBox}: top-left plus size, all in px. */
export interface ScaledBox {
  sx: number;
  sy: number;
  s: number;
}

/**
 * Grows a `size`-px sprite box by `scale` about its bottom-center, so a figure
 * drawn to fill the box gets taller and wider while its feet stay planted on the
 * same ground line and its centerline is unchanged. Health bars and aggro marks
 * should keep using the original box so they stay pinned to the tile.
 */
export function scaleHumanoidBox(
  sx: number,
  sy: number,
  size: number,
  scale: number = HUMANOID_NPC_SCALE,
): ScaledBox {
  const grow = size * (scale - 1);
  return { sx: sx - grow / 2, sy: sy - grow, s: size * scale };
}
