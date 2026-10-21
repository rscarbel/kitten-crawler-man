/**
 * The title screen every player lands on. Thin glue: it owns the clock, the
 * state machine, the camera, the light rig, the layer stack and the music
 * claim, and leaves every picture to the layers in `TITLE_LAYERS` and every
 * choice to the title menu.
 */

import { Scene, type SceneManager } from '../../core/Scene';
import type { InputManager } from '../../core/InputManager';
import type { AudioManager } from '../../audio/AudioManager';
import { GATED_SFX_GROUPS } from '../../audio/sfxGroups';
import type { AudioScope } from '../../audio/AudioScope';
import type { DungeonSceneOptions } from '../DungeonScene';
import { UiRoot } from '../../ui/core/UiRoot';
import {
  browserViewportInput,
  NO_INSETS,
  resolveViewport,
  type SafeAreaInsets,
  type ViewportInput,
} from '../../ui/core/viewport';
import { TITLE_INK } from '../../ui/theme/titleInk';
import { TITLE_STEP_MS, TitleClockSource, type TitleMoment, type TitleState } from './titleClock';
import { TitleCameraRig } from './titleCamera';
import type { TitleLayer } from './titleLayer';
import { TITLE_LAYERS } from './titleLayers';
import { TitleMenu, type TitleMenuChoice } from './titleMenu';
import { freshTitleEventSeed, TitleEventScheduler, TitleQuipChannel } from './titleEvents';
import { titlePromptSurface } from './titlePrompt';
import { TitleMusicPulse } from './titlePulse';
import { TITLE_WELCOME_HOLD_MS, TITLE_WELCOME_LINE, titleSystemAiSurface } from './titleSystemAi';
import { TitleLightRigState, stageLayout, type TitleStage } from './titleStage';
import {
  DIVE_DURATION_MS,
  DIVE_TIMELINE,
  IGNITION_DURATION_MS,
  IGNITION_TIMELINE,
  TimelineCursor,
  type TitleKeyframe,
} from './titleTimeline';

const TITLE_TRACK = 'welcome_to_the_dungeon';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function prefersReducedMotion(): boolean {
  if (typeof globalThis.matchMedia !== 'function') return false;
  return globalThis.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Where a title scene starts. Left unset, it follows the audio context:
 * dormant until the context runs, or straight to `alive` when it already does.
 * - `dormant`: holds the dormant picture even after the first gesture.
 * - `ignition`: plays the reveal from its first frame.
 * - `alive`: opens on the idle loop, as if the reveal had played.
 */
export type TitleStartState = Extract<TitleState, 'dormant' | 'ignition' | 'alive'>;

/** Dev routes and review renders; the game passes none of these. */
export interface TitleSceneHarness {
  readonly startState?: TitleStartState;
  /** Replaces the live browser viewport. */
  readonly viewport?: () => ViewportInput;
  /** Replaces `performance.now` for the menu's tweens and the hint's pulse. */
  readonly now?: () => number;
  /** Replaces the `prefers-reduced-motion` query. */
  readonly reducedMotion?: boolean;
  /** Fixes which idle beats play when; a live title draws a fresh one. */
  readonly eventSeed?: number;
}

export class TitleScene extends Scene {
  readonly ui: UiRoot;
  private readonly audio: AudioManager | null;
  private scope: AudioScope | null = null;
  private readonly viewportInput: () => ViewportInput;
  private readonly clock: TitleClockSource;
  private readonly camera = new TitleCameraRig();
  private readonly lights = new TitleLightRigState();
  private readonly layers: readonly TitleLayer[];
  private readonly menu: TitleMenu;
  private readonly events: TitleEventScheduler;
  /** The System AI's lines (its welcome, then sponsor quips), for the line that shows them to listen on. */
  readonly quips = new TitleQuipChannel();
  private readonly pulse: TitleMusicPulse;
  private stage: TitleStage;
  /** The insets the stage was laid out inside; a change (a rotation) lays it out again. */
  private stageSafeArea: SafeAreaInsets = NO_INSETS;
  private ignitionCursor = new TimelineCursor(IGNITION_TIMELINE);
  private diveCursor = new TimelineCursor(DIVE_TIMELINE);
  /** What the dive hands over to once it finishes; null until a choice is taken. */
  private pendingLaunch: (() => void) | null = null;
  private launched = false;
  private exited = false;

  constructor(
    input: InputManager,
    sceneManager: SceneManager,
    baseOptions: DungeonSceneOptions,
    /** Present only when a saved checkpoint exists on this device. */
    onContinue?: () => void,
    private readonly harness: TitleSceneHarness = {},
  ) {
    super();
    this.audio = baseOptions.audio ?? null;
    for (const group of GATED_SFX_GROUPS) this.audio?.holdSfxGroup(group, false);
    this.viewportInput = harness.viewport ?? browserViewportInput;
    this.clock = new TitleClockSource(
      { ignitionMs: IGNITION_DURATION_MS, diveMs: DIVE_DURATION_MS },
      harness.reducedMotion ?? prefersReducedMotion(),
    );
    this.pulse = new TitleMusicPulse(this.audio, TITLE_TRACK);
    this.layers = TITLE_LAYERS.map((build) => build());
    this.stage = this.layoutStage();
    this.events = new TitleEventScheduler(
      {
        broadcast: (fire) => {
          for (const layer of this.layers) layer.onEvent?.(fire);
        },
        quip: (quip) => this.quips.publish(quip),
      },
      harness.eventSeed ?? freshTitleEventSeed(),
    );

    this.ui = new UiRoot({
      audio: this.audio,
      viewport: this.viewportInput,
      now: harness.now,
      handleWorldPointer: () => {
        // The menu is a modal, so every gesture lands on it; nothing lies beneath.
      },
    });
    this.menu = new TitleMenu({
      input,
      sceneManager,
      baseOptions,
      onContinue,
      stage: () => this.stage,
      clock: () => this.clock,
      choose: (launch) => this.dive(launch),
    });
    this.ui.mount(
      titlePromptSurface({
        showing: () => this.clock.state === 'dormant',
        stage: () => this.stage,
        menuStrip: (ui) => this.menu.layout(ui).strip,
      }),
    );
    this.ui.mount(
      titleSystemAiSurface({
        clock: () => this.clock,
        quips: this.quips,
        stage: () => this.stage,
        menuStrip: (ui) => this.menu.layout(ui).strip,
      }),
    );
    this.ui.mount(this.menu.surface());
  }

  /** The menu's choices in order, as the player sees them. */
  choices(): readonly TitleMenuChoice[] {
    return this.menu.choices();
  }

  get state(): TitleState {
    return this.clock.state;
  }

  onEnter(): void {
    this.layoutLayers();
    this.claimTitleMusic();
    this.enterStartState();
  }

  onExit(): void {
    this.exited = true;
    this.scope?.dispose();
    this.scope = null;
    this.pulse.dispose();
    for (const layer of this.layers) layer.dispose?.();
  }

  /**
   * Pins the scene to one instant for good, with every cue before it already
   * delivered, so a review render shows exactly that moment.
   */
  showMoment(moment: TitleMoment): void {
    this.clock.freezeAt(moment);
    this.events.restart();
    this.quips.clear();
    this.ignitionCursor = new TimelineCursor(IGNITION_TIMELINE);
    this.diveCursor = new TimelineCursor(DIVE_TIMELINE);
    const { elapsedMs, stateElapsedMs } = this.clock;
    const stateStartedAtMs = elapsedMs - stateElapsedMs;
    if (moment.state === 'ignition') {
      this.deliver(this.ignitionCursor.advanceTo(stateElapsedMs), stateStartedAtMs);
    } else if (moment.state === 'alive') {
      this.deliverWholeIgnition(stateStartedAtMs);
    } else if (moment.state === 'dive' && moment.diveFrom !== 'dormant') {
      this.deliverWholeIgnition(stateStartedAtMs);
    }
    if (moment.state === 'dive') {
      this.deliver(this.diveCursor.advanceTo(stateElapsedMs), stateStartedAtMs);
    }
    this.events.update(this.clock);
    this.clock.musicPulse = this.pulse.sample(this.clock);
    this.camera.update(this.clock, this.stage);
    for (const layer of this.layers) layer.update?.(this.clock, this.stage);
  }

  update(): void {
    this.relayoutIfResized();
    this.clock.tick(TITLE_STEP_MS);
    if (!this.clock.isFrozen) this.advanceStateMachine();
    this.events.update(this.clock);
    this.clock.musicPulse = this.pulse.sample(this.clock);
    this.camera.update(this.clock, this.stage);
    for (const layer of this.layers) layer.update?.(this.clock, this.stage);
  }

  render(ctx: CanvasRenderingContext2D): void {
    this.relayoutIfResized();
    ctx.save();
    ctx.fillStyle = TITLE_INK.void.clear;
    ctx.fillRect(0, 0, this.stage.width, this.stage.height);
    ctx.restore();
    for (const layer of this.layers) {
      ctx.save();
      layer.render(ctx, this.clock, this.stage, this.camera);
      ctx.restore();
    }
    this.ui.frame(ctx);
  }

  private claimTitleMusic(): void {
    if (this.audio === null) return;
    this.scope = this.audio.createScope();
    this.scope.claimMusic({
      owner: 'title',
      layer: 'area',
      selection: { kind: 'loop', id: TITLE_TRACK },
    });
  }

  private enterStartState(): void {
    const requested = this.harness.startState;
    if (requested === 'dormant') return;
    if (requested === 'ignition') {
      this.beginIgnition();
      return;
    }
    const audio = this.audio;
    // With no audio at all there is no gesture to wait for, so nothing would ever ignite.
    if (requested === 'alive' || audio === null || audio.isRunning) {
      this.skipToAlive();
      return;
    }
    // `onRunning` keeps the callback past this scene's exit, so the scene checks it is still up.
    audio.onRunning(() => {
      if (!this.exited && this.clock.state === 'dormant') this.beginIgnition();
    });
  }

  private beginIgnition(): void {
    this.clock.enterState('ignition');
    this.ignitionCursor = new TimelineCursor(IGNITION_TIMELINE);
    this.deliver(this.ignitionCursor.advanceTo(this.clock.stateElapsedMs), this.stateStartedAtMs());
  }

  /** The fast path: the end of the reveal, with every one of its cues delivered. */
  private skipToAlive(): void {
    this.deliverWholeIgnition(this.clock.elapsedMs);
    this.clock.enterState('alive');
  }

  /** Every ignition cue, timed as if the reveal had finished at `endedAtMs` on the scene clock. */
  private deliverWholeIgnition(endedAtMs: number): void {
    this.ignitionCursor = new TimelineCursor(IGNITION_TIMELINE);
    this.deliver(
      this.ignitionCursor.advanceTo(IGNITION_DURATION_MS),
      endedAtMs - IGNITION_DURATION_MS,
    );
  }

  private dive(launch: () => void): void {
    if (this.pendingLaunch !== null) return;
    this.pendingLaunch = launch;
    this.clock.enterState('dive');
    this.diveCursor = new TimelineCursor(DIVE_TIMELINE);
    this.deliver(this.diveCursor.advanceTo(this.clock.stateElapsedMs), this.stateStartedAtMs());
  }

  private stateStartedAtMs(): number {
    return this.clock.elapsedMs - this.clock.stateElapsedMs;
  }

  private advanceStateMachine(): void {
    const { state, stateElapsedMs } = this.clock;
    if (state === 'ignition') {
      this.deliver(this.ignitionCursor.advanceTo(stateElapsedMs), this.stateStartedAtMs());
      if (stateElapsedMs >= IGNITION_DURATION_MS) this.clock.enterState('alive');
      return;
    }
    if (state === 'dive') {
      this.deliver(this.diveCursor.advanceTo(stateElapsedMs), this.stateStartedAtMs());
      const launch = this.pendingLaunch;
      if (stateElapsedMs < DIVE_DURATION_MS || launch === null || this.launched) return;
      this.launched = true;
      launch();
    }
  }

  /**
   * Hands `keyframes` to the camera, the layers and the System AI line, each
   * timed on the scene clock from `sequenceStartedAtMs`, so a sequence
   * entered part-way shows a cue already as far along as it would be.
   */
  private deliver(keyframes: readonly TitleKeyframe[], sequenceStartedAtMs: number): void {
    const { reducedMotion } = this.clock;
    for (const keyframe of keyframes) {
      const firedAtElapsedMs = sequenceStartedAtMs + keyframe.atMs;
      this.camera.onCue(keyframe.cue, firedAtElapsedMs, reducedMotion);
      for (const layer of this.layers) layer.onCue?.(keyframe.cue);
      if (keyframe.cue === 'typewriterStart') {
        this.quips.publish({
          text: TITLE_WELCOME_LINE,
          startedAtMs: firedAtElapsedMs,
          durationMs: TITLE_WELCOME_HOLD_MS,
        });
      }
    }
  }

  private layoutStage(): TitleStage {
    const input = this.viewportInput();
    const { cssWidth, cssHeight, safeArea } = input;
    const { size } = resolveViewport(input);
    const stage = stageLayout({ width: cssWidth, height: cssHeight, safeArea, size }, this.lights);
    this.stageSafeArea = safeArea;
    this.lights.fitTo(stage.torches.length);
    return stage;
  }

  private layoutLayers(): void {
    for (const layer of this.layers) layer.layout?.(this.stage);
  }

  private relayoutIfResized(): void {
    const { cssWidth, cssHeight, safeArea } = this.viewportInput();
    const laidOut = this.stageSafeArea;
    const sameInsets =
      safeArea.t === laidOut.t &&
      safeArea.r === laidOut.r &&
      safeArea.b === laidOut.b &&
      safeArea.l === laidOut.l;
    if (cssWidth === this.stage.width && cssHeight === this.stage.height && sameInsets) return;
    this.stage = this.layoutStage();
    this.layoutLayers();
  }
}
