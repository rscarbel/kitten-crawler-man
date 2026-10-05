#!/usr/bin/env tsx
/**
 * The shared review-scene frame: only a primary-button press (or a wheel turn)
 * on the art reaches the scene's world handler, so a right-click or a
 * middle-click never pans or switches a preview; and a caption too long for
 * the top-right column moves under the controls rather than squeezing every
 * control into a column of its own.
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
const { setViewportSize } = await import('../src/core/Viewport.js');

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

function press(scene: ProbeScene, button: number): void {
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

if (failures > 0) {
  console.log(`\n${failures} preview-scene check(s) failed.`);
  process.exit(1);
}
console.log('\nAll preview-scene checks passed.');
