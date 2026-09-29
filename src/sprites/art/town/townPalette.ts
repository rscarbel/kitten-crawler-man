/**
 * Over City's colour vocabulary: the ramp family every town material painter
 * draws from, plus the ground ramps they are authored to sit near.
 *
 * Every ramp is a `{ shadow, mid, light, accent }` four-stop family, the same
 * shape `BUILDING_RAMPS` (`src/sprites/buildinggen/ramps.ts`) and
 * `villageArt.ts`'s palette already use. Over City is lighter and cooler than
 * Briar Hollow's dark oiled walnut throughout, so the two settlements never
 * read as the same place even in the same screenshot: cream plaster and ash
 * oak timber over cool dressed stone, against the village's warm dark wood
 * and grey-green fieldstone.
 *
 * A ramp here is a *target* a building's declared materials should land
 * near, not the only literal colour a wall may use — `getTownRamp` throws on
 * an unknown id for the same reason `getRamp` does: a spec naming a ramp
 * that doesn't exist is an authoring mistake, and a silent default would
 * paint a plausible grey and pass every gate.
 */

import { mix, sampleRamp, shade, type Ramp } from '../../../map/tilegen/palette';
import { FLAGSTONE_RAMP, COBBLE_RAMP, GRASS_RAMP } from '../../../map/tilegen/palette';
import type { RGB } from '../../../map/tilegen/raster';

export { mix, sampleRamp, shade, FLAGSTONE_RAMP, COBBLE_RAMP, GRASS_RAMP };
export type { Ramp, RGB };

function ramp(shadow: RGB, mid: RGB, light: RGB, accent: RGB): Ramp {
  return { shadow, mid, light, accent };
}

/**
 * Every ramp a town material painter may be asked for. Append freely; never
 * renumber or rename — a future spec's declared-ramp gate binds a building's
 * colour to these ids the same way `BUILDING_RAMPS`' ids already bind the
 * shipped facades.
 */
export const TOWN_RAMPS = {
  /** Lime-wash cream, the default infill between timbers. One step lighter and cooler than `plaza`'s `FLAGSTONE_RAMP.mid`. */
  oc_plaster: ramp([110, 102, 86], [167, 154, 128], [203, 192, 164], [226, 216, 190]),
  /** Ash oak framing: the same hue family as the village's walnut, desaturated and lifted a stop — a cousin of it, never the same board. */
  oc_timber: ramp([54, 45, 36], [108, 90, 70], [156, 138, 108], [192, 172, 136]),
  /** Cool dressed ashlar, quarried and coursed — bluer and lighter than the trodden `COBBLE_RAMP` underfoot. */
  oc_stone: ramp([72, 80, 88], [126, 134, 144], [180, 190, 202], [206, 214, 226]),
  /** Cooled, desaturated slate — replaces a saturated cartoon blue with a roof that reads as stone, not paint. */
  oc_slate: ramp([54, 59, 66], [98, 107, 120], [150, 160, 172], [196, 204, 214]),
  /** Terracotta, desaturated so a warm roof does not fight the cooled walls under it. */
  oc_clay: ramp([90, 54, 42], [150, 96, 74], [198, 144, 110], [224, 182, 152]),
  /** Hardware only — hinges, sconces, window ironwork, the odd weathervane. Never a whole wall. */
  iron_black: ramp([18, 18, 20], [38, 38, 42], [66, 68, 72], [110, 110, 118]),
  /** Awning and banner cloth, the cool half of the pair — desaturated so market dressing reads as dyed fabric, not a carnival. */
  oc_cloth_sky: ramp([34, 50, 68], [62, 90, 120], [110, 142, 172], [110, 142, 172]),
  /** The warm half of the awning pair: guild colours, alternating stripes. */
  oc_cloth_ember: ramp([90, 46, 36], [150, 84, 62], [200, 142, 104], [200, 142, 104]),
  /** Skyfowl religious and civic iconography — a relief device, a dome, a perch finial. Never a whole wall. */
  oc_sky_icon: ramp([34, 58, 66], [62, 98, 112], [124, 160, 172], [184, 208, 214]),
} as const satisfies Record<string, Ramp>;

export type TownRampId = keyof typeof TOWN_RAMPS;

/**
 * Resolves a town ramp by name. Throws rather than falling back — see the
 * file comment.
 */
export function getTownRamp(id: TownRampId): Ramp {
  return TOWN_RAMPS[id];
}

/** The warm near-black every Over City silhouette and internal line is inked with — never pure black. */
export const TOWN_INK: RGB = [16, 12, 12];

/** The dark end of the ground's own shadow ramp, reused for a building's cast shadow onto the street. */
export const TOWN_GROUND_SHADOW: RGB = [24, 22, 18];

/** The warm near-black every contact-AO pass uses — the same colour `SHADOW_COLOR` in `buildinggen/lighting.ts` already paints with, restated here so this module has no dependency on that kit. */
export const TOWN_CONTACT_SHADOW: RGB = [18, 13, 12];

/**
 * The one sun for the whole game, restated from `src/sprites/buildinggen/ramps.ts`
 * rather than imported from it, for the same no-dependency-on-buildinggen
 * reason `TOWN_CONTACT_SHADOW` is restated.
 */
export const TOWN_LIGHT_DIR_X = -0.55;
export const TOWN_LIGHT_DIR_Y = -0.83;
