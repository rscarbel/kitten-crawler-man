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
import { viewportWidth } from '../../../core/Viewport';
import type { Cow } from '../../../creatures/Cow';
import type { QuestMarkerState } from '../../../sprites/questNPCSprite';
import { drawFittedTitle } from '../../../ui/QuestBanners';
import { drawText } from '../../../ui/TextBox';
import { UPDATES_PER_SECOND } from '../structureRules';
import type { BlueprintsQuestContext } from './blueprintsContext';

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

const BANNER_TITLE_SIZE = 26;
const BANNER_TITLE_COLOR = '#a8f070';
const BANNER_TITLE_GLOW = '#3a6a2a';
const BANNER_GLOW_BLUR = 12;
const BANNER_SUBTITLE_SIZE = 14;
const BANNER_SUBTITLE_COLOR = '#f1f5f9';
const BANNER_SUBTITLE_GAP_PX = 6;

/** Midge's caption stands this many tiles above her tile, over her `!`. */
const MIDGE_CAPTION_LIFT_TILES = 2.3;
const MIDGE_CAPTION_SIZE = 12;
const MIDGE_CAPTION_COLOR = '#fde68a';

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

  /** Screen space: the banner, its top edge at `top`. */
  renderHud(ctx: CanvasRenderingContext2D, top: number): void {
    const banner = this.banner;
    if (banner === null) return;
    const alpha = Math.min(1, this.bannerTicksLeft / STEP_BANNER_FADE_TICKS);
    const centerX = viewportWidth() / 2;
    drawFittedTitle(ctx, banner.title, {
      centerX,
      y: top,
      size: BANNER_TITLE_SIZE,
      color: BANNER_TITLE_COLOR,
      alpha,
      glow: BANNER_TITLE_GLOW,
      glowBlur: BANNER_GLOW_BLUR,
    });
    drawText(ctx, banner.subtitle, {
      x: centerX,
      y: top + BANNER_TITLE_SIZE + BANNER_SUBTITLE_GAP_PX,
      size: BANNER_SUBTITLE_SIZE,
      bold: true,
      color: BANNER_SUBTITLE_COLOR,
      align: 'center',
      outline: true,
      alpha,
    });
  }

  /** Over every body: Midge's caption, over her `!`. */
  renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const cow = this.escort.midge;
    const caption = this.midgeCaption();
    if (cow === null || caption === null || !cow.isAlive) return;
    // A downed crawler's arrow is the only guidance the game allows on screen.
    if (this.ctx.human.isKnockedOut || this.ctx.cat.isKnockedOut) return;
    drawText(ctx, caption, {
      x: cow.x + TILE_SIZE / 2 - camX,
      y: cow.y - MIDGE_CAPTION_LIFT_TILES * TILE_SIZE - camY,
      size: MIDGE_CAPTION_SIZE,
      bold: true,
      color: MIDGE_CAPTION_COLOR,
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
