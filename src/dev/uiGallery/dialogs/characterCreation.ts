/**
 * Fixtures for the character creation screen: the name page empty, holding a
 * name and holding one that breaks a rule, the body page, and the figure page
 * before and after a figure is picked.
 */

import type { Complexion, CrawlerBody } from '../../../characters/crawlerChoices';
import { CreationFigureCells } from '../../../scenes/title/creationFigures';
import {
  CharacterCreation,
  type CreationFigurePainter,
  type CreationPage,
} from '../../../ui/screens/creation/characterCreation';
import type { DialogFixture } from './fixture';

const FIXTURE_NAME = 'Siobhán';
const REJECTED_NAME = '<script>';

interface CreationFixtureState {
  readonly page: CreationPage;
  readonly typed?: string;
  readonly body?: CrawlerBody;
  readonly complexion?: Complexion;
}

/**
 * One set of cells for every creation fixture. Each fixture paints through
 * its own view of them, and a view painting after another fixture's lets the
 * other's looks go first, so the gallery holds only the shown fixture's looks.
 */
const sharedFigures = new CreationFigureCells();
let figuresPaintedFor: string | null = null;

function sharedFiguresFor(fixtureName: string): CreationFigurePainter {
  return {
    paint: (ctx, rect, look, nowMs) => {
      if (figuresPaintedFor !== fixtureName) sharedFigures.release();
      figuresPaintedFor = fixtureName;
      sharedFigures.paint(ctx, rect, look, nowMs);
    },
    release: () => {
      if (figuresPaintedFor !== fixtureName) return;
      sharedFigures.release();
      figuresPaintedFor = null;
    },
  };
}

function creationFixture(name: string, state: CreationFixtureState): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      const creation = new CharacterCreation({
        figures: sharedFiguresFor(name),
        keyboardAnchor: null,
      });
      creation.open(() => undefined);
      creation.fill(state.typed ?? (state.page === 'name' ? '' : FIXTURE_NAME));
      if (state.page !== 'name') creation.next();
      if (state.page === 'figure') creation.chooseBody(state.body ?? 'male');
      if (state.complexion !== undefined) creation.chooseComplexion(state.complexion);
      const surface = creation.surface(name);
      return [{ ...surface, isOpen: () => shown() && surface.isOpen() }];
    },
  };
}

export const FIXTURES: readonly DialogFixture[] = [
  creationFixture('creation-name-empty', { page: 'name' }),
  creationFixture('creation-name-filled', { page: 'name', typed: FIXTURE_NAME }),
  creationFixture('creation-name-rejected', { page: 'name', typed: REJECTED_NAME }),
  creationFixture('creation-body', { page: 'body' }),
  creationFixture('creation-figure-male', { page: 'figure', body: 'male' }),
  creationFixture('creation-figure-female-dark', {
    page: 'figure',
    body: 'female',
    complexion: 'dark',
  }),
];
