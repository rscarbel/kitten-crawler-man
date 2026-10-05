import { TILE_SIZE } from '../core/constants';
import type { AudioManager } from '../audio/AudioManager';
import type { EventBus } from '../core/EventBus';
import type { Player } from '../Player';
import { REVIVE_FRAMES, REVIVE_HP_FRACTION, REVIVE_RANGE_PX } from '../core/reviveRules';
import { KNOCKOUT_TIMEOUT_FRAMES } from './GameLoopPhases';
import { worldText } from '../ui/world/worldText';
import { worldBar } from '../ui/world/worldShapes';
import { worldPalette } from '../ui/theme/worldInk';
import { ARROW_PRIORITY, drawArrowAbovePlayer, type ArrowCandidate } from '../ui/WorldArrow';
import type { TopBandEntry } from '../ui/hud/topBand';
import { stackedBandEntry, TOP_BAND_WIDTH, type BandRow } from '../ui/hud/topBandStack';
import { palette } from '../ui/theme/tokens';

/**
 * The downed-teammate state machine and its HUD, shared by every scene a
 * crawler can go down in — the overworld and building interiors alike — so
 * "knocked out" means the same thing, ticks at the same speed, and is revived
 * by the same 5-second stand-close everywhere.
 */

const FRAMES_PER_SECOND = 60;
/** Seconds left on a bleed-out clock at which the countdown turns red. */
const CRITICAL_SECONDS_LEFT = 10;

const BANNER_PULSE_BASE = 0.75;
const BANNER_PULSE_AMPLITUDE = 0.25;
const BANNER_PULSE_FREQUENCY = 0.006;

/** The colour of every arrow pointing at someone waiting for a revive. */
export const REVIVE_ARROW_COLOR = palette.accent.base;
const REVIVE_BAR_WIDTH = 160;
const REVIVE_BAR_HEIGHT = 18;
const REVIVE_BAR_TEXT_SIZE = 11;
const REVIVE_BAR_TEXT_Y_OFFSET = 3;
const REVIVE_BAR_BORDER_WIDTH = 1;
const REVIVE_BAR_RADIUS = 2;

/**
 * The slow throb every knockout warning is drawn at, as an alpha. Wall-clock
 * driven, as a purely cosmetic pulse that must keep moving while the world is
 * halted under a menu.
 */
export function knockoutPulse(): number {
  return BANNER_PULSE_BASE + BANNER_PULSE_AMPLITUDE * Math.sin(Date.now() * BANNER_PULSE_FREQUENCY);
}

/** Whole seconds left on a bleed-out clock of `totalFrames`, `elapsedFrames` in. */
export function knockoutSecondsLeft(totalFrames: number, elapsedFrames: number): number {
  return Math.max(0, Math.ceil((totalFrames - elapsedFrames) / FRAMES_PER_SECOND));
}

/** Amber with time to spare, red once the clock is nearly out. */
export function knockoutCountdownColor(secondsLeft: number): string {
  return secondsLeft <= CRITICAL_SECONDS_LEFT
    ? worldPalette.knockout.countdownCritical
    : worldPalette.knockout.countdown;
}

/**
 * The "REVIVING" bar, centred on `centerX` with its top at `y`, filled to
 * `progress` (0–1). Every revive in the game draws this one bar.
 */
export function drawRevivingBar(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  y: number,
  progress: number,
  width = REVIVE_BAR_WIDTH,
): void {
  worldBar(
    ctx,
    { x: centerX - width / 2, y, w: width, h: REVIVE_BAR_HEIGHT },
    {
      style: 'stamina',
      value: progress,
      border: worldPalette.knockout.reviveEdge,
      borderWidth: REVIVE_BAR_BORDER_WIDTH,
      radius: REVIVE_BAR_RADIUS,
    },
  );
  worldText(ctx, 'REVIVING', {
    x: centerX,
    y: y + REVIVE_BAR_TEXT_Y_OFFSET,
    align: 'center',
    size: REVIVE_BAR_TEXT_SIZE,
    bold: true,
    color: worldPalette.knockout.reviveInk,
    outline: true,
  });
}

export interface KnockoutParty {
  /** The crawler being driven. */
  active: Player;
  /** The companion — the one who can go down and be revived. */
  inactive: Player;
  /** Chooses between the human and cat knockout/revive sounds. */
  inactiveIsHuman: boolean;
  audio: AudioManager | null;
  /** Carries `crawlerKnockedOut` / `crawlerRevived` to whoever wants to react. */
  bus: EventBus;
}

/**
 * Detects the companion dropping to 0 HP and transitions them into the
 * knocked-out state; while they're down, ticks the bleed-out timer and the
 * proximity-revive progress. The caller decides what a bleed-out past
 * {@link KNOCKOUT_TIMEOUT_FRAMES} means (game over, in every scene so far).
 */
export function updateKnockoutState(party: KnockoutParty): void {
  const { active, inactive, inactiveIsHuman, audio, bus } = party;

  if (!inactive.isAlive && !inactive.isKnockedOut) {
    inactive.isKnockedOut = true;
    inactive.knockedOutFrames = 0;
    inactive.reviveProgress = 0;
    inactive.clearStatusEffects();
    inactive.clearKnockback();
    audio?.play(inactiveIsHuman ? 'human_knocked_out' : 'cat_knocked_out');
    bus.emit('crawlerKnockedOut', { player: inactive });
  }

  if (!inactive.isKnockedOut) return;

  // Being down is defined by having no HP, so anything that puts HP back —
  // a night's sleep bought while they lay there, a lingering regen effect —
  // brings them round without the usual proximity revive.
  if (inactive.hp > 0) {
    finishRevival(inactive, inactiveIsHuman, audio, bus);
    return;
  }

  const dist = Math.hypot(active.x - inactive.x, active.y - inactive.y);
  if (dist <= REVIVE_RANGE_PX) {
    if (inactive.reviveProgress === 0) {
      audio?.play('reviving_tone');
    }
    inactive.reviveProgress++;
    if (inactive.reviveProgress >= REVIVE_FRAMES) {
      finishRevival(inactive, inactiveIsHuman, audio, bus);
    }
  } else {
    inactive.reviveProgress = 0;
    inactive.knockedOutFrames++;
  }
}

/** Clears the downed state and puts the crawler back on their feet with a sliver of HP. */
export function finishRevival(
  player: Player,
  isHuman: boolean,
  audio: AudioManager | null,
  bus: EventBus,
): void {
  player.isKnockedOut = false;
  player.knockedOutFrames = 0;
  player.reviveProgress = 0;
  player.hp = Math.max(player.hp, Math.ceil(player.maxHp * REVIVE_HP_FRACTION));
  audio?.play(isHuman ? 'human_revived' : 'cat_revived');
  bus.emit('crawlerRevived', { player });
}

/**
 * The downed-teammate arrow, as a candidate for the one shared arrow slot
 * (`drawTopArrowCandidate`) rather than drawn directly — a downed companion
 * always wins that slot over any quest or siege arrow.
 */
export function downedCompanionArrowCandidate(
  ctx: CanvasRenderingContext2D,
  active: Player,
  inactive: Player,
  camX: number,
  camY: number,
): ArrowCandidate | null {
  if (!inactive.isKnockedOut) return null;
  const dist = Math.hypot(active.x - inactive.x, active.y - inactive.y);
  if (dist <= REVIVE_RANGE_PX) return null;
  return {
    priority: ARROW_PRIORITY.DOWNED_COMPANION,
    draw: () =>
      drawArrowAbovePlayer(
        ctx,
        active.x,
        active.y,
        inactive.x + TILE_SIZE / 2,
        inactive.y + TILE_SIZE / 2,
        camX,
        camY,
        REVIVE_ARROW_COLOR,
      ),
  };
}

/**
 * The knocked-out warning, the bleed-out clock and, once someone is in range,
 * the revive's progress, as a top-band entry. The arrow pointing at the downed
 * teammate is drawn separately, through {@link downedCompanionArrowCandidate}
 * and the shared arrow arbiter.
 */
export function knockedOutBandEntry(inactive: Player): TopBandEntry | null {
  if (!inactive.isKnockedOut) return null;

  const pulse = knockoutPulse();
  const secondsLeft = knockoutSecondsLeft(KNOCKOUT_TIMEOUT_FRAMES, inactive.knockedOutFrames);
  const rows: BandRow[] = [
    {
      kind: 'text',
      text: 'Revive your teammate!',
      role: 'title',
      tone: 'danger',
      wrap: true,
      maxLines: 2,
      alpha: pulse,
    },
    {
      kind: 'text',
      text: `${secondsLeft}s`,
      role: 'heading',
      tone: secondsLeft <= CRITICAL_SECONDS_LEFT ? 'danger' : 'warning',
      tabular: true,
      alpha: pulse,
    },
  ];
  // Only ticks up while the reviver is in range (see `updateKnockoutState`),
  // so a positive value on its own means the pair are already close enough
  // that the arrow would have nothing left to point out.
  if (inactive.reviveProgress > 0) {
    rows.push({
      kind: 'meter',
      id: 'knockout/revive',
      value: inactive.reviveProgress,
      max: REVIVE_FRAMES,
      meterKind: 'stamina',
      label: 'Reviving',
    });
  }
  return stackedBandEntry({
    id: 'knockout',
    priority: 'countdown',
    maxWidth: TOP_BAND_WIDTH.regular,
    accentTone: 'danger',
    rows,
  });
}
