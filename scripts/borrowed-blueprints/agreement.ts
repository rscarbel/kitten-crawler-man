/**
 * Checks for `verify:borrowed-blueprints` that what the player is told and
 * what the player is shown agree with each other and with what a press does:
 *
 * - Fenna's "the skyfowl town <bearing> of here" names the same compass
 *   direction the world arrow is drawn in, on maps whose village lies on
 *   either side of the town;
 * - while a press would be taken by the side quest (a live scythe swing, a
 *   fence section being hammered) no villager's "Talk" prompt stands beside
 *   it, and the swing bar says what it is;
 * - the station guidance names the machine whose upgrade prompt is showing;
 * - the guide's arrows and captions stand down while the crawler's hands are
 *   busy, and the station's own prompt stays off its "upgraded!" callout.
 */

import { allocCanvas, surfaceContext } from '../../src/core/canvasSurface';
import { TILE_SIZE } from '../../src/core/constants';
import { findNearbyWalkableTile } from '../../src/map/findWalkableTile';
import { teachBoth } from '../../src/core/CraftSkills';
import { ITEM_DEF } from '../../src/core/ItemDefs';
import type { ResourceCost } from '../../src/core/partyResources';
import { RESOURCE_IDS } from '../../src/core/resourceIds';
import type { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { GameMap } from '../../src/map/GameMap';
import { TIKKA_PLANS_UNLOCKS } from '../../src/core/villageUnlocks';
import {
  BLUEPRINTS_QUEST_ID,
  grantBlueprintsItem,
} from '../../src/systems/briarHollow/blueprints/blueprintsProgress';
import { scytheSwingInstruction } from '../../src/systems/briarHollow/blueprints/ScytheSwingBar';
import { keybindings } from '../../src/core/Keybindings';
import { setViewportSize } from '../../src/core/Viewport';
import {
  ROPE_WALK_UPGRADE_COST,
  SAW_UPGRADE_COST,
  STATION_UPGRADE_SECONDS,
} from '../../src/systems/briarHollow/blueprints/StationUpgrades';
import type { BriarHollowKit } from '../../src/systems/briarHollow/BriarHollowKit';
import { processingStationsOf } from '../../src/systems/briarHollow/processingStations';
import { pointedGuidanceTarget } from '../../src/systems/briarHollow/questGuidance';
import { CALLOUT_FRAMES } from '../../src/systems/briarHollow/structureCallouts';
import { setInteractionPromptsSuppressed } from '../../src/ui/InteractionPrompt';
import { testConversationFlow } from '../dialogFlowTestHelpers';
import { standAt, UPDATES_PER_SECOND } from '../villageSiegeHarness';
import { blueprintsRig } from './fence';
import { firstParagraph, journalRig, villagerContext, type Check } from './fenna';

const AGREEMENT_MAP_SIZE = 280;
/**
 * Two generated overworlds whose villages lie on opposite sides of the town
 * (south-east of it on the first, north-east on the second), so a bearing
 * computed backwards reads wrong on at least one.
 */
const AGREEMENT_MAP_SEEDS = [1, 2] as const;
const TILE_CENTRE = 0.5;
/** The swing bar lays itself out against the live viewport; with none it has no width to draw in. */
const SWING_BAR_VIEWPORT = { width: 1280, height: 720 } as const;
/**
 * A compass word joins the bearing once the arrow leans that way by more
 * than half a sector of an eight-way rose: sin(22.5°).
 */
const COMPASS_LEAN = Math.sin(Math.PI / 8);
const PROMPT_CANVAS_PX = 256;
/** Enough boards for a fence section with plenty over. */
const PLENTY_OF_BOARDS = 40;
/** How far around the two machines the station scan stands the crawler, in tiles. */
const STATION_SCAN_MARGIN_TILES = 3;
const UPGRADE_FRAMES = Math.round(STATION_UPGRADE_SECONDS * UPDATES_PER_SECOND);
const WOOD_TO_WORK = 5;
const TALK_LABEL = 'Talk';
/** How far below the saw the callout probe walks to talk to someone else, and how far round it may look. */
const AWAY_FROM_SAW_TILES = 10;
const AWAY_SEARCH_TILES = 4;
const HARVEST_CAPTION = 'Harvest grain';

/** The eight-way bearing the arrow leans toward, worked out from its components alone. */
function arrowBearing(dx: number, dy: number): string {
  const length = Math.hypot(dx, dy);
  if (length === 0) return '';
  const northSouth =
    dy / length < -COMPASS_LEAN ? 'north' : dy / length > COMPASS_LEAN ? 'south' : '';
  const eastWest = dx / length > COMPASS_LEAN ? 'east' : dx / length < -COMPASS_LEAN ? 'west' : '';
  return [northSouth, eastWest].filter((word) => word !== '').join(' ');
}

/** A canvas that records every string drawn on it. */
function recordingContext(): { readonly ctx: CanvasRenderingContext2D; readonly texts: string[] } {
  const ctx = surfaceContext(allocCanvas(PROMPT_CANVAS_PX, PROMPT_CANVAS_PX));
  const texts: string[] = [];
  const fillText = ctx.fillText.bind(ctx);
  ctx.fillText = (...args: Parameters<CanvasRenderingContext2D['fillText']>) => {
    texts.push(args[0]);
    fillText(...args);
  };
  return { ctx, texts };
}

/** The kit's prompt chain for one frame, as the scene runs it: what it claimed and every word it drew. */
function promptFrame(
  kit: BriarHollowKit,
  active: HumanPlayer,
): { readonly claimed: boolean; readonly texts: readonly string[] } {
  setInteractionPromptsSuppressed(false);
  const { ctx, texts } = recordingContext();
  const claimed = kit.renderPrompt(ctx, 0, 0, active);
  return { claimed, texts };
}

/** Moves Merrit to stand on (`tileX`, `tileY`); false when the village has no Merrit. */
function placeMerrit(kit: BriarHollowKit, tileX: number, tileY: number): boolean {
  const merrit = kit.villagers?.villagers.find((villager) => villager.id === 'merrit');
  if (merrit === undefined) return false;
  merrit.x = tileX * TILE_SIZE;
  merrit.y = tileY * TILE_SIZE;
  return true;
}

function give(human: HumanPlayer, cost: ResourceCost): void {
  for (const id of RESOURCE_IDS) {
    const amount = cost[id];
    if (amount !== undefined && amount > 0) human.inventory.addItem(id, amount);
  }
}

/**
 * Fenna's bearing and the arrow the Journal pin draws both come out the same
 * compass direction — from the village, toward Plumbline Farm's door — on
 * two maps with the village on opposite sides of the town.
 */
export function verifyTownBearingAgreesWithArrow(check: Check): void {
  const bearingsSeen = new Set<string>();
  for (const seed of AGREEMENT_MAP_SEEDS) {
    const map = new GameMap({
      mapSize: AGREEMENT_MAP_SIZE,
      mapType: 'overworld',
      worldSeed: seed,
      tileHeight: TILE_SIZE,
    });
    const rig = journalRig(map);
    const village = map.briarHollow?.centre;
    if (rig === null || village === undefined) {
      check(false, `seed ${seed}: the map stands up a village to accept the quest in`);
      continue;
    }
    teachBoth(rig.human, rig.cat, 'construction');
    rig.state.unlocks.construction.push(...TIKKA_PLANS_UNLOCKS);
    const opening = rig.quest.lineFor('fenna', villagerContext(rig.state));
    if (opening?.after.kind !== 'confirm') {
      check(false, `seed ${seed}: Fenna makes her offer`);
      rig.quest.dispose();
      continue;
    }
    const said = firstParagraph(opening.after.accept.run(testConversationFlow()));
    const spoken = /skyfowl town (.+) of here/.exec(said)?.[1] ?? null;

    const guidance = rig.quest.guidance();
    const pointed = guidance?.kind === 'town_building' ? pointedGuidanceTarget(guidance) : null;
    const tracked = rig.quest
      .trackerEntries()
      .find((entry) => entry.id === BLUEPRINTS_QUEST_ID)?.target;
    check(
      pointed !== null &&
        tracked !== undefined &&
        pointed.x === tracked.x &&
        pointed.y === tracked.y,
      `seed ${seed}: the guidance and the Journal pin both point at Plumbline Farm's door`,
    );
    if (tracked === undefined || spoken === null) {
      check(false, `seed ${seed}: Fenna names a bearing ("${said}")`);
      rig.quest.dispose();
      continue;
    }
    // The pinned arrow is aimed from the crawler's centre at the target tile's centre.
    const dx = (tracked.x + TILE_CENTRE - (village.x + TILE_CENTRE)) * TILE_SIZE;
    const dy = (tracked.y + TILE_CENTRE - (village.y + TILE_CENTRE)) * TILE_SIZE;
    const shown = arrowBearing(dx, dy);
    bearingsSeen.add(spoken);
    check(
      spoken === shown,
      `seed ${seed}: Fenna says "${spoken}" and the arrow from the village points ${shown}`,
    );
    rig.quest.dispose();
  }
  check(
    bearingsSeen.size === AGREEMENT_MAP_SEEDS.length,
    `the maps put the town on different bearings (${[...bearingsSeen].join(', ')})`,
  );
}

/**
 * A live scythe swing takes Space, so the prompt slot is the swing's: Merrit
 * working beside the field never shows "Talk" over it, and the bar says
 * what the press is. Before the swing, the harvest prompt beats her too.
 */
export function verifySwingOwnsThePrompt(check: Check): void {
  const { rig, blueprints } = blueprintsRig('harvest_grain');
  const field = blueprints.harvest.grainField();
  if (field === null) {
    check(false, 'the village has a grain field');
    return;
  }
  rig.human.inventory.replaceQuestSlot({ ...ITEM_DEF.quest_scythe, quantity: 1 });
  standAt(rig.human, field.x + 1, field.y);
  check(placeMerrit(rig.kit, field.x + 1, field.y - 1), 'Merrit stands at the field edge');
  check(
    rig.kit.villagers?.talkTarget(rig.human)?.id === 'merrit',
    'Merrit is near enough to talk to',
  );

  const before = promptFrame(rig.kit, rig.human);
  check(
    before.claimed && before.texts.includes('Harvest') && !before.texts.includes(TALK_LABEL),
    `beside Merrit with grain in reach, the prompt offers the harvest (${before.texts.join(' ')})`,
  );

  rig.kit.questGuide?.update();
  const guideBefore = recordingContext();
  rig.kit.renderAbove(guideBefore.ctx, 0, 0);
  check(
    guideBefore.texts.includes(HARVEST_CAPTION),
    'before the swing the guide captions the field',
  );

  check(
    rig.kit.tryInteract(rig.human) && blueprints.harvest.isSwinging,
    'Space starts a swing rather than a conversation',
  );
  const during = promptFrame(rig.kit, rig.human);
  check(
    during.claimed && !during.texts.includes(TALK_LABEL),
    `mid-swing no "Talk" is offered beside Merrit (${during.texts.join(' ') || 'nothing drawn'})`,
  );
  check(rig.kit.wouldInteract(rig.human), 'mid-swing the village still claims the press');

  setViewportSize(SWING_BAR_VIEWPORT.width, SWING_BAR_VIEWPORT.height);
  const barDuring = recordingContext();
  blueprints.harvest.renderHud(barDuring.ctx, []);
  const instruction = scytheSwingInstruction(keybindings.labelFor('attack'));
  check(barDuring.texts.includes(instruction), `the swing bar says "${instruction}"`);
  const guideDuring = recordingContext();
  rig.kit.renderAbove(guideDuring.ctx, 0, 0);
  check(
    !guideDuring.texts.includes(HARVEST_CAPTION),
    "mid-swing the guide's arrow and caption stand down off the swing bar",
  );
}

/** Hammering a fence section keeps the prompt slot, so a villager beside it offers no "Talk". */
export function verifyFenceWorkOwnsThePrompt(check: Check): void {
  const { rig, blueprints } = blueprintsRig('build_fence');
  rig.human.inventory.addItem('wood_board', PLENTY_OF_BOARDS);
  const siteCentre = rig.site.pasture.rect;
  const tiles = blueprints.fence.nearestUnbuiltSectionTiles({ x: siteCentre.x, y: siteCentre.y });
  const tile = tiles?.[0] ?? null;
  if (tile === null) {
    check(false, 'the pasture has a fence section to rebuild');
    return;
  }
  standAt(rig.human, tile.x, tile.y);
  check(placeMerrit(rig.kit, tile.x, tile.y + 1), 'Merrit stands beside the section');
  check(
    rig.kit.villagers?.talkTarget(rig.human)?.id === 'merrit',
    'Merrit is near enough to talk to',
  );
  check(
    rig.kit.tryInteract(rig.human) && blueprints.fence.isWorking,
    'Space starts hammering the section',
  );
  const during = promptFrame(rig.kit, rig.human);
  check(
    during.claimed && !during.texts.includes(TALK_LABEL),
    `while hammering no "Talk" is offered beside the section (${during.texts.join(' ') || 'nothing drawn'})`,
  );
  check(blueprints.busyWithWork, 'hammering counts as busy work for the guide');
}

/**
 * Wherever an upgrade prompt shows, the guidance names that same machine —
 * never the other one because its footprint centre happens to be nearer.
 */
export function verifyStationGuidanceFollowsThePrompt(check: Check): void {
  const { rig, blueprints } = blueprintsRig('build_stations');
  grantBlueprintsItem(rig.human, 'quest_blueprints');
  give(rig.human, SAW_UPGRADE_COST);
  give(rig.human, ROPE_WALK_UPGRADE_COST);
  const machines = processingStationsOf(rig.site);
  if (machines.length < 2) {
    check(false, 'the village has both machines');
    return;
  }
  const left = Math.min(...machines.map((machine) => machine.footprint.x));
  const top = Math.min(...machines.map((machine) => machine.footprint.y));
  const right = Math.max(...machines.map((machine) => machine.footprint.x + machine.footprint.w));
  const bottom = Math.max(...machines.map((machine) => machine.footprint.y + machine.footprint.h));
  let inReachTiles = 0;
  let nearestDisagrees = 0;
  const mismatches: string[] = [];
  for (
    let tileY = top - STATION_SCAN_MARGIN_TILES;
    tileY <= bottom + STATION_SCAN_MARGIN_TILES;
    tileY++
  ) {
    for (
      let tileX = left - STATION_SCAN_MARGIN_TILES;
      tileX <= right + STATION_SCAN_MARGIN_TILES;
      tileX++
    ) {
      standAt(rig.human, tileX, tileY);
      const machine = blueprints.stations.upgradableInReach(rig.human);
      if (machine === null) continue;
      inReachTiles++;
      const guidance = blueprints.guidance();
      const promptStation = blueprints.stations.stationToGuide(rig.human)?.guidanceId;
      const nearest = blueprints.stations.nearestToUpgrade({ x: tileX, y: tileY })?.guidanceId;
      if (nearest !== promptStation) nearestDisagrees++;
      const guided = guidance?.kind === 'station_upgrade' ? guidance.station : null;
      const prompted = machine.kind === 'boards' ? 'saw' : 'rope_walk';
      if (guided !== prompted)
        mismatches.push(`(${tileX},${tileY}) ${guided ?? 'none'}≠${prompted}`);
    }
  }
  check(inReachTiles > 0, `some tiles put a machine in reach (${inReachTiles})`);
  check(
    nearestDisagrees > 0,
    `the scan covers tiles where the nearer footprint is not the one in reach (${nearestDisagrees})`,
  );
  check(
    mismatches.length === 0,
    `the guidance names the machine whose prompt shows (wrong at: ${mismatches.slice(0, 4).join(', ') || 'none'})`,
  );
}

/**
 * An upgrade in progress, and its "upgraded!" callout after, keep the guide
 * down and the machine's own prompt off the callout; both come back after.
 */
export function verifyUpgradeKeepsTheCalloutClear(check: Check): void {
  const { rig, blueprints } = blueprintsRig('build_stations');
  grantBlueprintsItem(rig.human, 'quest_blueprints');
  give(rig.human, SAW_UPGRADE_COST);
  // Wood to work at an open sawmill, so the saw has a prompt of its own to bring back.
  rig.state.unlocks.processingStations = true;
  rig.human.inventory.addItem('wood', WOOD_TO_WORK);
  const saw = processingStationsOf(rig.site).find((machine) => machine.kind === 'boards');
  if (saw === undefined) {
    check(false, 'the village has a saw');
    return;
  }
  const { x, y, h } = saw.footprint;
  standAt(rig.human, x, y + h);
  check(
    blueprints.tryUpgradeStation(rig.human) && blueprints.stations.isUpgrading,
    'X starts the saw upgrade',
  );
  check(blueprints.busyWithWork, 'the upgrade counts as busy work for the guide');
  for (let frame = 0; frame < UPGRADE_FRAMES; frame++) blueprints.stations.update();
  check(rig.state.blueprints.stationsUpgraded.saw, 'the saw stands upgraded');
  check(
    blueprints.stations.isCelebrating && blueprints.busyWithWork,
    'while "Saw upgraded!" is up the guide stays down',
  );
  const during = promptFrame(rig.kit, rig.human);
  check(
    during.claimed && during.texts.length === 0,
    `no prompt stacks on the callout (${during.texts.join(' ') || 'nothing drawn'})`,
  );
  // Walked away from the saw while its callout is still up: a villager there
  // is spoken to as usual, and says so.
  const elsewhere = findNearbyWalkableTile(
    rig.map,
    x,
    y + h + AWAY_FROM_SAW_TILES,
    AWAY_SEARCH_TILES,
    (tileX, tileY) => rig.map.isWalkable(tileX, tileY + 1),
  );
  if (elsewhere === null) {
    check(false, 'open ground away from the saw to stand on');
  } else {
    standAt(rig.human, elsewhere.x, elsewhere.y);
    check(placeMerrit(rig.kit, elsewhere.x, elsewhere.y + 1), 'Merrit stands away from the saw');
    const away = promptFrame(rig.kit, rig.human);
    check(
      blueprints.stations.isCelebrating && away.texts.includes(TALK_LABEL),
      `away from the saw, a villager's "Talk" still shows during the callout (${away.texts.join(' ') || 'nothing drawn'})`,
    );
    standAt(rig.human, x, y + h);
  }
  for (let frame = 0; frame < CALLOUT_FRAMES; frame++) blueprints.stations.update();
  check(
    !blueprints.stations.isCelebrating && !blueprints.busyWithWork,
    'once the callout is gone the guide comes back',
  );
  const after = promptFrame(rig.kit, rig.human);
  check(
    after.texts.length > 0,
    `after the callout the saw's own prompt comes back (${after.texts.join(' ') || 'nothing drawn'})`,
  );
}

export function agreementSections(
  check: Check,
): ReadonlyArray<{ readonly name: string; readonly run: () => void }> {
  return [
    {
      name: "Fenna's bearing agrees with the arrow",
      run: () => verifyTownBearingAgreesWithArrow(check),
    },
    { name: 'A live swing owns the prompt', run: () => verifySwingOwnsThePrompt(check) },
    { name: 'Fence hammering owns the prompt', run: () => verifyFenceWorkOwnsThePrompt(check) },
    {
      name: 'Station guidance follows the prompt',
      run: () => verifyStationGuidanceFollowsThePrompt(check),
    },
    {
      name: 'An upgrade keeps its callout clear',
      run: () => verifyUpgradeKeepsTheCalloutClear(check),
    },
  ];
}
