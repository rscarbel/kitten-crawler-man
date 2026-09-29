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

/**
 * Grimaldi's circus: the old circus hues gone sick and warm, a travelling
 * show that died and kept performing. Red and cream are dried blood and old
 * bone rather than candy stripe, the blues have faded to slate, the brass
 * has tarnished, and mildew and vine greens are the corruption creeping out
 * from under the canvas. The stripe and brass mids share the town's value
 * band so a tent and a townhouse share one lighting world, while the
 * bruise, navy, vine and timber mids sit a step darker so the circus reads
 * as a place gone dim. Blood and brass carry about the town cloth's
 * saturation; the lights and accents fall off toward grey so the stripes
 * read as weathered dye, never as fresh paint.
 *
 * Ramps the circus shares with the town are not restated here: hardware
 * iron is `iron_black` and clean framing is `oc_timber`. Same append-only
 * rule as `TOWN_RAMPS`.
 */
export const CIRCUS_RAMPS = {
  /** Dried-blood red: the warm stripe of every tent panel, valance and pennant, and Donut's red/white props. */
  circus_blood: ramp([54, 20, 22], [114, 40, 38], [150, 66, 58], [174, 94, 84]),
  /** Bone cream: the pale stripe paired with `circus_blood`, clown greasepaint and sun-bleached canvas. Warmer and yellower than `oc_plaster`. */
  circus_bone: ramp([104, 90, 70], [168, 152, 120], [204, 190, 154], [222, 210, 176]),
  /** Bruise purple: the hall-of-mirrors drapes, velvet curtains and marquee trim. */
  circus_bruise: ramp([36, 24, 42], [78, 50, 84], [118, 84, 118], [148, 112, 136]),
  /** Tarnished brass and gilt: hoops, follow-spots, mirror frames, finials and star targets. The accent is the one polished glint. */
  circus_brass: ramp([54, 46, 24], [122, 96, 48], [168, 140, 76], [212, 188, 118]),
  /** Navy faded to slate: the menagerie drapes, Carl's circus-blue props and wagon panels. */
  circus_navy: ramp([30, 38, 52], [60, 74, 94], [102, 116, 132], [136, 148, 158]),
  /** Mildew green-grey: blooms on the canvas skirt and damp stains on timber — a tint over another material, never a whole surface. */
  circus_mildew: ramp([50, 58, 42], [94, 104, 72], [134, 140, 100], [162, 164, 120]),
  /** Grimaldi's vine: runners from under the skirt, roots through the sawdust, the king-pole growth. The accent is its sick yellow-green highlight. */
  circus_vine: ramp([24, 38, 22], [50, 78, 38], [90, 118, 54], [148, 164, 72]),
  /** Backstage canvas in the dark: the solid mass of the tent interior, near-black with just enough warmth for a stripe ghost and rigging to register. */
  circus_backstage: ramp([10, 8, 10], [22, 18, 20], [38, 32, 32], [56, 46, 44]),
  /** Sun-greyed, rotting timber: king poles, stage braces, wagon beds and crates. Greyer and darker than the town's clean `oc_timber`. */
  circus_rot_timber: ramp([38, 32, 28], [84, 74, 64], [124, 112, 96], [154, 142, 122]),
  /** Straw and sawdust: cage beds, drifted straw, sawdust-dusted hems and the high striker's mallet haft. */
  circus_straw: ramp([94, 74, 40], [154, 128, 76], [192, 168, 110], [218, 198, 144]),
  /** Limelight and footlight glass: lit bulbs, lamp lenses and stage-light pools — the only saturated warm in the set, because it is light, not pigment. */
  circus_limelight: ramp([148, 82, 32], [226, 160, 82], [248, 222, 168], [252, 244, 220]),
  /** Ringmaster blue: Carl's props only. Kept saturated where the navy drapes are faded, because "that one is Carl's" has to read from across a dark lane. */
  circus_ringmaster: ramp([16, 26, 58], [30, 54, 112], [58, 96, 168], [112, 152, 212]),
  /** Show gilt: Donut's hoop and trim only, a polished gold kept apart from the tarnished brass hardware for the same reason. */
  circus_gilt: ramp([104, 66, 16], [174, 124, 34], [226, 180, 70], [250, 222, 130]),
  /** Stage red: Donut's stripes, the one red in the tent still bright enough to say "hers" under the stage lights. */
  circus_stage_red: ramp([70, 14, 20], [150, 32, 40], [196, 56, 60], [222, 102, 96]),
} as const satisfies Record<string, Ramp>;

export type CircusRampId = keyof typeof CIRCUS_RAMPS;

/** Resolves a circus ramp by name, the circus counterpart of `getTownRamp`. */
export function getCircusRamp(id: CircusRampId): Ramp {
  return CIRCUS_RAMPS[id];
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
