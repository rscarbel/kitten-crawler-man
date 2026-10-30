import { PLAYER_CAT_LOOK } from '../../../sprites/art/catFigure';
import { CatAppearance } from '../../../sprites/catSprite';

/**
 * The player's cat as the explainer pages draw her: in her bare coat, so a
 * page reads the same whatever she has on in play. One for every page, so
 * the pages share her warm rows.
 */
export const EXPLAINER_CAT = new CatAppearance('crawler', PLAYER_CAT_LOOK);
