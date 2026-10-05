/**
 * The seams between "The Borrowed Blueprints"' steps, where the party has
 * just finished something with its hands and the next thing to do is not
 * yet on screen:
 * - the last fence section built, and the hundredth grain cut: a banner
 *   saying so and naming who to see next, with the objective-complete chime
 *   (`objectiveComplete` on the bus, which `AudioManager.wireEvents` plays);
 * - Merrit's "There she is" read through: a banner sending the party off
 *   with Midge;
 * - Midge herself, who wears a `!` and a caption whenever the party has to
 *   go to her — while she answers Merrit's call, for the first
 *   {@link MIDGE_INTRO_SECONDS} of the escort, and whenever she has been
 *   left behind or is waiting at Merrit's gate.
 *
 * Owned by `BlueprintsQuestSystem`, which tells it of every phase move
 * ({@link onPhaseChanged}) and routes the update, HUD and world passes here.
 * Nothing here is durable: a door visit or a rewind drops a banner mid-show.
 */

import { TILE_SIZE } from '../../../core/constants';
import type { BlueprintsQuestPhase } from '../../../core/blueprintsQuestPhase';
import { isVillageUnderSiege } from '../../../core/villageQuestPhase';
import type { Cow } from '../../../creatures/Cow';
import type { QuestMarkerState } from '../../../sprites/questNPCSprite';
import { worldText } from '../../../ui/world/worldText';
import type { Rect } from '../../../ui/core/geom';
import type { Ui } from '../../../ui/core/UiRoot';
import { topBandCard, topBandCardPadding, type TopBandEntry } from '../../../ui/hud/topBand';
import { measureTextHeight, text } from '../../../ui/widgets/text';
import { UPDATES_PER_SECOND } from '../structureRules';
import type { BlueprintsQuestContext } from './blueprintsContext';
import { worldPalette } from '../../../ui/theme/worldInk';

/** What a step banner says: the thing just done, and what to do about it. */
export interface BlueprintsStepBanner {
  readonly title: string;
  readonly subtitle: string;
}

export const FENCE_DONE_BANNER: BlueprintsStepBanner = {
  title: 'Fence rebuilt!',
  subtitle: 'Tell Merrit the fence is finished',
};
export const HARVEST_DONE_BANNER: BlueprintsStepBanner = {
  title: 'Harvest complete!',
  subtitle: 'Bring the grain to Merrit',
};
export const ESCORT_START_BANNER: BlueprintsStepBanner = {
  title: 'Midge is yours to lead',
  subtitle: "Walk her to Wendell's pasture at Plumbline Farm",
};

/** The `objectiveComplete` ids the two finished jobs raise, for the chime. */
export const FENCE_DONE_OBJECTIVE_ID = 'blueprints_fence_rebuilt';
export const HARVEST_DONE_OBJECTIVE_ID = 'blueprints_grain_harvested';

/** Midge's caption while the escort has just begun. */
export const MIDGE_LEAD_CAPTION = "Lead Midge to Wendell's pasture";
/** Midge's caption while she stands waiting for the party to come back for her. */
export const MIDGE_WAITING_CAPTION = 'Midge is waiting for you';

/** How long Midge wears her `!` and caption at the start of the escort, however well she follows. */
export const MIDGE_INTRO_SECONDS = 8;
const MIDGE_INTRO_TICKS = MIDGE_INTRO_SECONDS * UPDATES_PER_SECOND;

/** How long a banner stays up, the last second of it fading. */
export const STEP_BANNER_SECONDS = 4.5;
const STEP_BANNER_TICKS = STEP_BANNER_SECONDS * UPDATES_PER_SECOND;
const STEP_BANNER_FADE_TICKS = UPDATES_PER_SECOND;

export const STEP_BANNER_ENTRY_ID = 'blueprints-step-banner';
const STEP_BANNER_MAX_WIDTH = 420;
const STEP_BANNER_TITLE_MAX_LINES = 2;
const STEP_BANNER_SUBTITLE_MAX_LINES = 3;

/** Midge's caption stands this many tiles above her tile, over her `!`. */
const MIDGE_CAPTION_LIFT_TILES = 2.3;
const MIDGE_CAPTION_SIZE = 12;

/** What the moments read: the quest's state, the bus, the party, the siege, and Midge. */
export type BlueprintsStepMomentsContext = Pick<
  BlueprintsQuestContext,
  'state' | 'bus' | 'human' | 'cat' | 'pleaPhase'
>;

/** What the moments ask of Midge's escort. */
export interface MidgeWhereabouts {
  readonly midge: Cow | null;
  readonly isWaitingAtGate: boolean;
  readonly isOutOfLeadRange: boolean;
}

export class BlueprintsStepMoments {
  private banner: BlueprintsStepBanner | null = null;
  private bannerTicksLeft = 0;
  private midgeIntroTicksLeft = 0;
  /** The Midge this last marked, so her glyph comes off when she stops being the escort's. */
  private markedMidge: Cow | null = null;

  constructor(
    private readonly ctx: BlueprintsStepMomentsContext,
    private readonly escort: MidgeWhereabouts,
  ) {}

  private get phase(): BlueprintsQuestPhase {
    return this.ctx.state.blueprints.phase;
  }

  /** The banner on screen, or null. */
  get currentBanner(): BlueprintsStepBanner | null {
    return this.banner;
  }

  /** Every phase move, as it happens: raises the moment the move is. */
  onPhaseChanged(from: BlueprintsQuestPhase, to: BlueprintsQuestPhase): void {
    if (from === 'build_fence' && to === 'report_fence') {
      this.show(FENCE_DONE_BANNER);
      this.ctx.bus.emit('objectiveComplete', { objectiveId: FENCE_DONE_OBJECTIVE_ID });
    } else if (from === 'harvest_grain' && to === 'deliver_grain') {
      this.show(HARVEST_DONE_BANNER);
      this.ctx.bus.emit('objectiveComplete', { objectiveId: HARVEST_DONE_OBJECTIVE_ID });
    } else if (to === 'escort_midge') {
      this.show(ESCORT_START_BANNER);
      this.midgeIntroTicksLeft = MIDGE_INTRO_TICKS;
    }
  }

  private show(banner: BlueprintsStepBanner): void {
    this.banner = banner;
    this.bannerTicksLeft = STEP_BANNER_TICKS;
  }

  /** Once per gameplay frame: runs the banner and the escort's intro down, and dresses Midge. */
  update(): void {
    if (this.bannerTicksLeft > 0) this.bannerTicksLeft--;
    if (this.bannerTicksLeft <= 0) this.banner = null;
    if (this.midgeIntroTicksLeft > 0 && this.phase === 'escort_midge') this.midgeIntroTicksLeft--;
    const cow = this.escort.midge;
    if (this.markedMidge !== null && this.markedMidge !== cow) {
      this.markedMidge.questMarker = 'none';
    }
    this.markedMidge = cow;
    if (cow !== null) cow.questMarker = this.midgeMarker();
  }

  /** Whether the party has to go to Midge right now: the `!` she wears. */
  midgeMarker(): QuestMarkerState {
    if (isVillageUnderSiege(this.ctx.pleaPhase())) return 'none';
    // Out of the herd before the escort, she can only be answering Merrit's call.
    const answeringCall = this.phase === 'deliver_grain';
    const wanted = answeringCall || this.midgeCaption() !== null;
    return wanted ? 'exclamation' : 'none';
  }

  /**
   * What Midge's caption says, or null for none. While she answers Merrit's
   * call she wears her `!` without one: she is walking to the party already.
   */
  midgeCaption(): string | null {
    if (this.phase !== 'escort_midge' || this.escort.midge === null) return null;
    if (isVillageUnderSiege(this.ctx.pleaPhase())) return null;
    if (this.escort.isWaitingAtGate || this.escort.isOutOfLeadRange) return MIDGE_WAITING_CAPTION;
    return this.midgeIntroTicksLeft > 0 ? MIDGE_LEAD_CAPTION : null;
  }

  /** The step banner's card for the HUD's top band, while one is up. */
  topBandEntry(): TopBandEntry | null {
    const banner = this.banner;
    if (banner === null) return null;
    const alpha = Math.min(1, this.bannerTicksLeft / STEP_BANNER_FADE_TICKS);
    return {
      id: STEP_BANNER_ENTRY_ID,
      priority: 'banner',
      maxWidth: STEP_BANNER_MAX_WIDTH,
      height: (ui, width) =>
        topBandCardPadding(ui) +
        stepBannerLayout(ui, { x: 0, y: 0, w: contentWidth(ui, width), h: 0 }, banner).height,
      render: (ui, rect) => {
        const { ctx } = ui;
        ctx.save();
        ctx.globalAlpha *= alpha;
        const inner = topBandCard(ui, rect, { accent: ui.theme.palette.state.success });
        const layout = stepBannerLayout(ui, inner, banner);
        text(ui, layout.title, { ...titleText(ui, banner), wrap: true, align: 'center' });
        text(ui, layout.subtitle, { ...subtitleText(banner), wrap: true, align: 'center' });
        ctx.restore();
      },
    };
  }

  /** Over every body: Midge's caption, over her `!`. */
  renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const cow = this.escort.midge;
    const caption = this.midgeCaption();
    if (cow === null || caption === null || !cow.isAlive) return;
    // A downed crawler's arrow is the only guidance the game allows on screen.
    if (this.ctx.human.isKnockedOut || this.ctx.cat.isKnockedOut) return;
    worldText(ctx, caption, {
      x: cow.x + TILE_SIZE / 2 - camX,
      y: cow.y - MIDGE_CAPTION_LIFT_TILES * TILE_SIZE - camY,
      size: MIDGE_CAPTION_SIZE,
      bold: true,
      color: worldPalette.escortCaption,
      align: 'center',
      outline: true,
    });
  }

  /** A death rewind on the same scene: no banner, and the escort's intro is over. */
  onRewind(): void {
    this.banner = null;
    this.bannerTicksLeft = 0;
    this.midgeIntroTicksLeft = 0;
  }

  /** The scene is being torn down: Midge takes her glyph off. */
  dispose(): void {
    if (this.markedMidge !== null) this.markedMidge.questMarker = 'none';
    this.markedMidge = null;
  }
}

function titleText(ui: Ui, banner: BlueprintsStepBanner) {
  return {
    text: banner.title,
    role: 'success',
    style: ui.theme.type.heading,
    maxLines: STEP_BANNER_TITLE_MAX_LINES,
  } as const;
}

function subtitleText(banner: BlueprintsStepBanner) {
  return {
    text: banner.subtitle,
    role: 'label',
    maxLines: STEP_BANNER_SUBTITLE_MAX_LINES,
  } as const;
}

function contentWidth(ui: Ui, width: number): number {
  return Math.max(0, width - ui.theme.space.md * 2);
}

function stepBannerLayout(
  ui: Ui,
  inner: Rect,
  banner: BlueprintsStepBanner,
): { readonly title: Rect; readonly subtitle: Rect; readonly height: number } {
  const titleHeight = measureTextHeight(ui, inner.w, titleText(ui, banner));
  const subtitleHeight = measureTextHeight(ui, inner.w, subtitleText(banner));
  const gap = ui.theme.space.xxs;
  return {
    title: { x: inner.x, y: inner.y, w: inner.w, h: titleHeight },
    subtitle: { x: inner.x, y: inner.y + titleHeight + gap, w: inner.w, h: subtitleHeight },
    height: titleHeight + gap + subtitleHeight,
  };
}
