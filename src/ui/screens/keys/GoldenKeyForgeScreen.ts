/**
 * The forging of a floor's key: every fragment it needs summoned into a wide
 * ring of columns, circling faster and closer with gold streaks and arcs of
 * energy between them while the screen trembles, then slamming together in a
 * white flash. The whole key hangs in god rays with its seams glowing once,
 * and its name slams in over a line saying what it opens.
 *
 * Bigger than a fragment's ceremony on purpose: longer, louder, brighter.
 * One `modal` surface that halts the world and keeps the keyboard, opened by
 * the scene's key ceremonies, usually straight from the fragment that made
 * the key whole. A first press while it plays jumps to its settled state; the
 * next, once a short guard has passed, continues, and the caller flies the
 * key to the Keys button from where it hung.
 */

import type { AudioManager } from '../../../audio/AudioManager';
import { playKeyCue } from '../../../audio/keySoundCues';
import type { SoundId } from '../../../audio/sounds';
import { keyKindDef } from '../../../core/keys/keyKinds';
import type { ForgeMoment } from '../../../core/keys/keyMoments';
import {
  KEY_ART_ASPECT,
  fragmentPieceExtent,
  fragmentPieceOffset,
  paintKeyFragment,
  paintKeyTurned,
  warmKeyArt,
  type KeyArtPicture,
} from '../../../sprites/art/keyArt';
import type { Rect } from '../../core/geom';
import { prefersReducedMotion } from '../../core/reducedMotion';
import type { Surface, Ui, UiMeasure } from '../../core/UiRoot';
import { KEY_INK } from '../../theme/keyInk';
import { lineHeightOf, measureTextHeight, text } from '../../widgets/text';
import {
  paintLightColumn,
  paintMoteDrift,
  paintRayFan,
  paintScreenFlash,
  paintShockRing,
  paintSparkleBurst,
  type Point,
} from '../celebration/celebrationLight';
import { FULL_TURN, paintSoftPool } from '../../../sprites/lightMaps';
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
import { span } from './fragmentTimeline';
import {
  FORGE_BEATS,
  FORGE_CONTINUE_GUARD_FRAMES,
  FORGE_CUE_FRAMES,
  forgeBackdrop,
  forgeFlash,
  forgeKeyAlpha,
  forgeOrbit,
  forgePiecesAlpha,
  forgeRays,
  forgeSeamGlow,
  forgeShake,
  forgeSummonFrame,
  forgeSummoned,
  forgeWords,
} from './forgeTimeline';

type CueAudio = Pick<AudioManager, 'play' | 'playAt' | 'fadeOutSound'>;

type ForgeCue = keyof typeof FORGE_CUE_FRAMES;

/** The long build-up cues a skip cuts short: they belong to beats the skip jumps past. */
const CUT_ON_SKIP: ReadonlySet<ForgeCue> = new Set(['forgeSummon', 'forgeOrbitBuild']);
/** How quickly a cut cue fades, so it stops without a click. */
const CUE_CUT_FADE_MS = 120;

/** What the forge shows: the moment, and the line saying which stairwells the key opens. */
export interface ForgeShowing {
  readonly moment: ForgeMoment;
  readonly subline: string;
}

interface Showing extends ForgeShowing {
  frame: number;
  settledFrames: number;
}

/** Where the key hung as the forge closed, in canvas CSS pixels, for the flight to the Keys button. */
export interface ForgeHandOff {
  readonly moment: ForgeMoment;
  readonly at: Point;
  readonly keyWidth: number;
}

const KEY_W_SHARE = 0.8;
const KEY_H_SHARE = 0.55;
const KEY_MAX_W = 560;
const MIN_KEY_WIDTH = 8;
/** The ring the fragments are summoned into, as a share of the stage's half-size. */
const RING_RADIUS_SHARE = 0.92;
/** The first fragment is summoned on the ring's left, so a key of two pieces sits either side of the middle. */
const RING_START_ANGLE = Math.PI;
/** The ring is flattened into an ellipse this tall over wide, so it reads as lying round the key. */
const RING_SQUASH = 0.62;
/** A summoned fragment is drawn from a whole-key box this share of the forged key's width. */
const PIECE_SCALE = 0.62;
/** It grows to the forged key's own scale as the ring closes, so the pieces meet at their size in the key. */
const PIECE_SCALE_AT_FUSE = 1;
const COLUMN_HALF_WIDTH = 0.11;
const COLUMN_HEIGHT = 0.9;
const COLUMN_WIDEN = 1.5;
const COLUMN_ALPHA = 0.6;
/** The summoning columns stand where the pieces arrived and are gone this far into the orbit. */
const COLUMN_FADE_SHARE = 0.2;
const SUMMON_BURST_FRAMES = 26;
const SUMMON_BURST_COUNT = 10;
const SUMMON_BURST_REACH = 0.22;
const SUMMON_BURST_SIZE = 0.018;
/** A piece's trail: soft pools of light left behind it round the ring, each smaller and fainter. */
const TRAIL_STEPS = 10;
const TRAIL_LAG = 0.035;
const TRAIL_ALPHA = 0.32;
const TRAIL_REACH = 0.16;
/** The soft glow each orbiting piece carries, as the orbit quickens. */
const PIECE_GLOW_REACH = 0.32;
const PIECE_GLOW_ALPHA = 0.4;
const CORE_REACH = 0.9;
const CORE_ALPHA = 0.7;
const SHOCK_FRAMES = 42;
const SHOCK_REACH = 1.6;
const SHOCK_WIDTH = 0.05;
const SHOCK_SQUASH = 0.7;
const FUSE_BURST_FRAMES = 60;
const FUSE_BURST_COUNT = 40;
const FUSE_BURST_REACH = 1.3;
const FUSE_BURST_SIZE = 0.03;
const RAY_COUNT = 18;
const RAY_HALF_ANGLE = 0.07;
const RAY_REACH = 1.9;
const RAY_ALPHA = 0.36;
const COUNTER_RAY_COUNT = 11;
const COUNTER_RAY_HALF_ANGLE = 0.12;
const COUNTER_RAY_ALPHA = 0.16;
const RAY_TURN_PER_FRAME = 0.003;
const COUNTER_RAY_TURN_PER_FRAME = -0.0045;
const KEY_POOL_REACH = 1.1;
const KEY_POOL_ALPHA = 0.55;
const FOUNTAIN_COUNT = 30;
const FOUNTAIN_PERIOD = 120;
const FOUNTAIN_SIZE = 0.014;
const FOUNTAIN_SPREAD = 0.9;
const FOUNTAIN_RISE = 0.9;
const FOUNTAIN_SWAY = 0.05;
const FOUNTAIN_SWAY_PER_FRAME = 0.04;
const FOUNTAIN_SEED = 3100;
/** The whole key swings slowly about its upright axis, far enough to show its thickness, never edge-on. */
const KEY_TURN_PER_FRAME = 0.012;
const KEY_SWING = 0.85;
/** The swing is warmed ahead at this many angles across it, enough to touch every baked step. */
const SWING_WARM_SAMPLES = 24;
const KEY_BOB = 0.012;
const KEY_BOB_PER_FRAME = 0.03;
const GLINT_PERIOD = 160;
const SHAKE_PX = 14;
const TITLE_GLOW_BLUR = 30;
const BURST_SEED_SUMMON = 11;
const BURST_SEED_FUSE = 13;
const CONTINUE_LABEL = 'Continue';
const HALF = 0.5;

export class GoldenKeyForgeScreen {
  private showing: Showing | null = null;
  /** Where the key hung on the last frame drawn, for the flight to the Keys button. */
  private lastKey: { at: Point; keyWidth: number } | null = null;
  private readonly reducedMotion: () => boolean;
  /** The take each cue of the forge on screen played, so a skip or a teardown can cut it. */
  private readonly sounding = new Map<ForgeCue, SoundId>();

  constructor(
    private readonly audio: CueAudio | null,
    private readonly onContinue: (handOff: ForgeHandOff) => void,
    reducedMotion: () => boolean = prefersReducedMotion,
  ) {
    this.reducedMotion = reducedMotion;
  }

  get isOpen(): boolean {
    return this.showing !== null;
  }

  open(showing: ForgeShowing): void {
    this.sounding.clear();
    this.showing = { ...showing, frame: 0, settledFrames: 0 };
    this.lastKey = null;
    this.sound(-1, 0);
  }

  tick(): void {
    const showing = this.showing;
    if (showing === null) return;
    const before = showing.frame;
    if (showing.frame < FORGE_BEATS.settledAt) showing.frame++;
    else showing.settledFrames++;
    this.sound(before, showing.frame);
  }

  skip(): void {
    const showing = this.showing;
    if (showing === null || showing.frame >= FORGE_BEATS.settledAt) return;
    this.cut((cue) => CUT_ON_SKIP.has(cue));
    if (showing.frame < FORGE_CUE_FRAMES.forgeFanfare) this.play('forgeFanfare');
    showing.frame = FORGE_BEATS.settledAt;
    showing.settledFrames = 0;
  }

  /** Closes the screen at once, as everything under it is torn down, and silences its cues. */
  dismiss(): void {
    this.cut(() => true);
    this.showing = null;
  }

  private play(cue: ForgeCue): void {
    const id = playKeyCue(this.audio, cue, null, 'ui');
    if (id !== null) this.sounding.set(cue, id);
  }

  private cut(which: (cue: ForgeCue) => boolean): void {
    for (const [cue, id] of this.sounding) {
      if (!which(cue)) continue;
      this.audio?.fadeOutSound(id, CUE_CUT_FADE_MS);
      this.sounding.delete(cue);
    }
  }

  private ready(showing: Showing): boolean {
    return (
      showing.frame >= FORGE_BEATS.settledAt && showing.settledFrames >= FORGE_CONTINUE_GUARD_FRAMES
    );
  }

  private advance(): void {
    const showing = this.showing;
    if (showing === null) return;
    if (showing.frame < FORGE_BEATS.settledAt) {
      this.skip();
      return;
    }
    if (!this.ready(showing)) return;
    this.showing = null;
    const key = this.lastKey ?? { at: { x: 0, y: 0 }, keyWidth: 0 };
    this.onContinue({ moment: showing.moment, at: key.at, keyWidth: key.keyWidth });
  }

  private sound(from: number, to: number): void {
    for (const cue of CEREMONY_CUES) {
      const at = FORGE_CUE_FRAMES[cue];
      if (from < at && to >= at) this.play(cue);
    }
  }

  /**
   * Bakes ahead, within the frame's bake budget, the art `showing`'s forge
   * will draw on this viewport, while it waits to open.
   */
  prepare(target: UiMeasure, showing: ForgeShowing): boolean {
    const { stage } = ceremonyLayout(target, (w) => this.wordsHeight(target, showing, w));
    const keyWidth = forgedKeyWidth(stage);
    if (keyWidth < MIN_KEY_WIDTH) return true;
    const pictures = forgePictures(showing.moment.needed);
    return warmKeyArt(target.ctx, keyWidth, showing.moment.keyKind, pictures);
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
    const settled = frame >= FORGE_BEATS.settledAt;
    paintCeremonyBackdrop(ui, forgeBackdrop(frame));
    const layout = ceremonyLayout(ui, (w) => this.wordsHeight(ui, showing, w));
    const shake = shakeOffset(clock, forgeShake(frame, reduced), SHAKE_PX);
    ctx.save();
    ctx.translate(shake.x, shake.y);
    this.paintStage(ui, showing, layout.stage, clock, reduced);
    ctx.restore();
    this.paintWords(ui, showing, layout.words, reduced);
    paintScreenFlash(ctx, ui.screen, ui.theme.palette.text.bright, forgeFlash(frame, reduced));
    paintCeremonyFooter(ui, layout.footer, {
      settled,
      label: CONTINUE_LABEL,
      ready: this.ready(showing),
      alpha: 1,
      onContinue: () => this.advance(),
    });
    registerSkip(ui, settled, () => this.skip());
  }

  private paintStage(ui: Ui, showing: Showing, stage: Rect, clock: number, reduced: boolean): void {
    const { ctx } = ui;
    const { moment } = showing;
    const frame = showing.frame;
    const ink = KEY_INK[moment.keyKind];
    const keyWidth = forgedKeyWidth(stage);
    if (keyWidth < MIN_KEY_WIDTH) return;
    const centre: Point = { x: stage.x + stage.w * HALF, y: stage.y + stage.h * HALF };
    this.lastKey = {
      at: { x: centre.x * ui.uiScale, y: centre.y * ui.uiScale },
      keyWidth: keyWidth * ui.uiScale,
    };
    const summonedSize = keyWidth * PIECE_SCALE;
    const widestPiece = Math.max(
      ...Array.from({ length: moment.needed }, (_, i) => fragmentPieceExtent(i, moment.needed).w),
    );
    const tallestPiece = Math.max(
      ...Array.from({ length: moment.needed }, (_, i) => fragmentPieceExtent(i, moment.needed).h),
    );
    const ringRoomX = stage.w * HALF - widestPiece * summonedSize * HALF;
    const ringRoomY = stage.h * HALF - tallestPiece * summonedSize * HALF;
    const ringRx = Math.max(0, Math.min(ringRoomX, ringRoomY / RING_SQUASH) * RING_RADIUS_SHARE);
    if (frame < FORGE_BEATS.fuseAt)
      warmKeyArt(ctx, keyWidth, moment.keyKind, forgePictures(moment.needed));
    const orbit = forgeOrbit(frame, reduced);
    const piecesAlpha = forgePiecesAlpha(frame, reduced);
    const fuseAt = FORGE_BEATS.fuseAt;

    if (frame < fuseAt) {
      const core = orbit.progress * orbit.progress;
      paintSoftPool(
        ctx,
        centre.x,
        centre.y,
        keyWidth * CORE_REACH,
        keyWidth * CORE_REACH,
        ink.glow,
        CORE_ALPHA * core,
        'linear',
      );
    }

    const pieceAt = (i: number, lag: number): Point => {
      const angle = orbit.turn - lag + (i / moment.needed) * FULL_TURN + RING_START_ANGLE;
      const r = ringRx * orbit.radius;
      return {
        x: centre.x + Math.cos(angle) * r,
        y: centre.y + Math.sin(angle) * r * RING_SQUASH,
      };
    };
    const summonSpot = (i: number): Point => {
      const angle = (i / moment.needed) * FULL_TURN + RING_START_ANGLE;
      return {
        x: centre.x + Math.cos(angle) * ringRx,
        y: centre.y + Math.sin(angle) * ringRx * RING_SQUASH,
      };
    };
    const homeOf = (i: number): Point => {
      const offset = fragmentPieceOffset(i, moment.needed);
      return { x: offset.x * keyWidth, y: offset.y * keyWidth };
    };

    if (piecesAlpha > 0) {
      const closing = orbit.radius;
      const scale = PIECE_SCALE + (PIECE_SCALE_AT_FUSE - PIECE_SCALE) * (1 - closing);
      const size = keyWidth * scale;
      for (let i = 0; i < moment.needed; i++) {
        const shown = forgeSummoned(frame, i) * piecesAlpha;
        if (shown <= 0) continue;
        const ringPoint = pieceAt(i, 0);
        const home = homeOf(i);
        const at: Point = {
          x: ringPoint.x + home.x * (1 - closing),
          y: ringPoint.y + home.y * (1 - closing),
        };
        const columnFade = 1 - span(orbit.progress, 0, COLUMN_FADE_SHARE);
        const summonedAt = summonSpot(i);
        paintLightColumn(
          ctx,
          {
            base: { x: summonedAt.x, y: summonedAt.y + summonedSize * KEY_ART_ASPECT * HALF },
            halfBase: keyWidth * COLUMN_HALF_WIDTH * shown,
            widen: COLUMN_WIDEN,
            height: keyWidth * COLUMN_HEIGHT,
          },
          ink.glow,
          COLUMN_ALPHA * shown * columnFade,
          clock,
        );
        if (!reduced && orbit.progress > 0) {
          this.paintTrail(ctx, i, pieceAt, orbit.progress, keyWidth, ink.glow);
          paintSoftPool(
            ctx,
            at.x,
            at.y,
            keyWidth * PIECE_GLOW_REACH,
            keyWidth * PIECE_GLOW_REACH,
            ink.glow,
            PIECE_GLOW_ALPHA * orbit.progress * shown,
            'linear',
          );
        }
        paintSparkleBurst(
          ctx,
          {
            at,
            progress: span(frame, forgeSummonFrame(i), forgeSummonFrame(i) + SUMMON_BURST_FRAMES),
            count: SUMMON_BURST_COUNT,
            reach: keyWidth * SUMMON_BURST_REACH,
            size: keyWidth * SUMMON_BURST_SIZE,
            seed: BURST_SEED_SUMMON + i,
          },
          ink.glow,
          ink.metal.highlight,
        );
        if (size < MIN_KEY_WIDTH) continue;
        const offset = fragmentPieceOffset(i, moment.needed);
        ctx.save();
        ctx.globalAlpha *= shown;
        paintKeyFragment(
          ctx,
          at.x - offset.x * size,
          at.y - offset.y * size,
          size,
          moment.keyKind,
          i,
          moment.needed,
          (clock / GLINT_PERIOD + i / moment.needed) % 1,
          keyWidth,
        );
        ctx.restore();
      }
    }

    const rays = forgeRays(frame);
    paintRayFan(
      ctx,
      centre,
      {
        count: RAY_COUNT,
        halfAngle: RAY_HALF_ANGLE,
        reach: keyWidth * RAY_REACH,
        turn: reduced ? 0 : clock * RAY_TURN_PER_FRAME,
      },
      ink.glow,
      RAY_ALPHA * rays,
    );
    paintRayFan(
      ctx,
      centre,
      {
        count: COUNTER_RAY_COUNT,
        halfAngle: COUNTER_RAY_HALF_ANGLE,
        reach: keyWidth * RAY_REACH,
        turn: reduced ? 0 : clock * COUNTER_RAY_TURN_PER_FRAME,
      },
      ink.metal.highlight,
      COUNTER_RAY_ALPHA * rays,
    );
    const keyAlpha = forgeKeyAlpha(frame, reduced);
    paintSoftPool(
      ctx,
      centre.x,
      centre.y,
      keyWidth * KEY_POOL_REACH,
      keyWidth * KEY_POOL_REACH,
      ink.glow,
      KEY_POOL_ALPHA * keyAlpha,
      'linear',
    );
    const shock = span(frame, fuseAt, fuseAt + SHOCK_FRAMES);
    if (!reduced && shock > 0 && shock < 1) {
      paintShockRing(
        ctx,
        {
          at: centre,
          radius: keyWidth * SHOCK_REACH * shock,
          squash: SHOCK_SQUASH,
          lineWidth: keyWidth * SHOCK_WIDTH * (1 - shock),
        },
        ink.metal.highlight,
        1 - shock,
      );
    }
    if (keyAlpha > 0) this.paintForgedKey(ui, showing, centre, keyWidth, clock, reduced, keyAlpha);
    paintMoteDrift(
      ctx,
      {
        origin: { x: centre.x, y: centre.y + keyWidth * KEY_ART_ASPECT },
        spread: keyWidth * FOUNTAIN_SPREAD,
        rise: keyWidth * FOUNTAIN_RISE,
        sway: keyWidth * FOUNTAIN_SWAY,
        count: Math.round(FOUNTAIN_COUNT * keyAlpha),
        size: keyWidth * FOUNTAIN_SIZE,
        age: clock - fuseAt,
        period: FOUNTAIN_PERIOD,
        swayPerFrame: FOUNTAIN_SWAY_PER_FRAME,
        seed: FOUNTAIN_SEED,
      },
      [ink.glow, ink.metal.highlight, ink.glint],
    );
    paintSparkleBurst(
      ctx,
      {
        at: centre,
        progress: reduced ? -1 : span(frame, fuseAt, fuseAt + FUSE_BURST_FRAMES),
        count: FUSE_BURST_COUNT,
        reach: keyWidth * FUSE_BURST_REACH,
        size: keyWidth * FUSE_BURST_SIZE,
        seed: BURST_SEED_FUSE,
      },
      ink.glow,
      ink.glint,
    );
  }

  /** Soft pools of light trailing piece `i` round the ring, longer and brighter as the orbit quickens. */
  private paintTrail(
    ctx: CanvasRenderingContext2D,
    i: number,
    pieceAt: (i: number, lag: number) => Point,
    progress: number,
    keyWidth: number,
    tint: string,
  ): void {
    for (let step = 1; step <= TRAIL_STEPS; step++) {
      const fade = 1 - step / (TRAIL_STEPS + 1);
      paintSoftPool(
        ctx,
        pieceAt(i, step * TRAIL_LAG * progress * FULL_TURN * HALF).x,
        pieceAt(i, step * TRAIL_LAG * progress * FULL_TURN * HALF).y,
        keyWidth * TRAIL_REACH * fade,
        keyWidth * TRAIL_REACH * fade,
        tint,
        TRAIL_ALPHA * progress * fade,
        'linear',
      );
    }
  }

  private paintForgedKey(
    ui: Ui,
    showing: Showing,
    centre: Point,
    keyWidth: number,
    clock: number,
    reduced: boolean,
    alpha: number,
  ): void {
    const { ctx } = ui;
    const { moment } = showing;
    const since = clock - FORGE_BEATS.fuseAt;
    const yaw = reduced ? 0 : Math.sin(since * KEY_TURN_PER_FRAME) * KEY_SWING;
    const bob = reduced ? 0 : Math.sin(since * KEY_BOB_PER_FRAME) * keyWidth * KEY_BOB;
    const glint = reduced ? undefined : (Math.max(0, since) % GLINT_PERIOD) / GLINT_PERIOD;
    ctx.save();
    ctx.globalAlpha *= alpha;
    paintKeyTurned(ctx, centre.x, centre.y + bob, keyWidth, moment.keyKind, yaw, {
      glint,
      seams: { count: moment.needed, alpha: forgeSeamGlow(showing.frame) },
    });
    ctx.restore();
  }

  // ── Words ──

  private titleOf(showing: ForgeShowing): string {
    return `The ${keyKindDef(showing.moment.keyKind).name}`;
  }

  private wordsHeight(ui: UiMeasure, showing: ForgeShowing, width: number): number {
    const { space } = ui.theme;
    const title = ceremonyHeadline(ui, this.titleOf(showing), width);
    return (
      title.lineHeight +
      space.sm +
      Math.max(
        lineHeightOf(ui, 'title'),
        measureTextHeight(ui, width, { text: showing.subline, role: 'title' }),
      )
    );
  }

  private paintWords(ui: Ui, showing: Showing, rect: Rect, reduced: boolean): void {
    const { ctx, theme } = ui;
    const ink = KEY_INK[showing.moment.keyKind];
    const words = forgeWords(showing.frame);
    const title = this.titleOf(showing);
    const style = ceremonyHeadline(ui, title, rect.w);
    const titleRect: Rect = { x: rect.x, y: rect.y, w: rect.w, h: style.lineHeight };
    const scale = reduced ? 1 : words.titleScale;
    const cx = titleRect.x + titleRect.w * HALF;
    const cy = titleRect.y + titleRect.h * HALF;
    ctx.save();
    ctx.globalAlpha *= words.title;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
    glowText(ui, titleRect, {
      text: title,
      style,
      color: ink.metal.highlight,
      glow: ink.glow,
      glowBlur: TITLE_GLOW_BLUR,
    });
    ctx.restore();
    const subY = titleRect.y + titleRect.h + theme.space.sm;
    ctx.save();
    ctx.globalAlpha *= words.subline;
    text(
      ui,
      { x: rect.x, y: subY, w: rect.w, h: rect.y + rect.h - subY },
      {
        text: showing.subline,
        role: 'title',
        color: theme.palette.text.primary,
        align: 'center',
        wrap: true,
      },
    );
    ctx.restore();
  }
}

/** The forged key's width on `stage`. */
function forgedKeyWidth(stage: Rect): number {
  return Math.min(stage.w * KEY_W_SHARE, (stage.h * KEY_H_SHARE) / KEY_ART_ASPECT, KEY_MAX_W);
}

/** Every picture the forge draws from: its pieces still, the whole key across its swing, its seams. */
function forgePictures(needed: number): readonly KeyArtPicture[] {
  const swing = Array.from(
    { length: SWING_WARM_SAMPLES + 1 },
    (_, i) => KEY_SWING * ((i / SWING_WARM_SAMPLES) * 2 - 1),
  );
  return [
    ...Array.from({ length: needed }, (_, index): KeyArtPicture => ({
      look: 'fragment',
      index,
      count: needed,
      yaws: [0],
    })),
    { look: 'key', yaws: swing },
    { look: 'seams', count: needed },
  ];
}

/** Every cue the ceremony raises, listed once rather than on every frame's sound check. */
const CEREMONY_CUES = Object.keys(FORGE_CUE_FRAMES).filter(isCeremonyCue);

function isCeremonyCue(cue: string): cue is keyof typeof FORGE_CUE_FRAMES {
  return cue in FORGE_CUE_FRAMES;
}
