/**
 * The key ring: each key the floor holds, the fragments of it the party has
 * and the ones still out there, and once the fragments are forged, what the
 * key opens.
 *
 * A tab per kind of key appears only when the floor holds more than one kind,
 * so a floor with a single key shows its page with no strip above it. The
 * page itself reads everything about a kind from its definition and its
 * floor's table, so a new kind needs no edit here beyond its own `opens`.
 */

import { CAROLINE_NAME } from '../../../dialog/caroline';
import { SPEAKERS } from '../../../dialog/speakers';
import type { FragmentView, KeyRingView, KeyView } from '../../../core/keys/KeyRing';
import type { FloorKeySource, FragmentQuestId } from '../../../core/keys/floorKeys';
import type { KeyKind, KeyOpens } from '../../../core/keys/keyKinds';
import { BOSS_DISPLAY_NAMES } from '../../../core/mobs/debriefBossTypes';
import { ANCHOR_QUEST_NAME } from '../../../core/quests/AnchorQuestProgress';
import { MISSING_CATS_QUEST_NAME } from '../../../core/quests/missingCatsProgress';
import { BRIAR_HOLLOW_QUEST_NAME } from '../../../core/quests/villageQuestPhase';
import { getLevelDef } from '../../../levels';
import type { LevelExit } from '../../../levels/types';
import {
  fragmentPieceExtent,
  fragmentPieceOffset,
  KEY_ART_ASPECT,
  paintKey,
  paintKeyFragment,
  paintKeySilhouette,
  paintMissingKeyFragment,
} from '../../../sprites/art/keyArt';
import { STORY_BEATS } from '../../../story/storyBeats';
import { floorIntroTheme } from '../floorIntro/floorIntroThemes';
import type { StorySpeaker } from '../../../story/storyTypes';
import { inset, splitH, type Rect } from '../../core/geom';
import { prefersReducedMotion } from '../../core/reducedMotion';
import type { Ui } from '../../core/UiRoot';
import { skinsFor, type TextRole } from '../../theme/skins';
import { card } from '../../widgets/card';
import { lineHeightOf, measureTextHeight, text } from '../../widgets/text';
import { choiceRow, type Choice } from './parts';
import type { PauseSection, SectionLayout } from './section';

/** The big key is never drawn wider than this, in UI units, however wide the page. */
const SILHOUETTE_MAX_WIDTH = 420;
/** The share of the page's width the big key takes when the page is narrower than that. */
const SILHOUETTE_WIDTH_SHARE = 0.86;
/** The big key's height never takes more than this share of the screen's, so a landscape phone still sees the rows under it. */
const SILHOUETTE_MAX_HEIGHT_SHARE = 0.32;
/** The share of each shimmer cycle the light spends crossing the key; it rests for the rest. */
const SHIMMER_SWEEP_SHARE = 0.55;
/** The forged key's glint crosses it at the same pace, but over the whole key. */
const FORGED_GLINT_SWEEP_SHARE = 0.4;
/** The painted piece at the start of a fragment's row, as a multiple of the theme's slot size. */
const ROW_ART_SLOTS = 1.25;

const UNKNOWN_FRAGMENT = 'Unknown fragment';

/** Each quest that issues a fragment, by the name it goes by on screen. */
const FRAGMENT_QUEST_NAMES = {
  briar_hollow_plea: BRIAR_HOLLOW_QUEST_NAME,
  taloncrest_missing_cats: MISSING_CATS_QUEST_NAME,
  anchor_shards: ANCHOR_QUEST_NAME,
} as const satisfies Record<FragmentQuestId, string>;

/** The story's speakers by the name a fragment they hand over is credited to. */
function giverName(speaker: StorySpeaker): string {
  switch (speaker) {
    case 'dave':
      return SPEAKERS.dave.name;
    case 'caroline':
      return CAROLINE_NAME;
    default: {
      const unhandled: never = speaker;
      return unhandled;
    }
  }
}

/** "The Trash Gremlin" set inside a sentence reads "the Trash Gremlin". */
function midSentence(name: string): string {
  const leadingArticle = 'The ';
  return name.startsWith(leadingArticle) ? `the ${name.slice(leadingArticle.length)}` : name;
}

/** Where a held fragment came from, in a few words. */
function provenance(source: FloorKeySource): string {
  switch (source.kind) {
    case 'storyBeat':
      return `Given by ${giverName(STORY_BEATS[source.beat].speaker)}`;
    case 'bossDefeated':
      return `Taken from ${midSentence(BOSS_DISPLAY_NAMES[source.boss])}`;
    case 'questCompleted':
      return `Earned for ${FRAGMENT_QUEST_NAMES[source.questId]}`;
    default: {
      const unhandled: never = source;
      return unhandled;
    }
  }
}

/** Which stairwells a floor's way out stands for. */
function stairwellsOf(exit: LevelExit): string {
  switch (exit.kind) {
    case 'descend':
      return 'the stairwells on this floor';
    case 'runEnd':
      return 'the stairwell in the town square';
    default: {
      const unhandled: never = exit;
      return unhandled;
    }
  }
}

/** What a forged key opens, as a sentence, by what the key is for. */
const OPENS_LINES = {
  floorStairwells: (view) => `Opens ${stairwellsOf(getLevelDef(view.levelId).exit)}.`,
} as const satisfies Record<KeyOpens['kind'], (view: KeyRingView) => string>;

function opensLine(opens: KeyOpens, view: KeyRingView): string {
  return OPENS_LINES[opens.kind](view);
}

function countLine(key: KeyView): string {
  if (key.forged) return 'Forged';
  const noun = key.needed === 1 ? 'fragment' : 'fragments';
  return `${key.held} of ${key.needed} ${noun}`;
}

/** Where a light sweeping a key is, 0..1, or undefined while it rests between sweeps or motion is reduced. */
function sweepPhase(ui: Ui, sweepShare: number): number | undefined {
  if (prefersReducedMotion()) return undefined;
  const cycle = ui.theme.motion.keyShimmer;
  const into = (ui.now % cycle) / cycle;
  return into < sweepShare ? into / sweepShare : undefined;
}

function renderBigKey(layout: SectionLayout, key: KeyView): void {
  const { ui } = layout;
  const widthForHeight = (ui.viewport.h * SILHOUETTE_MAX_HEIGHT_SHARE) / KEY_ART_ASPECT;
  const width = Math.min(
    SILHOUETTE_MAX_WIDTH,
    layout.width * SILHOUETTE_WIDTH_SHARE,
    widthForHeight,
  );
  const rect = layout.row(width * KEY_ART_ASPECT + ui.theme.space.md * 2, ui.theme.space.md);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  if (key.forged) {
    paintKey(ui.ctx, cx, cy, width, key.kind, sweepPhase(ui, FORGED_GLINT_SWEEP_SHARE));
    return;
  }
  const heldMask = key.fragments.map((fragment) => fragment.held);
  paintKeySilhouette(ui.ctx, cx, cy, width, key.kind, heldMask, {
    shimmer: sweepPhase(ui, SHIMMER_SWEEP_SHARE),
  });
}

/** Paints piece `index` of `count` as large as fits in `rect`, centred in it. */
function paintPieceIn(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  kind: KeyKind,
  index: number,
  count: number,
  held: boolean,
): void {
  const extent = fragmentPieceExtent(index, count);
  const size = Math.min(rect.w / extent.w, rect.h / extent.h);
  const offset = fragmentPieceOffset(index, count);
  const cx = rect.x + rect.w / 2 - offset.x * size;
  const cy = rect.y + rect.h / 2 - offset.y * size;
  if (held) paintKeyFragment(ctx, cx, cy, size, kind, index, count);
  else paintMissingKeyFragment(ctx, cx, cy, size, kind, index, count);
}

interface RowWords {
  readonly title: string;
  readonly titleRole: TextRole;
  readonly detail: string;
  readonly detailRole: TextRole;
}

function rowWords(fragment: FragmentView): RowWords {
  return fragment.held
    ? {
        title: fragment.fragment.name,
        titleRole: 'label',
        detail: provenance(fragment.fragment.source),
        detailRole: 'secondary',
      }
    : {
        title: UNKNOWN_FRAGMENT,
        titleRole: 'labelMuted',
        detail: fragment.fragment.hint,
        detailRole: 'muted',
      };
}

function renderFragmentRow(
  layout: SectionLayout,
  key: KeyView,
  fragment: FragmentView,
  index: number,
): void {
  const { ui } = layout;
  const { space, size } = ui.theme;
  const padding = skinsFor(ui.theme).panel.raised.padding;
  const art = size.slot * ROW_ART_SLOTS;
  const words = rowWords(fragment);
  const textWidth = layout.width - padding * 2 - art - space.md;
  const titleHeight = lineHeightOf(ui, words.titleRole);
  const detailHeight = measureTextHeight(ui, textWidth, {
    text: words.detail,
    role: words.detailRole,
  });
  const textHeight = titleHeight + space.xxs + detailHeight;
  const rect = layout.row(Math.max(art, textHeight) + padding * 2);
  card(ui, rect, {
    id: `fragment/${fragment.fragment.id}`,
    content: (body) => {
      const [artCell, wordsCell] = splitH(body, [art, 'fill'], space.md);
      paintPieceIn(ui.ctx, artCell, key.kind, index, key.fragments.length, fragment.held);
      const column = inset(wordsCell, { t: Math.max(0, (body.h - textHeight) / 2) });
      text(ui, { ...column, h: titleHeight }, { text: words.title, role: words.titleRole });
      text(
        ui,
        { ...column, y: column.y + titleHeight + space.xxs, h: detailHeight },
        { text: words.detail, role: words.detailRole, wrap: true },
      );
    },
  });
}

/** One kind of key's page. */
function renderTab(layout: SectionLayout, key: KeyView, view: KeyRingView): void {
  const { ui } = layout;
  const floorName = floorIntroTheme(view.levelId).kicker;
  const header = layout.row(lineHeightOf(ui, 'title'), ui.theme.space.xxs);
  text(ui, header, { text: key.def.name, role: 'title' });
  layout.paragraph(floorName, 'muted');
  renderBigKey(layout, key);
  const count = layout.row(lineHeightOf(ui, 'value'), ui.theme.space.xs);
  text(ui, count, {
    text: countLine(key),
    role: 'value',
    color: key.forged ? ui.theme.palette.accent.base : undefined,
    align: 'center',
  });
  if (key.forged) {
    const opens = opensLine(key.def.opens, view);
    const height = measureTextHeight(ui, layout.width, { text: opens, role: 'secondary' });
    const line = layout.row(height);
    text(ui, line, { text: opens, role: 'secondary', wrap: true, align: 'center' });
  }
  layout.heading('Fragments');
  key.fragments.forEach((fragment, index) => renderFragmentRow(layout, key, fragment, index));
}

export function keyRingSection(): PauseSection {
  let chosen: KeyKind | null = null;
  const shownKey = (view: KeyRingView): KeyView => {
    const byKind = new Map(view.keys.map((key) => [key.kind, key]));
    const picked = chosen === null ? undefined : byKind.get(chosen);
    return picked ?? view.keys[0];
  };
  return {
    id: 'keys',
    label: 'Keys',
    glyph: 'keyRound',
    render: (layout, ctx) => {
      const view = ctx.keyRing;
      const key = shownKey(view);
      if (view.keys.length > 1) {
        const choices: Choice<KeyKind>[] = view.keys.map((each) => ({
          value: each.kind,
          label: each.def.name,
        }));
        choiceRow(layout, {
          id: 'key-kind',
          choices,
          selected: key.kind,
          onPick: (picked) => {
            chosen = picked;
          },
        });
        layout.space(layout.ui.theme.space.xs);
      }
      renderTab(layout, key, view);
    },
    reset: () => {
      chosen = null;
    },
  };
}
