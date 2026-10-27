/**
 * The Cloak & Dagger's seated gamblers: who sits on each casino stool, and
 * what they are doing there.
 *
 * Every stool in `CLUB_CASINO_SEATS` is either empty or holds one gambler, who
 * plays a loop of seated poses — mostly waiting, now and then playing, and
 * after a play sometimes cheering or slumping. Gamblers come and go slowly, so
 * the room is never static and never a revolving door.
 *
 * The poker table seats only the regulars, each by their own look, and the
 * room follows the poker screen: while the player is at the table, its stools
 * hold exactly the regulars the screen deals to, and the player's own stool
 * stands empty. Blackjack is played one-on-one with Deuce, so its stools
 * empty while that table is open.
 */

import { TILE_SIZE } from '../core/constants';
import type { InteriorFigure } from '../core/rendering/InteriorFigure';
import {
  CLUB_CASINO_SEATS,
  type CasinoSeatFacing,
  type CasinoSeatFixture,
} from '../core/club/clubLayout';
import {
  drawClubCastFigure,
  prewarmClubSeatedFigures,
  SEAT_POSE_SECONDS,
  type ClubFigureRef,
  type SeatPose,
} from '../sprites/clubCastFigure';
import { CLUB_PATRON_REFS } from '../sprites/clubCastRoster';
import {
  POKER_REGULARS,
  REGULAR_IDS,
  isRegularId,
  type RegularId,
} from './casino/poker/npc/regulars';
import { CLUB_ANIM_FRAMES_PER_SECOND } from '../core/club/clubTiming';
import { PLAYER_SEAT } from './casino/poker/PokerTable';

/** What the gamblers need to know about the tables this tick. */
export interface GamblerTableView {
  readonly blackjackOpen: boolean;
  /** The poker screen's seats while the player is at the table, else null. */
  readonly pokerSeats: ReadonlyArray<{ readonly occupantId: string | null }> | null;
}

interface SeatedGambler {
  readonly ref: ClubFigureRef;
  /** The regular this is, for a poker stool; null for anyone else. */
  readonly regular: RegularId | null;
  pose: SeatPose;
  /** Animation tick the current pose began on, so a one-shot pose plays from its start. */
  poseStartTick: number;
  /** Animation tick the current pose gives way to the next. */
  poseEndTick: number;
  /** Animation tick this gambler gets up and leaves. */
  leaveTick: number;
}

interface Stool {
  readonly fixture: CasinoSeatFixture;
  gambler: SeatedGambler | null;
  /** Animation tick the empty stool next takes someone. */
  refillTick: number;
}

/** A sitter sorts this far after the stool on their tile, so they are painted onto its cushion. */
const SITTER_AFTER_STOOL_PX = 0.5;

/** Ticks in a second of the club's clock. */
const TICKS_PER_SECOND = CLUB_ANIM_FRAMES_PER_SECOND;

/** How long a gambler stays put, in seconds: long enough that the room reads as settled. */
const STAY_MIN_SECONDS = 45;
const STAY_MAX_SECONDS = 120;
/** How long an emptied stool waits before someone takes it. */
const VACANCY_MIN_SECONDS = 8;
const VACANCY_MAX_SECONDS = 25;
/** How many whole waiting loops a gambler sits through between plays. */
const IDLE_LOOPS_MIN = 2;
const IDLE_LOOPS_MAX = 5;

/** Share of the casino's stools taken when the club is first entered. */
const OPENING_OCCUPANCY = 0.8;

/**
 * What follows a play, by game: a slot pays out or doesn't on every pull, so a
 * slot player reacts more often than a card player, who mostly just plays the
 * next hand.
 */
const REACTION_CHANCE: Readonly<Record<CasinoSeatFixture['game'], number>> = {
  slots: 0.45,
  blackjack: 0.3,
  poker: 0.2,
};
/** Of the reactions, the share that are a win: the house edge shows in the room. */
const CHEER_SHARE = 0.35;

/** One unit-vector facing per stool direction, as the cast rows take it. */
const FACING_VECTOR: Readonly<Record<CasinoSeatFacing, { x: number; y: number }>> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
};

function randomBetween(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}

function secondsToTicks(seconds: number): number {
  return Math.round(seconds * TICKS_PER_SECOND);
}

export class ClubGamblerSystem {
  private readonly stools: Stool[];
  private readonly figures: InteriorFigure[] = [];
  /** Refilled each frame with the figures of the stools that are taken. */
  private readonly visible: InteriorFigure[] = [];
  private tick = 0;
  /** Whether the room was following an open poker table last tick. */
  private followingPoker = false;
  /** Whether the blackjack table was open last tick. */
  private blackjackWasOpen = false;

  constructor(private readonly random: () => number = Math.random) {
    this.stools = CLUB_CASINO_SEATS.map((fixture) => ({
      fixture,
      gambler: null,
      refillTick: 0,
    }));
    for (const stool of this.stools) {
      if (this.isPlayerChair(stool) || this.random() >= OPENING_OCCUPANCY) {
        stool.refillTick = secondsToTicks(
          randomBetween(this.random, VACANCY_MIN_SECONDS, VACANCY_MAX_SECONDS),
        );
        continue;
      }
      stool.gambler = this.arrival(stool);
      // Stagger the first departures so the opening crowd doesn't leave as one.
      stool.gambler.leaveTick = secondsToTicks(this.random() * STAY_MAX_SECONDS);
    }
    for (const stool of this.stools) {
      this.figures.push({
        y: stool.fixture.tile.y * TILE_SIZE + SITTER_AFTER_STOOL_PX,
        render: (ctx, camX, camY, tileSize) => this.renderStool(stool, ctx, camX, camY, tileSize),
      });
    }
  }

  /** Warms every seated row of every look that can sit here, ahead of the first draw. */
  prewarm(): void {
    prewarmClubSeatedFigures([
      ...CLUB_PATRON_REFS,
      ...REGULAR_IDS.map((id) => POKER_REGULARS[id].look),
    ]);
  }

  update(tick: number, tables: GamblerTableView): void {
    this.tick = tick;
    const following = tables.pokerSeats !== null;
    if (tables.pokerSeats !== null) this.followPokerTable(tables.pokerSeats);
    else if (this.followingPoker) this.leavePokerTable();
    this.followingPoker = following;
    if (this.blackjackWasOpen && !tables.blackjackOpen) this.closeBlackjack();
    this.blackjackWasOpen = tables.blackjackOpen;

    for (const stool of this.stools) {
      const followed = following && stool.fixture.game === 'poker';
      const emptied = tables.blackjackOpen && stool.fixture.game === 'blackjack';
      if (emptied) {
        if (stool.gambler !== null) this.vacate(stool);
        continue;
      }
      if (followed) {
        if (stool.gambler !== null) this.advancePose(stool, stool.gambler);
        continue;
      }
      this.rotate(stool);
    }
  }

  /** The stools that are taken, for the interior's Y-sorted pass. */
  renderables(): ReadonlyArray<InteriorFigure> {
    this.visible.length = 0;
    this.stools.forEach((stool, index) => {
      if (stool.gambler !== null) this.visible.push(this.figures[index]);
    });
    return this.visible;
  }

  /** The stool empties and stays empty a while, so a closed table never refills at once. */
  private vacate(stool: Stool): void {
    stool.gambler = null;
    stool.refillTick = this.vacancyEndsTick();
  }

  /**
   * The vacancy each stool took when the table opened has long run out after
   * a real session, so the closing restarts it: otherwise every stool fills
   * the tick the panel shuts.
   */
  private closeBlackjack(): void {
    for (const stool of this.stools) {
      if (stool.fixture.game === 'blackjack') stool.refillTick = this.vacancyEndsTick();
    }
  }

  private vacancyEndsTick(): number {
    return (
      this.tick +
      secondsToTicks(randomBetween(this.random, VACANCY_MIN_SECONDS, VACANCY_MAX_SECONDS))
    );
  }

  /** Every stool that holds someone, and the regular sitting there if any, for gates to read. */
  occupiedSeats(): ReadonlyArray<{
    readonly fixture: CasinoSeatFixture;
    readonly regular: RegularId | null;
  }> {
    return this.stools.flatMap((stool) =>
      stool.gambler === null ? [] : [{ fixture: stool.fixture, regular: stool.gambler.regular }],
    );
  }

  private isPlayerChair(stool: Stool): boolean {
    return stool.fixture.game === 'poker' && stool.fixture.pokerSeat === PLAYER_SEAT;
  }

  private rotate(stool: Stool): void {
    const gambler = stool.gambler;
    if (gambler === null) {
      if (this.isPlayerChair(stool) || this.tick < stool.refillTick) return;
      stool.gambler = this.arrival(stool);
      return;
    }
    if (this.tick >= gambler.leaveTick) {
      this.vacate(stool);
      return;
    }
    this.advancePose(stool, gambler);
  }

  /**
   * Someone new for the stool: a regular not already at the poker table for
   * a poker stool, anyone from the crowd's looks for the rest.
   */
  private arrival(stool: Stool): SeatedGambler {
    const regular = stool.fixture.game === 'poker' ? this.freeRegular() : null;
    const ref =
      regular !== null
        ? POKER_REGULARS[regular].look
        : CLUB_PATRON_REFS[Math.floor(this.random() * CLUB_PATRON_REFS.length)];
    return this.seated(ref, regular);
  }

  private seated(ref: ClubFigureRef, regular: RegularId | null): SeatedGambler {
    const gambler: SeatedGambler = {
      ref,
      regular,
      pose: 'idle',
      poseStartTick: this.tick,
      poseEndTick: this.tick,
      leaveTick:
        this.tick + secondsToTicks(randomBetween(this.random, STAY_MIN_SECONDS, STAY_MAX_SECONDS)),
    };
    this.startWaiting(gambler);
    return gambler;
  }

  /** A regular nobody at the poker table already is, or null when all fourteen are sitting. */
  private freeRegular(): RegularId | null {
    const seated = new Set(this.stools.map((stool) => stool.gambler?.regular ?? null));
    const free = REGULAR_IDS.filter((id) => !seated.has(id));
    if (free.length === 0) return null;
    return free[Math.floor(this.random() * free.length)] ?? null;
  }

  /**
   * Seats the poker screen's own regulars on the stools its seats stand for.
   * A stool already holding the right regular keeps them mid-pose.
   */
  private followPokerTable(seats: ReadonlyArray<{ readonly occupantId: string | null }>): void {
    for (const stool of this.stools) {
      if (stool.fixture.game !== 'poker') continue;
      const occupant = seats[stool.fixture.pokerSeat]?.occupantId ?? null;
      const regular =
        stool.fixture.pokerSeat !== PLAYER_SEAT && isRegularId(occupant) ? occupant : null;
      if (regular === null) {
        stool.gambler = null;
        continue;
      }
      if (stool.gambler?.regular === regular) continue;
      stool.gambler = this.seated(POKER_REGULARS[regular].look, regular);
    }
  }

  /** Once the player leaves the table, its regulars sit on for a while before the room moves on. */
  private leavePokerTable(): void {
    for (const stool of this.stools) {
      if (stool.fixture.game !== 'poker') continue;
      const gambler = stool.gambler;
      if (gambler === null) {
        stool.refillTick = this.vacancyEndsTick();
        continue;
      }
      gambler.leaveTick =
        this.tick + secondsToTicks(randomBetween(this.random, STAY_MIN_SECONDS, STAY_MAX_SECONDS));
    }
  }

  /** Waiting runs whole loops, so the breathing never cuts off mid-breath. */
  private startWaiting(gambler: SeatedGambler): void {
    const loops = Math.floor(randomBetween(this.random, IDLE_LOOPS_MIN, IDLE_LOOPS_MAX + 1));
    this.startPose(gambler, 'idle', loops);
  }

  private startPose(gambler: SeatedGambler, pose: SeatPose, loops = 1): void {
    gambler.pose = pose;
    gambler.poseStartTick = this.tick;
    gambler.poseEndTick = this.tick + secondsToTicks(SEAT_POSE_SECONDS[pose] * loops);
  }

  /** The seated loop: wait, play, and now and then react to how the play went. */
  private advancePose(stool: Stool, gambler: SeatedGambler): void {
    if (this.tick < gambler.poseEndTick) return;
    switch (gambler.pose) {
      case 'idle':
        this.startPose(gambler, 'play');
        return;
      case 'play': {
        if (this.random() >= REACTION_CHANCE[stool.fixture.game]) {
          this.startWaiting(gambler);
          return;
        }
        this.startPose(gambler, this.random() < CHEER_SHARE ? 'cheer' : 'slump');
        return;
      }
      case 'cheer':
      case 'slump':
        this.startWaiting(gambler);
        return;
      default: {
        const unhandled: never = gambler.pose;
        throw new Error(`unhandled seat pose ${String(unhandled)}`);
      }
    }
  }

  private renderStool(
    stool: Stool,
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    const gambler = stool.gambler;
    if (gambler === null) return;
    const facing = FACING_VECTOR[stool.fixture.facing];
    drawClubCastFigure(
      ctx,
      gambler.ref,
      stool.fixture.tile.x * TILE_SIZE - camX,
      stool.fixture.tile.y * TILE_SIZE - camY,
      tileSize,
      {
        action: 'sit',
        seatPose: gambler.pose,
        walkPhase: 0,
        facingX: facing.x,
        facingY: facing.y,
        poseSeconds: (this.tick - gambler.poseStartTick) / TICKS_PER_SECOND,
      },
    );
  }
}
