import { TILE_SIZE } from '../core/constants';
import { platform } from '../core/Platform';
import { viewportWidth } from '../core/Viewport';
import type { AudioManager } from '../audio/AudioManager';
import type { Player } from '../Player';
import { REVIVE_HP_FRACTION } from '../core/PlayerSnapshot';
import { KNOCKOUT_TIMEOUT_FRAMES } from './GameLoopPhases';
import { drawText, TEXT_PRESETS } from '../ui/TextBox';
import { drawProgressBar, PROGRESS_PRESETS } from '../ui/Box';
import { drawArrowAbovePlayer } from '../ui/WorldArrow';

/**
 * The downed-teammate state machine and its HUD, shared by every scene a
 * crawler can go down in — the overworld and building interiors alike — so
 * "knocked out" means the same thing, ticks at the same speed, and is revived
 * by the same 5-second stand-close everywhere.
 */

/** How close the active crawler must stand to a downed teammate to revive them. */
const REVIVE_RANGE_TILE_FRACTION = 0.8;
export const REVIVE_RANGE_PX = TILE_SIZE * REVIVE_RANGE_TILE_FRACTION;
/** 5 seconds @ 60fps of standing close before the teammate comes back up. */
export const REVIVE_FRAMES = 300;

const FRAMES_PER_SECOND = 60;
/** Seconds left on the bleed-out clock at which the countdown turns red. */
const CRITICAL_SECONDS_LEFT = 10;

const BANNER_PULSE_BASE = 0.75;
const BANNER_PULSE_AMPLITUDE = 0.25;
const BANNER_PULSE_FREQUENCY = 0.006;
const BANNER_TEXT_SIZE_MOBILE = 15;
const BANNER_TEXT_SIZE_DESKTOP = 22;
const BANNER_MARGIN = 16;
const BANNER_Y = 44;
const COUNTDOWN_TEXT_SIZE = 15;
const COUNTDOWN_Y_MOBILE = 62;
const COUNTDOWN_Y_DESKTOP = 70;
/** Width kept clear beside the minimap so the banner never slides behind it. */
const MINIMAP_SIDEBAR_WIDTH = 16;

const REVIVE_ARROW_COLOR = '#facc15';
const REVIVE_BAR_WIDTH = 160;
const REVIVE_BAR_HEIGHT = 18;
const REVIVE_BAR_Y = 96;
const REVIVE_BAR_TEXT_SIZE = 11;
const REVIVE_BAR_TEXT_Y_OFFSET = 3;

export interface KnockoutParty {
  /** The crawler being driven. */
  active: Player;
  /** The companion — the one who can go down and be revived. */
  inactive: Player;
  /** Chooses between the human and cat knockout/revive sounds. */
  inactiveIsHuman: boolean;
  audio: AudioManager | null;
}

/**
 * Detects the companion dropping to 0 HP and transitions them into the
 * knocked-out state; while they're down, ticks the bleed-out timer and the
 * proximity-revive progress. The caller decides what a bleed-out past
 * {@link KNOCKOUT_TIMEOUT_FRAMES} means (game over, in every scene so far).
 */
export function updateKnockoutState(party: KnockoutParty): void {
  const { active, inactive, inactiveIsHuman, audio } = party;

  if (!inactive.isAlive && !inactive.isKnockedOut) {
    inactive.isKnockedOut = true;
    inactive.knockedOutFrames = 0;
    inactive.reviveProgress = 0;
    inactive.clearStatusEffects();
    inactive.clearKnockback();
    audio?.play(inactiveIsHuman ? 'human_knocked_out' : 'cat_knocked_out');
  }

  if (!inactive.isKnockedOut) return;

  // Being down is defined by having no HP, so anything that puts HP back —
  // a night's sleep bought while they lay there, a lingering regen effect —
  // brings them round without the usual proximity revive.
  if (inactive.hp > 0) {
    finishRevival(inactive, inactiveIsHuman, audio);
    return;
  }

  inactive.knockedOutFrames++;

  const dist = Math.hypot(active.x - inactive.x, active.y - inactive.y);
  if (dist <= REVIVE_RANGE_PX) {
    if (inactive.reviveProgress === 0) {
      audio?.play('reviving_tone');
    }
    inactive.reviveProgress++;
    if (inactive.reviveProgress >= REVIVE_FRAMES) {
      finishRevival(inactive, inactiveIsHuman, audio);
    }
  } else {
    inactive.reviveProgress = 0;
  }
}

/** Clears the downed state and puts the crawler back on their feet with a sliver of HP. */
export function finishRevival(player: Player, isHuman: boolean, audio: AudioManager | null): void {
  player.isKnockedOut = false;
  player.knockedOutFrames = 0;
  player.reviveProgress = 0;
  player.hp = Math.max(player.hp, Math.ceil(player.maxHp * REVIVE_HP_FRACTION));
  audio?.play(isHuman ? 'human_revived' : 'cat_revived');
}

/**
 * Renders the knocked-out warning banner, the arrow pointing at the downed
 * teammate, and the revival progress bar. `miniMapSize` is the top-right
 * minimap's edge length, which on mobile is what the banner must stay clear of.
 */
export function renderKnockedOutUI(
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  active: Player,
  inactive: Player,
  miniMapSize: number,
): void {
  if (!inactive.isKnockedOut) return;

  const t = Date.now();
  const pulse = BANNER_PULSE_BASE + BANNER_PULSE_AMPLITUDE * Math.sin(t * BANNER_PULSE_FREQUENCY);

  const availW = platform.isMobile
    ? viewportWidth() - miniMapSize - MINIMAP_SIDEBAR_WIDTH
    : viewportWidth();
  const cx = availW / 2;
  const bannerSize = platform.isMobile ? BANNER_TEXT_SIZE_MOBILE : BANNER_TEXT_SIZE_DESKTOP;

  drawText(ctx, 'Revive your teammate!', {
    x: cx,
    y: BANNER_Y,
    align: 'center',
    ...TEXT_PRESETS.danger,
    size: bannerSize,
    outline: true,
    alpha: pulse,
    width: availW - BANNER_MARGIN,
  });

  const secondsLeft = Math.max(
    0,
    Math.ceil((KNOCKOUT_TIMEOUT_FRAMES - inactive.knockedOutFrames) / FRAMES_PER_SECOND),
  );
  drawText(ctx, `${secondsLeft}s`, {
    x: cx,
    y: platform.isMobile ? COUNTDOWN_Y_MOBILE : COUNTDOWN_Y_DESKTOP,
    align: 'center',
    ...TEXT_PRESETS.danger,
    size: COUNTDOWN_TEXT_SIZE,
    color: secondsLeft <= CRITICAL_SECONDS_LEFT ? '#ef4444' : '#fbbf24',
    outline: true,
    alpha: pulse,
  });

  const dist = Math.hypot(active.x - inactive.x, active.y - inactive.y);

  if (dist > REVIVE_RANGE_PX) {
    drawArrowAbovePlayer(
      ctx,
      active.x,
      active.y,
      inactive.x + TILE_SIZE / 2,
      inactive.y + TILE_SIZE / 2,
      camX,
      camY,
      REVIVE_ARROW_COLOR,
    );
  } else if (inactive.reviveProgress > 0) {
    const barX = cx - REVIVE_BAR_WIDTH / 2;

    drawProgressBar(ctx, {
      x: barX,
      y: REVIVE_BAR_Y,
      width: REVIVE_BAR_WIDTH,
      height: REVIVE_BAR_HEIGHT,
      value: inactive.reviveProgress / REVIVE_FRAMES,
      ...PROGRESS_PRESETS.stamina,
      border: '#ffffff',
      borderWidth: 1,
      radius: 2,
    });

    drawText(ctx, 'REVIVING', {
      x: cx,
      y: REVIVE_BAR_Y + REVIVE_BAR_TEXT_Y_OFFSET,
      align: 'center',
      size: REVIVE_BAR_TEXT_SIZE,
      bold: true,
      color: '#fff',
      outline: true,
    });
  }
}
