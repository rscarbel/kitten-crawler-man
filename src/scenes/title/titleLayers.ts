/**
 * The whole title picture, back to front. Adding, removing or reordering an
 * effect is an edit to this list and nothing else; each entry builds a fresh
 * layer, so a title scene entered again starts from clean state.
 */

import type { TitleLayerFactory } from './titleLayer';
import { backdropLayer } from './layers/backdropLayer';
import { dungeonHallLayer } from './layers/dungeonHallLayer';
import { torchLayer } from './layers/torchLayer';
import { lightLayer } from './layers/lightLayer';
import { fogLayer } from './layers/fogLayer';
import { vignetteLayer } from './layers/vignetteLayer';
import { logoLayer } from './layers/logoLayer';
import { particlesLayer } from './layers/particlesLayer';
import { lurkersLayer } from './layers/lurkersLayer';
import { lootGlintLayer } from './layers/lootGlintLayer';
import { heroesLayer } from './layers/heroesLayer';
import { spotlightLayer } from './layers/spotlightLayer';

export const TITLE_LAYERS: readonly TitleLayerFactory[] = [
  backdropLayer,
  dungeonHallLayer,
  torchLayer,
  lightLayer,
  fogLayer,
  lurkersLayer,
  lootGlintLayer,
  heroesLayer,
  spotlightLayer,
  particlesLayer,
  logoLayer,
  vignetteLayer,
];
