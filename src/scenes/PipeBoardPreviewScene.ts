/**
 * The pipe board bench (`?pipeboard`, or `?pipeboard=<seed>`): the real board
 * surface and explainer over a stand-in for the bathroom system. Pick a tier,
 * step the world seed, and let the solver play the board one turn at a time
 * to watch the flood, the leaks and the win moment. The board is generated
 * one attempt per frame, as the game does behind the explainer.
 *
 * The board sits over the header while it is open; close it (Escape or ✕) to
 * reach the controls.
 */

import type { Difficulty } from '../core/difficulty/difficultyProfiles';
import { viewportHeight, viewportWidth } from '../core/rendering/Viewport';
import { DevPipeBoardSource, nextSolverTurn } from '../dev/pipeBoardDevSource';
import {
  PIPE_BOARD_DIFFICULTIES,
  createPipeBoard,
  turnTile,
} from '../systems/cloggedBathroom/pipeBoard';
import {
  GENERATION_ATTEMPTS_MAX,
  createPipeBoardGeneration,
  type PipeBoardGeneration,
} from '../systems/cloggedBathroom/pipeBoardGenerator';
import { pipeBoardExplainerSurface } from '../ui/screens/dialogs/pipeBoardExplainer';
import { pipeBoardSurfaces } from '../ui/screens/dialogs/pipeBoardSurface';
import { previewInk } from '../ui/theme/previewInk';
import { PreviewScene, type PreviewControl } from './PreviewScene';

const DEFAULT_SEED = 1;
/** Frames between the solver's turns, slow enough to watch each flood. */
const AUTOPLAY_INTERVAL_FRAMES = 20;
const SEED_RANGE = 1_000_000;

const TIER_LABELS: Readonly<Record<Difficulty, string>> = {
  easy: 'Kitten (easy)',
  normal: 'Crawler (normal)',
  hard: 'Nightmare (hard)',
};

function seedFromUrl(): number {
  const raw = new URLSearchParams(window.location.search).get('pipeboard');
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_SEED;
}

export class PipeBoardPreviewScene extends PreviewScene {
  private tier: Difficulty = 'normal';
  private seed = seedFromUrl();
  private autoplay = false;
  private frame = 0;
  private explainerOpen = false;
  private readonly source = new DevPipeBoardSource(null);
  private generation: PipeBoardGeneration;

  constructor() {
    super();
    this.generation = createPipeBoardGeneration(this.seed, this.tier);
    for (const surface of pipeBoardSurfaces(this.boardSource())) this.ui.mount(surface);
    const explainerOpen = (): boolean => this.explainerOpen;
    this.ui.mount(
      pipeBoardExplainerSurface({
        get isPipeBoardExplainerOpen() {
          return explainerOpen();
        },
        finishPipeBoardExplainer: () => {
          this.explainerOpen = false;
          this.source.isPipeBoardOpen = true;
        },
        dismissPipeBoardExplainer: () => {
          this.explainerOpen = false;
        },
      }),
    );
  }

  /** The dev source, with "How it works" wired to this bench's explainer. */
  private boardSource(): DevPipeBoardSource {
    this.source.openPipeBoardExplainer = () => {
      this.explainerOpen = true;
    };
    return this.source;
  }

  private regenerate(): void {
    this.source.pipeBoard = null;
    this.source.pipeBoardSolved = false;
    this.source.pipeBoardGenerationProgress = 0;
    this.generation = createPipeBoardGeneration(this.seed, this.tier);
  }

  protected previewTitle(): string {
    return 'Pipe board — ?pipeboard';
  }

  protected previewControls(): readonly PreviewControl[] {
    const tiers = PIPE_BOARD_DIFFICULTIES.map((tier): PreviewControl => ({
      id: `tier-${tier}`,
      label: TIER_LABELS[tier],
      selected: tier === this.tier,
      onTap: () => {
        this.tier = tier;
        this.regenerate();
      },
    }));
    return [
      ...tiers,
      {
        id: 'seed-down',
        label: 'Seed −',
        onTap: () => {
          this.seed--;
          this.regenerate();
        },
      },
      {
        id: 'seed-up',
        label: 'Seed +',
        onTap: () => {
          this.seed++;
          this.regenerate();
        },
      },
      {
        id: 'seed-random',
        label: 'Random seed',
        onTap: () => {
          this.seed = Math.floor(Math.random() * SEED_RANGE);
          this.regenerate();
        },
      },
      {
        id: 'autoplay',
        label: `Autoplay solver: ${this.autoplay ? 'on' : 'off'}`,
        selected: this.autoplay,
        onTap: () => {
          this.autoplay = !this.autoplay;
        },
      },
      {
        id: 'open',
        label: 'Open board',
        onTap: () => {
          this.source.isPipeBoardOpen = true;
        },
      },
      {
        id: 'explainer',
        label: 'Explainer',
        onTap: () => {
          this.explainerOpen = true;
        },
      },
    ];
  }

  protected previewCaptions(): readonly string[] {
    const settled = this.generation.result;
    const how =
      settled === null
        ? `generating, attempt ${this.generation.attempts}`
        : `${settled.source}, ${settled.attempts} attempts`;
    return [`seed ${this.seed} · ${this.tier}`, how];
  }

  update(): void {
    this.frame++;
    if (this.source.pipeBoard === null) {
      const done = this.generation.step();
      this.source.pipeBoardGenerationProgress = this.generation.attempts / GENERATION_ATTEMPTS_MAX;
      const result = this.generation.result;
      if (done && result !== null) this.source.pipeBoard = createPipeBoard(result.layout);
      return;
    }
    const board = this.source.pipeBoard;
    const playing = this.autoplay && this.source.isPipeBoardOpen && !this.explainerOpen;
    if (!playing || this.frame % AUTOPLAY_INTERVAL_FRAMES !== 0) return;
    const cell = nextSolverTurn(board);
    if (cell !== null) turnTile(board, cell, 'clockwise');
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = previewInk.pipeBoard.backdrop;
    ctx.fillRect(0, 0, viewportWidth(), viewportHeight());
    this.renderChrome(ctx);
  }
}
