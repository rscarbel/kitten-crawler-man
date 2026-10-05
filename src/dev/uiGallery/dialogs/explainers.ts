/**
 * Fixtures for the paged explainers and tutorials: every "how it works"
 * explainer on its first page and a later one, the rules sheets, the quest
 * tutorials, the near-goblin hint, a readable and the notice board.
 */

import { CraftExplainers, type ExplainerId } from '../../../ui/screens/dialogs/CraftExplainers';
import { CONSTRUCTION_EXPLAINER } from '../../../ui/screens/dialogs/constructionExplainer';
import { mongoExplainerEntry } from '../../../ui/screens/dialogs/mongoExplainer';
import { PROCESSING_EXPLAINER } from '../../../ui/screens/dialogs/processingExplainer';
import { RESOURCING_EXPLAINER } from '../../../ui/screens/dialogs/resourcingExplainer';
import type { Notice } from '../../../systems/townNotices';
import { readableBuildings, readablesFor, type Readable } from '../../../systems/townReadables';
import { BlackjackRules } from '../../../ui/screens/dialogs/BlackjackRules';
import { defendTutorialSurface } from '../../../ui/screens/dialogs/defendTutorial';
import { nearGoblinHintSurface } from '../../../ui/screens/dialogs/nearGoblinHint';
import { NoticeBoard } from '../../../ui/screens/dialogs/NoticeBoard';
import { ReadableOverlay } from '../../../ui/screens/dialogs/ReadableOverlay';
import { spiderTutorialSurface } from '../../../ui/screens/dialogs/spiderTutorial';
import type { Surface } from '../../../ui/core/UiRoot';
import type { DialogFixture, FixtureRig } from './fixture';

/** A pet level that draws Mongo as an adolescent, the middle of his three growth stages. */
const MONGO_FIXTURE_LEVEL = 5;

/** Opens the fixture's model the first time it is shown, and keeps the surface shut otherwise. */
function gated(surface: Surface, shown: () => boolean, open: () => void): Surface {
  return {
    ...surface,
    isOpen: () => {
      if (!shown()) return false;
      if (!surface.isOpen()) open();
      return surface.isOpen();
    },
  };
}

function pressTimes(key: string, times: number): (rig: FixtureRig) => void {
  return (rig) => {
    for (let press = 0; press < times; press++) {
      rig.key(key);
      rig.frame();
    }
  };
}

function explainerFixtures(id: ExplainerId, pageCount: number): readonly DialogFixture[] {
  const name = `explainer-${id}`;
  const build = (fixtureName: string, shown: () => boolean): readonly Surface[] => {
    const host = new CraftExplainers();
    host.register('construction', CONSTRUCTION_EXPLAINER);
    host.register('resourcing', RESOURCING_EXPLAINER);
    host.register('processing', PROCESSING_EXPLAINER);
    host.register(
      'mongo',
      mongoExplainerEntry(() => MONGO_FIXTURE_LEVEL),
    );
    return [gated(host.surface({ id: fixtureName }), shown, () => void host.open(id))];
  };
  return Array.from({ length: pageCount }, (_unused, page) => {
    const fixtureName = page === 0 ? name : `${name}-page${page + 1}`;
    return {
      name: fixtureName,
      surfaces: (shown: () => boolean) => build(fixtureName, shown),
      interact: page === 0 ? undefined : pressTimes('ArrowRight', page),
    };
  });
}

/** A tutorial whose page lives on a stand-in for the quest that owns it. */
class PagedModel {
  open = false;
  page = 0;
  constructor(private readonly pageCount: number) {}
  advance(): void {
    if (this.page >= this.pageCount - 1) this.open = false;
    else this.page++;
  }
}

function tutorialFixtures(
  name: string,
  pageCount: number,
  surfaceFor: (model: PagedModel, id: string) => Surface,
): readonly DialogFixture[] {
  return Array.from({ length: pageCount }, (_unused, page) => {
    const fixtureName = page === 0 ? name : `${name}-page${page + 1}`;
    return {
      name: fixtureName,
      surfaces: (shown: () => boolean) => {
        const model = new PagedModel(pageCount);
        const open = (): void => {
          model.open = true;
          model.page = page;
        };
        return [gated(surfaceFor(model, fixtureName), shown, open)];
      },
    };
  });
}

const DEFEND_PAGES = 3;
const SPIDER_PAGES = 2;
const BLACKJACK_LATER_PAGE = 4;

function blackjackFixture(name: string, autoShown: boolean, page: number): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      const rules = new BlackjackRules();
      let hints = true;
      const surface = rules.surface(name, {
        enabled: () => hints,
        toggle: () => {
          hints = !hints;
        },
      });
      return [gated(surface, shown, () => rules.show(autoShown))];
    },
    interact: page === 0 ? undefined : pressTimes('ArrowRight', page),
  };
}

/** The readable with the most text, so the phone layouts have to page it. */
function longestReadable(): Readable | null {
  const all = readableBuildings().flatMap((building) => [...readablesFor(building)]);
  const length = (readable: Readable): number =>
    readable.body.reduce((sum, paragraph) => sum + paragraph.length, 0);
  return all.reduce<Readable | null>(
    (best, readable) => (best === null || length(readable) > length(best) ? readable : best),
    null,
  );
}

function readableFixture(name: string, page: number): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      const overlay = new ReadableOverlay();
      const readable = longestReadable();
      const open = (): void => {
        if (readable !== null) overlay.openWith(readable);
      };
      return [gated(overlay.surface(name), shown, open)];
    },
    interact:
      page === 0
        ? undefined
        : (rig) => {
            for (let turn = 0; turn < page; turn++) {
              rig.key(' ');
              rig.frame();
            }
          },
  };
}

const NOTICES: readonly Notice[] = [
  {
    tone: 'danger',
    title: 'Heather the Bear',
    body: 'Sighted again in the ruins north of the square. Do not engage alone. Reward posted at the guard house.',
  },
  {
    tone: 'active',
    title: 'Murders at the Krasue',
    body: 'Two dead in a week. Anyone with word of a feather in black wax, speak to the constable.',
  },
  {
    tone: 'available',
    title: 'Bounty: Slice the Mantid',
    body: "Shady pays in coin for the mark's head. Ask at the back table of the tavern.",
  },
  {
    tone: 'available',
    title: 'Plumbline Farm',
    body: 'Hands wanted for the harvest. Bring your own scythe; meals provided.',
  },
  {
    tone: 'done',
    title: 'The circus has left town',
    body: 'The Big Top is down and the clowns are gone. Thank you to the crawlers who saw them off.',
  },
  {
    tone: 'danger',
    title: 'Doomsday preppers',
    body: 'Strange noises from the old cellars. The council asks that nobody go poking.',
  },
];

function noticeFixture(name: string, taps: number): DialogFixture {
  return {
    name,
    surfaces: (shown) => {
      const board = new NoticeBoard();
      return [gated(board.surface(name), shown, () => board.openWith(NOTICES))];
    },
    interact:
      taps === 0
        ? undefined
        : (rig) => {
            for (let tap = 0; tap < taps; tap++) {
              rig.tap(rig.need(`${name}/${name}/page`));
              rig.frame();
            }
          },
  };
}

const CONSTRUCTION_PAGES = 4;
const THREE_PAGES = 3;

export const FIXTURES: readonly DialogFixture[] = [
  ...explainerFixtures('construction', CONSTRUCTION_PAGES),
  ...explainerFixtures('resourcing', THREE_PAGES),
  ...explainerFixtures('processing', THREE_PAGES),
  ...explainerFixtures('mongo', THREE_PAGES),
  blackjackFixture('blackjack-rules', true, 0),
  blackjackFixture('blackjack-rules-page5', false, BLACKJACK_LATER_PAGE),
  ...tutorialFixtures('defend-tutorial', DEFEND_PAGES, (model, id) =>
    defendTutorialSurface(
      {
        get isTutorialOpen() {
          return model.open;
        },
        get tutorialPageIndex() {
          return model.page;
        },
        advancePage: () => {
          model.advance();
          return true;
        },
        dismissDialog: () => {
          model.open = false;
          return true;
        },
      },
      id,
    ),
  ),
  ...tutorialFixtures('spider-tutorial', SPIDER_PAGES, (model, id) =>
    spiderTutorialSurface(
      {
        get isKeyboardHeroTutorialOpen() {
          return model.open;
        },
        get tutorialPageIndex() {
          return model.page;
        },
        advanceTutorial: () => model.advance(),
        dismissDialog: () => {
          model.open = false;
          return true;
        },
      },
      id,
    ),
  ),
  ...tutorialFixtures('near-goblin-hint', 1, (model, id) =>
    nearGoblinHintSurface(
      {
        get showNearGoblinDialog() {
          return model.open;
        },
        dismissNearGoblinDialog: () => {
          model.open = false;
        },
      },
      id,
    ),
  ),
  readableFixture('readable', 0),
  readableFixture('readable-page2', 1),
  noticeFixture('notice-board', 0),
  noticeFixture('notice-board-scrolled', 1),
];
