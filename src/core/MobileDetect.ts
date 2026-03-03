/**
 * True when the game is running on a touch-capable device (phone / tablet).
 * Evaluated once at startup; does not change during the session.
 */
export const IS_MOBILE: boolean =
  typeof navigator !== 'undefined' &&
  (navigator.maxTouchPoints > 0 ||
    /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    ));
