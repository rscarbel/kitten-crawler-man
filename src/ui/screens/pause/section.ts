/**
 * What a pause-screen section is, the context it draws with, and the column
 * layout it draws into.
 */

import type { AudioManager } from '../../../audio/AudioManager';
import type { AbilityManager } from '../../../core/AbilityManager';
import type { AchievementManager } from '../../../core/AchievementManager';
import type { CraftSkillId } from '../../../core/CraftSkills';
import type { Difficulty } from '../../../core/difficultyProfiles';
import type { GameStats } from '../../../core/GameStats';
import type { JournalProgress } from '../../../core/JournalProgress';
import type { CrawlerKind } from '../../../core/SkillManager';
import type { CatPlayer } from '../../../creatures/CatPlayer';
import type { HumanPlayer } from '../../../creatures/HumanPlayer';
import type { TrackerEntry } from '../../../systems/questTracker';
import { splitH, type Rect } from '../../core/geom';
import type { HitState, KeyModifiers, Ui } from '../../core/UiRoot';
import type { GlyphId } from '../../theme/glyphs';
import type { TextRole } from '../../theme/skins';
import { measureTextHeight, text } from '../../widgets/text';

export const PAUSE_SECTION_IDS = [
  'journal',
  'character',
  'abilities',
  'crafts',
  'achievements',
  'settings',
  'controls',
] as const;

export type PauseSectionId = (typeof PAUSE_SECTION_IDS)[number];

/** What the Journal needs from the world to draw a bearing on each row. */
export interface JournalContext {
  readonly playerTileX: number;
  readonly playerTileY: number;
  readonly entries: ReadonlyArray<TrackerEntry>;
  readonly progress: JournalProgress;
}

/** The slice of the audio manager the pause screen uses. */
export type PauseAudio = Pick<
  AudioManager,
  | 'play'
  | 'pauseMusic'
  | 'pauseAmbience'
  | 'resumeMusic'
  | 'resumeAmbience'
  | 'masterVolume'
  | 'musicVolume'
  | 'sfxVolume'
  | 'setMasterVolumePreference'
  | 'setMusicVolumePreference'
  | 'setSfxVolumePreference'
>;

/** The explainers a section can open. Absent ones are offered disabled or not at all. */
export interface PauseGuides {
  readonly mongo?: () => void;
  readonly craft?: (id: CraftSkillId) => void;
  readonly processing?: () => void;
}

/** What the screen offers its sections beyond the game state. */
export interface PauseActions {
  show(id: PauseSectionId): void;
  /** Asks before a guarded difficulty change restarts something. */
  requestDifficulty(difficulty: Difficulty): void;
  requestRestoreKeys(): void;
}

/** Everything a section draws from, rebuilt each frame. */
export interface PauseContext {
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly abilities: AbilityManager;
  readonly achievements: Readonly<Record<CrawlerKind, AchievementManager>>;
  readonly gameStats: GameStats;
  /** Null on floors without a Journal, which hides it. */
  readonly journal: JournalContext | null;
  readonly audio: PauseAudio | null;
  /** Opens a crawler's loot boxes, or null where they can't be opened here. */
  readonly openBoxes: Readonly<Record<CrawlerKind, (() => void) | null>>;
  readonly guides: PauseGuides;
  /** Opens the chat window; null where chat isn't offered. */
  readonly openChat: (() => void) | null;
  readonly actions: PauseActions;
}

/**
 * One page of the pause screen. Adding a section is one entry in the
 * screen's list.
 */
export interface PauseSection {
  readonly id: PauseSectionId;
  readonly label: string;
  readonly glyph: GlyphId;
  /** Hidden from the menu while this is false. Always offered when absent. */
  readonly available?: (ctx: PauseContext) => boolean;
  /** A count or tag pinned beside the label in the menu. */
  readonly badge?: (ctx: PauseContext) => string | null;
  /** The heading over the page; the label when absent. Follows the page's sub-view. */
  readonly title?: (ctx: PauseContext) => string;
  readonly subtitle?: (ctx: PauseContext, ui: Ui) => string | undefined;
  /** Draws the page top to bottom into the layout's column. */
  readonly render: (layout: SectionLayout, ctx: PauseContext) => void;
  /** A page within the page (an ability's details) that a back control steps out of. */
  readonly subView?: {
    readonly active: () => boolean;
    readonly exit: () => void;
    /** Names the view showing, so each view scrolls on its own. */
    readonly key: () => string;
  };
  /** Typed input while the page is showing (a key being rebound). True when consumed. */
  readonly onKey?: (key: string, mods: KeyModifiers) => boolean;
  /** Drops transient state: called when the page is left and when the menu closes. */
  readonly reset?: () => void;
}

/** A control a page drew, kept so keyboard focus can scroll the page to it. */
export interface TrackedControl {
  /** Top and bottom in content coordinates (from the top of the scrolled column). */
  readonly top: number;
  readonly bottom: number;
  /** Left and right edges, in the same coordinates as the column. */
  readonly left: number;
  readonly right: number;
  readonly focused: boolean;
  /** Whether keyboard focus can land on it (an enabled, tappable control). */
  readonly focusable: boolean;
  /** Left/Right nudge the control (a slider) instead of moving focus. */
  readonly adjust?: (direction: -1 | 1) => void;
}

export interface TrackOptions {
  /** False for a control drawn disabled or without a tap. Defaults to true. */
  readonly focusable?: boolean;
  readonly adjust?: (direction: -1 | 1) => void;
}

/**
 * A column a page lays itself out in, top to bottom. It hands out rows,
 * remembers how tall the page came out, and records the controls drawn so
 * the screen can keep the focused one in view.
 */
export class SectionLayout {
  private cursor: number;
  readonly controls: TrackedControl[] = [];

  constructor(
    readonly ui: Ui,
    /** The column, already offset by the scroll; its height is ignored. */
    readonly area: Rect,
  ) {
    this.cursor = area.y;
  }

  get width(): number {
    return this.area.w;
  }

  get x(): number {
    return this.area.x;
  }

  /** How tall the page has come out so far. */
  get height(): number {
    return this.cursor - this.area.y;
  }

  /** The next `h` units of the column, followed by `after` units of space (default `space.sm`). */
  row(h: number, after: number = this.ui.theme.space.sm): Rect {
    const rect: Rect = { x: this.area.x, y: this.cursor, w: this.area.w, h };
    this.cursor += h + after;
    return rect;
  }

  space(h: number): void {
    this.cursor += h;
  }

  /** Wrapped text across the column. Returns its rect. */
  paragraph(content: string, role: TextRole = 'secondary', after?: number): Rect {
    const h = measureTextHeight(this.ui, this.area.w, { text: content, role });
    const rect = this.row(h, after);
    text(this.ui, rect, { text: content, role, wrap: true });
    return rect;
  }

  /** Small spaced capitals that open a group of rows. */
  heading(content: string, color?: string): Rect {
    const { space, type } = this.ui.theme;
    this.space(space.xs);
    const rect = this.row(type.overline.lineHeight, space.sm);
    text(this.ui, rect, { text: content, role: 'overline', color });
    return rect;
  }

  /** Side-by-side columns starting at the cursor. Hand them back to {@link join} once drawn. */
  split(count: number, gap: number): SectionLayout[] {
    const strip: Rect = { x: this.area.x, y: this.cursor, w: this.area.w, h: 0 };
    const tracks = Array.from({ length: count }, (): 'fill' => 'fill');
    return splitH(strip, tracks, gap).map((column) => new SectionLayout(this.ui, column));
  }

  /** Takes back columns from {@link split}: their controls, and the tallest one's height. */
  join(columns: readonly SectionLayout[], after: number = this.ui.theme.space.sm): void {
    let tallest = 0;
    for (const column of columns) {
      const offset = column.area.y - this.area.y;
      for (const control of column.controls) {
        this.controls.push({
          ...control,
          top: control.top + offset,
          bottom: control.bottom + offset,
        });
      }
      tallest = Math.max(tallest, column.height);
    }
    this.cursor += tallest + after;
  }

  /** Records a drawn control and passes its state through. */
  track(rect: Rect, state: HitState, opts: TrackOptions = {}): HitState {
    this.controls.push({
      top: rect.y - this.area.y,
      bottom: rect.y + rect.h - this.area.y,
      left: rect.x,
      right: rect.x + rect.w,
      focused: state.focused,
      focusable: opts.focusable ?? true,
      adjust: opts.adjust,
    });
    return state;
  }
}
