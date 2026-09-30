/**
 * Merrit's fence, for `verify:borrowed-blueprints`: how the pasture ring is
 * cut into sections, that a section can only be rebuilt during
 * `build_fence`, what one costs and the refusal when the party is short, the
 * hammering channel and what cancels it, the restyle and its chunk
 * invalidation, and the step moving on once the last section stands.
 *
 * Run on the whole village kit, built as the scene builds it, over a real
 * generated floor-3 map (the siege harness's rig).
 */

import { TILE_SIZE } from '../../src/core/constants';
import { createBriarHollowState } from '../../src/core/briarHollowState';
import type { BlueprintsQuestPhase } from '../../src/core/blueprintsQuestPhase';
import type { MidgeEscortCarry } from '../../src/core/midgeEscortCarry';
import { Rat } from '../../src/creatures/Rat';
import { FENCE } from '../../src/map/tileTypes';
import type { TilePoint } from '../../src/map/town/townPlan';
import {
  PASTURE_FENCE_SECTION_COUNT,
  pastureFenceSections,
} from '../../src/map/overworld/briarHollowLayout';
import type { BlueprintsQuestSystem } from '../../src/systems/briarHollow/BlueprintsQuestSystem';
import type { SoundId } from '../../src/audio/sounds';
import { REPAIR_ROWS, type HumanRowName } from '../../src/sprites/art/humanFigure';
import {
  FENCE_SECTION_BOARD_COST,
  FENCE_SECTION_WORK_SECONDS,
  FENCE_SHORT_MESSAGE,
  PastureFenceWork,
} from '../../src/systems/briarHollow/blueprints/PastureFenceWork';
import { BLUEPRINTS_CUES } from '../../src/systems/briarHollow/blueprints/blueprintsSoundCues';
import { buildSiegeRig, standAt, UPDATES_PER_SECOND, type SiegeRig } from '../villageSiegeHarness';

/** The runner's pass/fail recorder, handed in so every section counts toward one verdict. */
export type Check = (ok: boolean, label: string) => void;

/** A seed whose floor 3 has Briar Hollow on it, shared with the Plea's gate. */
export const BLUEPRINTS_RIG_SEED = 7919;
const RIG_ASSAULT_LEVEL = 6;
const SHORTEST_SECTION = 4;
const LONGEST_SECTION = 5;
/** Enough boards for every section with some over. */
const PLENTY_OF_BOARDS = 40;
/** A frame or two past the channel's end, so the last tick has certainly run. */
const WORK_FRAMES_WITH_SLACK = Math.ceil(FENCE_SECTION_WORK_SECONDS * UPDATES_PER_SECOND) + 2;
/** A push well past the channel's motion tolerance. */
const WALK_OFF_PX = 6;
const TILE_CENTRE = 0.5;
/** The section the build walk-through rebuilds: any one away from the gate. */
const BUILT_SECTION = 2;
const HALF_THE_CHANNEL_FRAMES = Math.floor((FENCE_SECTION_WORK_SECONDS * UPDATES_PER_SECOND) / 2);

/**
 * A fresh village kit, with the blueprints quest standing at `phase`, and
 * Midge's escort as a door carried it when `midgeEscortCarry` is given.
 */
export function blueprintsRig(
  phase: BlueprintsQuestPhase,
  midgeEscortCarry?: MidgeEscortCarry,
): {
  readonly rig: SiegeRig;
  readonly blueprints: BlueprintsQuestSystem;
} {
  const state = createBriarHollowState();
  state.blueprints.phase = phase;
  const rig = buildSiegeRig({
    seed: BLUEPRINTS_RIG_SEED,
    state,
    assaultLevel: RIG_ASSAULT_LEVEL,
    midgeEscortCarry,
  });
  const blueprints = rig.kit.blueprints;
  if (blueprints === null) throw new Error('the village kit built no blueprints quest');
  // What is under test is the quest, not the party's survival.
  rig.human.godMode = true;
  rig.cat.godMode = true;
  return { rig, blueprints };
}

function stepFrames(rig: SiegeRig, frames: number): void {
  for (let frame = 0; frame < frames; frame++) rig.step();
}

function isFourAdjacent(a: TilePoint, b: TilePoint): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

function styleAt(rig: SiegeRig, tile: TilePoint): string | undefined {
  return rig.map.structure[tile.y]?.[tile.x]?.fenceStyle;
}

/**
 * Stands the human beside `tile` on the side away from the pasture's middle
 * — the tile a crawler walking the ring would press from.
 */
function standBeside(rig: SiegeRig, tile: TilePoint): void {
  const { rect } = rig.site.pasture;
  const centreX = rect.x + rect.w / 2;
  const centreY = rect.y + rect.h / 2;
  const onSide = tile.x === rect.x || tile.x === rect.x + rect.w - 1;
  const dx = onSide ? Math.sign(tile.x - centreX) : 0;
  const dy = onSide ? 0 : Math.sign(tile.y - centreY);
  standAt(rig.human, tile.x + dx, tile.y + dy);
  rig.human.isMoving = false;
}

function giveBoards(rig: SiegeRig, boards: number): void {
  const held = rig.human.inventory.countOf('wood_board') + rig.cat.inventory.countOf('wood_board');
  if (held > 0) {
    rig.human.inventory.removeItems('wood_board', rig.human.inventory.countOf('wood_board'));
    rig.cat.inventory.removeItems('wood_board', rig.cat.inventory.countOf('wood_board'));
  }
  if (boards > 0) rig.human.inventory.addItem('wood_board', boards);
}

function boardsHeld(rig: SiegeRig): number {
  return rig.human.inventory.countOf('wood_board') + rig.cat.inventory.countOf('wood_board');
}

/** The ring's sections: ten contiguous runs of four or five, covering the fence once, the same every time. */
export function verifyFenceSections(check: Check): void {
  const { rig } = blueprintsRig('build_fence');
  const { rect, fenceGates } = rig.site.pasture;
  const sections = pastureFenceSections(rig.site);
  check(
    sections.length === PASTURE_FENCE_SECTION_COUNT,
    `the ring is cut into ${PASTURE_FENCE_SECTION_COUNT} sections`,
  );
  check(
    sections.every(
      (section) => section.length >= SHORTEST_SECTION && section.length <= LONGEST_SECTION,
    ),
    `every section is ${SHORTEST_SECTION}–${LONGEST_SECTION} tiles (${sections.map((s) => s.length).join(', ')})`,
  );
  check(
    sections.every((section) =>
      section.every((tile, index) => index === 0 || isFourAdjacent(section[index - 1], tile)),
    ),
    'every section is one contiguous run',
  );
  const flat = sections.flat();
  const keys = new Set(flat.map((tile) => `${tile.x},${tile.y}`));
  const perimeter = 2 * rect.w + 2 * (rect.h - 2);
  check(
    keys.size === flat.length && flat.length === perimeter - fenceGates.length,
    `the sections cover every fence tile once (${flat.length} of ${perimeter} ring tiles, less the gate)`,
  );
  check(
    flat.every((tile) => !fenceGates.some((gate) => gate.x === tile.x && gate.y === tile.y)),
    'no section takes a gate tile',
  );
  check(
    flat.every((tile) => rig.map.structure[tile.y]?.[tile.x]?.type === FENCE),
    'every section tile is a fence tile on the painted map',
  );
  const [gate] = fenceGates;
  const firstTile = sections[0]?.[0];
  check(
    gate !== undefined && firstTile !== undefined && isFourAdjacent(gate, firstTile),
    'the first section starts at the gate',
  );
  const lastSection = sections[sections.length - 1];
  const lastTile = lastSection?.[lastSection.length - 1];
  check(
    gate !== undefined && lastTile !== undefined && isFourAdjacent(gate, lastTile),
    'the last section ends at the gate from the other side',
  );
  // Clockwise on screen from a gate in the west side runs north first.
  check(
    gate !== undefined && firstTile !== undefined && firstTile.y < gate.y,
    'the ring is walked clockwise, north from the west gate',
  );
  check(
    JSON.stringify(pastureFenceSections(rig.site)) === JSON.stringify(sections),
    'cutting the ring twice gives the same sections',
  );
  check(
    flat.every((tile) => styleAt(rig, tile) === 'rickety'),
    'an unbuilt fence is painted rickety',
  );
  rig.dispose();
}

/** Space and taps reach a section only during `build_fence`. */
export function verifyFenceOnlyInBuildStep(check: Check): void {
  const phases: readonly BlueprintsQuestPhase[] = [
    'unoffered',
    'ask_wendell',
    'ask_merrit',
    'report_fence',
    'harvest_grain',
  ];
  for (const phase of phases) {
    const { rig, blueprints } = blueprintsRig(phase);
    giveBoards(rig, PLENTY_OF_BOARDS);
    const [tile] = blueprints.fence.sections[0];
    standBeside(rig, tile);
    const pressed = blueprints.fence.tryInteract(rig.human);
    const tapped = blueprints.fence.handleTap(
      (tile.x + TILE_CENTRE) * TILE_SIZE,
      (tile.y + TILE_CENTRE) * TILE_SIZE,
      rig.human,
    );
    check(
      !pressed && !tapped && !blueprints.fence.isWorking,
      `in ${phase}, neither Space nor a tap starts a section`,
    );
    stepFrames(rig, WORK_FRAMES_WITH_SLACK);
    check(boardsHeld(rig) === PLENTY_OF_BOARDS, `in ${phase}, no boards are spent`);
    rig.dispose();
  }
}

/** A section built: the channel, the boards, the restyle and the chunk invalidation round it. */
export function verifyFenceBuild(check: Check): void {
  const { rig, blueprints } = blueprintsRig('build_fence');
  const fence = blueprints.fence;
  giveBoards(rig, PLENTY_OF_BOARDS);
  const dirtied = new Set<string>();
  const markTileDirty = rig.map.markTileDirty.bind(rig.map);
  rig.map.markTileDirty = (tileX: number, tileY: number) => {
    dirtied.add(`${tileX},${tileY}`);
    markTileDirty(tileX, tileY);
  };
  const section = BUILT_SECTION;
  const tiles = fence.sections[section];
  standBeside(rig, tiles[0]);
  check(fence.sectionInReach(rig.human) === section, 'the section beside the crawler is in reach');
  check(
    blueprints.counterText() === `0/${PASTURE_FENCE_SECTION_COUNT} fence sections`,
    'the counter reads 0/10 fence sections',
  );
  check(rig.kit.tryInteract(rig.human), 'Space through the kit takes the press');
  check(fence.isWorking, 'the press starts the hammering channel');
  check(boardsHeld(rig) === PLENTY_OF_BOARDS, 'no boards are spent as the channel starts');
  stepFrames(rig, HALF_THE_CHANNEL_FRAMES);
  check(
    fence.isWorking && !rig.state.blueprints.fenceSectionsBuilt[section],
    'half way through, the section is not built yet',
  );
  stepFrames(rig, WORK_FRAMES_WITH_SLACK - HALF_THE_CHANNEL_FRAMES);
  check(!fence.isWorking, 'the channel ends');
  check(rig.state.blueprints.fenceSectionsBuilt[section], 'the section is marked built');
  check(
    boardsHeld(rig) === PLENTY_OF_BOARDS - FENCE_SECTION_BOARD_COST,
    `the section costs ${FENCE_SECTION_BOARD_COST} boards`,
  );
  check(
    tiles.every((tile) => styleAt(rig, tile) === 'post_and_rail'),
    "the section's tiles are restyled post-and-rail",
  );
  const others = fence.sections.filter((_, index) => index !== section).flat();
  check(
    others.every((tile) => styleAt(rig, tile) === 'rickety'),
    'every other section stays rickety',
  );
  const neighbourhoodDirtied = tiles.every((tile) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dirtied.has(`${tile.x + dx},${tile.y + dy}`)) return false;
      }
    }
    return true;
  });
  check(neighbourhoodDirtied, 'every restyled tile re-bakes itself and all eight neighbours');
  check(
    blueprints.counterText() === `1/${PASTURE_FENCE_SECTION_COUNT} fence sections`,
    'the counter reads 1/10 fence sections',
  );
  check(
    fence.sectionInReach(rig.human) !== section,
    'a built section is no longer offered to the press',
  );

  // A rewind puts the flags back; the fence follows them.
  dirtied.clear();
  rig.state.blueprints.fenceSectionsBuilt[section] = false;
  rig.step();
  check(
    tiles.every((tile) => styleAt(rig, tile) === 'rickety') && dirtied.size > 0,
    'flags put back (a rewind) put the rickety fence back, re-baked',
  );
  rig.dispose();
}

/** A tap on the section in reach starts it; a tap elsewhere does not. */
export function verifyFenceTap(check: Check): void {
  const { rig, blueprints } = blueprintsRig('build_fence');
  const fence = blueprints.fence;
  giveBoards(rig, PLENTY_OF_BOARDS);
  const tiles = fence.sections[0];
  standBeside(rig, tiles[0]);
  const far = fence.sections[Math.floor(PASTURE_FENCE_SECTION_COUNT / 2)][0];
  check(
    !fence.handleTap(
      (far.x + TILE_CENTRE) * TILE_SIZE,
      (far.y + TILE_CENTRE) * TILE_SIZE,
      rig.human,
    ),
    'a tap on a section out of reach is not taken',
  );
  const reachable = tiles[0];
  check(
    fence.handleTap(
      (reachable.x + TILE_CENTRE) * TILE_SIZE,
      (reachable.y + TILE_CENTRE) * TILE_SIZE,
      rig.human,
    ),
    'a tap on the section in reach is taken',
  );
  check(fence.isWorking, 'the tap starts the channel');
  rig.dispose();

  // With a hostile in reach a tap is an attack, as Space is, and must not
  // root the crawler in a channel.
  const threatened = blueprintsRig('build_fence');
  giveBoards(threatened.rig, PLENTY_OF_BOARDS);
  const section = threatened.blueprints.fence.sections[0];
  standBeside(threatened.rig, section[0]);
  const hostile = new Rat(0, 0, TILE_SIZE);
  hostile.x = threatened.rig.human.x;
  hostile.y = threatened.rig.human.y;
  threatened.rig.world.roster.add(hostile);
  const tappedUnderThreat = threatened.rig.kit.handleTap(
    (section[0].x + TILE_CENTRE) * TILE_SIZE,
    (section[0].y + TILE_CENTRE) * TILE_SIZE,
    0,
    0,
    threatened.rig.human,
  );
  check(
    !tappedUnderThreat && !threatened.blueprints.fence.isWorking,
    'a tap on a section with a hostile in reach starts no channel',
  );
  threatened.rig.dispose();
}

/** Walking off cancels with nothing spent; a short party is refused, and guidance turns to the shortfall. */
export function verifyFenceCancelAndRefusal(check: Check): void {
  const { rig, blueprints } = blueprintsRig('build_fence');
  const fence = blueprints.fence;
  giveBoards(rig, PLENTY_OF_BOARDS);
  standBeside(rig, fence.sections[0][0]);
  fence.tryInteract(rig.human);
  stepFrames(rig, HALF_THE_CHANNEL_FRAMES);
  rig.human.x += WALK_OFF_PX;
  rig.human.isMoving = true;
  rig.step();
  rig.human.isMoving = false;
  check(!fence.isWorking, 'walking off cancels the channel');
  stepFrames(rig, WORK_FRAMES_WITH_SLACK);
  check(
    !rig.state.blueprints.fenceSectionsBuilt[0] && boardsHeld(rig) === PLENTY_OF_BOARDS,
    'a cancelled section is neither built nor paid for',
  );

  giveBoards(rig, FENCE_SECTION_BOARD_COST - 1);
  standBeside(rig, fence.sections[0][0]);
  const announcedBefore = rig.announced.length;
  check(fence.tryInteract(rig.human), 'a press short of boards is still taken');
  check(
    !fence.isWorking && rig.announced.slice(announcedBefore).includes(FENCE_SHORT_MESSAGE),
    `a short party is told "${FENCE_SHORT_MESSAGE}" and nothing starts`,
  );
  const guidance = blueprints.guidance();
  check(
    guidance !== null && guidance.kind !== 'fence_section',
    `guidance turns to the shortfall (${guidance?.kind ?? 'none'})`,
  );
  giveBoards(rig, PLENTY_OF_BOARDS);
  check(
    blueprints.guidance()?.kind === 'fence_section',
    'with boards in hand, guidance points at a section',
  );

  // Boards spent elsewhere mid-channel: the channel finishes without paying or building.
  fence.tryInteract(rig.human);
  giveBoards(rig, 0);
  const announcedMidChannel = rig.announced.length;
  stepFrames(rig, WORK_FRAMES_WITH_SLACK);
  check(
    !rig.state.blueprints.fenceSectionsBuilt[0] &&
      rig.announced.slice(announcedMidChannel).includes(FENCE_SHORT_MESSAGE),
    'boards gone by the end of the channel: refused, not built',
  );
  rig.dispose();
}

const HAMMER_ROWS: readonly HumanRowName[] = Object.values(REPAIR_ROWS);

/** Carl hammers while a section is worked, facing it, and stops when the work does. */
export function verifyFenceHammering(check: Check): void {
  const { rig, blueprints } = blueprintsRig('build_fence');
  const fence = blueprints.fence;
  giveBoards(rig, PLENTY_OF_BOARDS);
  const hammering = (): boolean =>
    rig.human.isActing && HAMMER_ROWS.includes(rig.human.spriteSelection().row);
  const [tile] = fence.sections[BUILT_SECTION];
  standBeside(rig, tile);
  rig.human.facingX = 0;
  rig.human.facingY = 0;
  fence.tryInteract(rig.human);
  check(hammering(), 'Carl hammers as the channel starts');
  const toTileX = (tile.x + TILE_CENTRE) * TILE_SIZE - (rig.human.x + TILE_SIZE * TILE_CENTRE);
  const toTileY = (tile.y + TILE_CENTRE) * TILE_SIZE - (rig.human.y + TILE_SIZE * TILE_CENTRE);
  check(
    rig.human.facingX * toTileX + rig.human.facingY * toTileY > 0,
    'he turns to face the section',
  );
  rig.human.stopAction();
  rig.step();
  check(fence.isWorking && hammering(), 'a hammering pose lost mid-channel is picked back up');
  stepFrames(rig, WORK_FRAMES_WITH_SLACK);
  check(!fence.isWorking && !rig.human.isActing, 'the hammering stops when the section is done');

  const [next] = fence.sections[BUILT_SECTION + 1];
  standBeside(rig, next);
  fence.tryInteract(rig.human);
  stepFrames(rig, HALF_THE_CHANNEL_FRAMES);
  rig.human.x += WALK_OFF_PX;
  rig.human.isMoving = true;
  rig.step();
  rig.human.isMoving = false;
  check(!fence.isWorking && !rig.human.isActing, 'walking off stops the hammering too');
  rig.dispose();
}

/**
 * The hammering bed is re-asked for every frame of the channel, since the
 * palisade's repairs can stop the same recording under it; and it only ever
 * stops a bed it started itself.
 */
export function verifyFenceWorkLoop(check: Check): void {
  const { rig } = blueprintsRig('build_fence');
  giveBoards(rig, PLENTY_OF_BOARDS);
  const running = new Set<SoundId>();
  const [loop] = BLUEPRINTS_CUES.fenceWorkLoop;
  const fence = new PastureFenceWork({
    state: rig.state,
    gameMap: rig.map,
    site: rig.site,
    human: rig.human,
    cat: rig.cat,
    active: () => rig.human,
    announce: () => undefined,
    onTileChanged: () => undefined,
    noteResourceActivity: () => undefined,
    worldHalted: () => false,
    cue: () => undefined,
    audio: {
      startAmbientLoop: (id) => void running.add(id),
      stopAmbientLoop: (id) => void running.delete(id),
      isAmbientLoopRunning: (id) => running.has(id),
    },
  });
  standBeside(rig, fence.sections[0][0]);
  fence.tryInteract(rig.human);
  fence.update();
  check(running.has(loop), 'the hammering bed plays while a section is worked');
  running.delete(loop);
  fence.update();
  check(running.has(loop), 'a bed stopped under the channel by someone else comes back');
  for (let frame = 0; frame < WORK_FRAMES_WITH_SLACK; frame++) fence.update();
  check(!fence.isWorking && !running.has(loop), 'the bed stops with the channel');
  running.add(loop);
  fence.update();
  check(running.has(loop), "a bed another system started is not the fence's to stop");
  fence.dispose();
  rig.dispose();
}

/** The last section moves the quest to `report_fence`; from there on every section is post-and-rail. */
export function verifyFenceCompletes(check: Check): void {
  const { rig, blueprints } = blueprintsRig('build_fence');
  const fence = blueprints.fence;
  giveBoards(rig, PLENTY_OF_BOARDS);
  const last = PASTURE_FENCE_SECTION_COUNT - 1;
  for (let index = 0; index < last; index++) rig.state.blueprints.fenceSectionsBuilt[index] = true;
  rig.step();
  check(rig.state.blueprints.phase === 'build_fence', 'nine sections keep the step at build_fence');
  standBeside(rig, fence.sections[last][0]);
  fence.tryInteract(rig.human);
  stepFrames(rig, WORK_FRAMES_WITH_SLACK);
  check(
    rig.state.blueprints.phase === 'report_fence',
    'the tenth section moves on to report_fence',
  );
  check(blueprints.counterText() === null, 'the counter comes down once the fence is done');
  check(
    fence.sections.flat().every((tile) => styleAt(rig, tile) === 'post_and_rail'),
    'the whole ring stands post-and-rail',
  );
  rig.dispose();

  const done = blueprintsRig('complete');
  done.rig.step();
  check(
    done.blueprints.fence.sections
      .flat()
      .every((tile) => styleAt(done.rig, tile) === 'post_and_rail'),
    'a completed quest shows post-and-rail everywhere, whatever the flags say',
  );
  done.rig.dispose();

  const fresh = blueprintsRig('build_fence');
  fresh.rig.step();
  check(
    fresh.blueprints.fence.sections.flat().every((tile) => styleAt(fresh.rig, tile) === 'rickety'),
    'a kit built on fresh state puts the shared map back to rickety',
  );
  fresh.rig.dispose();
}
