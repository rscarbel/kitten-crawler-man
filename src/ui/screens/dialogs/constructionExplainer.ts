/**
 * The four pages of the Construction explainer: the menu, the walls,
 * trebuchets and snares, and looking after what you build. Built fresh on
 * every open, so the keys named are the ones the player has bound and a touch
 * screen reads "tap" and "long-press".
 */

import { explainerPage, type ExplainerEntry, type ExplainerPageContent } from './explainerPages';
import {
  drawMenuScene,
  drawWallsScene,
  drawSiegeScene,
  drawCareScene,
} from '../../icons/explainerArt/constructionArt';
import { keybindings } from '../../../core/Keybindings';

/** The explainer's pages, worded for the player's own bindings and device. */
export function constructionExplainerPages(touch: boolean): ExplainerPageContent[] {
  const openMenu = touch ? 'tap the Build button' : `press ${keybindings.labelFor('construction')}`;
  const structureMenu = touch ? 'long-press' : `press ${keybindings.labelFor('structureMenu')} on`;

  return [
    {
      subtitle: 'The Construction menu',
      drawIllustration: drawMenuScene,
      lines: [
        `${touch ? 'Tap the Build button' : `Press ${keybindings.labelFor('construction')}`} to open it. Your wood, stone, boards and rope are at the top, and what you can build is below.`,
        `Pick an option to build right in front of you. ${touch ? 'Tapping' : 'Hovering'} an option shows where it will go.`,
      ],
    },
    {
      subtitle: 'Walls',
      drawIllustration: drawWallsScene,
      lines: [
        `Face a section of the fence and ${openMenu}. Fence → Wooden Wall → Stone Wall  → Fortified.`,
        `A wall knocked down leaves a breach. Face it and ${touch ? 'double tap' : `press ${keybindings.labelFor('attack')}`} to repair it; the same goes for a damaged wall.`,
      ],
    },
    {
      subtitle: 'Trebuchets and snares',
      drawIllustration: drawSiegeScene,
      lines: [
        `A trebuchet hurls stone at enemies. It needs to be loaded with stone after its built to work.`,
        `A snare holds an enemy for a short duration. Friends step over it safely.`,
      ],
    },
    {
      subtitle: 'Looking after it',
      drawIllustration: drawCareScene,
      lines: [
        `${structureMenu.charAt(0).toUpperCase()}${structureMenu.slice(1)} any construction to repair it, add spikes (from Construction level 5), or destroy it.`,
        ...(touch
          ? []
          : [
              `Press ${keybindings.labelFor('quickLoad')} by a damaged wall or trebuchet to repair it.`,
            ]),
        'You build faster with every level.',
      ],
    },
  ];
}

export const CONSTRUCTION_EXPLAINER: ExplainerEntry = {
  title: 'How Construction works',
  pages: (touch) => constructionExplainerPages(touch).map((content) => explainerPage(content)),
};
