/**
 * What kind of thing was granted. Only the overlay's heading varies — the
 * animation, layout and dismissal are identical, which is why an ability tome
 * and a skill book share one dialog rather than owning two near-copies.
 */
export type GrantedRewardKind = 'ability' | 'skill';

/**
 * Represents a single reward shown in the RewardGrantedDialog after
 * dismissing any award screen that contains an ability or special unlock.
 */
export interface GrantedReward {
  kind: GrantedRewardKind;
  name: string;
  description: string;
  renderIcon: (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => void;
}
