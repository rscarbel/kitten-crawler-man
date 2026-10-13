/**
 * The high striker's mallet as a held visual: a long rot-timber haft and a
 * squared wooden block across its end, its striking face blooded like the
 * one leaning on the striker in `circusArt.ts`. It belongs to the striker,
 * not to any item: a crawler holds it only for the one swing at the pad.
 */

import { TOOL_KNOB_LENGTH } from '../../art/toolArt';
import { rgb } from '../../art/town/townArt';
import { getCircusRamp } from '../../art/town/townPalette';
import { defineHeldVisual, type HeldLook } from '../heldVisualDef';
import { heldShade, outlineAndFill } from '../heldPaint';

type Ctx = CanvasRenderingContext2D;

const ROT_TIMBER = getCircusRamp('circus_rot_timber');
const BLOOD = getCircusRamp('circus_blood');

const MALLET_HANDLE_LENGTH = 1.05;
/** The block's run along the haft, and its span across it, centred on the haft. */
const MALLET_HEAD_ALONG = 0.2;
const MALLET_HEAD_HALF_ACROSS = 0.17;
/** The block sits this far back over the haft's end, so the haft runs into it rather than butting on it. */
const MALLET_HEAD_SET_BACK = 0.04;
/** The share of the block, along the haft, its key-lit side catches. */
const MALLET_LIT_SHARE = 0.45;
/** The blood on the striking face, as shares of the block: how deep it soaks in, and how far across. */
const MALLET_BLOOD_DEPTH_SHARE = 0.3;
const MALLET_BLOOD_SPAN_SHARE = 0.7;

function traceMalletHead(ctx: Ctx, base: number): void {
  ctx.beginPath();
  ctx.rect(
    base - MALLET_HEAD_SET_BACK,
    -MALLET_HEAD_HALF_ACROSS,
    MALLET_HEAD_ALONG,
    MALLET_HEAD_HALF_ACROSS * 2,
  );
}

function paintMalletHead(ctx: Ctx, look: HeldLook, base: number): void {
  const back = base - MALLET_HEAD_SET_BACK;
  traceMalletHead(ctx, base);
  outlineAndFill(ctx, heldShade(rgb(ROT_TIMBER.mid), look));
  ctx.save();
  traceMalletHead(ctx, base);
  ctx.clip();
  const litAlongTheHaft = look.light.x >= 0;
  const litWidth = MALLET_HEAD_ALONG * MALLET_LIT_SHARE;
  ctx.fillStyle = heldShade(rgb(ROT_TIMBER.light), look);
  ctx.fillRect(
    litAlongTheHaft ? back + MALLET_HEAD_ALONG - litWidth : back,
    -MALLET_HEAD_HALF_ACROSS,
    litWidth,
    MALLET_HEAD_HALF_ACROSS * 2,
  );
  // The striking face is the block's leading side, which is what met the pad.
  const bloodDepth = MALLET_HEAD_HALF_ACROSS * 2 * MALLET_BLOOD_DEPTH_SHARE;
  const bloodSpan = MALLET_HEAD_ALONG * MALLET_BLOOD_SPAN_SHARE;
  ctx.fillStyle = heldShade(rgb(BLOOD.mid), look);
  ctx.fillRect(
    back + (MALLET_HEAD_ALONG - bloodSpan) / 2,
    MALLET_HEAD_HALF_ACROSS - bloodDepth,
    bloodSpan,
    bloodDepth,
  );
  ctx.restore();
}

export const STRIKER_MALLET_HELD = defineHeldVisual({
  id: 'striker_mallet',
  name: 'High striker mallet',
  archetype: 'twoHandHaft',
  weight: 'heavy',
  handle: { length: MALLET_HANDLE_LENGTH, radius: 'thick' },
  head: { length: MALLET_HEAD_ALONG, width: MALLET_HEAD_HALF_ACROSS * 2 },
  gripPoint: TOOL_KNOB_LENGTH / MALLET_HANDLE_LENGTH,
  phases: 1,
  handleLook: { colour: rgb(ROT_TIMBER.light), butt: 'knob' },
  paintHead: (ctx, look, handle) => paintMalletHead(ctx, look, handle.headBase),
});
