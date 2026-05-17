export type PauseTab =
  | 'main'
  | 'inventory'
  | 'stats'
  | 'spend'
  | 'achievements'
  | 'abilities'
  | 'settings';

export type ButtonRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Called on click unless positionedAction is provided. */
  action?: () => void;
  /** When present, called instead of action — receives the exact click coordinates. */
  positionedAction?: (mx: number, my: number) => void;
};
