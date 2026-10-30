---
name: add-sound
description: Add a sound effect, jingle or song to Kitten Crawler World (a song is one `npm run add:music` command), or change how audio plays — the music/ and jingles/ folders, SoundId tuples and SOUND_MANIFEST, MUSIC_CATALOG, music claims through the MusicDirector, sound traits, positional playAt, AudioScope loops, buses, loudness measurement and the check:audio / verify:audio gates. Use when adding, playing or routing any audio.
---

# Add a Sound

All audio is **pre-recorded MP3**, plus Ogg Vorbis for a song that must loop gaplessly — no synthesis. WebAudio is only the playback graph:

```
music, sfx, ambience, ui → master → limiter → destination   (src/audio/buses.ts)
```

Sliders (Master, Music, Effects, Ambience; UI follows Effects) map through a square-law dB taper (`sliderGain`). Every bus sits at unity: each recording is trimmed at runtime to its bus's `BUS_TARGET_LUFS` (`src/audio/loudnessTargets.ts`), which is what places the buses against each other. `LIMITER` is a brickwall safety net, not a levelling tool. Every voice owns a gain node and every stop ramps it first (`stopVoice` in `src/audio/voiceFades.ts`).

## Three kinds of id

| Kind                                                             | Folder                                                                             | Tuple in `src/audio/sounds.ts` | Type           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------ | -------------- |
| Credited song                                                    | `src/audio/music/`, flat, **file name = id**                                       | `MUSIC_TRACK_IDS`              | `MusicTrackId` |
| Uncredited musical clip or loop (stings, the slots' bonus loops) | `src/audio/jingles/`, file name = id                                               | `JINGLE_IDS`                   | `JingleId`     |
| Everything else                                                  | `src/audio/{ambient,bosses,casino,characters,combat,effects,enemies,events,menu}/` | `SFX_IDS`                      | —              |

`SoundId` is the union of all three; `MusicBusId` (`MusicTrackId | JingleId`) is what a music claim accepts, so a sound effect in a claim is a type error. Nothing sits at the `src/audio/` root. Jingles get no unlock, no credit and no music-page row; a sting such as `briar_hollow_victory` plays as a one-shot `play()`.

## Adding a sound effect

1. Drop the `.mp3` in its category folder.
2. Add the id to `SFX_IDS` and its path to `SOUND_MANIFEST` (both `src/audio/sounds.ts`).
3. Add it to every `SFX_GROUPS` group in `src/audio/sfxGroups.ts` whose context can trigger it (`universal` for menu, UI and the party's own cues; `level1`/`level2`/`level3`; a quest, bounty or interior group). Only declared groups are decoded, and `play()` returns silently with no buffer — an id in no group never sounds. Ids may sit in several groups. A recording with no play site yet goes in `UNWIRED_SOUND_IDS` instead (wiring it means removing it there). Dev builds warn once per id played that no preload requested.
4. Ambience beds and music are in `STREAMING_SOUND_IDS`: they stream through media elements, are never preloaded and must be in no group (cue tables drop them through `decodedCueIds`).
   A long, rare sting that opens a moment (a fight, reward, jackpot, death) can go in `ON_DEMAND_SOUND_IDS` (`sounds.ts`): its group's preload keeps only the compressed file and the first play decodes it, which waits 2–31 ms. Never a hit, a telegraph, a cue an animation is timed to, feedback to the player's own input, a loop, or anything played through `playNow`. Decoded audio is float32 at the context's rate, about 0.35 MB per stereo second, whatever the file's own rate.
5. Give it traits if the defaults are wrong (below), and a caption if it carries information the screen does not show.
6. Run `npm run measure:audio`, then play it.

**Never register an id whose file does not exist yet.** A feature waiting on a recording plays a stand-in through a named cue table — `src/audio/villageSoundCues.ts` (Briar Hollow), `BLUEPRINTS_CUES` (`src/systems/briarHollow/blueprints/blueprintsSoundCues.ts`), `CONTRACT_CUES` (`src/systems/constructionContracts/contractSoundCues.ts`) — with an empty list for a cue that stays silent; when the file lands the change is its registration plus one line there. A `CueSlot` (`src/audio/cueSlot.ts`) also names the recording it waits for in `standInFor`; registering `<name>` or `<name>_1` makes that slot fail to compile until it is switched over. Weapons use it by sound family (`src/audio/weaponSoundCues.ts`), as do gear equips (`EQUIP_CUES`, `EQUIP_OVERRIDES`) and the reward chest's drop (`CHEST_DROP`). Every village-only id, stand-ins included, goes in the `briarHollow` group (floor 3 loads it through `LEVEL3_SFX_GROUPS`), or in `briarHollowSiege` when only the siege, Midge's escort or the village's walls and engines play it; the village's shops are outdoors, so an id otherwise only in an interior group (`purchase_success`) needs `briarHollow` too.

**Gated groups.** Floor 3's `briarHollowSiege`, `bounty` and `starlightTent`, and floor 1's `floodedPumpRoomMusic` (the Kraken's decoded fight music, held near her room), are `GATED_SFX_GROUPS`, in no floor's bundle: `FloorSfxGates` (built by `DungeonScene.buildSfxGates`) holds each through `AudioManager.holdSfxGroup` while the party is within 40 tiles of its place (let go past 70) or while something under way can play it anywhere (a siege, a bounty out, Midge's escort). A new cue in one of them must only fire inside that window; an id that can sound anywhere on floor 3 goes in `level3` instead. An interior that hosts gated content declares the group itself (the Starlight Tent declares `starlightTent`, which is built from `STARLIGHT_TENT_CUES` plus the grounds' high striker). As a safety net floor 3's scenes keep every gated id's compressed file (`AudioScope.keepCompressed`, `compressedSfxForLevelId`, about 1.5 MB): a gated cue played with its group let go decodes on demand, 2–30 ms late, and dev builds warn once naming it — treat that warning as a gate bug. An unplaced `play()` is heard map-wide, so its id belongs in an always-held group.

## Adding a song

**Use the script — one command, a few seconds. Do not hand-edit the registry, and do not read `sounds.ts` or `catalog.ts` first.**

```
npm run add:music -- <file.mp3|file.ogg> --title "Shown Title" --area <area> \
  (--author-name "Real Name" | --author-username handle)   # either or both
  [--original-title "Recording's own title"]   # default: --title
  [--pixabay]                                  # licensed from Pixabay; omit for the user's own compositions
  [--id snake_case_id]                         # default: the file name
  [--area-label "Label"]                       # creates --area as a new music area
  [--loop-start <seconds>]                     # intro heard once before the loop body
  [--decoded]                                  # decoded, not streamed: a gapless loop or a stem
```

The file may already sit in `src/audio/music/` (an uncommitted drop) or anywhere else (it is copied in). The script adds the id to `MUSIC_TRACK_IDS`, `SOUND_MANIFEST` and `STREAMING_SOUND_IDS`, writes the `MUSIC_CATALOG` entry (plus `MUSIC_AREA_IDS` / `MUSIC_AREA_LABELS` with `--area-label`) and `MUSIC_LOOP_START_S`, warns if the export is not 44.1 kHz stereo, then runs `measure:audio`, prettier on the two files and `check:audio`. An unknown `--area` without `--area-label` fails and prints the known areas. When the user wrote the song, attribution is `--author-name "Nine Lives Orchestra"` with no `--pixabay`; ask only for what the request leaves out (title, area). Afterwards run `npm run typecheck` — no other gate is needed for registration alone.

What remains by hand is step 5. Background for reading the script's output:

1. Songs are exported **44.1 kHz stereo MP3 at a modest bitrate**. Cut size with the bitrate, never the sample rate: a low sample rate removes the top end and sounds muffled. There is no encode script; the user owns the exports.
2. The file is `src/audio/music/<id>.mp3`; songs stream, so they are in `STREAMING_SOUND_IDS` and no SFX group. A streamed song loops through a media element, which leaves a gap at the seam. A song that must loop seamlessly or change stems in sync is `--decoded`: an `.ogg` (Vorbis keeps the exact length, where an MP3 is padded by its encoder) played from a decoded `AudioBufferSourceNode` that loops sample-exact. It is about 0.35 MB per second decoded, so it goes in the SFX group (usually a gated one) of the place that claims it; a claimed decoded song whose buffer is not resident is fetched and starts once decoded.
3. `MUSIC_CATALOG` (`src/audio/music/catalog.ts`): `title` (distinct, non-blank), `area` (a `MusicAreaId` — groups the music page and gives the locked row's "Found in" hint) and `attribution` (`originalTitle`, `authorName` and/or `authorUsername`, `source: 'Pixabay'` or absent for an original composition). `formatAttribution` builds the credit line.
4. `MUSIC_LOOP_START_S` holds an intro's length in seconds; a re-export must keep that intro the same length.
5. **Make something claim it** (below). A claim unlocks every song it names; the credit card shows the first time the song is actually heard. A song nobody claims yet is fine: it shows locked on the music page.

## Music: claim, never play

There is no `playMusic`. The `MusicDirector` (`src/audio/music/MusicDirector.ts`, `audio.music`) outlives scenes and plays the winning claim:

- `scope.claimMusic({ owner, layer, selection, fadeInMs? })` / `scope.releaseMusic(owner, { fadeOutMs? })` / `scope.isMusicClaimed(owner)` on the scene's `AudioScope`. A system takes this as `MusicClaims`.
- **Layers** `area < activity < battle < boss < player < exclusive`; the highest layer wins, and within a layer the newest claim. Releasing falls back to the next claim on its own — never restore music by hand. `player` is the music page's choice (Repeat, Play once, Shuffle unlocked; Area music releases it); only `exclusive` (the keyboard-hero song, whose note chart reads its clock) outranks it.
- **Selections**: `silence`, `loop` (`skipIntro?`, `fromTop?`), `stems` (below), `playlist` (reshuffled each pass, never the same song twice in a row; `advance?` moves a set already playing on to its next song), `held` (the claimant plays the voice itself — the keyboard-hero song through `scope.startKeyboardHeroMusic`).
- **Owners** are the closed `MusicClaimOwner` union; a new system adds its owner there.
- A claim for the track already playing carries on without a restart, across a scene change too (the handover resolves only after the new scene's first claims). An overridden track resumes where it was within `MUSIC_RESUME_WINDOW_S`; after that a playlist moves on and a loop restarts at its loop point. Changes are equal-power crossfades with per-layer `MUSIC_LAYER_FADE_MS`.
- **`fromTop`** (on `loop` and `stems`): the claim starts its music from the top once, on its first win, even over the same music playing or remembered — for a fight that restarts as a whole after a death. Made again identically it restarts again; winning back later it resumes like any claim.
- **Stem sets** (`src/audio/music/stemSets.ts`, `MUSIC_STEM_SETS`): recordings of one piece, the same length, cut from one mix with layers removed; the first is the full mix. `{ kind: 'stems', set, stem }` (the stem's type is checked against its set) loops the stem decoded from the top. A claim naming another stem of the set already playing crossfades over the claim's `fadeInMs` at the same point in the loop: the director lays the new stem `MUSIC_STEM_SWITCH_LEAD_S` ahead on the audio clock (`MusicTrackRequest.startAtS`) at the position the old one will reach (`MusicTrackHandle.positionS(atS)`) and fades the old one from that instant (`stop(…, fromS)`). The set carries on and is remembered as one piece, whichever stem plays. Every stem plays at its set's full-mix loudness trim (`musicTrimIdOf`), so taking a layer out sounds like a layer leaving. The full mix is catalogued; the reduced stems are uncredited jingles in `jingles/`. A new set is one entry there, its stems decoded and in a group.
- **Bosses**: `src/audio/music/bossTracks.ts` maps boss type → `BossMusic`: `track` (`bossTrack`, default `boss_music_3`), or `scoredByFight` for a fight that claims its own music (the Lich's tower finale, scored from the `warden_ritual` stems; the Kraken's room, following its pumps) with the catalogued `tracks` it can play, which `bossFightTracks` hands the music backfill. `wireBossMusic` claims `boss` on `bossFightInitiated` and releases on `bossDefeated` for `track` bosses only. A new boss track is one entry there.
- **The Kraken** (`KrakenFightMusic`, `src/systems/bossRooms/floodedPumpRoom/krakenFightMusic.ts`, owner `flooded_pump_room`, layer `boss`) reads the room's `fightState` and `pumpsShutOff` each frame: the intro's growl claims the `kraken_flooded` stems from the top, each pump shut off crossfades a layer out (300 ms), the drain crossfades to `KRAKEN_BATTLE_TRACK` (500 ms), and her death releases with a 2 s fade. `DungeonScene.restoreFromCheckpoint` calls `restart`, which starts whatever the rewound room calls for from the top (the stem for the pumps the checkpoint kept shut), or goes quiet when it is back before the intro.
- **Bus effects never change a claim.** `audio.pauseMusic(reason)` / `resumeMusic(reason)` take a `MusicPauseReason`; the bus stays silent until every reason lets go, so a new silencer gets its own reason. `duckMusic(reason, level)` / `unduckMusic(reason)` take a `MusicDuckReason`; the lowest duck wins and the player's volume is never touched. `pauseAmbience` / `resumeAmbience` work like pauses.

## Playing one-shots

`AudioManager` (`src/audio/AudioManager.ts`):

- `play(id, { volume?, playbackRate?, startOffset?, bus? })` queues until the mobile unlock gesture; `bus: 'ui'` for interface cues. `playWhenReady`, `playRandom([ids])` (never repeats the last take), `stopSound(id)` and `fadeOutSound(id, fadeMs)` (every copy of the id).
- **Placed in the world**: `playAt(id, x, y, opts, reach?)`, `playRandomAt`, or `placedAt(x, y, reach?)` for a player whose cues share one point (mob cues in `playMobAudioCues`, `src/systems/GameLoopPhases.ts`). Heard from the active crawler (`setListener`, set each frame by `CombatKit`): quieter with distance, panned up to ±0.7, dropped past the id's `hearingTiles` before taking a voice. `reach: 'panOnly'` keeps only the side, for boss cues and the party's own shots that reach past ordinary hearing. The interface, the party's own cues and stings stay on `play`.
- **Timed to the picture**: `playNow(id, opts)` plays this instant or not at all and returns its start on the audio clock; `clockSeconds` reads that clock (it stops while backgrounded, so an animation timed off it pauses with its sound — `HighStrikerSystem`). `opts.fadeOut: { atS, durationS }` schedules a sample-exact cut.
- `onCuePlayed(listener)` reports every started one-shot with its source point (the caption lane listens).

## Traits (`src/audio/soundTraits.ts`)

Resolved per id (`ID_TRAITS`) over its folder (`FOLDER_TRAITS`) over `DEFAULT_SOUND_TRAITS`:

- `maxVoices` — a new copy past the cap stops the oldest.
- `minIntervalMs` — a repeat sooner is dropped, so ten goblins swinging on one frame make one voice per take.
- `priority` (`low`/`normal`/`high`) — past the global voice cap a sound steals the oldest voice of the lowest priority at or below its own, else is dropped.
- `pitchJitter` / `volumeJitter` — never vary a take by hand.
- `duckMusic` (`{ depthDb, releaseMs }`) — lowers music for the sound's length through the `'stinger'` duck reason; `STINGER_IDS` carry it.
- `hearingTiles` — the `playAt` range.
- `caption` — from `SOUND_CAPTIONS`: `{ text, when: 'always' | 'offscreen' }`. A cue gets one only when it carries gameplay information the screen does not show (alarms, off-screen boss or mob cries, traps); `offscreen` needs a `playAt` source. Never for UI taps, the party's own attacks, music or ambience. Shown in the HUD's caption lane (`src/ui/hud/captions.ts`) whatever the volume, when the player turns Sound captions on.

## Loops: `AudioScope` (`src/audio/AudioScope.ts`)

One scope per scene (`audio.createScope()`, disposed in `onExit`; also on `SceneWorld`, and an `audioScope` dependency of any system that loops). Loops start only through it: `startAmbientLoop(id, volume)` / `setAmbientLoopVolume` / `stopAmbientLoop` / `isAmbientLoopRunning`, `startLoop(LOOP)` / `stopLoop` for fixed-level loops in `src/audio/loopLevels.ts`, and the keyboard-hero song.

- Disposing fades out everything the scope owns, its music claims included.
- The scope remembers the loops it _wants_, so a backgrounded page (which stops every voice) or the unlock gesture restarts them.
- `scope.preload(ids)` declares a scene's sounds; when a scope is disposed, decoded buffers no live scope declared (except `universal`) are released.

## Where to trigger from

- **Events first**: map EventBus events to sounds in `AudioManager.wireEvents(bus)`. The bus is cleared on scene teardown, so it re-wires per scene. Music is never wired there — claim it.
- **Mobs**: set the creature's `audioTag` (a `CreatureAudioTag`) and say what each generic flag plays in its `MOB_VOICES` row (`src/systems/mobVoices.ts`), which `playMobAudioCues` reads. `dealDamage` sets `attackSoundPending`; set `projectileSoundPending` for ranged attacks. More voices than the boolean flags carry go in a typed field (`Cow.voicePending`, drained by `playCowVoice`) or a cue queue with its own player (`src/systems/undeadAudioCues.ts`).
- **Systems** hold no `AudioManager`; they set pending flags the scene drains, and take `MusicClaims` / `audioScope` for music and loops.
- **The human crawler's voice**: hurt, knocked-out and revived sounds follow the body the player chose, through `humanVocalSounds()` (`HUMAN_VOCAL_SOUNDS`, `src/characters/humanVocalSounds.ts`, a `Record<CrawlerBody, …>`). Play from that table, never a fixed id; a new vocal moment is a new field filled for every body. The crawler's name is the player's, so no sound, caption or file id names the human.
- **UI buttons**: the scene's `UiRoot` plays the tap (a region's `sound` option picks another cue or `null`); never add per-button play calls — see `add-ui`.

## Gates

- `npm run lint` runs `npm run check:audio` (`scripts/check-audio.ts`): folders vs registry vs manifest for `music/` and `jingles/`, every manifest path on disk, the catalogue holding exactly the music tracks with distinct titles, every decoded effect in a group (or unwired), no streamed id in a group, no file at the `src/audio/` root, and every id's loudness entry present with a hash matching its file.
- **After adding or swapping any audio file run `npm run measure:audio`** (`scripts/measure-audio.ts`, needs `ffmpeg` and `ffprobe` on PATH or at `$FFMPEG` / `$FFPROBE`). It rewrites `src/audio/loudness.generated.ts` — per-id LUFS, true peak, hash and trim, served by `loudnessTrimDb` in `src/audio/loudness.ts` — and lists newly measured files to re-export. It only runs ffmpeg on files whose hash changed (under a second for one file); `-- --all` re-measures and lists everything, needed only after changing the targets in `loudnessTargets.ts`. Never edit that table by hand or re-encode a file to fix a level; a stale hash fails `check:audio`.
- **Featured effects.** A sound that must punch above the bus (a death sting, a boss moment) gets its own integrated target in `FEATURED_SFX_TARGET_LUFS` (`src/audio/loudnessTargets.ts`, keyed by `SoundId`) and the higher `FEATURED_TRUE_PEAK_CEILING_DBTP`: its transient may exceed full scale after the trim and the master limiter catches it, on purpose. Give it stinger traits too (`priority: 'high'`, music duck) and play it unplaced (`at: null`) if the camera is on the moment. Re-run `measure:audio` after adding an entry; it recomputes trims without re-measuring unchanged files.
- `npm run verify:audio` (`scripts/verify-audio.ts`, checks in `scripts/verifyAudio/`) is the behaviour gate for the director, library, credits, voices, ramped stops, scopes, captions and accessibility options. Run it after touching anything under `src/audio/` or `src/core/music/MusicLibrary.ts`.

Finish with the `dev-workflow` gates (typecheck, lint, format).
