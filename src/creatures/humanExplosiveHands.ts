import type { HumanPlayer } from './HumanPlayer';
import {
  eventFrame,
  type HumanRowName,
  humanRowOf,
  type ViewRows,
} from '../sprites/art/humanFigure';
import { DYNAMITE_THROWING_HAND } from '../sprites/art/human/actionsThrow';
import { type HumanRowView, prewarmHumanRow } from '../sprites/humanSprite';
import type { Pt } from '../sprites/art/bipedArt';
import type { ThrownPropVisualId } from '../sprites/held/heldVisualIds';
import type {
  ExplosiveStance,
  ExplosiveThrower,
  ThrowCallbacks,
} from '../systems/explosiveThrower';

/** The rows he lights, holds and throws a stick in, per view. */
const LIGHT_ROWS: ViewRows = {
  front: 'dynamite_light',
  side: 'dynamite_light_side',
  back: 'dynamite_light_away',
};
const HOLD_ROWS: ViewRows = {
  front: 'dynamite_hold',
  side: 'dynamite_hold_side',
  back: 'dynamite_hold_away',
};
const THROW_ROWS: ViewRows = {
  front: 'dynamite_throw',
  side: 'dynamite_throw_side',
  back: 'dynamite_throw_away',
};
const ALL_DYNAMITE_ROWS: ReadonlySet<HumanRowName> = new Set([
  ...Object.values(LIGHT_ROWS),
  ...Object.values(HOLD_ROWS),
  ...Object.values(THROW_ROWS),
]);

/**
 * The human's explosive in his fist: lit with his lighter and held cocked,
 * or hanging unlit from his throwing hand, and thrown overarm.
 */
export class HumanExplosiveHands implements ExplosiveThrower {
  /** The stance and view whose rows have been warmed, null since he last took one up. */
  private warmed: { readonly stance: ExplosiveStance; readonly view: HumanRowView } | null = null;
  /** Whether the fuse has been drawn catching, so a light cut short is not played twice. */
  private lit = false;

  constructor(private readonly human: HumanPlayer) {}

  takeExplosive(look: ThrownPropVisualId): void {
    this.human.takeExplosiveInHand(look);
    this.warmed = null;
    this.lit = false;
  }

  holdExplosive(stance: ExplosiveStance): void {
    if (stance === 'lighting') this.poseForLight();
    else this.poseForReadied(stance);
  }

  throwExplosive(callbacks: ThrowCallbacks): boolean {
    const { human } = this;
    const row = human.rowFacing(THROW_ROWS);
    const releaseFrame = eventFrame(row, 'release');
    if (releaseFrame === undefined) return false;
    return human.playAction(row, {
      faceX: human.facingX,
      faceY: human.facingY,
      onFrame: [{ frame: releaseFrame, run: callbacks.onRelease }],
      onEnd: (reason) => callbacks.onEnd(reason === 'defeated'),
    });
  }

  dropExplosivePose(): void {
    const { human } = this;
    if (human.isActing && ALL_DYNAMITE_ROWS.has(human.spriteSelection().row)) human.stopAction();
  }

  explosiveReleasePoint(): Pt {
    return this.human.handWorldPosition(DYNAMITE_THROWING_HAND);
  }

  /** Warms `rows` for the view he faces the first time he stands in `stance` facing it. */
  private warm(stance: ExplosiveStance, view: HumanRowView, rows: readonly ViewRows[]): void {
    if (this.warmed?.stance === stance && this.warmed.view === view) return;
    this.warmed = { stance, view };
    for (const viewRows of rows) prewarmHumanRow(viewRows[view]);
  }

  /** Whether he is drawn in `row` already, facing the way it would be drawn now. */
  private drawnIn(row: HumanRowName): boolean {
    const { human } = this;
    const drawn = human.spriteSelection();
    const mirrored = humanRowOf(row)?.mirrorable === true;
    const flipMatches = !mirrored || drawn.flipX === human.facingSelection.flipX;
    return human.isActing && drawn.row === row && flipMatches;
  }

  /** Whether he is in the middle of something other than his explosive, which it must not cut off. */
  private busyWithOther(): boolean {
    const { human } = this;
    return human.isActing && !ALL_DYNAMITE_ROWS.has(human.spriteSelection().row);
  }

  /**
   * Keeps him posed for the charge: lighting the stick until the fuse has
   * caught, then holding it cocked. Asked again whenever the row he is drawn
   * in is not the one wanted — he walked and the stride took over, or he
   * turned and the view changed — and only while he stands still, since
   * moving ends an action on its first step anyway.
   */
  private poseForLight(): void {
    const { human } = this;
    const view = human.rowViewFacing();
    // The light buys the better part of a second, which is lead enough to
    // bake the hold and the throw before either is drawn. Turning mid-charge
    // warms the new view's pair the same way: its throw can be let go at once.
    this.warm('lighting', view, [HOLD_ROWS, THROW_ROWS]);
    if (human.isMoving) return;
    const row = this.lit ? HOLD_ROWS[view] : LIGHT_ROWS[view];
    if (this.drawnIn(row)) return;
    // The fuse catches partway through the light; the rest of it — the draw
    // back into the stance — plays out before the hold takes over.
    const lightRow = LIGHT_ROWS[view];
    const drawn = human.spriteSelection();
    const lightStillPlaying =
      drawn.row === lightRow && drawn.frame < (humanRowOf(lightRow)?.frameCount ?? 0) - 1;
    if (lightStillPlaying && this.drawnIn(lightRow)) return;
    if (this.busyWithOther()) return;
    const fuseFrame = eventFrame(row, 'fuseLit');
    const lightFuse = (): void => {
      this.lit = true;
    };
    // The light holds its last frame — the cocked stance the hold loops on —
    // so there is no tick of standing between the two rows.
    human.playAction(row, {
      loop: this.lit,
      holdLastFrame: !this.lit,
      faceX: human.facingX,
      faceY: human.facingY,
      onFrame: fuseFrame === undefined ? [] : [{ frame: fuseFrame, run: lightFuse }],
    });
  }

  /**
   * Keeps him standing with the stick or bomb hanging from his throwing hand:
   * the light row's first frame, held there by pacing it at zero. A bomb has
   * no fuse to light while he winds up, so it is held this way too and can
   * never go off in his hand.
   */
  private poseForReadied(stance: ExplosiveStance): void {
    const { human } = this;
    const view = human.rowViewFacing();
    // The throw follows a tap with no light to hide a bake behind, so its
    // rows are warmed while the stick is only held.
    this.warm(stance, view, [LIGHT_ROWS, THROW_ROWS]);
    if (human.isMoving) return;
    const row = LIGHT_ROWS[view];
    if (this.drawnIn(row) || this.busyWithOther()) return;
    human.playAction(row, {
      progress: () => 0,
      faceX: human.facingX,
      faceY: human.facingY,
    });
  }
}
