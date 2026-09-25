/**
 * The gestures systems ask Carl for outside a fight — casting Protective
 * Shell, drinking, stooping for loot, heaving a chest open, talking — each
 * picked for the view he faces and played through `HumanPlayer.playAction`.
 *
 * Systems tell him what is happening; nothing here draws him. Where gameplay
 * waits on the gesture (the dome raised when the palm lands, the chest's
 * reward shown once the lid is up), the wait is only ever as long as the
 * picture: a gesture that is refused, cut off by a blow, walked out of or
 * left behind by a switch of crawler runs the gameplay at once, so nothing
 * the player asked for is ever lost to it. The exceptions are his going down
 * part-way, when what he was doing dies with him and nothing was spent on it,
 * and the world stopping under the death screen, when nothing happens at all.
 *
 * A gesture's facing picks the row and mirrors it; it never turns him. His
 * gameplay facing is what the next blow, sling shot or throw goes along, and
 * a stoop toward a pickup behind him must not aim those away from the fight.
 */

import { TILE_SIZE } from '../core/constants';
import type { Player } from '../Player';
import { type Pt } from '../sprites/art/carlArt';
import { eventFrame, type HumanRowName, type ViewRows } from '../sprites/art/humanFigure';
import { viewForFacing } from '../sprites/humanSprite';
import { HumanPlayer } from './HumanPlayer';

type GestureFamily = 'shell_cast' | 'drink' | 'grab' | 'chest_open' | 'talk';

const GESTURE_ROWS: Readonly<Record<GestureFamily, ViewRows>> = {
  shell_cast: { front: 'shell_cast', side: 'shell_cast_side', back: 'shell_cast_away' },
  drink: { front: 'drink', side: 'drink_side', back: 'drink_away' },
  grab: { front: 'grab', side: 'grab_side', back: 'grab_away' },
  chest_open: { front: 'chest_open', side: 'chest_open_side', back: 'chest_open_away' },
  talk: { front: 'talk', side: 'talk_side', back: 'talk_away' },
};

interface Facing {
  readonly x: number;
  readonly y: number;
}

/** Under this many pixels apart, there is no direction to turn toward. */
const SAME_SPOT_PX = 1;

/** The unit direction from his tile's centre to a point in the world, or null on top of him. */
function facingToward(human: HumanPlayer, target: Pt): Facing | null {
  const half = TILE_SIZE / 2;
  const dx = target.x - (human.x + half);
  const dy = target.y - (human.y + half);
  const length = Math.hypot(dx, dy);
  if (length < SAME_SPOT_PX) return null;
  return { x: dx / length, y: dy / length };
}

/**
 * The row of a family for the way he faces — or the way `face` turns him — and
 * that facing, which is always passed on to `playAction`: left to itself it
 * mirrors the row by the facing the animator last ticked with, a tick behind
 * a turn made this frame.
 */
function gestureRow(
  human: HumanPlayer,
  family: GestureFamily,
  face: Facing | null,
): { readonly row: HumanRowName; readonly faceX: number; readonly faceY: number } {
  const faceX = face?.x ?? human.facingX;
  const faceY = face?.y ?? human.facingY;
  return { row: GESTURE_ROWS[family][viewForFacing(faceX, faceY)], faceX, faceY };
}

/** A row's first frame, where a gesture's moment falls when its row names none. */
const FIRST_FRAME = 0;

/** Wraps `run` so it happens once, whichever of its callers gets there first. */
function once(run: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    run();
  };
}

/** Whether he is mid-way through a Protective Shell cast, so a second press waits for it. */
export function isCastingShell(human: HumanPlayer): boolean {
  const drawn = human.spriteSelection().row;
  return human.isActing && Object.values(GESTURE_ROWS.shell_cast).includes(drawn);
}

/**
 * Whether he is still on his feet: a gesture whose gameplay lands on a corpse
 * would spend a cooldown on nothing, or show a chest's loot over the death
 * screen.
 */
function isOnHisFeet(human: HumanPlayer): boolean {
  return human.isAlive && !human.isKnockedOut;
}

/**
 * Protective Shell: the right palm driven down and out, and `cast` run on the
 * frame it lands — or straight away if he cannot play it, and at once if it is
 * cut short before the palm lands. A switch to the cat before the palm lands
 * still casts: the press was made while he was driven. A cast cut short by his
 * going down, or by the world stopping under the death screen, is lost
 * outright, never run: nothing was spent on it, so the cooldown is untouched.
 */
export function castShellWithGesture(human: HumanPlayer, cast: () => void): void {
  // Only while he is up: at full power the cast heals him to full, which on a
  // dead man is a resurrection under the death screen.
  const fire = once(() => {
    if (isOnHisFeet(human)) cast();
  });
  const { row, faceX, faceY } = gestureRow(human, 'shell_cast', null);
  const accepted = human.playAction(row, {
    faceX,
    faceY,
    onFrame: [{ frame: eventFrame(row, 'cast') ?? FIRST_FRAME, run: fire }],
    onEnd: (reason) => {
      if (reason !== 'defeated') fire();
    },
  });
  if (!accepted) fire();
}

/**
 * Holds the Protective Shell cast of the way he faces warm up to the frame the
 * dome goes up, while the spell sits on his hotbar ready to cast: the press
 * can come on any tick, and the dome waits on that frame being drawn. Called
 * once a tick by whatever keeps the spell's cooldown.
 */
export function standByForShellCast(human: HumanPlayer, offCooldown: boolean): void {
  const slotted = human.inventory.actionBar.slots.some(
    (slot) => slot?.abilityId === 'protective_shell',
  );
  if (!slotted || !offCooldown || !human.isActive) {
    human.standBy('shell_cast', []);
    return;
  }
  const { row } = gestureRow(human, 'shell_cast', null);
  human.standBy('shell_cast', [{ row, frames: (eventFrame(row, 'cast') ?? FIRST_FRAME) + 1 }]);
}

/**
 * A drink: bottle to the mouth, head back, a wipe of the mouth. Only Carl has
 * the rows; the cat drinks unseen. Asked for while the world is halted under a
 * menu, it waits on its first frame — the idle's own — and plays once play
 * resumes; walking off cuts it short.
 */
export function playDrinkGesture(drinker: Player): void {
  if (!(drinker instanceof HumanPlayer)) return;
  const { row, faceX, faceY } = gestureRow(drinker, 'drink', null);
  drinker.playAction(row, { faceX, faceY });
}

/**
 * A quick stoop for something at his feet, turned toward it. Only when he is
 * standing about: loot is picked up by walking over it, and a stoop played on
 * the run would stop him dead on screen while he kept moving. Never over
 * another gesture either — a pile landing mid-drink leaves the drink alone.
 */
export function playPickupGesture(picker: Player, item: Pt): void {
  if (!(picker instanceof HumanPlayer)) return;
  if (picker.isMoving || picker.isActing) return;
  const { row, faceX, faceY } = gestureRow(picker, 'grab', facingToward(picker, item));
  picker.playAction(row, { faceX, faceY });
}

/**
 * A low reach to scratch an animal's head, turned toward it — the stoop he
 * makes for a pickup, aimed at the head instead of the ground, which at a
 * cow's height reads as a hand to the brow. Refused on the move and over
 * another gesture, like the stoop.
 */
export function playPetGesture(petter: Player, head: Pt): void {
  if (!(petter instanceof HumanPlayer)) return;
  if (petter.isMoving || petter.isActing) return;
  const { row, faceX, faceY } = gestureRow(petter, 'grab', facingToward(petter, head));
  petter.playAction(row, { faceX, faceY });
}

/**
 * How a chest's lid came up, for the reward shown on it:
 * - `shown`: he is standing at the open chest, and the reward can be shown.
 * - `unseen`: he went down before the lid was up. Nobody is there to be shown
 *   it, but whatever the showing would have handed over is still his: out
 *   cold as the companion he wakes to it, and killed as the one driven, the
 *   death screen's rewind puts the chest back to be opened again anyway.
 */
type ChestLidOutcome = 'shown' | 'unseen';

/**
 * Heaving a chest open: turned to it, a squat, the lid lifted and pushed over,
 * and `lidUp` run once the lid is up past his chest — or straight away if the
 * opener is not Carl, if he cannot play it, or if it is cut short first.
 *
 * The loot is the caller's to grant on the press; only the showing of it waits
 * on the lid. Cut short by the world stopping under the death screen, `lidUp`
 * never runs: the rewind that follows puts the chest and his pack back as they
 * were, exactly as it discards a reward dialog left open.
 */
export function openChestWithGesture(
  opener: Player,
  chest: Pt,
  lidUp: (outcome: ChestLidOutcome) => void,
): void {
  if (!(opener instanceof HumanPlayer)) {
    lidUp('shown');
    return;
  }
  const fire = once(() => {
    lidUp(isOnHisFeet(opener) ? 'shown' : 'unseen');
  });
  const { row, faceX, faceY } = gestureRow(opener, 'chest_open', facingToward(opener, chest));
  const accepted = opener.playAction(row, {
    faceX,
    faceY,
    onFrame: [{ frame: eventFrame(row, 'lidUp') ?? FIRST_FRAME, run: fire }],
    onEnd: (reason) => {
      if (reason !== 'defeated') fire();
    },
  });
  if (!accepted) fire();
}

/**
 * Keeps Carl talking, turned toward whoever he is in conversation with, for as
 * long as a scene reports a speaker; and back to standing when it stops.
 *
 * Most conversations halt the world, and a halted world does not tick him, so
 * the scene says so and his talking is advanced here instead — the one thing
 * on him that moves while the world waits on the dialog.
 */
export class HumanTalkDriver {
  private talking = false;

  /**
   * Once per scene update, before its halted-world early return.
   *
   * @param speaker where the one he is talking to stands, in world pixels, or
   *   null when no conversation is open.
   * @param worldHalted whether the scene is about to skip its gameplay tick,
   *   which is what advances him otherwise.
   */
  update(human: HumanPlayer, speaker: Pt | null, worldHalted: boolean): void {
    if (speaker === null || !human.isActive) {
      this.stop(human);
      return;
    }
    // Walking off is how a street conversation ends; starting to talk on the
    // move would only be cut off by the step. A drink or a pickup mid-chat is
    // left to finish, and the talking picks up again after it.
    if (!this.talking && !human.isMoving && !human.isActing) this.startTalking(human, speaker);
    // Only the talking is this driver's to advance: any other action asked for
    // under a halted dialog waits on its first frame for play to resume, the
    // same as everything else the halt stops.
    if (worldHalted && this.talking) human.tickActionWhileHalted();
  }

  /**
   * Ends the talking, if this driver started it. The player outlives the
   * scene that drives him — a scene leaving with a conversation open must
   * call this, or the loop plays on in the next scene with nobody to end it.
   */
  stop(human: HumanPlayer): void {
    if (this.talking) human.stopAction();
    this.talking = false;
  }

  private startTalking(human: HumanPlayer, speaker: Pt): void {
    const half = TILE_SIZE / 2;
    const face = facingToward(human, { x: speaker.x + half, y: speaker.y + half });
    const { row, faceX, faceY } = gestureRow(human, 'talk', face);
    this.talking = human.playAction(row, {
      loop: true,
      faceX,
      faceY,
      onEnd: () => {
        this.talking = false;
      },
    });
  }
}
