/**
 * Represents a single reward shown in the RewardGrantedDialog after
 * dismissing any award screen that contains an ability or special unlock.
 */
export interface GrantedReward {
  name: string;
  description: string;
  renderIcon: (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => void;
}
