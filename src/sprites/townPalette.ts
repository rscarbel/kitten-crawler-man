/**
 * The Over City's shared woodwork colours. The notice board, benches, seer's
 * table and market carts are all supposed to look like they were built by the
 * same carpenter, so the tones live here instead of being redeclared per sprite.
 *
 * Sampled from the town's own `oc_timber`/`oc_plaster` ramps
 * (`src/sprites/art/town/townPalette.ts`) rather than invented separately —
 * ash oak over lime-wash cream, lighter and cooler than the village's dark
 * oiled walnut, so a bench and a facade read as the same carpenter's timber.
 */

import { rgb } from './art/town/townArt';
import { getTownRamp } from './art/town/townPalette';

const TIMBER = getTownRamp('oc_timber');
const PLASTER = getTownRamp('oc_plaster');

export const WOOD = rgb(TIMBER.mid);
export const WOOD_DARK = rgb(TIMBER.shadow);
export const WOOD_LIGHT = rgb(TIMBER.light);
export const PARCHMENT = rgb(PLASTER.accent);
