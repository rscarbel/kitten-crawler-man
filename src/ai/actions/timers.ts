/**
 * Undo steps for the AI's temporary effects (a music claim), counted in
 * frames of live play: the adapter ticks them only while the game is not
 * paused, so a paused game holds them.
 */
interface PendingUndo {
  framesLeft: number;
  readonly run: () => void;
}

class AIActionTimers {
  private pending: PendingUndo[] = [];

  /** Runs `undo` after `frames` ticks of {@link tick}, or at {@link flush}, whichever is first. */
  after(frames: number, undo: () => void): void {
    this.pending.push({ framesLeft: Math.max(0, frames), run: undo });
  }

  tick(): void {
    if (this.pending.length === 0) return;
    const due: PendingUndo[] = [];
    const kept: PendingUndo[] = [];
    for (const entry of this.pending) {
      entry.framesLeft--;
      (entry.framesLeft <= 0 ? due : kept).push(entry);
    }
    this.pending = kept;
    for (const entry of due) entry.run();
  }

  /** Runs every pending undo now: the scene they belong to is going away. */
  flush(): void {
    const due = this.pending;
    this.pending = [];
    for (const entry of due) entry.run();
  }

  get size(): number {
    return this.pending.length;
  }
}

export const aiActionTimers = new AIActionTimers();
