/**
 * A key fragment's ceremony: the world falls away, a column of gold light
 * slams down, the fragment spins up out of it and flares, the key's dark
 * silhouette fades in behind it and the fragment flies into its socket, then
 * its name, the count and Caroline's word for it.
 *
 * One `modal` surface that halts the world and keeps the keyboard. It never
 * opens by itself: the scene's key ceremonies hand it each fragment moment.
 * A first press while it plays jumps to its settled state; the next, once a
 * short guard has passed, continues. A fragment that makes its key whole
 * continues into the forge instead ("Forge").
 */

import type { AudioManager } from '../../../audio/AudioManager';
import { playKeyCue } from '../../../audio/keySoundCues';
import type { SoundId } from '../../../audio/sounds';
import { keyKindDef } from '../../../core/keys/keyKinds';
import type { FragmentMoment } from '../../../core/keys/keyMoments';
import {
  FULL_TURN_YAWS,
  KEY_ART_ASPECT,
  fragmentPieceOffset,
  paintKeyFragmentTurned,
  paintKeySilhouette,
  warmKeyArt,
  type KeyArtPicture,
} from '../../../sprites/art/keyArt';
import type { Rect } from '../../core/geom';
import { prefersReducedMotion } from '../../core/reducedMotion';
import type { Surface, Ui, UiMeasure } from '../../core/UiRoot';
import { KEY_INK } from '../../theme/keyInk';
import { SilhouetteBake } from './silhouetteBake';
import {
  CAROLINE_FULLY_OPEN,
  carolineBox,
  carolineOpenAt,
  carolineRevealAt,
  carolineRevealLength,
  carolineSettled,
  measureCarolineBox,
} from '../../widgets/carolineFrame';
import { lineHeightOf } from '../../widgets/text';
import {
  paintLightColumn,
  paintMoteDrift,
  paintRayFan,
  paintScreenFlash,
  paintShockRing,
  paintSparkleBurst,
  type Point,
} from '../celebration/celebrationLight';
import { paintSoftPool } from '../../../sprites/lightMaps';
import { glowText } from '../dialogs/endScreenParts';
import {
  ceremonyHeadline,
  ceremonyLayout,
  ceremonySurface,
  paintCeremonyBackdrop,
  paintCeremonyFooter,
  registerSkip,
  shakeOffset,
} from './ceremonyParts';
import {
  FRAGMENT_BEATS,
  FRAGMENT_CONTINUE_GUARD_FRAMES,
  FRAGMENT_CUE_FRAMES,
  MS_PER_FRAME,
  decay,
  fragmentBackdrop,
  fragmentColumn,
  fragmentPose,
  fragmentShake,
  fragmentSilhouette,
  fragmentWords,
  pulse,
  span,
} from './fragmentTimeline';

type CueAudio = Pick<AudioManager, 'play' | 'playAt' | 'fadeOutSound'>;

interface Showing {
  readonly moment: FragmentMoment;
  frame: number;
  /** Frames since the ceremony settled, for the idle light. */
  settledFrames: number;
  /** A skip finished Caroline's line, so it is drawn whole and fully open. */
  lineDone: boolean;
  /**
   * The clock (frame plus settled frames) everything was first on screen at,
   * Caroline's line whole included; Continue's guard counts from here.
   */
  shownAt: number | null;
}

/** The cues a skip cuts short: they belong to beats the skip jumps past. */
const CUT_ON_SKIP: ReadonlySet<FragmentCue> = new Set(['fragmentColumnSlam', 'fragmentRise']);
/** How quickly a cut cue fades, so it stops without a click. */
const CUE_CUT_FADE_MS = 120;

/** The silhouette's width as a share of the stage's width, and its cap against the stage's height. */
const SILHOUETTE_W_SHARE = 0.8;
const SILHOUETTE_H_SHARE = 0.62;
const SILHOUETTE_MAX_W = 520;
/** The fragment at its reveal is drawn from a whole-key box this much wider than the silhouette. */
const REVEAL_SCALE = 1.45;
/** A canvas cannot draw through a transform scaled to nothing. */
const MIN_KEY_WIDTH = 8;
/** The column's foot sits this far below the stage's middle, as a share of the stage's height. */
const COLUMN_FOOT_DROP = 0.42;
const COLUMN_HALF_WIDTH = 0.16;
const COLUMN_WIDEN = 1.6;
const COLUMN_ALPHA = 0.75;
const FOOT_POOL_REACH = 0.55;
const FOOT_POOL_ALPHA = 0.6;
const DUST_RING_FRAMES = 40;
const DUST_RING_REACH = 0.7;
const DUST_RING_SQUASH = 0.28;
const DUST_RING_WIDTH = 0.025;
const DUST_BURST_COUNT = 22;
const DUST_BURST_FRAMES = 44;
const DUST_BURST_SIZE = 0.012;
const EMBER_COUNT = 18;
const EMBER_PERIOD = 90;
const EMBER_SIZE = 0.012;
const EMBER_SPREAD = 0.5;
const EMBER_SWAY = 0.04;
const EMBER_SWAY_PER_FRAME = 0.05;
const EMBER_SEED = 2100;
/** The shimmer under the rising fragment, growing as it climbs. */
const HALO_REACH = 0.75;
const HALO_ALPHA = 0.55;
const FLARE_FRAMES = 30;
const FLARE_REACH = 1.2;
const FLARE_ALPHA = 0.85;
const RAY_COUNT = 14;
const RAY_HALF_ANGLE = 0.08;
const RAY_REACH = 1.6;
const RAY_ALPHA = 0.32;
const RAYS_IN_FRAMES = 24;
const RAY_TURN_PER_FRAME = 0.004;
const REVEAL_BURST_FRAMES = 34;
const REVEAL_BURST_COUNT = 26;
const REVEAL_BURST_REACH = 0.85;
const REVEAL_BURST_SIZE = 0.03;
const LOCK_BURST_FRAMES = 26;
const LOCK_BURST_COUNT = 14;
const LOCK_BURST_REACH = 0.35;
const LOCK_BURST_SIZE = 0.022;
const LOCK_FLASH_FRAMES = 12;
const LOCK_FLASH_ALPHA = 0.35;
const HELD_GLOW = 0.6;
const LOCK_GLOW = 1;
const LOCK_GLOW_FRAMES = 40;
const SHIMMER_PERIOD = 150;
const SETTLED_GLOW_REACH = 0.9;
const SETTLED_GLOW_ALPHA = 0.28;
const SHAKE_PX = 10;
const NAME_GLOW_BLUR = 22;
const KICKER_GLOW_BLUR = 10;
const BURST_SEED_REVEAL = 3;
const BURST_SEED_LOCK = 5;
const BURST_SEED_DUST = 7;
/** The count line under a fragment that makes its key whole. */
const WHOLE_KEY_LINE = 'The key is whole';
const CONTINUE_LABEL = 'Continue';
const FORGE_LABEL = 'Forge';
const HALF = 0.5;

export class KeyFragmentScreen {
  private showing: Showing | null = null;
  private readonly reducedMotion: () => boolean;
  /** The take each cue of the ceremony on screen played, so a skip or a teardown can cut it. */
  private readonly sounding = new Map<FragmentCue, SoundId>();
  private readonly bake = new SilhouetteBake();

  /**
   * `onContinue` runs as the player continues from a settled ceremony, with
   * the moment it showed; the screen is already closed when it runs, so the
   * caller can open the forge in the same press.
   */
  constructor(
    private readonly audio: CueAudio | null,
    private readonly onContinue: (moment: FragmentMoment) => void,
    reducedMotion: () => boolean = prefersReducedMotion,
  ) {
    this.reducedMotion = reducedMotion;
  }

  get isOpen(): boolean {
    return this.showing !== null;
  }

  open(moment: FragmentMoment): void {
    this.sounding.clear();
    this.showing = { moment, frame: 0, settledFrames: 0, lineDone: false, shownAt: null };
    this.sound(-1, 0);
  }

  /** Advances the ceremony one frame. */
  tick(): void {
    const showing = this.showing;
    if (showing === null) return;
    const before = showing.frame;
    if (showing.frame < FRAGMENT_BEATS.settledAt) showing.frame++;
    else showing.settledFrames++;
    this.sound(before, showing.frame);
  }

  /** Jumps to the settled ceremony, sounding only the beats it would still have sounded at their own end. */
  skip(): void {
    const showing = this.showing;
    if (showing?.shownAt !== null) return;
    this.cut((cue) => CUT_ON_SKIP.has(cue));
    const before = showing.frame;
    if (before < FRAGMENT_CUE_FRAMES.fragmentFanfare) this.play('fragmentFanfare');
    if (before < FRAGMENT_CUE_FRAMES.fragmentSocketLock) this.play('fragmentSocketLock');
    if (showing.frame < FRAGMENT_BEATS.settledAt) {
      showing.frame = FRAGMENT_BEATS.settledAt;
      showing.settledFrames = 0;
    }
    showing.lineDone = true;
    showing.shownAt = clockOf(showing);
  }

  /** Closes the screen at once, as everything under it is torn down, and silences its cues. */
  dismiss(): void {
    this.cut(() => true);
    this.showing = null;
    this.bake.release();
  }

  /** Lets go of everything the screen holds, as the scene that owns it is torn down. */
  dispose(): void {
    this.dismiss();
    this.bake.dispose();
  }

  private ready(showing: Showing): boolean {
    return (
      showing.shownAt !== null &&
      clockOf(showing) - showing.shownAt >= FRAGMENT_CONTINUE_GUARD_FRAMES
    );
  }

  private advance(): void {
    const showing = this.showing;
    if (showing === null) return;
    if (showing.shownAt === null) {
      this.skip();
      return;
    }
    if (!this.ready(showing)) return;
    this.showing = null;
    this.bake.release();
    this.onContinue(showing.moment);
  }

  private play(cue: FragmentCue): void {
    const id = playKeyCue(this.audio, cue, null, 'ui');
    if (id !== null) this.sounding.set(cue, id);
  }

  private cut(which: (cue: FragmentCue) => boolean): void {
    for (const [cue, id] of this.sounding) {
      if (!which(cue)) continue;
      this.audio?.fadeOutSound(id, CUE_CUT_FADE_MS);
      this.sounding.delete(cue);
    }
  }

  private sound(from: number, to: number): void {
    for (const cue of CEREMONY_CUES) {
      const at = FRAGMENT_CUE_FRAMES[cue];
      if (from < at && to >= at) this.play(cue);
    }
  }

  surface(id: string): Surface {
    return ceremonySurface(id, {
      isOpen: () => this.isOpen,
      advance: () => this.advance(),
      render: (ui) => {
        const showing = this.showing;
        if (showing !== null) this.render(ui, showing);
      },
    });
  }

  // ── Drawing ──

  private render(ui: Ui, showing: Showing): void {
    const { ctx } = ui;
    const frame = showing.frame;
    const clock = frame + showing.settledFrames;
    const reduced = this.reducedMotion();
    const settled = frame >= FRAGMENT_BEATS.settledAt;
    if (settled && showing.shownAt === null && this.lineRevealed(ui, showing, reduced)) {
      showing.shownAt = clock;
    }
    paintCeremonyBackdrop(ui, fragmentBackdrop(frame));
    const layout = ceremonyLayout(ui, (w) => this.wordsHeight(ui, showing.moment, w));
    const shake = shakeOffset(clock, fragmentShake(frame, reduced), SHAKE_PX);
    ctx.save();
    ctx.translate(shake.x, shake.y);
    this.paintStage(ui, showing, layout.stage, clock, reduced);
    ctx.restore();
    this.paintWords(ui, showing, layout.words, reduced);
    paintCeremonyFooter(ui, layout.footer, {
      settled,
      label: showing.moment.completesKey ? FORGE_LABEL : CONTINUE_LABEL,
      ready: this.ready(showing),
      alpha: span(frame, 0, FRAGMENT_BEATS.darkenEnd),
      onContinue: () => this.advance(),
    });
    registerSkip(ui, showing.shownAt !== null, () => this.skip());
  }

  /** Whether Caroline's line has finished decoding on its own. */
  private lineRevealed(ui: Ui, showing: Showing, reduced: boolean): boolean {
    const message = showing.moment.issueLine.text;
    const reveal = carolineRevealAt(ui.theme, message, this.lineElapsedMs(showing), reduced);
    return reveal.decoding === 0 && reveal.shown >= carolineRevealLength(message);
  }

  private lineElapsedMs(showing: Showing): number {
    return (clockOf(showing) - FRAGMENT_BEATS.lineAt) * MS_PER_FRAME;
  }

  private paintStage(ui: Ui, showing: Showing, stage: Rect, clock: number, reduced: boolean): void {
    const { ctx, theme } = ui;
    const { moment } = showing;
    const frame = showing.frame;
    const ink = KEY_INK[moment.keyKind];
    const keyWidth = silhouetteWidth(stage);
    if (keyWidth < MIN_KEY_WIDTH) return;
    const centre: Point = { x: stage.x + stage.w * HALF, y: stage.y + stage.h * HALF };
    const foot: Point = { x: centre.x, y: centre.y + stage.h * COLUMN_FOOT_DROP };
    const glow = ink.glow;
    const light = ink.metal.highlight;

    const column = fragmentColumn(frame);
    if (column.alpha > 0) {
      const columnTop = ui.screen.y;
      const columnFootY = columnTop + (foot.y - columnTop) * column.reach;
      paintLightColumn(
        ctx,
        {
          base: { x: foot.x, y: columnFootY },
          halfBase: keyWidth * COLUMN_HALF_WIDTH,
          widen: COLUMN_WIDEN,
          height: columnFootY - columnTop,
        },
        glow,
        COLUMN_ALPHA * column.alpha,
        clock,
      );
      paintSoftPool(
        ctx,
        foot.x,
        foot.y,
        keyWidth * FOOT_POOL_REACH,
        keyWidth * FOOT_POOL_REACH,
        glow,
        FOOT_POOL_ALPHA * column.alpha,
        'linear',
      );
    }
    const ring = span(frame, FRAGMENT_BEATS.slamAt, FRAGMENT_BEATS.slamAt + DUST_RING_FRAMES);
    if (ring > 0 && ring < 1) {
      paintShockRing(
        ctx,
        {
          at: foot,
          radius: keyWidth * DUST_RING_REACH * ring,
          squash: DUST_RING_SQUASH,
          lineWidth: keyWidth * DUST_RING_WIDTH * (1 - ring),
        },
        light,
        1 - ring,
      );
    }
    paintSparkleBurst(
      ctx,
      {
        at: foot,
        progress: span(frame, FRAGMENT_BEATS.slamAt, FRAGMENT_BEATS.slamAt + DUST_BURST_FRAMES),
        count: DUST_BURST_COUNT,
        reach: keyWidth * DUST_RING_REACH,
        size: keyWidth * DUST_BURST_SIZE,
        seed: BURST_SEED_DUST,
      },
      theme.palette.text.secondary,
      glow,
    );

    const revealAt = FRAGMENT_BEATS.revealAt;
    const rays =
      span(frame, revealAt, revealAt + RAYS_IN_FRAMES) * (1 - fragmentSilhouette(frame) * HALF);
    paintRayFan(
      ctx,
      centre,
      {
        count: RAY_COUNT,
        halfAngle: RAY_HALF_ANGLE,
        reach: keyWidth * RAY_REACH,
        turn: reduced ? 0 : clock * RAY_TURN_PER_FRAME,
      },
      glow,
      RAY_ALPHA * rays,
    );
    if (frame >= FRAGMENT_BEATS.settledAt) {
      paintSoftPool(
        ctx,
        centre.x,
        centre.y,
        keyWidth * SETTLED_GLOW_REACH,
        keyWidth * SETTLED_GLOW_REACH,
        glow,
        SETTLED_GLOW_ALPHA,
        'linear',
      );
    }

    if (frame < FRAGMENT_BEATS.revealAt) this.warm(ctx, moment, keyWidth);
    this.paintSilhouette(ui, showing, centre, keyWidth, clock, reduced);
    this.paintFragment(ui, showing, stage, centre, keyWidth, clock, reduced);

    paintSparkleBurst(
      ctx,
      {
        at: centre,
        progress: span(frame, revealAt, revealAt + REVEAL_BURST_FRAMES),
        count: REVEAL_BURST_COUNT,
        reach: keyWidth * REVEAL_BURST_REACH,
        size: keyWidth * REVEAL_BURST_SIZE,
        seed: BURST_SEED_REVEAL,
      },
      glow,
      light,
    );
    const lockAt = FRAGMENT_BEATS.lockAt;
    paintSparkleBurst(
      ctx,
      {
        at: socketOf(moment, centre, keyWidth),
        progress: span(frame, lockAt, lockAt + LOCK_BURST_FRAMES),
        count: LOCK_BURST_COUNT,
        reach: keyWidth * LOCK_BURST_REACH,
        size: keyWidth * LOCK_BURST_SIZE,
        seed: BURST_SEED_LOCK,
      },
      glow,
      light,
    );
    if (!reduced) {
      paintScreenFlash(
        ctx,
        ui.screen,
        glow,
        LOCK_FLASH_ALPHA * decay(frame, lockAt, LOCK_FLASH_FRAMES),
      );
    }
  }

  /**
   * Bakes ahead, within the frame's bake budget, the art `moment`'s ceremony
   * will draw on this viewport, while it waits to open.
   */
  prepare(target: UiMeasure, moment: FragmentMoment): boolean {
    const { stage } = ceremonyLayout(target, (w) => this.wordsHeight(target, moment, w));
    const keyWidth = silhouetteWidth(stage);
    return keyWidth < MIN_KEY_WIDTH || this.warm(target.ctx, moment, keyWidth);
  }

  /** Bakes the spinning fragment and the socket ahead, within the frame's bake budget; true once all are ready. */
  private warm(ctx: CanvasRenderingContext2D, moment: FragmentMoment, keyWidth: number): boolean {
    const spin: readonly KeyArtPicture[] = [
      { look: 'fragment', index: moment.index, count: moment.needed, yaws: FULL_TURN_YAWS },
    ];
    if (!warmKeyArt(ctx, keyWidth * REVEAL_SCALE, moment.keyKind, spin)) return false;
    const before = moment.heldMask.map((held, i) => held && i !== moment.index);
    const socket: readonly KeyArtPicture[] = [
      { look: 'socket', count: moment.needed },
      { look: 'halo', held: before },
      { look: 'halo', held: moment.heldMask },
      ...moment.heldMask.flatMap((held, index): KeyArtPicture[] =>
        held ? [{ look: 'fragment', index, count: moment.needed, yaws: [0] }] : [],
      ),
    ];
    return warmKeyArt(ctx, keyWidth, moment.keyKind, socket);
  }

  private paintSilhouette(
    ui: Ui,
    showing: Showing,
    centre: Point,
    keyWidth: number,
    clock: number,
    reduced: boolean,
  ): void {
    const { ctx } = ui;
    const { moment } = showing;
    const frame = showing.frame;
    const fade = fragmentSilhouette(frame);
    if (fade <= 0) return;
    const before = moment.heldMask.map((held, i) => held && i !== moment.index);
    const locked = reduced
      ? span(frame, FRAGMENT_BEATS.flyFrom, FRAGMENT_BEATS.lockAt)
      : frame >= FRAGMENT_BEATS.lockAt
        ? 1
        : 0;
    const shimmer = reduced ? undefined : (clock % SHIMMER_PERIOD) / SHIMMER_PERIOD;
    const lockGlow = LOCK_GLOW * decay(frame, FRAGMENT_BEATS.lockAt, LOCK_GLOW_FRAMES);
    if (locked < 1) {
      ctx.save();
      ctx.globalAlpha *= fade;
      paintKeySilhouette(ctx, centre.x, centre.y, keyWidth, moment.keyKind, before, {
        shimmer,
        edgeGlow: HELD_GLOW,
      });
      ctx.restore();
    }
    if (locked <= 0) return;
    ctx.save();
    ctx.globalAlpha *= fade * locked;
    const lockGlowDone = frame >= FRAGMENT_BEATS.lockAt + LOCK_GLOW_FRAMES;
    if (lockGlowDone) {
      this.bake.draw(
        ctx,
        centre.x,
        centre.y,
        keyWidth,
        { kind: moment.keyKind, heldMask: moment.heldMask, edgeGlow: HELD_GLOW },
        shimmer,
      );
    } else {
      paintKeySilhouette(ctx, centre.x, centre.y, keyWidth, moment.keyKind, moment.heldMask, {
        shimmer,
        edgeGlow: Math.max(HELD_GLOW, lockGlow),
      });
    }
    ctx.restore();
  }

  private paintFragment(
    ui: Ui,
    showing: Showing,
    stage: Rect,
    centre: Point,
    keyWidth: number,
    clock: number,
    reduced: boolean,
  ): void {
    const { ctx } = ui;
    const { moment } = showing;
    const frame = showing.frame;
    if (!reduced && frame >= FRAGMENT_BEATS.lockAt) return;
    const pose = fragmentPose(frame, reduced);
    const fadeIntoSocket = reduced ? 1 - pose.toSocket : 1;
    const alpha = pose.alpha * fadeIntoSocket;
    if (alpha <= 0) return;
    const ink = KEY_INK[moment.keyKind];
    const socket = socketOf(moment, centre, keyWidth);
    const travel = reduced ? 0 : pose.toSocket;
    const at: Point = {
      x: centre.x + (socket.x - centre.x) * travel,
      y: centre.y + stage.h * pose.drop + (socket.y - centre.y) * travel,
    };
    const revealSize = keyWidth * REVEAL_SCALE;
    const size = (revealSize + (keyWidth - revealSize) * travel) * pose.scale;
    const climb = span(frame, FRAGMENT_BEATS.riseFrom, FRAGMENT_BEATS.revealAt);
    paintSoftPool(
      ctx,
      at.x,
      at.y,
      size * HALO_REACH,
      size * HALO_REACH,
      ink.glow,
      HALO_ALPHA * climb * alpha * (1 - travel),
      'linear',
    );
    paintMoteDrift(
      ctx,
      {
        origin: { x: at.x, y: at.y + size * EMBER_SPREAD * HALF },
        spread: size * EMBER_SPREAD,
        rise: size,
        sway: size * EMBER_SWAY,
        count: EMBER_COUNT,
        size: size * EMBER_SIZE,
        age: clock - FRAGMENT_BEATS.riseFrom,
        period: EMBER_PERIOD,
        swayPerFrame: EMBER_SWAY_PER_FRAME,
        seed: EMBER_SEED,
      },
      [ink.glow, ink.metal.highlight],
    );
    const flare = pulse(frame, FRAGMENT_BEATS.revealAt, FLARE_FRAMES);
    paintSoftPool(
      ctx,
      at.x,
      at.y,
      size * FLARE_REACH,
      size * FLARE_REACH,
      ink.glow,
      FLARE_ALPHA * flare,
      'linear',
    );
    if (size < MIN_KEY_WIDTH) return;
    const offset = fragmentPieceOffset(moment.index, moment.needed);
    ctx.save();
    ctx.globalAlpha *= alpha;
    paintKeyFragmentTurned(
      ctx,
      at.x - offset.x * size,
      at.y - offset.y * size,
      size,
      moment.keyKind,
      moment.index,
      moment.needed,
      pose.turn,
      pose.glint,
      revealSize,
    );
    ctx.restore();
  }

  // ── Words ──

  private wordsHeight(ui: UiMeasure, moment: FragmentMoment, width: number): number {
    const { space } = ui.theme;
    const name = ceremonyHeadline(ui, moment.fragment.name, width);
    return (
      lineHeightOf(ui, 'overline') +
      space.xs +
      name.lineHeight +
      space.xs +
      lineHeightOf(ui, 'label') +
      space.md +
      measureCarolineBox(ui, width, moment.issueLine.text)
    );
  }

  private paintWords(ui: Ui, showing: Showing, rect: Rect, reduced: boolean): void {
    const { ctx, theme } = ui;
    const { space } = theme;
    const { moment } = showing;
    const frame = showing.frame;
    const words = fragmentWords(frame);
    const ink = KEY_INK[moment.keyKind];
    let y = rect.y;
    const kickerH = lineHeightOf(ui, 'overline');
    ctx.save();
    ctx.globalAlpha *= words.kicker;
    glowText(
      ui,
      { x: rect.x, y, w: rect.w, h: kickerH },
      {
        text: keyKindDef(moment.keyKind).fragmentName,
        style: theme.type.overline,
        color: ink.metal.light,
        glow: ink.glow,
        glowBlur: KICKER_GLOW_BLUR,
      },
    );
    ctx.restore();
    y += kickerH + space.xs;

    const nameStyle = ceremonyHeadline(ui, moment.fragment.name, rect.w);
    const nameRect: Rect = { x: rect.x, y, w: rect.w, h: nameStyle.lineHeight };
    const scale = reduced ? 1 : words.nameScale;
    ctx.save();
    ctx.globalAlpha *= words.name;
    ctx.translate(nameRect.x + nameRect.w * HALF, nameRect.y + nameRect.h * HALF);
    ctx.scale(scale, scale);
    ctx.translate(-(nameRect.x + nameRect.w * HALF), -(nameRect.y + nameRect.h * HALF));
    glowText(ui, nameRect, {
      text: moment.fragment.name,
      style: nameStyle,
      color: theme.palette.text.bright,
      glow: ink.glow,
      glowBlur: NAME_GLOW_BLUR,
    });
    ctx.restore();
    y += nameRect.h + space.xs;

    const countH = lineHeightOf(ui, 'label');
    const countText = moment.completesKey ? WHOLE_KEY_LINE : `${moment.held} of ${moment.needed}`;
    ctx.save();
    ctx.globalAlpha *= words.count;
    glowText(
      ui,
      { x: rect.x, y, w: rect.w, h: countH },
      {
        text: countText,
        style: theme.type.label,
        color: moment.completesKey ? ink.metal.highlight : theme.palette.text.secondary,
        glow: ink.glow,
        glowBlur: moment.completesKey ? KICKER_GLOW_BLUR : 0,
      },
    );
    ctx.restore();
    y += countH + space.md;

    if (words.line <= 0) return;
    const message = moment.issueLine.text;
    const boxH = measureCarolineBox(ui, rect.w, message);
    const elapsedMs = this.lineElapsedMs(showing);
    const whole = showing.lineDone;
    ctx.save();
    ctx.globalAlpha *= words.line;
    carolineBox(
      ui,
      { x: rect.x, y, w: rect.w, h: Math.min(boxH, rect.y + rect.h - y) },
      {
        message,
        reveal: whole
          ? carolineSettled(message)
          : carolineRevealAt(theme, message, elapsedMs, reduced),
        nowMs: ui.now,
        open: whole ? CAROLINE_FULLY_OPEN : carolineOpenAt(theme, elapsedMs, reduced),
      },
    );
    ctx.restore();
  }
}

/**
 * The frame the ceremony's light runs on: the timeline's own frame, then on
 * past it while the settled screen idles.
 */
function clockOf(showing: Showing): number {
  return showing.frame + showing.settledFrames;
}

type FragmentCue = keyof typeof FRAGMENT_CUE_FRAMES;

/** Where the fragment's socket is in a silhouette `keyWidth` wide centred on `centre`. */
function socketOf(moment: FragmentMoment, centre: Point, keyWidth: number): Point {
  const offset = fragmentPieceOffset(moment.index, moment.needed);
  return { x: centre.x + offset.x * keyWidth, y: centre.y + offset.y * keyWidth };
}

/** The key's width on `stage`: the silhouette's, which the fragment's reveal is scaled from. */
function silhouetteWidth(stage: Rect): number {
  return Math.min(
    stage.w * SILHOUETTE_W_SHARE,
    (stage.h * SILHOUETTE_H_SHARE) / KEY_ART_ASPECT,
    SILHOUETTE_MAX_W,
  );
}

/** Every cue the ceremony raises, listed once rather than on every frame's sound check. */
const CEREMONY_CUES = Object.keys(FRAGMENT_CUE_FRAMES).filter(isCeremonyCue);

function isCeremonyCue(cue: string): cue is keyof typeof FRAGMENT_CUE_FRAMES {
  return cue in FRAGMENT_CUE_FRAMES;
}
