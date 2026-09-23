/**
 * Decides which of Carl's reaction rows plays, from what is being done to him:
 * a blow landing, a shove, a hold on his feet, going down, coming round,
 * dying.
 *
 * It never draws him and never changes what happens to him — it reads the
 * player's state once a tick and asks the animator for the matching row. The
 * reactions rank against each other: dying outranks everything, then going
 * down and lying out cold, then getting back up, then the stumble, then the
 * flinch, then the struggle. A reaction only replaces one of equal or lower
 * rank, and one that ends hands back to whatever the state then asks for.
 */

import { type CarlView } from './art/carl/rig';
import { type HumanRowName, type ViewRows } from './art/humanFigure';
import {
  DEATH_KNEEL_FRAMES,
  HURT_RECOIL_FRAMES,
  type HurtFrom,
  KNOCKDOWN_FRAMES,
  KNOCKDOWN_FALL_FRAMES,
  STAGGER_REEL_FRAMES,
} from './art/human/reactions';
import { type HumanActionFrameEvent, type HumanReactionOptions } from './humanAnimator';
import { viewForFacing } from './humanSprite';

/** The reaction rows the director plays, by what they are for. */
type ReactionKind = 'struggle' | 'hurt' | 'stagger' | 'revive' | 'down' | 'death';

/** Higher outranks lower; a reaction replaces only one of equal or lower rank. */
const REACTION_RANK: Readonly<Record<ReactionKind, number>> = {
  struggle: 0,
  hurt: 1,
  stagger: 2,
  revive: 3,
  down: 4,
  death: 5,
};

/** What the director needs of the player: playing and stopping a row. */
interface HumanReactionHost {
  playReaction(row: HumanRowName, options: HumanReactionOptions): boolean;
  stopReaction(): void;
}

/** The player's state, as far as reactions go, for one tick. */
interface HumanReactionState {
  readonly alive: boolean;
  /** The crawler being driven: his death ends the run rather than downing him. */
  readonly active: boolean;
  readonly knockedOut: boolean;
  /** Something holds his feet — a web, a grip. */
  readonly stuck: boolean;
  readonly facingX: number;
  readonly facingY: number;
  /** Ground he covered this tick, in world pixels, whatever moved him. */
  readonly coveredPx: number;
  /** Whether a shove is still carrying him. */
  readonly knockbackActive: boolean;
}

/** Below this a facing component counts as no facing at all. */
const FACING_EPSILON = 1e-6;

const HURT_ROWS: Readonly<Record<HurtFrom, ViewRows>> = {
  front: { front: 'hurt', side: 'hurt_side', back: 'hurt_away' },
  behind: { front: 'hurt_behind', side: 'hurt_behind_side', back: 'hurt_behind_away' },
};

const STAGGER_ROWS: ViewRows = {
  front: 'stagger',
  side: 'stagger_side',
  back: 'stagger_away',
};

const STRUGGLE_ROWS: ViewRows = {
  front: 'struggle',
  side: 'struggle_side',
  back: 'struggle_away',
};

const KNOCKDOWN_LAST_FRAME = KNOCKDOWN_FRAMES - 1;

/** A row and how many of its frames, from the first, to bake ahead of it being needed. */
export interface HumanWarmSpan {
  readonly row: HumanRowName;
  readonly frames: number;
}

/**
 * The reactions a fight can call for at any tick in one view — the flinch
 * from either side and the stumble — each up to the end of the part that
 * carries the news, so the first blow he takes is not painted on the tick it
 * lands.
 */
export function fightReactionSpans(view: CarlView): readonly HumanWarmSpan[] {
  return [
    { row: HURT_ROWS.front[view], frames: HURT_RECOIL_FRAMES },
    { row: HURT_ROWS.behind[view], frames: HURT_RECOIL_FRAMES },
    { row: STAGGER_ROWS[view], frames: STAGGER_REEL_FRAMES },
  ];
}

/**
 * The falls — out cold as a companion, dead as the one being driven — up to
 * him reaching the floor. Drawn in profile only, so the same
 * rows serve every view.
 */
export const FALL_SPANS: readonly HumanWarmSpan[] = [
  { row: 'knockdown_side', frames: KNOCKDOWN_FALL_FRAMES },
  { row: 'death_side', frames: DEATH_KNEEL_FRAMES },
];

export class HumanReactionDirector {
  private playing: ReactionKind | null = null;
  /** Bumped on every accepted play, so a stale `onEnd` cannot clear a newer reaction. */
  private playToken = 0;
  private knockdownLanded = false;
  private wasKnockedOut = false;
  /** The side he falls toward in profile: +1 or −1, kept from the last real facing. */
  private fallSide = 1;
  private staggerTravelledPx = 0;
  private staggerDistancePx = 0;

  constructor(private readonly host: HumanReactionHost) {}

  /**
   * A blow landed. `from` is where it came from in the world and `at` where he
   * stands, both centres; a blow with no known origin is taken as from in
   * front. The flinch never plays over movement: he cancels it by moving.
   */
  hurt(
    from: { readonly x: number; readonly y: number } | undefined,
    at: { readonly x: number; readonly y: number },
    facingX: number,
    facingY: number,
  ): void {
    if (!this.mayPlay('hurt')) return;
    const towardBlowX = from === undefined ? facingX : from.x - at.x;
    const towardBlowY = from === undefined ? facingY : from.y - at.y;
    const side: HurtFrom = towardBlowX * facingX + towardBlowY * facingY >= 0 ? 'front' : 'behind';
    const row = HURT_ROWS[side][viewForFacing(facingX, facingY)];
    this.play('hurt', row, { cancelOnMove: true });
  }

  /**
   * A shove of `distancePx` along (`dirX`, `dirY`) began. He is drawn facing
   * back up the line of it, stumbling backward, paced by how far it has
   * carried him — so a shove stopped by a wall stops his feet with it.
   */
  knockback(dirX: number, dirY: number, distancePx: number): void {
    if (!this.mayPlay('stagger') || distancePx <= 0) return;
    const faceX = -dirX;
    const faceY = -dirY;
    this.staggerTravelledPx = 0;
    this.staggerDistancePx = distancePx;
    const row = STAGGER_ROWS[viewForFacing(faceX, faceY)];
    this.play('stagger', row, {
      faceX: this.sideOf(faceX),
      progress: () => this.staggerTravelledPx / this.staggerDistancePx,
    });
  }

  /** Called once a tick, before the animator's own tick. */
  tick(state: HumanReactionState): void {
    if (Math.abs(state.facingX) > FACING_EPSILON) this.fallSide = state.facingX < 0 ? -1 : 1;
    if (this.playing === 'stagger') {
      this.staggerTravelledPx += state.coveredPx;
      // The shove is spent: whatever it did not carry him, he has caught.
      if (!state.knockbackActive) this.staggerTravelledPx = this.staggerDistancePx;
    }

    const cameRound = this.wasKnockedOut && !state.knockedOut;
    this.wasKnockedOut = state.knockedOut;

    if (!state.alive && state.active && !state.knockedOut) {
      if (this.playing !== 'death') {
        this.play('death', 'death_side', this.floorOptions({ holdLastFrame: true }));
      }
      return;
    }
    if (state.knockedOut) {
      this.tickDown();
      return;
    }
    if (cameRound && state.alive) {
      // Back on his feet he is back in the fight: a companion revived beside a
      // mob swings at it straight away, and that swing is drawn over the rest
      // of the getting up rather than hidden under it.
      this.play('revive', 'revive_side', { ...this.floorOptions({}), overridesBlows: false });
      return;
    }
    // Anything still lying about from before — a restore that brought him
    // back standing — has no business being drawn now.
    if (this.playing === 'down' || this.playing === 'death') this.host.stopReaction();

    const struggleWanted = state.stuck && state.alive;
    if (!struggleWanted && this.playing === 'struggle') this.host.stopReaction();
    if (struggleWanted && this.playing === null) {
      this.play('struggle', STRUGGLE_ROWS[viewForFacing(state.facingX, state.facingY)], {
        loop: true,
      });
    }
  }

  /** Forgets everything in flight: a checkpoint restore, a respawn. */
  reset(): void {
    this.playing = null;
    this.playToken++;
    this.knockdownLanded = false;
    this.wasKnockedOut = false;
    this.staggerTravelledPx = 0;
    this.staggerDistancePx = 0;
  }

  /**
   * Out cold: the collapse first, held on its last frame — which is the lying
   * loop's first — until it has landed, then the breathing loop.
   */
  private tickDown(): void {
    if (this.playing === 'down' && this.knockdownLanded) {
      this.knockdownLanded = false;
      this.play('down', 'knocked_out_side', this.floorOptions({ loop: true }));
      return;
    }
    if (this.playing === 'down') return;
    this.knockdownLanded = false;
    const landed: HumanActionFrameEvent = {
      frame: KNOCKDOWN_LAST_FRAME,
      run: () => {
        this.knockdownLanded = true;
      },
    };
    this.play(
      'down',
      'knockdown_side',
      this.floorOptions({ holdLastFrame: true, onFrame: [landed] }),
    );
  }

  /** The falls are drawn in profile only, toward whichever side he last faced. */
  private floorOptions(options: HumanReactionOptions): HumanReactionOptions {
    return { ...options, faceX: this.fallSide, overridesBlows: true };
  }

  private sideOf(x: number): number {
    if (Math.abs(x) <= FACING_EPSILON) return this.fallSide;
    return x < 0 ? -1 : 1;
  }

  private mayPlay(kind: ReactionKind): boolean {
    return this.playing === null || REACTION_RANK[this.playing] <= REACTION_RANK[kind];
  }

  private play(kind: ReactionKind, row: HumanRowName, options: HumanReactionOptions): void {
    const token = this.playToken + 1;
    const accepted = this.host.playReaction(row, {
      ...options,
      onEnd: () => {
        if (this.playToken === token) this.playing = null;
      },
    });
    if (!accepted) return;
    this.playToken = token;
    this.playing = kind;
  }
}
