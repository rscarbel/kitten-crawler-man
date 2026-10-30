/**
 * Whether Belle could use her senses right now — something only she
 * perceives lies within her reach — and everything that tells the player so.
 *
 * {@link CatSenseCue.showing} is the one answer every indicator reads: the
 * ring at her feet, the glow on her HUD portrait and the pulse on the switch
 * button. It turns on only near where a scent trail starts, so the player
 * follows it from there rather than being told at its end, and once on it
 * holds while she walks the trail. As it turns true she says so in a bark and
 * the cue sound plays, no oftener than {@link CAT_SENSE_REARM_MS}; the first
 * time in a save the senses explainer opens as well. A scene owns one,
 * updates it once a frame after its {@link SenseLayer}, and paints its ring in
 * the ground pass.
 */

import type { AudioManager } from '../../audio/AudioManager';
import { TILE_SIZE } from '../../core/constants';
import type { GameStats } from '../../core/progression/GameStats';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import { pickLine } from '../../dialog/line';
import { CAT_SENSE_BARKS, CAT_SENSE_FIRST_BARK } from '../../dialog/scripts/catSenses';
import type { CraftExplainers } from '../../ui/screens/dialogs/CraftExplainers';
import { feetPointPx } from '../../map/collisionAnchors';
import { paintSenseCueRing, type SensePaintView } from '../../ui/world/worldSenses';
import type { CrawlerBarkSystem } from '../CrawlerBarkSystem';
import { CAT_SENSE_CUE } from '../../audio/catSenseSoundCues';
import { SENSE_CUE_REACH_TILES, type SenseLayer } from './SenseLayer';

/** How far it must fall away again before the cue turns off, so standing on the edge never flickers it. */
const CAT_SENSE_RELEASE_TILES = 7;
const CAT_SENSE_REACH_PX = SENSE_CUE_REACH_TILES * TILE_SIZE;
const CAT_SENSE_RELEASE_PX = CAT_SENSE_RELEASE_TILES * TILE_SIZE;
/** The bark and the sound wait at least this long after the last before they come again. */
export const CAT_SENSE_REARM_MS = 20_000;
/** How long the ring takes to come up, or go down. */
const RING_FADE_MS = 350;
const MAX_FRAME_STEP_MS = 100;

export interface CatSenseCueDeps {
  readonly barks: Pick<CrawlerBarkSystem, 'say'>;
  readonly audio: Pick<AudioManager, 'playRandom'> | null;
  readonly explainers: Pick<CraftExplainers, 'open'>;
  readonly stats: Pick<GameStats, 'catSensesExplained' | 'recordCatSensesExplained'>;
}

/** One frame of what the cue reads. */
export interface CatSenseFrame {
  readonly senses: SenseLayer;
  readonly cat: CatPlayer;
  readonly steered: HumanPlayer | CatPlayer;
  /**
   * Nothing holds the party: no conversation, halting menu or cutscene. The
   * cue still turns on while one does, but its bark, sound and explainer
   * wait for the party to be free.
   */
  readonly calm: boolean;
  readonly nowMs: number;
}

export class CatSenseCue {
  private on = false;
  private announcePending = false;
  private lastAnnouncedMs: number | null = null;
  private lastUpdateMs: number | null = null;
  private ringStrength = 0;
  private barkIndex = 0;

  constructor(private readonly deps: CatSenseCueDeps) {}

  /** Whether something only Belle perceives is within her reach right now. */
  get showing(): boolean {
    return this.on;
  }

  update(frame: CatSenseFrame): void {
    const { senses, cat, steered, calm, nowMs } = frame;
    const last = this.lastUpdateMs;
    const stepMs = last === null ? 0 : Math.max(0, Math.min(MAX_FRAME_STEP_MS, nowMs - last));
    this.lastUpdateMs = nowMs;

    const canSense = cat.isAlive && !cat.isAway && !cat.isKnockedOut;
    const reachPx = this.on ? CAT_SENSE_RELEASE_PX : CAT_SENSE_REACH_PX;
    const part = this.on ? 'whole' : 'start';
    const inReach =
      canSense &&
      !senses.isEmpty &&
      senses.exclusiveSenseWithin(cat.crawlerKind, feetPointPx(cat, TILE_SIZE), reachPx, part);
    if (inReach && !this.on) this.announcePending = true;
    if (!inReach) this.announcePending = false;
    this.on = inReach;
    if (this.announcePending && calm) {
      this.announcePending = false;
      this.announce(cat, steered, nowMs);
    }

    const ringStep = stepMs / RING_FADE_MS;
    this.ringStrength = this.on
      ? Math.min(1, this.ringStrength + ringStep)
      : Math.max(0, this.ringStrength - ringStep);
  }

  /** The ring round her feet, in the ground pass under the bodies. */
  paint(ctx: CanvasRenderingContext2D, cat: CatPlayer, view: SensePaintView): void {
    if (this.ringStrength <= 0 || cat.isAway) return;
    paintSenseCueRing(ctx, feetPointPx(cat, TILE_SIZE), this.ringStrength, view);
  }

  private announce(cat: CatPlayer, steered: HumanPlayer | CatPlayer, nowMs: number): void {
    const last = this.lastAnnouncedMs;
    if (last !== null && nowMs - last < CAT_SENSE_REARM_MS) return;
    this.lastAnnouncedMs = nowMs;
    const { barks, audio, stats } = this.deps;
    if (CAT_SENSE_CUE.takes.length > 0) audio?.playRandom(CAT_SENSE_CUE.takes);
    const humanSteered = steered !== cat;
    if (stats.catSensesExplained) {
      barks.say(cat, [pickLine(CAT_SENSE_BARKS, this.barkIndex).paragraphs[0]]);
      this.barkIndex++;
      return;
    }
    const firstBark = humanSteered
      ? CAT_SENSE_FIRST_BARK.whileHumanSteered
      : CAT_SENSE_FIRST_BARK.whileCatSteered;
    barks.say(cat, [firstBark.paragraphs[0]]);
    if (this.deps.explainers.open('cat_senses')) stats.recordCatSensesExplained();
  }
}
