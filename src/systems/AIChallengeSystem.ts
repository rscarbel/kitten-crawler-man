/**
 * The show's timed bounties: the AI offers one (`offer_challenge`), the
 * player takes it or turns it down on a card, and an accepted one is tracked
 * from the floor's events until it is won, failed or the party leaves.
 *
 * A challenge is a template plus bounded parameters (`src/ai/show/challenges.ts`);
 * this system interprets the template's rules and never runs logic the model
 * wrote. One challenge at a time: an offer on the card or a challenge under
 * way refuses the next. Its clock counts gameplay frames, so it stands still
 * whenever the world does (menus, dialogs, the pause screen).
 *
 * Winning pays the template's reward chest to the crawler the player is
 * driving; failing shows the AI's taunt to everyone. Accepting, declining,
 * winning and failing are each a bus event, which the AI hears as a
 * high-importance game event.
 */

import { crawlerName } from '../characters/characters';
import type { Rarity } from '../core/items/defs/rarity';
import type { EventBus } from '../core/EventBus';
import { TILE_SIZE } from '../core/constants';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { GameMap } from '../map/GameMap';
import type { ToastOptions } from '../ui/hud/toasts';
import {
  CHALLENGE_TEMPLATES,
  STAIRWELL_REACH_TILES,
  challengeObjective,
  mobMatches,
  type ChallengeSpec,
  type ChallengeSummary,
} from '../ai/show/challenges';
import type { GameSystem, SystemContext } from './GameSystem';
import { secondsLabel, type TrackerEntry } from './questTracker';

const FRAMES_PER_SECOND = 60;
const TAUNT_TOAST_TICKS = 420;
const RESULT_TOAST_TICKS = 300;
const CHALLENGE_WARNING_SECONDS = 10;
/** Below this many frames left the band reads in warning colour. */
export const CHALLENGE_WARNING_FRAMES = CHALLENGE_WARNING_SECONDS * FRAMES_PER_SECOND;

type CrawlerSide = 'Human' | 'Cat';

export interface AIChallengeDeps {
  readonly bus: EventBus;
  readonly gameMap: GameMap;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  postToast(text: string, opts?: ToastOptions): void;
  /** Pays a won challenge's reward chest to `side`. */
  grantReward(side: CrawlerSide, rarity: Rarity): void;
}

/** A challenge on the offer card, waiting on the player. */
export interface OfferedChallenge {
  readonly id: string;
  readonly spec: ChallengeSpec;
  readonly objective: string;
}

/** A challenge the player took, as the band and the journal read it. */
export interface ActiveChallengeView {
  readonly id: string;
  readonly spec: ChallengeSpec;
  readonly objective: string;
  /** Frames left on the clock; null for an untimed challenge. */
  readonly framesLeft: number | null;
  readonly framesLimit: number | null;
  /** Kills toward the goal, for a kill challenge. */
  readonly kills: number;
}

interface ActiveChallenge {
  readonly id: string;
  readonly spec: ChallengeSpec;
  readonly objective: string;
  framesLeft: number | null;
  readonly framesLimit: number | null;
  framesElapsed: number;
  kills: number;
  lastHp: { human: number; cat: number };
}

export class AIChallengeSystem implements GameSystem {
  private nextId = 1;
  private offered: OfferedChallenge | null = null;
  private active: ActiveChallenge | null = null;
  private readonly unsubscribe: Array<() => void>;

  constructor(private readonly deps: AIChallengeDeps) {
    const { bus } = deps;
    this.unsubscribe = [
      bus.on('mobKilled', (e) => this.onKill(e.mob.spawnTypeKey, e.mob.isBoss, e.killer)),
      bus.on('healingPotionUsed', () => {
        if (
          this.active !== null &&
          CHALLENGE_TEMPLATES[this.active.spec.template].rules.failOnPotion
        ) {
          this.fail('drank a healing potion');
        }
      }),
      bus.on('bossDefeated', () => {
        if (this.active?.spec.template === 'no_potion_until_boss') this.complete();
      }),
      bus.on('crawlerKnockedOut', () => {
        if (this.active !== null) this.fail('a crawler was knocked out');
      }),
      bus.on('playerDied', () => {
        if (this.active !== null) this.fail('died');
      }),
    ];
  }

  /** An offer on the card or a challenge under way: either way, no room for another. */
  get busy(): boolean {
    return this.offered !== null || this.active !== null;
  }

  get offer(): OfferedChallenge | null {
    return this.offered;
  }

  get current(): ActiveChallengeView | null {
    const active = this.active;
    if (active === null) return null;
    return {
      id: active.id,
      spec: active.spec,
      objective: active.objective,
      framesLeft: active.framesLeft,
      framesLimit: active.framesLimit,
      kills: active.kills,
    };
  }

  /** Puts `spec` on the offer card. Returns its id, or null while another is offered or running. */
  propose(spec: ChallengeSpec): string | null {
    if (this.busy) return null;
    const id = `challenge-${this.nextId++}`;
    this.offered = { id, spec, objective: challengeObjective(spec) };
    return id;
  }

  /** The player took the offered challenge: its clock starts now. */
  accept(): void {
    const offered = this.offered;
    if (offered === null) return;
    this.offered = null;
    const { rules } = CHALLENGE_TEMPLATES[offered.spec.template];
    const framesLimit = rules.timed ? offered.spec.seconds * FRAMES_PER_SECOND : null;
    this.active = {
      id: offered.id,
      spec: offered.spec,
      objective: offered.objective,
      framesLeft: framesLimit,
      framesLimit,
      framesElapsed: 0,
      kills: 0,
      lastHp: { human: this.deps.human.hp, cat: this.deps.cat.hp },
    };
    this.deps.bus.emit('challengeAccepted', this.summaryOf(offered));
    this.deps.postToast(`Challenge accepted: ${offered.spec.title}`, {
      tone: 'accent',
      icon: 'trophy',
    });
  }

  /** The player turned the offered challenge down. */
  decline(): void {
    const offered = this.offered;
    if (offered === null) return;
    this.offered = null;
    this.deps.bus.emit('challengeDeclined', this.summaryOf(offered));
  }

  update(ctx: SystemContext): void {
    const active = this.active;
    if (active === null) return;
    const { rules } = CHALLENGE_TEMPLATES[active.spec.template];
    active.framesElapsed++;

    const hurt = ctx.human.hp < active.lastHp.human || ctx.cat.hp < active.lastHp.cat;
    active.lastHp = { human: ctx.human.hp, cat: ctx.cat.hp };
    if (hurt && rules.failOnDamage) {
      this.fail('took damage');
      return;
    }

    if (rules.goal === 'stairwell' && this.nearStairwell(ctx.active)) {
      this.complete();
      return;
    }

    if (active.framesLeft === null) return;
    active.framesLeft--;
    if (active.framesLeft > 0) return;
    if (rules.goal === 'survive') this.complete();
    else this.fail('ran out of time');
  }

  /** The party left the floor with a challenge open: it is over, unpaid and untaunted. */
  dispose(): void {
    for (const stop of this.unsubscribe) stop();
    this.endQuietly('left the floor');
  }

  /**
   * Withdraws an offer and ends a running challenge unpaid and untaunted:
   * the world it was set in is gone (the party left the floor, or the run
   * rewound to a checkpoint).
   */
  endQuietly(reason: string): void {
    if (this.offered !== null) this.decline();
    const active = this.active;
    if (active === null) return;
    this.active = null;
    this.deps.bus.emit('challengeFailed', { ...this.summaryOf(active), reason, taunt: '' });
  }

  /** The Journal's row for the challenge under way. */
  trackerEntries(): ReadonlyArray<TrackerEntry> {
    const active = this.active;
    if (active === null) return [];
    const clock = active.framesLeft === null ? '' : ` (${secondsLabel(active.framesLeft)} left)`;
    return [
      {
        id: `ai-${active.id}`,
        name: `Challenge: ${active.spec.title}`,
        status: 'active',
        objective: `${active.objective}${clock}`,
      },
    ];
  }

  private onKill(
    typeKey: string | null,
    isBoss: boolean,
    killer: HumanPlayer | CatPlayer | null,
  ): void {
    const active = this.active;
    if (active === null || killer === null) return;
    const { rules } = CHALLENGE_TEMPLATES[active.spec.template];
    if (!rules.countsKills || isBoss || !mobMatches(active.spec.mobType, typeKey)) return;
    const counts = rules.killer === 'party' || killer === this.deps.cat;
    if (!counts) {
      if (rules.failOnOtherKiller) this.fail(`${crawlerName('human')} landed the blow`);
      return;
    }
    active.kills++;
    if (active.kills >= active.spec.count) this.complete();
  }

  private nearStairwell(crawler: HumanPlayer | CatPlayer): boolean {
    const tileX = Math.floor(crawler.x / TILE_SIZE);
    const tileY = Math.floor(crawler.y / TILE_SIZE);
    return this.deps.gameMap.stairwellTiles.some(
      (tile) =>
        Math.abs(tile.x - tileX) <= STAIRWELL_REACH_TILES &&
        Math.abs(tile.y - tileY) <= STAIRWELL_REACH_TILES,
    );
  }

  private complete(): void {
    const active = this.active;
    if (active === null) return;
    this.active = null;
    const side: CrawlerSide = this.deps.human.isActive ? 'Human' : 'Cat';
    const name = crawlerName(side === 'Human' ? 'human' : 'cat');
    this.deps.grantReward(side, active.spec.rewardRarity);
    this.deps.bus.emit('challengeCompleted', {
      ...this.summaryOf(active),
      rewardedTo: side,
      secondsTaken: Math.round(active.framesElapsed / FRAMES_PER_SECOND),
    });
    this.deps.postToast(
      `Challenge complete: ${active.spec.title}! ${active.spec.rewardRarity} chest for ${name}.`,
      { tone: 'success', icon: 'trophy', urgent: true, durationTicks: RESULT_TOAST_TICKS },
    );
  }

  private fail(reason: string): void {
    const active = this.active;
    if (active === null) return;
    this.active = null;
    this.deps.bus.emit('challengeFailed', {
      ...this.summaryOf(active),
      reason,
      taunt: active.spec.taunt,
    });
    this.deps.postToast(`Challenge failed: ${active.spec.title}. ${active.spec.taunt}`, {
      tone: 'danger',
      icon: 'skull',
      urgent: true,
      durationTicks: TAUNT_TOAST_TICKS,
    });
  }

  private summaryOf(challenge: {
    readonly id: string;
    readonly spec: ChallengeSpec;
  }): ChallengeSummary {
    return {
      challengeId: challenge.id,
      title: challenge.spec.title,
      template: challenge.spec.template,
      objective: challengeObjective(challenge.spec),
      rewardRarity: challenge.spec.rewardRarity,
      offeredBy: challenge.spec.offeredBy,
    };
  }
}
