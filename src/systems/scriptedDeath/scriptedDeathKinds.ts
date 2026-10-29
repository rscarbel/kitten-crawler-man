/**
 * Every death a script plays out rather than a blow deals. A leaf module, so
 * `Player`'s `DamageSource` can name one without reaching the art and sound
 * each is played with (`SCRIPTED_DEATHS`).
 */
export type ScriptedDeathKind = 'shark_attack' | 'time_limit_detonation';
