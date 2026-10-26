#!/usr/bin/env tsx
/**
 * The shared review-scene frame: only a primary-button press (or a wheel turn)
 * on the art reaches the scene's world handler, so a right-click or a
 * middle-click never pans or switches a preview; and a caption too long for
 * the top-right column moves under the controls rather than squeezing every
 * control into a column of its own.
 *
 * The cat's `?cat` scene: `?cat=<row>` opens on that row and a tap on the
 * art steps it; the compass shows every facing view; the outfit picker lists
 * everything she can wear and puts it on her sprite; the tool picker offers
 * every working tool and the carry picker every carriable thing; every row
 * she plays holding something shows her holding it; and every compass action
 * renders.
 *
 * The human's `?human` scene: the weapon picker lists every weapon item he can
 * hold, read off the item table; picking one puts it out in the live
 * player's hand and turns the row pane to its rows; the live script draws
 * and stows it; every weapon renders.
 *
 * Run: npm run verify:preview-scene
 */

import { installBrowserShim } from './browserShim.js';

const PHONE_VIEWPORT = { width: 375, height: 667, devicePixelRatio: 1 } as const;
installBrowserShim(PHONE_VIEWPORT);

const { createCanvas } = await import('canvas');
const { asGameContext } = await import('./nodeGameContext.js');
const { PreviewScene } = await import('../src/scenes/PreviewScene.js');
const { PRIMARY_BUTTON } = await import('../src/ui/core/pointer.js');
const { setViewportSize } = await import('../src/core/rendering/Viewport.js');
const { CatPreviewScene } = await import('../src/scenes/CatPreviewScene.js');
const { CAT_ROWS } = await import('../src/sprites/art/catFigure.js');
const { catGripOf } = await import('../src/sprites/art/catSockets.js');
const { MOUTH_CARRY_VISUAL_IDS } = await import('../src/sprites/held/heldVisualIds.js');
const { activeCatFigure, activeCatLook } = await import('../src/sprites/catSprite.js');
const { CAT_LOOKS } = await import('./catLooks.js');
const { FACING_VIEWS } = await import('../src/sprites/facingView.js');
const { catLookOf, ITEM_DEF, isItemId, wearerAllows } =
  await import('../src/core/items/defs/ItemDefs.js');
const { TOOL_TIERS } = await import('../src/core/items/gathering/toolTiers.js');

setViewportSize(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);

type PreviewControl = import('../src/scenes/PreviewScene.js').PreviewControl;
type WorldGesture = import('../src/ui/core/UiRoot.js').WorldGesture;
type GestureKind = import('../src/ui/core/pointer.js').GestureKind;

const SECONDARY_BUTTON = 2;
const MIDDLE_BUTTON = 1;
const SHORT_LABELS = ['one', 'two', 'three', 'four'] as const;
const LONG_CAPTION =
  'front / side / away, one kind per tab; effects tab loops the standalone VFX and more';
/** Four short buttons fit two rows on a 375px phone; one per row means the caption squeezed them. */
const MOST_CONTROL_ROWS = 2;
const FRAMES_TO_SETTLE = 2;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === '' ? '' : ` (${detail})`}`);
}

class ProbeScene extends PreviewScene {
  readonly worldKinds: GestureKind[] = [];
  private readonly ctx = asGameContext(
    createCanvas(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height).getContext('2d'),
  );

  constructor(private readonly captions: readonly string[]) {
    super();
  }

  protected previewTitle(): string {
    return 'probe preview';
  }

  protected previewControls(): readonly PreviewControl[] {
    return SHORT_LABELS.map((label) => ({ label, onTap: () => undefined }));
  }

  protected previewCaptions(): readonly string[] {
    return this.captions;
  }

  protected handlePreviewWorldPointer(gesture: WorldGesture): void {
    this.worldKinds.push(gesture.kind);
  }

  update(): void {}

  render(): void {
    this.renderChrome(this.ctx);
  }

  settle(): void {
    for (let i = 0; i < FRAMES_TO_SETTLE; i++) this.render();
  }

  get bottom(): number {
    return this.headerBottom;
  }
}

function press(scene: Pick<ProbeScene, 'ui' | 'settle'>, button: number): void {
  const x = PHONE_VIEWPORT.width / 2;
  const y = PHONE_VIEWPORT.height - PHONE_VIEWPORT.height / 4;
  for (const kind of ['down', 'up'] as const) {
    scene.ui.pointer({
      kind,
      pointerId: 1,
      source: 'mouse',
      x,
      y,
      cssX: x,
      cssY: y,
      button,
      deltaY: 0,
    });
  }
  scene.settle();
}

console.log('A preview’s world handler hears only the primary button');
{
  const scene = new ProbeScene([]);
  scene.settle();
  press(scene, SECONDARY_BUTTON);
  check(
    'a right-click on the art reaches nothing',
    scene.worldKinds.length === 0,
    scene.worldKinds.join(','),
  );
  press(scene, MIDDLE_BUTTON);
  check('nor does a middle-click', scene.worldKinds.length === 0, scene.worldKinds.join(','));
  press(scene, PRIMARY_BUTTON);
  check(
    'a left-click reaches it, down and up',
    scene.worldKinds.join(',') === 'down,up',
    scene.worldKinds.join(','),
  );
}

console.log('A long caption on a phone leaves the controls in rows');
{
  const bare = new ProbeScene([]);
  bare.settle();
  const captioned = new ProbeScene([LONG_CAPTION]);
  captioned.settle();
  const extra = captioned.bottom - bare.bottom;
  const rowPitch = bare.bottom / (MOST_CONTROL_ROWS + 1);
  check(
    'the caption adds a few lines, not a button per row',
    extra < rowPitch * MOST_CONTROL_ROWS,
    `header ${bare.bottom.toFixed(0)}px bare, ${captioned.bottom.toFixed(0)}px captioned`,
  );
}

const CAT_OPENING_ROW = 'swipe_side';
/** Longer than a swipe plus its rest, so the watch spans a full play and a replay. */
const ONE_SHOT_WATCH_TICKS = 100;
/** Bare and "everything" bracket the one-item outfits and the garment sets. */
const OUTFITS_BESIDE_ITEMS = 2;
const GARMENT_SET_LABEL = 'every garment';
/** No tool, and the scythe, beside every axe and pickaxe tier. */
const TOOLS_BESIDE_TIERS = 2;
/** Enough ticks for a compass swipe, cast and work swing to get under way. */
const TICKS_PER_COMPASS_ACTION = 20;

class CatProbe extends CatPreviewScene {
  private readonly ctx = asGameContext(
    createCanvas(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height).getContext('2d'),
  );

  tap(id: string): void {
    this.previewControls()
      .find((control) => control.id === id)
      ?.onTap();
  }

  step(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.update();
    this.render(this.ctx);
  }

  settle(): void {
    for (let i = 0; i < FRAMES_TO_SETTLE; i++) this.render(this.ctx);
  }
}

for (const look of CAT_LOOKS) {
  console.log(`The cat’s preview shows ${look.id}'s rows, views, outfits and tools`);
  window.location.search = `?cat=${CAT_OPENING_ROW}&look=${look.id}`;
  const scene = new CatProbe();
  window.location.search = '';
  check(
    `&look=${look.id} paints her as ${look.id}`,
    activeCatLook().id === look.id && activeCatFigure().id.startsWith(`cat:${look.id}`),
    activeCatFigure().id,
  );
  check(
    '?cat=<row> opens on that row',
    scene.previewRow.state === CAT_OPENING_ROW,
    scene.previewRow.state,
  );
  let offRowDraws = 0;
  for (let tick = 0; tick < ONE_SHOT_WATCH_TICKS; tick++) {
    scene.update();
    if (scene.rowCell.state !== CAT_OPENING_ROW) offRowDraws++;
  }
  check(
    'a one-shot row draws only that row, through its rest as well as its play',
    offRowDraws === 0,
    `${offRowDraws} of ${ONE_SHOT_WATCH_TICKS} ticks drew another row`,
  );
  scene.step(1);
  press(scene, PRIMARY_BUTTON);
  check(
    'a tap on the art steps to the next row',
    scene.previewRow.state !== CAT_OPENING_ROW,
    scene.previewRow.state,
  );

  const facings = scene.compassFacings();
  const missingViews = FACING_VIEWS.filter(
    (view) => !facings.some((facing) => facing.view === view),
  );
  check('the compass shows every facing view', missingViews.length === 0, missingViews.join(','));
  check(
    'and both mirrorings',
    facings.some((facing) => facing.flipX) && facings.some((facing) => !facing.flipX),
  );

  const catWear = Object.keys(ITEM_DEF)
    .filter(isItemId)
    .filter((id) => {
      const wearer = ITEM_DEF[id].wearer;
      return wearer !== undefined && wearerAllows(wearer, 'cat');
    });
  const listed = scene.outfitChoices.flatMap((outfit) => outfit.items);
  const unlisted = catWear.filter((id) => !listed.includes(id));
  const garmentSets = scene.outfitChoices.filter((outfit) =>
    outfit.label.startsWith(GARMENT_SET_LABEL),
  );
  check(
    'the outfit picker lists everything she can wear',
    unlisted.length === 0 &&
      scene.outfitChoices.length === catWear.length + OUTFITS_BESIDE_ITEMS + garmentSets.length,
    unlisted.join(','),
  );
  const clashing = garmentSets.filter((outfit) => {
    const slots = outfit.items.map(
      (id) => `${ITEM_DEF[id].equipSlot}:${ITEM_DEF[id].equipSubSlot}`,
    );
    return new Set(slots).size !== slots.length;
  });
  const drawnAsGarment = catWear.filter((id) => catLookOf(ITEM_DEF[id])?.kind === 'garment');
  check(
    'the picker offers garment sets exactly when something is drawn as a garment on her',
    garmentSets.length > 0 === drawnAsGarment.length > 0,
    `${garmentSets.length} set(s), ${drawnAsGarment.length} item(s) drawn as a garment`,
  );
  check(
    'each garment set can be worn at once',
    clashing.length === 0,
    clashing.map((outfit) => outfit.label).join(','),
  );

  const firstGarment = drawnAsGarment.at(0);
  if (firstGarment === undefined) {
    console.log('  --   no item is drawn as a garment on her; outfit pick not replayed');
  } else {
    const bareFigure = activeCatFigure().id;
    const garmentIndex = scene.outfitChoices.findIndex(
      (outfit) => outfit.items.length === 1 && outfit.items[0] === firstGarment,
    );
    for (let i = 0; i < garmentIndex; i++) scene.tap('outfit');
    scene.step(1);
    check(
      `picking ${ITEM_DEF[firstGarment].name} puts it on her sprite`,
      activeCatFigure().id !== bareFigure,
      `${scene.outfit.label}: ${activeCatFigure().id}`,
    );
    while (scene.outfit.items.length > 0) scene.tap('outfit');
    scene.step(1);
    check(
      'and stepping round to bare takes it off',
      activeCatFigure().id === bareFigure,
      activeCatFigure().id,
    );
  }

  const tierCount = TOOL_TIERS.axe.length + TOOL_TIERS.pickaxe.length;
  check(
    'the tool picker offers no tool, every tier and the scythe',
    scene.toolChoices.length === tierCount + TOOLS_BESIDE_TIERS,
    `${scene.toolChoices.length} choices`,
  );
  scene.tap('tool');
  check('a tool reaches her', scene.toolOption.tool !== null, scene.toolOption.label);

  check(
    'the carry picker offers nothing and every look made to be carried in her jaws',
    scene.carryChoices.length === MOUTH_CARRY_VISUAL_IDS.length + 1,
    `${scene.carryChoices.length} choices`,
  );
  scene.tap('carry');
  check('a carried thing reaches her', scene.carryOption.look !== null, scene.carryOption.label);

  const holdRowsSeen = new Set<string>();
  const holdRowsWrong: string[] = [];
  for (let i = 0; i < CAT_ROWS.length; i++) {
    const row = scene.previewRow;
    if (row.hold !== null) {
      holdRowsSeen.add(row.state);
      scene.step(1);
      const held = scene.rowHeld;
      const wanted = row.hold === 'carry' ? 'mouthCarry' : 'pawTool';
      if (held === null || catGripOf(held.look) !== wanted) holdRowsWrong.push(row.state);
    }
    scene.tap('row');
  }
  const holdRows = CAT_ROWS.filter((row) => row.hold !== undefined);
  check(
    'every row she plays holding something shows her holding it',
    holdRowsSeen.size === holdRows.length && holdRowsWrong.length === 0,
    `${holdRowsSeen.size}/${holdRows.length} rows; wrong: ${holdRowsWrong.join(',')}`,
  );

  const actionsSeen = new Set<string>();
  let rendered = true;
  try {
    do {
      actionsSeen.add(scene.compassAction);
      scene.step(TICKS_PER_COMPASS_ACTION);
      scene.tap('compass');
    } while (!actionsSeen.has(scene.compassAction));
  } catch (error) {
    rendered = false;
    console.log(error);
  }
  check('every compass action renders', rendered, [...actionsSeen].join(','));
}

const { HumanPreviewScene, LIVE_SCRIPT_LAP_TICKS } =
  await import('../src/scenes/HumanPreviewScene.js');
const { weaponStatsOf } = await import('../src/core/items/defs/ItemDefs.js');
const { HELD_VISUALS } = await import('../src/sprites/held/heldVisuals.js');
const { motionSetOf } = await import('../src/sprites/art/human/motionSets.js');
const { activeHumanFigure, activeHumanLook, motionSetOfRow } =
  await import('../src/sprites/humanSprite.js');
const { HUMAN_LOOKS } = await import('./humanLooks.js');
const { humanRowOf } = await import('../src/sprites/art/humanFigure.js');

/** Long enough for the live script to stow, draw and strike with the weapon picked. */
const HUMAN_SCRIPT_WATCH_TICKS = 6 * 60;

class HumanProbe extends HumanPreviewScene {
  private readonly ctx = asGameContext(
    createCanvas(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height).getContext('2d'),
  );

  tap(id: string): void {
    this.previewControls()
      .find((control) => control.id === id)
      ?.onTap();
  }

  step(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.update();
    this.render(this.ctx);
  }
}

for (const look of HUMAN_LOOKS) {
  console.log(
    `The human’s preview paints ${look.id}, picks every weapon he can hold and plays its rows`,
  );
  window.location.search = `?human&look=${look.id}`;
  const scene = new HumanProbe();
  window.location.search = '';
  check(
    `&look=${look.id} paints him as ${look.id}`,
    activeHumanLook().id === look.id && activeHumanFigure().id.startsWith(`human:${look.id}`),
    activeHumanFigure().id,
  );
  const humanWeapons = Object.keys(ITEM_DEF)
    .filter(isItemId)
    .filter((id) => {
      const wearer = ITEM_DEF[id].wearer;
      return weaponStatsOf(id) !== null && wearer !== undefined && wearerAllows(wearer, 'human');
    });
  const listed = scene.weaponChoices.filter((id) => id !== null);
  check(
    'the weapon picker lists every weapon item he can hold, and bare hands',
    scene.weaponChoices[0] === null &&
      listed.length === humanWeapons.length &&
      humanWeapons.every((id) => listed.includes(id)),
    `${listed.length}/${humanWeapons.length}`,
  );
  const wrongHand: string[] = [];
  const wrongRows: string[] = [];
  const unplayed: string[] = [];
  let rendered = true;
  for (let pick = 1; pick < scene.weaponChoices.length; pick++) {
    scene.tap('weapon');
    const id = scene.pickedWeapon;
    if (id === null) continue;
    if (scene.livePlayer.mainHandWeaponId !== id) wrongHand.push(id);
    const weapon = weaponStatsOf(id);
    if (weapon === null) continue;
    const set = motionSetOf(HELD_VISUALS[weapon.heldVisual]);
    if (set !== 'unarmed' && motionSetOfRow(scene.shownRow) !== set) wrongRows.push(id);
    const played = new Set<string>();
    try {
      for (let tick = 0; tick < HUMAN_SCRIPT_WATCH_TICKS; tick++) {
        scene.step(1);
        played.add(scene.livePlayer.spriteSelection().row);
      }
    } catch (error) {
      rendered = false;
      console.log(error);
    }
    const holstered = [...played].some((row) => humanRowOf(row)?.holster !== undefined);
    if (set !== 'unarmed' && !holstered) unplayed.push(id);
  }
  check(
    'picking a weapon puts it out in the live player’s hand',
    wrongHand.length === 0,
    wrongHand.join(','),
  );
  check('the row pane turns to the weapon’s own rows', wrongRows.length === 0, wrongRows.join(','));
  check(
    'the live script draws and stows each weapon with rows of its own',
    unplayed.length === 0,
    unplayed.join(','),
  );
  check('every weapon renders in both panes', rendered);
  scene.tap('weapon');
  check('the picker comes round to bare hands', scene.pickedWeapon === null);
}

if (failures > 0) {
  console.log(`\n${failures} preview-scene check(s) failed.`);
  process.exit(1);
}
console.log('\nAll preview-scene checks passed.');
