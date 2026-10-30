#!/usr/bin/env tsx
/**
 * Headless renderer for the Town Center Tower's six storeys, each in every
 * state the questline can leave it in: the cistern with its conduit running
 * and shut, the kitchen with its portcullis down and raised, the archive under
 * each state of its wards, and the cattery from caged to lit to emptied.
 *
 * Each storey is generated through `GameMap.generateInterior` with the
 * tower's own variant and drawn in the storey's own dungeon theme, with the
 * storey's works stood up on it the way `TowerStoreysSystem` raises them (the
 * bells, the wards and their wardens or krasue, the cattery's keeper and
 * caged cats, the kitchen's dumbwaiter and portcullis) and run for a short
 * while with nobody on the storey, so each picture shows the works mid-round.
 * The wards are drawn as Belle sees them. Then it is marked up for review:
 * every mechanic zone the storey keeps for the cats outlined and named, and
 * on the gatehouse every guard at the start of its loop with its look washed
 * over the floor.
 *
 *   npx tsx scripts/render-tower-storeys.ts
 *   npx tsx scripts/render-tower-storeys.ts --only=cattery
 *
 * Then the cattery as the Warden's fight opens it (`--only=fight` for these
 * alone): every bound cat sat at her pillar, two of them unbound and bolting
 * for the stair, then settled there, and the carrier lifting one off the
 * floor. Each is written whole and as a close crop of the circle.
 *
 * Writes `preview/missing-cats/tower/<storey>--<state>.png` and
 * `preview/missing-cats/fight/binding--<moment>.png`.
 */

import { createCanvas, type Canvas } from 'canvas';

import { installCanvasGlobals, paintEnvironmentArtInNode } from './nodeCanvasGlobals.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { asGameContext } from './nodeGameContext.js';

interface CanvasGlobals {
  Image?: unknown;
  document?: unknown;
  window?: unknown;
}
const globals: CanvasGlobals = globalThis;
/** Matches the bake resolution the shipped sheets are authored at (see `nodeCanvasGlobals.ts`). */
const REVIEW_DEVICE_PIXEL_RATIO = 2;

const nodeCanvasModule = await import('canvas');
globals.Image = nodeCanvasModule.Image;
globals.window = { devicePixelRatio: REVIEW_DEVICE_PIXEL_RATIO };
globals.document = {
  createElement(tag: string) {
    if (tag !== 'canvas') throw new Error(`headless renderer cannot create <${tag}>`);
    return createCanvas(1, 1);
  },
};

const { TILE_SIZE } = await import('../src/core/constants.js');
const { loadSprites } = await import('../src/core/spriteAssets/SpriteLoader.js');
const { GameMap } = await import('../src/map/GameMap.js');
const { TOWN_TOWER_ID } = await import('../src/map/buildingIds.js');
const { setDungeonFloorTheme } = await import('../src/map/dungeon/floorTheme.js');
const { MISSING_CATS_PHASES } = await import('../src/core/quests/missingCatsProgress.js');
const {
  everyTowerState,
  towerStoreyIndex,
  towerStoreyStateKey,
  TOWER_MECHANIC_ZONES,
  TOWER_STOREY_IDS,
} = await import('../src/map/town/interiors/townCenterTower.js');
const { compileGatehouseWatch } = await import('../src/systems/tower/gatehouseWatch.js');
const { guardCone, guardPoseAt } = await import('../src/systems/stealthKeySnatch/prisonPatrols.js');
const { drawSightFan } = await import('../src/ui/world/worldSightFan.js');
const { FLOOR_ART_SEEDS } = await import('../src/map/ground/artSeedAlphabet.js');
const { setViewportSize } = await import('../src/core/rendering/Viewport.js');
const { WaterAnimationSystem } = await import('../src/systems/WaterAnimationSystem.js');
const { drawTownInteriorGroundProps, townInteriorPropFigures } =
  await import('../src/systems/townInteriorPropFigures.js');
const { EventBus } = await import('../src/core/EventBus.js');
const { createPartySplitState } = await import('../src/core/party/partySplit.js');
const { HumanPlayer } = await import('../src/creatures/HumanPlayer.js');
const { CatPlayer } = await import('../src/creatures/CatPlayer.js');
const { CatAlly } = await import('../src/creatures/CatAlly.js');
const { SpellSystem } = await import('../src/systems/SpellSystem.js');
const { MobRoster } = await import('../src/systems/kits/SceneWorld.js');
const { SenseLayer } = await import('../src/systems/senses/SenseLayer.js');
const { RoomMechanisms } = await import('../src/systems/roomMechanisms/RoomMechanisms.js');
const { CONVEYOR_PLACEMENTS, plateSetsFor } =
  await import('../src/map/town/interiors/roomMechanisms.js');
const { KitchenWorks } = await import('../src/systems/tower/kitchenWorks.js');
const { BellStoreyWorks } = await import('../src/systems/tower/bellStoreyWorks.js');
const { ArchiveWorks } = await import('../src/systems/tower/archiveWorks.js');
const { CatteryWorks } = await import('../src/systems/tower/catteryWorks.js');
const { BoundCats } = await import('../src/systems/tower/boundCats.js');
const { CarrierView, carrierFlightPose } = await import('../src/systems/lichCarrierFlight.js');
const { TOWN_CATS } = await import('../src/systems/critters/TownCats.js');
const { prewarmTowerCarrier } = await import('../src/sprites/art/towerCarrierFigure.js');
const { bakeFigurePrewarmFor } = await import('../src/sprites/figure/figureFrameCache.js');
const { TOWN_CAT_IDS } = await import('../src/core/state/townCatIds.js');
const { TOWER_BINDING_PILLARS, BINDING_PILLAR_VARIANT, bindingPillarId } =
  await import('../src/map/town/interiors/townCenterTower.js');
type TownCatId = import('../src/core/state/townCatIds.js').TownCatId;
type StoreyWorks = import('../src/systems/tower/storeyWorks.js').StoreyWorks;
type StoreyWorksDeps = import('../src/systems/tower/storeyWorks.js').StoreyWorksDeps;
type TowerStoreyId = import('../src/map/town/interiors/townCenterTower.js').TowerStoreyId;
type InteriorFigure = import('../src/core/rendering/InteriorFigure.js').InteriorFigure;
type GameMapInstance = InstanceType<typeof GameMap>;
type CatAllyInstance = InstanceType<typeof CatAlly>;

const SCALE = 2;
const OUT_DIR = `${PREVIEW_DIR}/missing-cats/tower`;
const FIGHT_OUT_DIR = `${PREVIEW_DIR}/missing-cats/fight`;
/** The circle and its pillars, in tiles, blown up for the close crop. */
const FIGHT_CROP = { col: 3, row: 1, cols: 15, rows: 8 } as const;
const FIGHT_CROP_SCALE = 4;
/** The cats unbound in the fight's middle pictures, and how long after each picture is taken. */
const UNBOUND_IN_PICTURE: readonly TownCatId[] = ['taloncrest_inn_cat', 'taloncrest_smithy_cat'];
const BOLTING_FRAMES = 40;
const SETTLED_FRAMES = 400;
/** The carrier's stoop, sampled once it has the cat off the floor. */
const CARRIER_LIFT_PROGRESS = 0.85;
const CARRIED_CAT: TownCatId = 'taloncrest_general_store_cat';

const FLAG_PREFIX_LENGTH = 3;
const ZONE_STROKE = 'rgba(80,220,255,0.95)';
const ZONE_FILL = 'rgba(80,220,255,0.12)';
const ZONE_LABEL = 'rgba(200,250,255,1)';
const ZONE_LABEL_FONT = '9px sans-serif';
const ZONE_LINE_WIDTH = 1.5;
const ZONE_LABEL_INSET_PX = 3;
const ZONE_LABEL_DROP_PX = 10;
const GUARD_MARK = 'rgba(255,80,80,0.95)';
const GUARD_MARK_RADIUS_PX = 6;
const FULL_TURN = Math.PI * 2;
/**
 * World frames the works run before the picture is taken: far enough into
 * the archive's pulse for the doorway ward to be burning, and for the bells
 * to have swung off the end of their arc.
 */
const WORKS_FRAMES_BEFORE_SNAPSHOT = 120;
/** Steps of the sense layer's clock, long enough between them for the wards to fade fully in for Belle. */
const SENSE_FADE_STEPS = 10;
const SENSE_FADE_STEP_MS = 100;

function stringArg(name: string, fallback: string): string {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw === undefined ? fallback : raw.slice(name.length + FLAG_PREFIX_LENGTH);
}

const only = stringArg('only', '');

await loadSprites('src/images/');
paintEnvironmentArtInNode(FLOOR_ART_SEEDS[0]);
installCanvasGlobals();

const everyState = everyTowerState(MISSING_CATS_PHASES);

interface StoodWorks {
  readonly works: StoreyWorks | null;
  readonly senses: InstanceType<typeof SenseLayer>;
  readonly mechanisms: InstanceType<typeof RoomMechanisms>;
  readonly mobs: InteriorFigure[];
}

/**
 * The storey's works raised on `map` as `TowerStoreysSystem.raiseWorks` raises
 * them, with no audio and nobody on the storey, then run for a short while.
 * The cattery's cellmate is brought out sat in her cage, as the cattery does
 * once Belle arrives.
 */
function standWorks(
  storey: TowerStoreyId,
  map: GameMapInstance,
  state: (typeof everyState)[number],
): StoodWorks {
  const bus = new EventBus();
  const split = createPartySplitState();
  const senses = new SenseLayer();
  const mechanisms = new RoomMechanisms({
    map,
    place: { building: TOWN_TOWER_ID, storey: towerStoreyIndex(storey) },
    plateSets: plateSetsFor(TOWN_TOWER_ID, towerStoreyIndex(storey)),
    conveyors: CONVEYOR_PLACEMENTS,
    split,
    bus,
    shatter: () => false,
    playSound: () => undefined,
  });
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(0, 0, TILE_SIZE);
  const mobs: InteriorFigure[] = [];
  let cellmate: CatAllyInstance | null = null;
  const deps: StoreyWorksDeps = {
    map,
    progress: state.progress,
    conditions: state.conditions,
    bus,
    audio: null,
    senses,
    mechanisms,
    split,
    addMob: (mob) => mobs.push(mob),
    presentCrawlers: () => [],
    setPartyDown: () => undefined,
    toast: () => undefined,
  };
  const cellmateDeps = {
    body: () => cellmate,
    bringOut: (tile: { readonly x: number; readonly y: number }) => {
      cellmate = new CatAlly(tile.x, tile.y, TILE_SIZE, 'tower_cattery_cellmate', cat);
      mobs.push(cellmate);
      return cellmate;
    },
    joinCat: () => undefined,
    order: () => undefined,
  };
  const works = ((): StoreyWorks | null => {
    switch (storey) {
      case 'cistern':
      case 'gatehouse':
        return null;
      case 'kitchen':
        return new KitchenWorks(deps);
      case 'bell_storey':
        return new BellStoreyWorks({ ...deps, cellmate: cellmateDeps });
      case 'archive':
        return new ArchiveWorks(deps);
      case 'cattery':
        return new CatteryWorks({ ...deps, cellmate: cellmateDeps });
      default: {
        const unhandled: never = storey;
        throw new Error(`unhandled tower storey ${String(unhandled)}`);
      }
    }
  })();
  const frameCtx = {
    human,
    cat,
    active: cat,
    partner: human,
    activeIsMoving: false,
    roster: new MobRoster(map, new SpellSystem()),
    gameMap: map,
  };
  works?.enter?.(frameCtx);
  for (let frame = 0; frame < WORKS_FRAMES_BEFORE_SNAPSHOT; frame++) works?.update(frameCtx);
  for (let step = 0; step <= SENSE_FADE_STEPS; step++) {
    senses.update(cat, step * SENSE_FADE_STEP_MS);
  }
  return { works, senses, mechanisms, mobs };
}

for (const storey of TOWER_STOREY_IDS) {
  if (only !== '' && !storey.includes(only)) continue;
  const states = new Map(
    everyState.map((state) => [towerStoreyStateKey(storey, state.conditions), state]),
  );
  for (const [stateKey, state] of states) {
    const { conditions } = state;
    const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
    map.generateInterior('tower', towerStoreyIndex(storey), TOWN_TOWER_ID, false, {
      kind: 'tower',
      conditions,
    });
    const theme = map.towerStoreyTheme;
    if (theme !== null) setDungeonFloorTheme(theme);
    map.releaseTileArt();

    const viewW = (map.structure[0]?.length ?? 0) * TILE_SIZE;
    const viewH = map.structure.length * TILE_SIZE;
    const canvas: Canvas = createCanvas(viewW * SCALE, viewH * SCALE);
    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);
    const gameCtx = asGameContext(ctx);
    map.renderCanvas(gameCtx, 0, 0, viewW, viewH);
    drawTownInteriorGroundProps(gameCtx, map, 0, 0, TILE_SIZE);
    setViewportSize(viewW, viewH);
    const water = new WaterAnimationSystem(map, () => true);
    water.renderGround(gameCtx, 0, 0);
    water.dispose();
    const stood = standWorks(storey, map, state);
    const hidden = new Set([
      ...(stood.works?.hiddenProps?.() ?? []),
      ...stood.mechanisms.hiddenProps(),
    ]);
    stood.works?.renderWorld?.(gameCtx, 0, 0);
    stood.mechanisms.renderGround(gameCtx, 0, 0);
    if (!stood.senses.isEmpty) {
      stood.senses.paint(gameCtx, { camX: 0, camY: 0, width: viewW, height: viewH, nowMs: 0 });
    }
    map.renderDecorationsOverlay(gameCtx, 0, 0, viewW, viewH);
    const figures = [
      ...townInteriorPropFigures(map, hidden),
      ...stood.mechanisms.sortedFigures(),
      ...(stood.works?.roomFigures?.() ?? []),
      ...stood.mobs,
    ].sort((a, b) => (a.depthY ?? a.y) - (b.depthY ?? b.y));
    for (const figure of figures) figure.render(gameCtx, 0, 0, TILE_SIZE);
    stood.works?.renderEffects?.(gameCtx, 0, 0);
    stood.mechanisms.renderMarkers(gameCtx, 0, 0, 0);
    stood.works?.dispose?.();

    if (storey === 'gatehouse') {
      const watch = compileGatehouseWatch(conditions, 'hard');
      for (const guard of watch.guards) {
        const pose = guardPoseAt(guard, 0);
        const cone = guardCone(watch, pose, 0);
        drawSightFan(gameCtx, {
          origin: cone.origin,
          rim: { kind: 'rays', ends: cone.ends },
          suspicion: 0,
        });
        ctx.fillStyle = GUARD_MARK;
        ctx.beginPath();
        ctx.arc(pose.x, pose.y, GUARD_MARK_RADIUS_PX, 0, FULL_TURN);
        ctx.fill();
      }
    }

    const zones: Readonly<Record<string, { x0: number; y0: number; x1: number; y1: number }>> =
      TOWER_MECHANIC_ZONES[storey];
    for (const [zone, rect] of Object.entries(zones)) {
      const x = rect.x0 * TILE_SIZE;
      const y = rect.y0 * TILE_SIZE;
      const w = (rect.x1 - rect.x0 + 1) * TILE_SIZE;
      const h = (rect.y1 - rect.y0 + 1) * TILE_SIZE;
      ctx.fillStyle = ZONE_FILL;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = ZONE_STROKE;
      ctx.lineWidth = ZONE_LINE_WIDTH;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = ZONE_LABEL;
      ctx.font = ZONE_LABEL_FONT;
      ctx.fillText(zone, x + ZONE_LABEL_INSET_PX, y + ZONE_LABEL_DROP_PX);
    }

    const outPath = writePreviewPng(
      `${OUT_DIR}/${storey}--${stateKey}.png`,
      canvas.toBuffer('image/png'),
    );
    console.log(outPath);
  }
}

/** One moment of the binding, as the cattery draws it. */
interface FightMoment {
  readonly name: string;
  readonly unbound: readonly TownCatId[];
  readonly framesAfter: number;
  readonly carried: TownCatId | null;
}

const FIGHT_MOMENTS: readonly FightMoment[] = [
  { name: 'bound', unbound: [], framesAfter: 0, carried: null },
  { name: 'unbinding', unbound: UNBOUND_IN_PICTURE, framesAfter: BOLTING_FRAMES, carried: null },
  { name: 'settled', unbound: UNBOUND_IN_PICTURE, framesAfter: SETTLED_FRAMES, carried: null },
  {
    name: 'carried',
    unbound: UNBOUND_IN_PICTURE,
    framesAfter: SETTLED_FRAMES,
    carried: CARRIED_CAT,
  },
];

function renderFightMoment(moment: FightMoment): void {
  const state = everyState.find(
    (candidate) =>
      candidate.conditions.ritual === 'lit' &&
      candidate.conditions.boundCats.size === TOWN_CAT_IDS.length,
  );
  if (state === undefined) throw new Error('no tower state has every cat bound in a lit circle');
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  map.generateInterior('tower', towerStoreyIndex('cattery'), TOWN_TOWER_ID, false, {
    kind: 'tower',
    conditions: state.conditions,
  });
  const theme = map.towerStoreyTheme;
  if (theme !== null) setDungeonFloorTheme(theme);
  map.releaseTileArt();

  const bound = TOWN_CAT_IDS.filter((cat) => state.conditions.boundCats.has(cat));
  const cats = new BoundCats(map, bound, map.startTile, () => 0);
  for (const cat of moment.unbound) {
    map.setPlacedInteriorPropVariant(bindingPillarId(cat), BINDING_PILLAR_VARIANT.broken);
    cats.unbind(cat);
  }
  for (let frame = 0; frame < moment.framesAfter; frame++) cats.update();

  if (moment.carried !== null) {
    const look = TOWN_CATS[moment.carried].look;
    const carriedPillar = TOWER_BINDING_PILLARS[moment.carried];
    cats.carriedOff(moment.carried);
    prewarmTowerCarrier('deacon_aviel');
    bakeFigurePrewarmFor(Number.POSITIVE_INFINITY, true);
    renderMoment(moment, map, cats, new CarrierView('deacon_aviel', () => look), carriedPillar);
  } else {
    renderMoment(moment, map, cats, null, null);
  }
  cats.dispose();
}

function renderMoment(
  moment: FightMoment,
  map: GameMapInstance,
  cats: InstanceType<typeof BoundCats>,
  carrier: InstanceType<typeof CarrierView> | null,
  carriedPillar: { readonly x: number; readonly y: number } | null,
): void {
  const viewW = (map.structure[0]?.length ?? 0) * TILE_SIZE;
  const viewH = map.structure.length * TILE_SIZE;
  const canvas: Canvas = createCanvas(viewW * SCALE, viewH * SCALE);
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  const gameCtx = asGameContext(ctx);
  map.renderCanvas(gameCtx, 0, 0, viewW, viewH);
  drawTownInteriorGroundProps(gameCtx, map, 0, 0, TILE_SIZE);
  setViewportSize(viewW, viewH);
  map.renderDecorationsOverlay(gameCtx, 0, 0, viewW, viewH);
  const figures = [...townInteriorPropFigures(map, new Set()), ...cats.roomFigures()].sort(
    (a, b) => (a.depthY ?? a.y) - (b.depthY ?? b.y),
  );
  for (const figure of figures) figure.render(gameCtx, 0, 0, TILE_SIZE);
  if (carrier !== null && carriedPillar !== null) {
    const window = map.placedInteriorProps.find((placed) => placed.propId === 'sky_window');
    if (window === undefined) throw new Error('the cattery has no observatory window');
    const windowTile = { col: window.tile.x, row: window.tile.y };
    const pose = carrierFlightPose('lifting', CARRIER_LIFT_PROGRESS, windowTile, {
      col: carriedPillar.x,
      row: carriedPillar.y,
    });
    carrier.render(gameCtx, 0, 0, pose, 'carried');
    carrier.dispose();
  }

  console.log(
    writePreviewPng(`${FIGHT_OUT_DIR}/binding--${moment.name}.png`, canvas.toBuffer('image/png')),
  );
  const cropW = FIGHT_CROP.cols * TILE_SIZE;
  const cropH = FIGHT_CROP.rows * TILE_SIZE;
  const crop = createCanvas(cropW * FIGHT_CROP_SCALE, cropH * FIGHT_CROP_SCALE);
  const cropCtx = crop.getContext('2d');
  cropCtx.imageSmoothingEnabled = false;
  cropCtx.drawImage(
    canvas,
    FIGHT_CROP.col * TILE_SIZE * SCALE,
    FIGHT_CROP.row * TILE_SIZE * SCALE,
    cropW * SCALE,
    cropH * SCALE,
    0,
    0,
    crop.width,
    crop.height,
  );
  console.log(
    writePreviewPng(
      `${FIGHT_OUT_DIR}/binding--${moment.name}--circle.png`,
      crop.toBuffer('image/png'),
    ),
  );
}

if (only === '' || 'fight'.includes(only)) {
  for (const moment of FIGHT_MOMENTS) renderFightMoment(moment);
}
