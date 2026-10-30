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
 *   - In real generated safe rooms, a doctor conversation closes on walking
 *     off inside the room, and so does Dave's; and walking from the
 *     doctor to Dave and pressing talk opens Dave, including in rooms
 *     where he stands close enough to the doctor that the doctor's box would
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
import { stampSafeRoomClinics } from '../src/map/safeRoomClinicLayout';
import { stampSafeRoomDecor } from '../src/map/safeRoomDecorLayout';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { DOCTOR_TALK_DISTANCE_TILES, DoctorSystem } from '../src/systems/DoctorSystem';
import { SafeRoomSystem } from '../src/systems/SafeRoomSystem';
import {
  DAVE_NEAR_DISTANCE_TILES,
  DaveGuideSystem,
  DaveWhereabouts,
} from '../src/systems/DaveGuideSystem';
import { safeRoomIdIn, type SafeRoomScope } from '../src/map/safeRoomId';
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
/** How close the walk-away test stands to Dave to start talking: well inside his range, as a player would. */
const DAVE_PRESS_TILES = 1.5;

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
  readonly doctorHome: Point;
  readonly daveHome: Point;
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
      if (!inRoom || paths.has(tileKey(next)) || !room.map.isWalkable(next.x, next.y, 'walker'))
        continue;
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
 * ticking the conversation and the doctor each frame as the dungeon does.
 * Stops early when `stop` says so.
 */
function walk(
  path: readonly Point[],
  human: HumanPlayer,
  cat: CatPlayer,
  conversation: Conversation,
  doctor: DoctorSystem,
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
      doctor.tick(human, cat, human, cat);
      if (stop()) return;
      if (distance < PLAYER_SPEED) break;
    }
  }
}

function standStill(
  human: HumanPlayer,
  cat: CatPlayer,
  conversation: Conversation,
  doctor: DoctorSystem,
): void {
  for (let frame = 0; frame < READING_FRAMES; frame++) {
    conversation.update({ x: human.x, y: human.y });
    doctor.tick(human, cat, human, cat);
  }
}

function tilesFromPlayer(human: HumanPlayer, tile: Point): number {
  return Math.hypot(human.x - tile.x * TILE_SIZE, human.y - tile.y * TILE_SIZE) / TILE_SIZE;
}

interface SafeRoomTally {
  rooms: number;
  doctorWalkAways: number;
  daveWalkAways: number;
  handOffs: number;
  closeTogetherHandOffs: number;
  /** Walks that ended beside Dave but still inside the doctor's own talk range. */
  overlappingHandOffs: number;
}

/** The scope every walk-away room is built in; any floor would do. */
const SAFE_ROOM_SCOPE: SafeRoomScope = { kind: 'floor', level: 'level1' };
function roomsOf(
  seed: number,
): Array<{ room: Room; doctor: DoctorSystem; dave: DaveGuideSystem; conversation: Conversation }> {
  const map = new GameMap({ tileHeight: TILE_SIZE, worldSeed: seed });
  const layouts = stampSafeRoomClinics(map);
  // After the doctor's corner, as the dungeon stamps them: the furnishings are solid,
  // and a walk that passed through a stove would prove nothing.
  stampSafeRoomDecor(map);
  return layouts.flatMap((layout) => {
    const safeRoomGeometry = map.safeRooms[layout.safeRoomIndex];
    if (safeRoomGeometry === undefined) return [];
    const conversation = new Conversation(null);
    // One system per room, with only that room's doctor, so each room is a
    // fresh visit and nothing one room's walk did carries into the next.
    const doctor = new DoctorSystem([layout], SAFE_ROOM_SCOPE, new EventBus(), conversation, false);
    const safeRooms = new SafeRoomSystem(map, SAFE_ROOM_SCOPE);
    const roomId = safeRoomIdIn(SAFE_ROOM_SCOPE, layout.safeRoomIndex);
    const daveHome = safeRooms.guidePlacement(roomId)?.home;
    if (daveHome === undefined) return [];
    const dave = new DaveGuideSystem(
      {
        safeRooms,
        conversation,
        whereabouts: new DaveWhereabouts(),
        camera: () => ({ x: 0, y: 0 }),
        audio: null,
      },
      roomId,
    );
    return [
      {
        room: { map, bounds: layout.roomBounds, doctorHome: layout.doctorTile, daveHome },
        doctor,
        dave,
        conversation,
      },
    ];
  });
}

function verifySafeRooms(): void {
  console.log(
    '\nreal safe rooms: walking off the doctor and Dave, and turning from one to the other',
  );
  const tally: SafeRoomTally = {
    rooms: 0,
    doctorWalkAways: 0,
    daveWalkAways: 0,
    handOffs: 0,
    closeTogetherHandOffs: 0,
    overlappingHandOffs: 0,
  };
  const doctorCloseAt = promisedCloseTiles(DOCTOR_TALK_DISTANCE_TILES);
  const daveCloseAt = promisedCloseTiles(DAVE_NEAR_DISTANCE_TILES);
  const line = say.line('Dave has a word for you.');

  for (const seed of SEEDS) {
    for (const { room, doctor, dave, conversation } of roomsOf(seed)) {
      tally.rooms++;
      const label = `seed ${seed}, room at ${room.bounds.x},${room.bounds.y}`;
      const allTiles: Point[] = [];
      for (let y = room.bounds.y; y < room.bounds.y + room.bounds.h; y++) {
        for (let x = room.bounds.x; x < room.bounds.x + room.bounds.w; x++) {
          if (room.map.isWalkable(x, y, 'walker')) allTiles.push({ x, y });
        }
      }
      // The floor the party can actually stand on: everything reachable from
      // Dave's home.
      const partyFloor = pathsFrom(room, room.daveHome);
      // Where a player talks from: the tile on that floor nearest the doctor
      // that a press reaches them from.
      const talkingTiles = allTiles
        .filter((tile) => partyFloor.has(tileKey(tile)))
        .filter((tile) => safeRoomSpeakerFor(doctor, null, pixels(tile)) === 'doctor')
        .sort((a, b) => tilesBetween(a, room.doctorHome) - tilesBetween(b, room.doctorHome));
      const visitFrom = talkingTiles[0];
      if (visitFrom === undefined) {
        check(false, `${label}: the doctor can be spoken to`);
        continue;
      }
      const paths = pathsFrom(room, visitFrom);

      // ── Walk away from the doctor ──
      {
        const { human, cat } = playerAt(visitFrom);
        check(doctor.tryInteract(human) && doctor.isDialogOpen, `${label}: the doctor's box opens`);
        standStill(human, cat, conversation, doctor);
        check(doctor.isDialogOpen, `${label}: standing by the doctor keeps the doctor's box open`);
        const farthest = [...paths.values()]
          .map((path) => path[path.length - 1])
          .filter((tile) => tilesBetween(tile, room.doctorHome) > doctorCloseAt + 1)
          .sort((a, b) => tilesBetween(b, room.doctorHome) - tilesBetween(a, room.doctorHome))[0];
        if (farthest !== undefined) {
          tally.doctorWalkAways++;
          const closed: { atTiles: number | null } = { atTiles: null };
          walk(paths.get(tileKey(farthest)) ?? [], human, cat, conversation, doctor, () => {
            if (doctor.isDialogOpen) return false;
            closed.atTiles = tilesFromPlayer(human, room.doctorHome);
            return true;
          });
          const closedAtTiles = closed.atTiles;
          check(
            closedAtTiles !== null && closedAtTiles <= doctorCloseAt + ONE_STEP_TILES,
            `${label}: walking off inside the room closes the doctor's box by ${doctorCloseAt.toFixed(1)} tiles (closed at ${closedAtTiles === null ? 'never' : closedAtTiles.toFixed(2)})`,
          );
        }
        conversation.close();
      }

      // ── Walk away from Dave ──
      {
        const daveTiles = allTiles
          .filter((tile) => tilesBetween(tile, room.daveHome) <= DAVE_PRESS_TILES)
          .sort((a, b) => tilesBetween(a, room.daveHome) - tilesBetween(b, room.daveHome));
        const talkFrom = daveTiles.find(
          (tile) => !(tile.x === room.daveHome.x && tile.y === room.daveHome.y),
        );
        if (talkFrom !== undefined) {
          const { human, cat } = playerAt(talkFrom);
          dave.openLine(human, line);
          check(dave.dialogOpen, `${label}: Dave's box opens`);
          standStill(human, cat, conversation, doctor);
          check(dave.dialogOpen, `${label}: standing by Dave keeps his box open`);
          const fromHere = pathsFrom(room, talkFrom);
          const farthest = [...fromHere.values()]
            .map((path) => path[path.length - 1])
            .filter((tile) => tilesBetween(tile, room.daveHome) > daveCloseAt + 1)
            .sort((a, b) => tilesBetween(b, room.daveHome) - tilesBetween(a, room.daveHome))[0];
          if (farthest !== undefined) {
            tally.daveWalkAways++;
            const closed: { atTiles: number | null } = { atTiles: null };
            walk(fromHere.get(tileKey(farthest)) ?? [], human, cat, conversation, doctor, () => {
              if (dave.dialogOpen) return false;
              closed.atTiles = tilesFromPlayer(human, room.daveHome);
              return true;
            });
            const closedAtTiles = closed.atTiles;
            check(
              closedAtTiles !== null && closedAtTiles <= daveCloseAt + ONE_STEP_TILES,
              `${label}: walking off closes Dave's box by ${daveCloseAt.toFixed(1)} tiles (closed at ${closedAtTiles === null ? 'never' : closedAtTiles.toFixed(2)})`,
            );
          }
          conversation.close();
        }
      }

      // ── From the doctor to Dave ──
      {
        // The tile a player walks up to him on: the one beside him nearest the
        // doctor. Chosen by the room's shape alone, not by who the game thinks
        // the press is for, so a room where he stands inside the doctor's range
        // is tested as the player meets it.
        const pressTile = allTiles
          .filter((tile) => paths.has(tileKey(tile)))
          .filter((tile) => tilesBetween(tile, room.daveHome) === 1)
          .sort((a, b) => tilesBetween(a, visitFrom) - tilesBetween(b, visitFrom))[0];
        if (pressTile === undefined) {
          check(false, `${label}: Dave can be walked up to from the doctor`);
          continue;
        }
        const { human, cat } = playerAt(visitFrom);
        doctor.tryInteract(human);
        standStill(human, cat, conversation, doctor);
        walk(paths.get(tileKey(pressTile)) ?? [], human, cat, conversation, doctor, () => false);
        const doctorBoxStillUp = doctor.isDialogOpen;
        const stillInDoctorRange = doctor.interactionDistanceTiles(human) !== null;
        const trySafeRoomPress = (): boolean => {
          const speaker = safeRoomSpeakerFor(doctor, dave, human);
          if (speaker === 'doctor') return doctor.tryInteract(human);
          if (speaker === 'dave') {
            dave.openLine(human, line);
            return true;
          }
          return false;
        };
        // The dungeon's interact press, as `DungeonScene` routes it: with a
        // box up, offered to the room first and then to the box; with none,
        // straight to the room.
        if (conversation.isOpen) {
          const pressIsForSomeoneElse = safeRoomPressLeavesSpeaker(doctor, dave, human);
          const handedOff = conversation.handOff(human, pressIsForSomeoneElse, trySafeRoomPress);
          if (!handedOff) conversation.advance();
        } else {
          trySafeRoomPress();
        }
        const reached = dave.dialogOpen && !doctor.isDialogOpen;
        check(
          reached,
          `${label}: walking from the doctor to Dave (${tilesBetween(room.doctorHome, room.daveHome).toFixed(1)} tiles apart) and pressing talk opens him`,
        );
        tally.handOffs++;
        if (doctorBoxStillUp) tally.closeTogetherHandOffs++;
        if (stillInDoctorRange) tally.overlappingHandOffs++;
        conversation.close();
      }
    }
  }

  console.log(
    `\n  ${tally.rooms} rooms; ${tally.doctorWalkAways} doctor walk-aways, ${tally.daveWalkAways} Dave walk-aways, ${tally.handOffs} doctor-to-Dave walks (${tally.closeTogetherHandOffs} with the doctor's box still up on arrival, ${tally.overlappingHandOffs} still inside the doctor's talk range)`,
  );
  // A gate that found no room to walk in passes vacuously; insist it found each case.
  check(tally.rooms > 0, 'the seeds generated safe rooms to test in');
  check(
    tally.doctorWalkAways > 0,
    'at least one room was big enough to walk off the doctor inside it',
  );
  check(tally.daveWalkAways > 0, 'at least one room was big enough to walk off Dave inside it');
  check(
    tally.closeTogetherHandOffs > 0,
    "at least one room put Dave close enough to the doctor that the doctor's box was still up on reaching him",
  );
  check(
    tally.overlappingHandOffs > 0,
    "at least one room put the tile beside Dave inside the doctor's own talk range",
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
