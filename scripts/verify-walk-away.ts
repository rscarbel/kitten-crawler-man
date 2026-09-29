#!/usr/bin/env tsx
/**
 * Checks that the player is done talking as soon as they walk away, and that
 * turning from one speaker to the next reaches the next one.
 *
 *   - A conversation the player can walk away from closes by the time they
 *     are one tile beyond the range it was opened from, measured
 *     from the speaker — never later, and never while they stand or shuffle
 *     inside that band.
 *   - Once out of the talk range, an interact press goes to the world first
 *     (`Conversation.handOff`); only a press nothing else takes turns a page.
 *   - In real generated safe rooms, a Bopca conversation closes on walking
 *     off inside the room, and so does Mordecai's; and walking from the
 *     counter to Mordecai and pressing talk opens Mordecai, including in rooms
 *     where he stands close enough to the counter that the Bopca's box would
 *     still be up when the player gets to him.
 *
 * Run: npx tsx scripts/verify-walk-away.ts
 */

import { installCanvasGlobals } from './nodeCanvasGlobals';
import { Conversation } from '../src/dialog/Conversation';
import { speakerLines } from '../src/dialog/line';
import type { ConversationRequest } from '../src/dialog/request';
import { WALK_AWAY_MARGIN_TILES } from '../src/dialog/walkAway';
import { PLAYER_SPEED, TILE_SIZE } from '../src/core/constants';
import { EventBus } from '../src/core/EventBus';
import { GameMap } from '../src/map/GameMap';
import { stampSafeRoomCounters } from '../src/map/safeRoomCounterLayout';
import { stampSafeRoomDecor } from '../src/map/safeRoomDecorLayout';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { BOPCA_TALK_DISTANCE_TILES, BopcaSystem } from '../src/systems/BopcaSystem';
import { SafeRoomSystem } from '../src/systems/SafeRoomSystem';
import { safeRoomPressLeavesSpeaker, safeRoomSpeakerFor } from '../src/systems/safeRoomSpeaker';

installCanvasGlobals();

let failures = 0;

function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
  if (!ok) failures++;
}

const say = speakerLines('narrator');

/**
 * The promise under test, written down here rather than read back from the
 * rule it tests: a player is done talking one tile past where they could
 * have started. A rule that drifts looser than this fails the gate instead of
 * quietly moving the goalposts with it.
 */
const PROMISED_MARGIN_TILES = 1;

/** Where a surface opened from `talkRangeTiles` must have closed by. */
function promisedCloseTiles(talkRangeTiles: number): number {
  return talkRangeTiles + PROMISED_MARGIN_TILES;
}

/** The street citizen's talk range, the tightest in the game — a walk-away rule loose enough to pass here passes everywhere. */
const CITIZEN_TALK_RANGE_TILES = 1.1;
/** Frames a player stands still, or shuffles, while reading — well past a whole page's reveal. */
const READING_FRAMES = 240;
/** How far inside the walk-away range the shuffle turns back, so it goes right up to the edge without crossing it. */
const SHUFFLE_EDGE_SLACK_TILES = 0.05;
/** A close is judged at the frame it happened, so the player can have overshot by at most one frame's walk. */
const ONE_STEP_TILES = PLAYER_SPEED / TILE_SIZE;
/** Enough frames to walk across any safe room several times over. */
const MAX_WALK_FRAMES = 4000;
/** Seeds whose floors are searched for safe rooms; each floor holds about two. */
const SEEDS = [7919, 15838, 23757, 31676, 39595, 47514, 55433, 63352, 71271, 79190, 87109, 95028];
/** How close the walk-away test stands to Mordecai to start talking: well inside his range, as a player would. */
const MORDECAI_PRESS_TILES = 1.5;

interface Point {
  x: number;
  y: number;
}

function anchoredRequest(
  speaker: Point,
  talkRangeTiles: number,
  onDismissed: () => void,
): ConversationRequest {
  return {
    lines: [say.line('A passing remark, long enough to stand and read for a while.')],
    reward: null,
    questRelated: false,
    ending: { kind: 'close', onClosed: () => undefined },
    dismiss: { kind: 'allowed', onDismissed },
    haltsWorld: false,
    anchor: { position: () => speaker, talkRangeTiles },
    locksKeyboard: true,
  };
}

function atTiles(tiles: number): Point {
  return { x: tiles * TILE_SIZE, y: 0 };
}

// ── The rule itself, on a bare conversation ───────────────────────────────

function verifyWalkAwayRule(): void {
  console.log('\nwalking away closes one margin past the talk range');
  const conversation = new Conversation(null);
  const speaker: Point = { x: 0, y: 0 };
  let dismissed = false;
  conversation.open(
    anchoredRequest(speaker, CITIZEN_TALK_RANGE_TILES, () => {
      dismissed = true;
    }),
  );
  const closeAt = promisedCloseTiles(CITIZEN_TALK_RANGE_TILES);

  const standingTiles = CITIZEN_TALK_RANGE_TILES;
  for (let frame = 0; frame < READING_FRAMES; frame++) conversation.update(atTiles(standingTiles));
  check(conversation.isOpen, 'standing still at the edge of the talk range keeps it open');

  const shuffleFar = closeAt - SHUFFLE_EDGE_SLACK_TILES;
  for (let frame = 0; frame < READING_FRAMES; frame++) {
    const phase = frame / READING_FRAMES;
    const tiles =
      standingTiles + (shuffleFar - standingTiles) * Math.abs(Math.sin(phase * Math.PI));
    conversation.update(atTiles(tiles));
  }
  check(conversation.isOpen, 'shuffling anywhere inside the walk-away range keeps it open');

  let tiles = standingTiles;
  let closedAtTiles: number | null = null;
  for (let frame = 0; frame < MAX_WALK_FRAMES; frame++) {
    tiles += ONE_STEP_TILES;
    conversation.update(atTiles(tiles));
    if (!conversation.isOpen) {
      closedAtTiles = tiles;
      break;
    }
  }
  check(closedAtTiles !== null, 'walking straight off closes it');
  if (closedAtTiles !== null) {
    check(
      closedAtTiles <= closeAt + ONE_STEP_TILES,
      `it closes within ${PROMISED_MARGIN_TILES} tile of the talk range (closed at ${closedAtTiles.toFixed(2)}, limit ${closeAt.toFixed(2)})`,
    );
    const shared = CITIZEN_TALK_RANGE_TILES + WALK_AWAY_MARGIN_TILES;
    check(closedAtTiles > shared, "it does not close before the shared rule's walk-away range");
  }
  check(dismissed, "the walk-away runs the owner's onDismissed");
}

function verifyHandOff(): void {
  console.log('\nan out-of-range press goes to the world first');
  {
    const conversation = new Conversation(null);
    const speaker: Point = { x: 0, y: 0 };
    let firstReleased = false;
    const first = conversation.open(
      anchoredRequest(speaker, CITIZEN_TALK_RANGE_TILES, () => {
        firstReleased = true;
      }),
    );
    let asked = false;
    const inRange = conversation.handOff(atTiles(CITIZEN_TALK_RANGE_TILES), false, () => {
      asked = true;
      return true;
    });
    check(!inRange && !asked, 'inside the talk range the press stays with the box');

    const outside = atTiles(CITIZEN_TALK_RANGE_TILES + WALK_AWAY_MARGIN_TILES / 2);
    const tookIt = conversation.handOff(outside, false, () => {
      conversation.open(anchoredRequest(outside, CITIZEN_TALK_RANGE_TILES, () => undefined));
      return true;
    });
    check(tookIt, 'out of range, a press someone else answers is theirs');
    check(!conversation.isActive(first), 'the new speaker is the one on screen');
    check(firstReleased, 'the first speaker was released');
  }
  {
    const conversation = new Conversation(null);
    let released = false;
    conversation.open(
      anchoredRequest({ x: 0, y: 0 }, CITIZEN_TALK_RANGE_TILES, () => {
        released = true;
      }),
    );
    const outside = atTiles(CITIZEN_TALK_RANGE_TILES + WALK_AWAY_MARGIN_TILES / 2);
    const tookIt = conversation.handOff(outside, false, () => true);
    check(
      tookIt && !conversation.isOpen && released,
      'a press the world takes without opening a box still ends the stale one',
    );
  }
  {
    const conversation = new Conversation(null);
    conversation.open(anchoredRequest({ x: 0, y: 0 }, CITIZEN_TALK_RANGE_TILES, () => undefined));
    const outside = atTiles(CITIZEN_TALK_RANGE_TILES + WALK_AWAY_MARGIN_TILES / 2);
    const tookIt = conversation.handOff(outside, false, () => false);
    check(!tookIt && conversation.isOpen, 'a press nobody else answers leaves the box alone');
  }
  {
    const conversation = new Conversation(null);
    conversation.open({
      ...anchoredRequest({ x: 0, y: 0 }, CITIZEN_TALK_RANGE_TILES, () => undefined),
      dismiss: { kind: 'blocked' },
    });
    let asked = false;
    conversation.handOff(atTiles(CITIZEN_TALK_RANGE_TILES * 2), true, () => {
      asked = true;
      return true;
    });
    check(!asked && conversation.isOpen, 'a scene the player is held for is never handed off');
  }
}

// ── The real safe rooms ───────────────────────────────────────────────────

interface Room {
  readonly map: GameMap;
  readonly bounds: { x: number; y: number; w: number; h: number };
  readonly bopcaHome: Point;
  readonly mordecaiHome: Point;
}

function tileKey(tile: Point): string {
  return `${tile.x},${tile.y}`;
}

/** Walkable tiles of the room reachable from `from`, with the path to each. */
function pathsFrom(room: Room, from: Point): Map<string, Point[]> {
  const paths = new Map<string, Point[]>([[tileKey(from), [from]]]);
  const queue: Point[] = [from];
  const steps: Point[] = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  for (let head = 0; head < queue.length; head++) {
    const tile = queue[head];
    const path = paths.get(tileKey(tile)) ?? [];
    for (const step of steps) {
      const next = { x: tile.x + step.x, y: tile.y + step.y };
      const { bounds } = room;
      const inRoom =
        next.x >= bounds.x &&
        next.x < bounds.x + bounds.w &&
        next.y >= bounds.y &&
        next.y < bounds.y + bounds.h;
      if (!inRoom || paths.has(tileKey(next)) || !room.map.isWalkable(next.x, next.y)) continue;
      paths.set(tileKey(next), [...path, next]);
      queue.push(next);
    }
  }
  return paths;
}

function tilesBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function playerAt(tile: Point): { human: HumanPlayer; cat: CatPlayer } {
  const human = new HumanPlayer(tile.x, tile.y, TILE_SIZE);
  const cat = new CatPlayer(tile.x, tile.y, TILE_SIZE);
  return { human, cat };
}

/**
 * Walks `human` along `path` at the player's speed, one frame at a time,
 * ticking the conversation and the Bopca each frame as the dungeon does.
 * Stops early when `stop` says so.
 */
function walk(
  path: readonly Point[],
  human: HumanPlayer,
  cat: CatPlayer,
  conversation: Conversation,
  bopca: BopcaSystem,
  stop: () => boolean,
): void {
  for (const tile of path) {
    const targetX = tile.x * TILE_SIZE;
    const targetY = tile.y * TILE_SIZE;
    for (let frame = 0; frame < MAX_WALK_FRAMES; frame++) {
      const dx = targetX - human.x;
      const dy = targetY - human.y;
      const distance = Math.hypot(dx, dy);
      if (distance < PLAYER_SPEED) {
        human.x = targetX;
        human.y = targetY;
      } else {
        human.x += (dx / distance) * PLAYER_SPEED;
        human.y += (dy / distance) * PLAYER_SPEED;
      }
      conversation.update({ x: human.x, y: human.y });
      bopca.tick(human, cat, human, cat);
      if (stop()) return;
      if (distance < PLAYER_SPEED) break;
    }
  }
}

function standStill(
  human: HumanPlayer,
  cat: CatPlayer,
  conversation: Conversation,
  bopca: BopcaSystem,
): void {
  for (let frame = 0; frame < READING_FRAMES; frame++) {
    conversation.update({ x: human.x, y: human.y });
    bopca.tick(human, cat, human, cat);
  }
}

function tilesFromPlayer(human: HumanPlayer, tile: Point): number {
  return Math.hypot(human.x - tile.x * TILE_SIZE, human.y - tile.y * TILE_SIZE) / TILE_SIZE;
}

interface SafeRoomTally {
  rooms: number;
  bopcaWalkAways: number;
  mordecaiWalkAways: number;
  handOffs: number;
  closeTogetherHandOffs: number;
  /** Walks that ended beside Mordecai but still inside the Bopca's own talk range. */
  overlappingHandOffs: number;
}

function roomsOf(
  seed: number,
): Array<{ room: Room; bopca: BopcaSystem; safeRoom: SafeRoomSystem; conversation: Conversation }> {
  const map = new GameMap({ tileHeight: TILE_SIZE, worldSeed: seed });
  const layouts = stampSafeRoomCounters(map);
  // After the counter, as the dungeon stamps them: the furnishings are solid,
  // and a walk that passed through a stove would prove nothing.
  stampSafeRoomDecor(map);
  return layouts.flatMap((layout) => {
    const safeRoomGeometry = map.safeRooms[layout.safeRoomIndex];
    if (safeRoomGeometry === undefined) return [];
    const conversation = new Conversation(null);
    // One system per room, with only that room's counter, so each room is a
    // fresh visit and nothing one room's walk did carries into the next.
    const bopca = new BopcaSystem(map, [layout], new EventBus(), conversation, null, false);
    const safeRoom = new SafeRoomSystem(map, 0, 0, conversation);
    const mordecaiHome = safeRoom.mordecaiPositions.find(
      (home) =>
        home.x >= layout.roomBounds.x &&
        home.x < layout.roomBounds.x + layout.roomBounds.w &&
        home.y >= layout.roomBounds.y &&
        home.y < layout.roomBounds.y + layout.roomBounds.h,
    );
    if (mordecaiHome === undefined) return [];
    return [
      {
        room: { map, bounds: layout.roomBounds, bopcaHome: layout.bopcaHomeTile, mordecaiHome },
        bopca,
        safeRoom,
        conversation,
      },
    ];
  });
}

function verifySafeRooms(): void {
  console.log(
    '\nreal safe rooms: walking off the Bopca and Mordecai, and turning from one to the other',
  );
  const tally: SafeRoomTally = {
    rooms: 0,
    bopcaWalkAways: 0,
    mordecaiWalkAways: 0,
    handOffs: 0,
    closeTogetherHandOffs: 0,
    overlappingHandOffs: 0,
  };
  const bopcaCloseAt = promisedCloseTiles(BOPCA_TALK_DISTANCE_TILES);
  const mordecaiCloseAt = promisedCloseTiles(SafeRoomSystem.MORDECAI_NEAR_DISTANCE);
  const line = say.line('Mordecai has a word for you.');

  for (const seed of SEEDS) {
    for (const { room, bopca, safeRoom, conversation } of roomsOf(seed)) {
      tally.rooms++;
      const label = `seed ${seed}, room at ${room.bounds.x},${room.bounds.y}`;
      const allTiles: Point[] = [];
      for (let y = room.bounds.y; y < room.bounds.y + room.bounds.h; y++) {
        for (let x = room.bounds.x; x < room.bounds.x + room.bounds.w; x++) {
          if (room.map.isWalkable(x, y)) allTiles.push({ x, y });
        }
      }
      // The floor the party can actually stand on: everything reachable from
      // Mordecai's home. The galley behind the counter is walkable but sealed
      // off by the counter itself, and a walk that starts in it goes nowhere.
      const partyFloor = pathsFrom(room, room.mordecaiHome);
      // Where a player orders from: the tile on that floor nearest the Bopca
      // that a press reaches her from.
      const orderingTiles = allTiles
        .filter((tile) => partyFloor.has(tileKey(tile)))
        .filter((tile) => safeRoomSpeakerFor(bopca, null, pixels(tile)) === 'bopca')
        .sort((a, b) => tilesBetween(a, room.bopcaHome) - tilesBetween(b, room.bopcaHome));
      const orderFrom = orderingTiles[0];
      if (orderFrom === undefined) {
        check(false, `${label}: the counter can be ordered from`);
        continue;
      }
      const paths = pathsFrom(room, orderFrom);

      // ── Walk away from the Bopca ──
      {
        const { human, cat } = playerAt(orderFrom);
        check(bopca.tryInteract(human) && bopca.isDialogOpen, `${label}: the Bopca's box opens`);
        standStill(human, cat, conversation, bopca);
        check(bopca.isDialogOpen, `${label}: standing at the counter keeps the Bopca's box open`);
        const farthest = [...paths.values()]
          .map((path) => path[path.length - 1])
          .filter((tile) => tilesBetween(tile, room.bopcaHome) > bopcaCloseAt + 1)
          .sort((a, b) => tilesBetween(b, room.bopcaHome) - tilesBetween(a, room.bopcaHome))[0];
        if (farthest !== undefined) {
          tally.bopcaWalkAways++;
          const closed: { atTiles: number | null } = { atTiles: null };
          walk(paths.get(tileKey(farthest)) ?? [], human, cat, conversation, bopca, () => {
            if (bopca.isDialogOpen) return false;
            closed.atTiles = tilesFromPlayer(human, room.bopcaHome);
            return true;
          });
          const closedAtTiles = closed.atTiles;
          check(
            closedAtTiles !== null && closedAtTiles <= bopcaCloseAt + ONE_STEP_TILES,
            `${label}: walking off inside the room closes the Bopca's box by ${bopcaCloseAt.toFixed(1)} tiles (closed at ${closedAtTiles === null ? 'never' : closedAtTiles.toFixed(2)})`,
          );
        }
        conversation.close();
      }

      // ── Walk away from Mordecai ──
      {
        const mordecaiTiles = allTiles
          .filter((tile) => tilesBetween(tile, room.mordecaiHome) <= MORDECAI_PRESS_TILES)
          .sort((a, b) => tilesBetween(a, room.mordecaiHome) - tilesBetween(b, room.mordecaiHome));
        const talkFrom = mordecaiTiles.find(
          (tile) => !(tile.x === room.mordecaiHome.x && tile.y === room.mordecaiHome.y),
        );
        if (talkFrom !== undefined) {
          const { human, cat } = playerAt(talkFrom);
          safeRoom.openMordecaiLine(human, line);
          check(safeRoom.mordecaiDialogOpen, `${label}: Mordecai's box opens`);
          standStill(human, cat, conversation, bopca);
          check(safeRoom.mordecaiDialogOpen, `${label}: standing by Mordecai keeps his box open`);
          const fromHere = pathsFrom(room, talkFrom);
          const farthest = [...fromHere.values()]
            .map((path) => path[path.length - 1])
            .filter((tile) => tilesBetween(tile, room.mordecaiHome) > mordecaiCloseAt + 1)
            .sort(
              (a, b) => tilesBetween(b, room.mordecaiHome) - tilesBetween(a, room.mordecaiHome),
            )[0];
          if (farthest !== undefined) {
            tally.mordecaiWalkAways++;
            const closed: { atTiles: number | null } = { atTiles: null };
            walk(fromHere.get(tileKey(farthest)) ?? [], human, cat, conversation, bopca, () => {
              if (safeRoom.mordecaiDialogOpen) return false;
              closed.atTiles = tilesFromPlayer(human, room.mordecaiHome);
              return true;
            });
            const closedAtTiles = closed.atTiles;
            check(
              closedAtTiles !== null && closedAtTiles <= mordecaiCloseAt + ONE_STEP_TILES,
              `${label}: walking off closes Mordecai's box by ${mordecaiCloseAt.toFixed(1)} tiles (closed at ${closedAtTiles === null ? 'never' : closedAtTiles.toFixed(2)})`,
            );
          }
          conversation.close();
        }
      }

      // ── From the counter to Mordecai ──
      {
        // The tile a player walks up to him on: the one beside him nearest the
        // counter. Chosen by the room's shape alone, not by who the game thinks
        // the press is for, so a room where he stands inside the Bopca's range
        // is tested as the player meets it.
        const pressTile = allTiles
          .filter((tile) => paths.has(tileKey(tile)))
          .filter((tile) => tilesBetween(tile, room.mordecaiHome) === 1)
          .sort((a, b) => tilesBetween(a, orderFrom) - tilesBetween(b, orderFrom))[0];
        if (pressTile === undefined) {
          check(false, `${label}: Mordecai can be walked up to from the counter`);
          continue;
        }
        const { human, cat } = playerAt(orderFrom);
        bopca.tryInteract(human);
        standStill(human, cat, conversation, bopca);
        walk(paths.get(tileKey(pressTile)) ?? [], human, cat, conversation, bopca, () => false);
        const bopcaBoxStillUp = bopca.isDialogOpen;
        const stillInBopcaRange = bopca.interactionDistanceTiles(human) !== null;
        const trySafeRoomPress = (): boolean => {
          const speaker = safeRoomSpeakerFor(bopca, safeRoom, human);
          if (speaker === 'bopca') return bopca.tryInteract(human);
          if (speaker === 'mordecai') {
            safeRoom.openMordecaiLine(human, line);
            return true;
          }
          return false;
        };
        // The dungeon's interact press, as `DungeonScene` routes it: with a
        // box up, offered to the room first and then to the box; with none,
        // straight to the room.
        if (conversation.isOpen) {
          const pressIsForSomeoneElse = safeRoomPressLeavesSpeaker(bopca, safeRoom, human);
          const handedOff = conversation.handOff(human, pressIsForSomeoneElse, trySafeRoomPress);
          if (!handedOff) conversation.advance();
        } else {
          trySafeRoomPress();
        }
        const reached = safeRoom.mordecaiDialogOpen && !bopca.isDialogOpen;
        check(
          reached,
          `${label}: walking from the counter to Mordecai (${tilesBetween(room.bopcaHome, room.mordecaiHome).toFixed(1)} tiles apart) and pressing talk opens him`,
        );
        tally.handOffs++;
        if (bopcaBoxStillUp) tally.closeTogetherHandOffs++;
        if (stillInBopcaRange) tally.overlappingHandOffs++;
        conversation.close();
      }
    }
  }

  console.log(
    `\n  ${tally.rooms} rooms; ${tally.bopcaWalkAways} Bopca walk-aways, ${tally.mordecaiWalkAways} Mordecai walk-aways, ${tally.handOffs} counter-to-Mordecai walks (${tally.closeTogetherHandOffs} with the Bopca's box still up on arrival, ${tally.overlappingHandOffs} still inside her talk range)`,
  );
  // A gate that found no room to walk in passes vacuously; insist it found each case.
  check(tally.rooms > 0, 'the seeds generated safe rooms to test in');
  check(
    tally.bopcaWalkAways > 0,
    'at least one room was big enough to walk off the Bopca inside it',
  );
  check(
    tally.mordecaiWalkAways > 0,
    'at least one room was big enough to walk off Mordecai inside it',
  );
  check(
    tally.closeTogetherHandOffs > 0,
    'at least one room put Mordecai close enough to the counter that the Bopca box was still up on reaching him',
  );
  check(
    tally.overlappingHandOffs > 0,
    "at least one room put the tile beside Mordecai inside the Bopca's own talk range",
  );
}

function pixels(tile: Point): Point {
  return { x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE };
}

verifyWalkAwayRule();
verifyHandOff();
verifySafeRooms();

console.log(failures === 0 ? '\nall walk-away checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
