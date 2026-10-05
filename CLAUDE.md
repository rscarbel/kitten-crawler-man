# CLAUDE.md

## Agent Configuration

Sub-agents should be used liberally for parallelizable work: running checks, exploring code, researching before implementing.

## Type Safety

Type safety is the highest priority in this codebase. The tsconfig has strict mode and every strict flag enabled — honor that rigorously.

- **No type casting.** Do not use `as` to cast types. If the type system disagrees with you, fix the types or restructure the code so the types flow naturally. The only acceptable exception is `as const`.
- **No non-null assertions.** Never use the `!` (bang) operator. Handle `null`/`undefined` explicitly with narrowing, nullish coalescing (`??`), or optional chaining (`?.`).
- **No `any`.** The linter already enforces `@typescript-eslint/no-explicit-any` as an error — never circumvent it. Use `unknown` and narrow, or use proper generics.
- **Use type utilities.** Prefer `Partial`, `Required`, `Pick`, `Omit`, `Record`, `Extract`, `Exclude`, `NonNullable`, `ReturnType`, `Parameters`, etc. over hand-rolling equivalent types.
- **Infer where possible.** Let TypeScript infer return types and variable types when the inference is clear. Add explicit annotations when inference is ambiguous or at module boundaries.

- if you discover a case of a violation of any of these rules, consider it in-scope to fix it, even if it is a pre-existing violation

## Canvas UI Utilities

Read the `add-ui` skill before touching any menu, dialog, HUD element or on-screen text. In short:

- **Surfaces** — anything on screen that takes input or hides the world is a `Surface` (`src/ui/core/UiRoot.ts`) mounted once on the scene's `UiRoot`. Its band and open order decide draw order, which press reaches it, where Escape goes, keyboard focus and whether the world halts. Never add a click chain, overlay flag or Escape branch; world taps arrive only through the scene's `handleWorldPointer`.
- **Widgets** — `src/ui/widgets/` (`text`, `button`, `iconButton`, `panel`, `scrollView`, `tabs`, `listRow`, `card`, `meter`, `itemSlot`, `choiceModal`, `pagedOverlay`, …) draw and register their hit region in one call. A menu is a `panel` with a width token (`sm`/`md`/`lg`/`xl`) filled with widgets; phones get a bottom sheet automatically.
- **Theme** — every colour, font, size, radius, spacing and duration comes from `src/ui/theme/tokens.ts` and the skins in `skins.ts`. A new look is a new skin or token, never an inline literal. Branch on `ui.size` / `ui.density`, never on platform.
- **World painters** — text, bars and plates painted into the game world use `src/ui/world/` (`worldText`, `worldBar`, `worldPlate`, `worldTint`) styled from `theme/worldInk.ts`. Raw `ctx` calls are fine only for game-world art (sprites, particles, geometry), never for UI chrome.

`npm run check:ui-style` (part of `npm run lint`) fails on colour literals, font strings, direct `fillText`/`strokeText` and platform branches in UI code; `npm run verify:ui-input` is the click-through gate; `npm run render:ui-gallery` renders every widget and screen for review — open the PNGs.

## Code Clarity

**Comments explain _why_, never _what_.** Well-named identifiers already say what code does — a comment restating that is noise. Only write a comment when something would surprise a reader: a hidden constraint, a subtle invariant, a non-obvious workaround, or a reason that can't be inferred from the names alone. If removing a comment wouldn't confuse a future reader, don't write it. When you encounter a pre-existing "what" comment while editing, remove it.

**JSDoc is an exception.** Public functions and types benefit from JSDoc when it adds meaning beyond the signature — keep and write these freely.

**A comment must make sense to a reader who was never in the conversation that produced it.** Much of this codebase is written by AI agents mid-task, and agents default to narrating their own edit rather than describing the code: "now uses X instead of Y", "fixed to handle Z", "changed from the old approach", "per the user's request", "this used to be broken because...". That framing only makes sense relative to a prior state the reader can't see and doesn't care about — the code's current behavior is the only thing that exists. Never write a comment that references a previous version of the code, a prior conversation, a task, or an agent's own change. If the comment has a real "why" underneath the narration, keep only that why, stated as a fact about the code as it stands. Any reviewing agent must treat a comment of this kind as in-scope to fix, regardless of who wrote it or when.

**Prefer named variables over comments and over terse one-liners.** If an expression is complex or its intent is unclear, extract it into a well-named variable rather than explaining it with a comment. Even if the variable doesn't affect performance and a one-liner would work, prefer the named variable when it makes the purpose obvious to a reader. More lines of obviously clear code is better than fewer lines of opaque code.

**Never cite a plan or a line number — in a comment or in a document.** Planning docs under `docs/` that describe work to be done are scaffolding for agents: once the work ships, the plan is deleted. A comment saying "see the swine plan", "per phase 3 of the difficulty plan", "§4 of the redesign doc", or "the art brief calls for four tusks" is guaranteed to rot — as is a bare label like "P2" whose only antecedent is a document.

Line-number references (`see Mob.ts:412`, "the check on line 88") rot on the _next edit to that file_, which makes them the most fragile pointer available and the one most likely to be silently wrong when read. This applies with full force to plan documents, which are written to be executed by an agent that will trust what they say: a plan citing `Foo.ts:317` sends that agent to whatever happens to sit on line 317 that day. Point at a file, a function, a class, a constant, or a distinctive quoted fragment of the code — those survive edits, and they can be found by grep. If the reason lives only in a plan, write the reason itself into the comment instead of pointing at the document.

Exactly four docs are durable references describing the shipped system, and those may be cited by filename: `docs/town.md`, `docs/over-city-reference.md`, `docs/asset-management.md`, `docs/difficulty-fairness-rules.md`. Every other file in `docs/` is a plan and must never be cited from code, from a skill, or from another doc.

**No magic numbers.** Every numeric literal whose meaning isn't self-evident must be extracted into a named constant. This codebase accumulates lots of numbers (frame counts, tile sizes, damage values, pixel offsets, timers) — unnamed literals make them all look the same and make future changes brittle. When you encounter a pre-existing magic number while editing, refactor it into a named constant as part of that edit. Name the constant after what the number _means_, not what it _is_ (e.g. `TONGUE_STRIKE_FRAMES = 18`, not `FRAMES_18`).

## Validation Gates

Before considering work complete, **both checks must pass**:

1. **Typecheck:** `npm run typecheck` — must exit 0 with no errors.
2. **Lint:** `npm run lint` — must exit 0 with no errors.

Run these after making changes. If any gate fails, fix the issue before proceeding. Do not skip or ignore failures.

In addition to the checks, make sure the code has been formatted: `npm run format`
