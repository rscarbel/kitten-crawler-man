# Desperado Club — Implementation Progress

Living status log for the multi-phase Desperado Club feature. See
[desperado-club-plan.md](desperado-club-plan.md) (design) and
[desperado-club-implementation.md](desperado-club-implementation.md) (step-by-step).

## Status: Phase 1 COMPLETE ✅ · Phases 2–5 not started

---

## Phase 1 — Club Shell (done)

You can walk into the Desperado Club from town: a safe, multi-room interior with
pulsing dance-floor lights, club music, cosmetic dancers + a skeleton DJ, and the
Sledge who greets you and grants free membership on the first visit. Membership
persists across the overworld↔club scene swaps.

### Files added
- `src/core/clubLayout.ts` — single source of truth for the interior geometry
  (dimensions, dance-floor rect, divider walls, station tiles, DJ/dancer tiles).
  **Both** `GameMap.generateInterior` and `DesperadoClubSystem` import from here.
- `src/core/ClubMembership.ts` — `{ hasDesperadoPass }` progress object + factory.
- `src/systems/DesperadoClubSystem.ts` — host system (Sledge greeting/membership
  gate, station proximity prompts, dance-floor light overlay, NPC rendering).
- `src/sprites/clubNpcSprite.ts` — primitive canvas figures (Sledge/Cretin,
  skeleton DJ, dancers, station staff). Placeholder art; see Phase 5.

### Files changed (the `'club'` building type threads through here)
- `src/systems/BuildingSystem.ts` — `BuildingEntry.type` union + 🔪 menu icon.
- `src/map/OverworldGenerator.ts` — `BuildingEntry` union, `placeBuilding` param,
  and the club placement (south of the square, west wall against the N-S road,
  short connector road). Constants: `CLUB_X_OFFSET/Y_OFFSET/W/H`, `ROAD_HALF`.
- `src/map/GameMap.ts` — `buildingEntries` field union, `generateInterior` param
  union + `isClub` branch (`CLUB_INTERIOR_W/H`, `CLUB_FLOOR`) + carving block
  (dance floor + divider walls).
- `src/map/tileTypes.ts` — `CLUB_FLOOR = 54`, `DANCE_FLOOR = 55` (walkable floors,
  so no `isWalkable` blocklist change needed).
- `src/map/tiles/specialFloorTiles.ts` — static renderers for both new floors.
- `src/scenes/BuildingInteriorScene.ts` — `clubMembership` ctor param, `club`
  field, construction, and wiring: `onEnter` music, update (modal early-return +
  space interact + tick), render (objects + UI), handleClick, escHandler, touch.
- `src/scenes/DungeonScene.ts` — `clubMembership` option/field/default + threaded
  into `BuildingInteriorScene` and both `DungeonScene` reconstructions.
- `src/audio/sounds.ts` — `desperado_club` SoundId (see placeholder note below).

### Deliberate scope decisions (read before Phase 2+)
- **Exterior roof:** reuses `ROOF_SLATE` (art-deco dressed-stone look). A dedicated
  neon-knife **sprite building** is the plan's Phase 5 upgrade — a new roof tile
  touches ~7 tile-system files for a cosmetic marker, so it was deferred.
- **Dance-floor animation:** the `DANCE_FLOOR` tile is a *static* dark base; the
  pulsing coloured lights are drawn as a per-frame overlay by
  `DesperadoClubSystem.renderDanceFloorLights` because the static `TileChunkCache`
  can't animate a cached floor tile.
- **Interior layout:** open floor plan with non-sealing divider walls (never boxes
  a region off) rather than a fully-walled maze — guarantees walkability. Layout
  lives entirely in `clubLayout.ts`.
- **Music:** `desperado_club` SoundId is real and wired, but its manifest path
  currently **reuses `circus_theme.mp3`** as a placeholder. Swap for a bespoke
  1920s-jazz track in Phase 5 (no code change — just the path in `sounds.ts`).
- **Persistence:** `ClubMembership` is threaded by reference across scenes exactly
  like `circus/murder/doomsdayQuestProgress`. Those objects are **not** serialized
  to the backend save (`GameProgress` only stores snapshots + levelId), so
  membership does not survive a full page reload — matching existing quest state.
  True reload persistence would require extending `GameProgress` (out of scope,
  and it would be a shared change for all quest objects).

### Stations (Phase 1 behaviour)
`CLUB_STATIONS` in `clubLayout.ts`: sledge, bar, casino, market, mercenary, vip.
Only **sledge** does anything real (greeting → grants pass, then a welcome-back
line). The other five show a themed "coming soon" flavour modal — replace those
with real UIs as each phase lands (`STATION_COMING_SOON` map in the system).

---

## Next: Phase 2 — Bar & Market (vendors)
Generalize `ShopSystem` to be config-driven (backward-compatible with the General
Store), then attach a bartender (buff drinks) and market (club-exclusive gear) to
the `bar`/`market` stations in `DesperadoClubSystem`. See implementation §2.

## Validation
`npm run typecheck`, `npm run lint`, `npm run format`, `npm run build` all clean
as of Phase 1 completion.
