/**
 * Time-sliced loading work, run a few milliseconds per rendered frame.
 *
 * A caller that has seconds of up-front work — painting a floor's art, warming
 * a crowd's figures, fetching sheets — hands this a list of named
 * {@link LoadTask}s. {@link LoadRunner.tick} spends one frame's budget on them,
 * in order, and reports a weighted progress fraction and the label of whatever
 * is running, so a loading screen can draw an honest bar and never a frozen one.
 *
 * Kept free of the DOM and of any canvas, so a headless gate can drive it with
 * fake tasks and a fake clock and prove the pacing rather than trust it.
 *
 * @example A floor's arrival work
 *   const runner = new LoadRunner([
 *     { label: 'Painting the streets', weight: 5, work: steppedWork((budgetMs) => paintFor(budgetMs)) },
 *     { label: 'Unpacking sprites', work: { kind: 'promise', promise: prewarmGroups(groups) } },
 *   ]);
 *   // once per rendered frame:
 *   runner.tick();
 *   drawBar(runner.progress, runner.statusLabel);
 *   if (runner.isFinished) startPlaying();
 */

/**
 * Milliseconds of loading work one frame may spend by default.
 *
 * Under a 60 Hz frame with room left for the loading screen's own draw and for
 * the caches' own frame-boundary slices, which keep draining alongside it: a
 * bar that stutters reads as a hang, and a hang is what a loading screen exists
 * to rule out.
 */
export const DEFAULT_LOAD_FRAME_BUDGET_MS = 10;

/**
 * How long a loading screen stays up at the least, once it is shown at all.
 * A screen that flashes for two frames reads as a glitch rather than a load.
 */
export const DEFAULT_MIN_LOAD_DISPLAY_MS = 600;

/**
 * Work that knows how to do a bounded slice of itself.
 *
 * `step` does as much as fits in `budgetMs` and returns how far the whole task
 * now is, `0`–`1`; anything at or above `1` means done. It must return rather
 * than run on when the budget is spent.
 *
 * `mustProgress` is true when nothing else has run this frame: the task then
 * owes at least one unit of work however large, so a task whose smallest piece
 * is bigger than a whole frame still moves. When it is false the task should
 * start a unit only if it expects the unit to fit — otherwise an earlier task
 * that spent most of the frame would be followed by a later one that spends a
 * whole extra unit on top of it.
 */
export interface SteppedLoadWork {
  readonly kind: 'stepped';
  step(budgetMs: number, mustProgress: boolean): number;
}

/**
 * Work written as a generator: each `next()` is one small indivisible unit,
 * and each yielded value is the task's progress so far, `0`–`1`. The runner
 * pulls units until the frame's budget is spent, so a unit should cost a
 * fraction of a frame.
 */
export interface IteratorLoadWork {
  readonly kind: 'iterator';
  readonly iterator: Iterator<number, unknown, undefined>;
}

/**
 * Work that runs on its own — a fetch, a decode — and only has to be waited
 * for. It costs no frame time, and counts as done once it settles, rejected or
 * not: a load that failed is logged, not waited on forever.
 */
export interface PromiseLoadWork {
  readonly kind: 'promise';
  readonly promise: Promise<unknown>;
}

export type LoadWork = SteppedLoadWork | IteratorLoadWork | PromiseLoadWork;

/** One named piece of loading work. */
export interface LoadTask {
  /** What the loading screen says while this task runs ("Painting the streets"). */
  readonly label: string;
  /**
   * This task's share of the bar, relative to the others. Defaults to 1. Weight
   * by expected time, so the bar moves at a steady rate rather than racing
   * through a cheap task and crawling through an expensive one.
   */
  readonly weight?: number;
  readonly work: LoadWork;
}

export interface LoadRunnerOptions {
  /** Milliseconds of synchronous work per {@link LoadRunner.tick}. */
  readonly frameBudgetMs?: number;
  /** See {@link DEFAULT_MIN_LOAD_DISPLAY_MS}. */
  readonly minDisplayMs?: number;
  /** The clock, `performance.now()` unless a harness supplies its own. */
  readonly now?: () => number;
}

/** Wraps a plain `(budgetMs) => progress` function as {@link SteppedLoadWork}. */
export function steppedWork(
  step: (budgetMs: number, mustProgress: boolean) => number,
): SteppedLoadWork {
  return { kind: 'stepped', step };
}

/** Wraps a started promise as {@link PromiseLoadWork}. */
export function promiseWork(promise: Promise<unknown>): PromiseLoadWork {
  return { kind: 'promise', promise };
}

/** Wraps a generator as {@link IteratorLoadWork}. */
export function iteratorWork(iterator: Iterator<number, unknown, undefined>): IteratorLoadWork {
  return { kind: 'iterator', iterator };
}

const DEFAULT_TASK_WEIGHT = 1;
const COMPLETE = 1;

interface TaskState {
  readonly task: LoadTask;
  readonly weight: number;
  progress: number;
  done: boolean;
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(COMPLETE, value));
}

/**
 * Runs a list of {@link LoadTask}s across frames.
 *
 * Synchronous tasks run strictly in list order, so a task may rely on the ones
 * before it having finished — a chunk bake after the art it bakes from. A
 * promise task is waited for at its place in the list; it was already running
 * from the moment the caller made the promise, so placing it late costs
 * nothing and lets earlier work overlap the wait.
 */
export class LoadRunner {
  private readonly states: TaskState[];
  private readonly frameBudgetMs: number;
  private readonly minDisplayMs: number;
  private readonly now: () => number;
  private readonly startedAtMs: number;
  private cursor = 0;
  private shownProgress = 0;
  private lastTickSpentMs = 0;
  private readonly settled = new Set<number>();

  /** Resolves once every task is done and the minimum display time has passed. */
  readonly finished: Promise<void>;
  private resolveFinished: () => void = () => undefined;
  /**
   * Set only inside `tick`, so a caller that ticks and then asks cannot see the
   * clock cross the minimum display time between the two and close a screen
   * whose `finished` promise never settled.
   */
  private finishedLatched = false;

  constructor(tasks: ReadonlyArray<LoadTask>, options: LoadRunnerOptions = {}) {
    this.frameBudgetMs = options.frameBudgetMs ?? DEFAULT_LOAD_FRAME_BUDGET_MS;
    this.minDisplayMs = options.minDisplayMs ?? DEFAULT_MIN_LOAD_DISPLAY_MS;
    this.now = options.now ?? (() => performance.now());
    this.startedAtMs = this.now();
    this.states = tasks.map((task) => ({
      task,
      weight: Math.max(0, task.weight ?? DEFAULT_TASK_WEIGHT),
      progress: 0,
      done: false,
    }));
    this.finished = new Promise<void>((resolve) => {
      this.resolveFinished = resolve;
    });
    this.states.forEach((state, index) => {
      const work = state.task.work;
      if (work.kind !== 'promise') return;
      // Recorded as settled rather than marked done here, so a task only ever
      // completes inside `tick` — the one place progress is allowed to move.
      work.promise.then(
        () => this.settled.add(index),
        (error: unknown) => {
          console.warn(`[LoadRunner] "${state.task.label}" failed; continuing without it`, error);
          this.settled.add(index);
        },
      );
    });
  }

  /**
   * Spends up to one frame's budget on the tasks still owed. Call once per
   * rendered frame. The first unit of work in a tick always runs, so a unit
   * larger than the whole budget still makes progress rather than stalling.
   */
  tick(): void {
    const tickStartedAt = this.now();
    const spentMs = (): number => this.now() - tickStartedAt;
    let workedThisTick = false;
    while (this.cursor < this.states.length) {
      const state = this.states[this.cursor];
      const remainingMs = this.frameBudgetMs - spentMs();
      if (remainingMs <= 0 && workedThisTick) break;
      const madeProgress = this.advance(
        state,
        this.cursor,
        Math.max(0, remainingMs),
        !workedThisTick,
      );
      workedThisTick ||= madeProgress;
      if (state.done) {
        this.cursor++;
        continue;
      }
      // A task that did nothing this frame is waiting on something outside the
      // frame — a promise, or a queue another slice is draining — so the frame's
      // remaining budget cannot help it.
      if (!madeProgress) break;
    }
    this.lastTickSpentMs = spentMs();
    this.shownProgress = Math.max(this.shownProgress, this.rawProgress());
    if (!this.finishedLatched && this.tasksDone && this.elapsedMs >= this.minDisplayMs) {
      this.finishedLatched = true;
      this.resolveFinished();
    }
  }

  /** Returns whether the task moved forward. */
  private advance(
    state: TaskState,
    index: number,
    budgetMs: number,
    mustProgress: boolean,
  ): boolean {
    const work = state.task.work;
    switch (work.kind) {
      case 'promise': {
        if (!this.settled.has(index)) return false;
        state.progress = COMPLETE;
        state.done = true;
        return true;
      }
      case 'stepped': {
        const before = state.progress;
        const reported = work.step(budgetMs, mustProgress);
        state.progress = Math.max(before, clampProgress(reported));
        if (reported >= COMPLETE) {
          state.progress = COMPLETE;
          state.done = true;
        }
        return state.done || state.progress > before;
      }
      case 'iterator': {
        const sliceStartedAt = this.now();
        let moved = false;
        // A unit has no cost estimate to test, so the only honest rule is the
        // one the caches use: never start one with the budget already gone,
        // except the first of a frame.
        for (;;) {
          const owedFirstUnit = mustProgress && !moved;
          const budgetLeft = this.now() - sliceStartedAt < budgetMs;
          if (!owedFirstUnit && !budgetLeft) break;
          const result = work.iterator.next();
          moved = true;
          if (result.done === true) {
            state.progress = COMPLETE;
            state.done = true;
            break;
          }
          state.progress = Math.max(state.progress, clampProgress(result.value));
        }
        return moved;
      }
    }
  }

  private rawProgress(): number {
    let totalWeight = 0;
    let doneWeight = 0;
    for (const state of this.states) {
      totalWeight += state.weight;
      doneWeight += state.weight * state.progress;
    }
    return totalWeight > 0 ? doneWeight / totalWeight : COMPLETE;
  }

  /** Weighted progress across every task, `0`–`1`. Never moves backwards. */
  get progress(): number {
    return this.shownProgress;
  }

  /** Whether every task has finished, regardless of the minimum display time. */
  get tasksDone(): boolean {
    return this.cursor >= this.states.length;
  }

  /**
   * Whether every task is done and the screen has been up long enough to take
   * down, as of the last {@link tick}.
   */
  get isFinished(): boolean {
    return this.finishedLatched;
  }

  /** The label of the task now running, or of the last one once all are done. */
  get statusLabel(): string {
    const index = Math.min(this.cursor, this.states.length - 1);
    return index >= 0 ? this.states[index].task.label : '';
  }

  /** Milliseconds since the runner was constructed, on its own clock. */
  get elapsedMs(): number {
    return this.now() - this.startedAtMs;
  }

  /** Milliseconds the last {@link tick} spent, for gates and readouts. */
  get lastTickMs(): number {
    return this.lastTickSpentMs;
  }

  /** The per-tick budget this runner was built with. */
  get budgetMs(): number {
    return this.frameBudgetMs;
  }
}
