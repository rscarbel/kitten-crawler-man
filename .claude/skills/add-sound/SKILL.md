---
name: add-sound
description: Add a sound effect or music track to Kitten Crawler Man — SoundId registry, SOUND_MANIFEST, AudioManager playback, EventBus wiring. Use when adding/playing audio or changing music behavior.
---

# Add a Sound

All audio is **pre-recorded mp3 files** — no synthesis. WebAudio is only the playback graph (`AudioContext → masterGain → { sfxGain, musicGain }`). Files live under `src/audio/{characters,enemies,bosses,effects,events,menu,background_music}/`.

## Checklist

1. Drop the `.mp3` in the appropriate `src/audio/<category>/` folder.
2. Add its id to `SOUND_IDS_TUPLE` in `src/audio/sounds.ts` (the `SoundId` type derives from it).
3. Add the id → path mapping in `SOUND_MANIFEST` in the same file.
4. Play it. Preloading is automatic (`preload()` fetches and decodes everything in `ALL_SOUND_IDS`; missing files warn and skip).

## Playing sounds

`AudioManager` (`src/audio/AudioManager.ts`):

- One-shot: `audio.play(id, { volume?, playbackRate?, startOffset? })` — queues until the mobile gesture-unlock if the context is suspended.
- Variants: `playWhenReady(id)`, `playRandom([ids])`, `stopSound(id)`.
- Music: `playMusic(id, { fadeInMs })`, `stopMusic(fadeMs)`, `pauseMusic` / `resumeMusic`.
- Looping SFX (walking, machinery, etc.) have dedicated start/stop methods — follow that pattern for new loops.

## Where to trigger from

- **Preferred**: wire to a game event in `AudioManager.wireEvents(bus)` — the central subscriber mapping EventBus events (`mobKilled`, `bossFightInitiated`, `questCompleted`, ...) to sounds/music. Cleaner than sprinkling `audio.play` at emit sites. Note the bus is cleared on scene teardown, so `wireEvents` runs once per scene.
- **Mob sounds**: set the creature's `audioTag` and add a `case` in the audio switch in `DungeonScene` (search `audioTag`). `dealDamage` sets `attackSoundPending` automatically; set `projectileSoundPending` for ranged attacks. Boss-specific sounds use `instanceof` checks there.
- **Systems** don't hold an audio reference — they set pending flags (e.g. `explosionSoundPending`) the scene drains.
- **UI buttons**: handled by `setButtonAudio` + `notifyButtonClick` (see `add-ui`) — don't add per-button play calls.

Finish with the `dev-workflow` gates (typecheck, lint, format).
