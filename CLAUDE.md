# Emberhollow — project memory for Claude

Browser 3D action RPG (Three.js + TypeScript + Vite). Owner play-tests; Claude writes all code.
**`docs/DESIGN.md` is the source of truth** — read it before any feature work; change it only by agreement with the owner.

## Commands
- `npm install` — install
- `npm run dev` — dev server
- `npm run build` — type-check (`tsc --noEmit`, strict, `noUnusedLocals`) + Vite build
- `npm test` — build, then `scripts/smoke.mjs` drives the game in headless Chromium (port 4179). Must pass before every commit. Add checks for each new feature.
- `node scripts/smoke.mjs --shots <dir>` — also save screenshots

## Code map
- `src/config.ts` — all tuning numbers (`TUNING`, incl. `combat` and `enemies`). Change feel here, not in logic.
- `src/Game.ts` — renderer (low-res + pixelated upscale), fixed 1/60 s step; runs lock-on, player, strikes → enemies, hit-stop. `?test` URL → `game.manual = true`; `game.step(frames, input, draw)` for tests; `window.game` exposed.
- `src/core/` — `Input.ts` (keyboard/mouse/gamepad, `setVirtual` for tests), `toon.ts` (toon material + inverted-hull outline), `noise.ts`.
- `src/world/World.ts` — test map: heightmap terrain, boxes, collision queries (`heightAt`, `groundAt`, `resolveBoxes`, `terrainWall`, `isSolid`).
- `src/player/Player.ts` — state machine: ground / air / roll / climb / climbJump / mantle / glide / attack / stagger / dead; stamina; fall damage; 3-hit combo with input buffer; block/parry; `takeHit`.
- `src/combat/` — `combat.ts` (Hit, Poise + stagger thresholds, `inArc`), `Enemy.ts` (AI state machine: idle/chase/windup/active/recover/stagger/return/dead), `EnemyModel.ts` (blocky slime/boar/bandit), `Enemies.ts` (camps, strikes, separation, respawn), `LockOn.ts` (target pick + flick switch).
- `src/player/PlayerModel.ts` — placeholder blocky model with procedural poses (real Quaternius models come later).
- `src/camera/ThirdPersonCamera.ts` — orbit camera with wall pull-in; lock-on follow + shoulder offset; trauma shake.
- `src/ui/Hud.ts` — HP, stamina wheel, debug, pixel-size slider, toasts; damage numbers, enemy HP bars, lock-on reticle.

## Rules
- Original game: genre mechanics only. No names, art, music, levels or code from commercial games.
- Veloren (GPL-3.0) was studied for ideas/numbers only — never copy its code.
- Assets: CC0 only (Quaternius, KayKit, Kenney); list every one in `CREDITS.md`.
- Commit and push to `origin main` (github.com/Spinster51/emberhollow) after each verified step — the cloud container is wiped between sessions.
- Break multi-step work into small tasks; mark done only when verified.

## Status
- Milestone 1 (movement) — done.
- Milestone 2 (combat) — done: Warrior combo, block/parry, poise/stagger, lock-on, slime/boar/bandit, death/respawn, enemy respawn. 47/47 smoke checks. Awaiting owner play-test for feel tuning.
- Next: milestone 3 — loot (drops, rarities, inventory, visible gear, shared chest).

## Decisions log
- Skills: only project-relevant ones kept, stored in `.claude/skills/` (see its README for the list and sources). Other-engine and unrelated skills removed.
- Combat (M2): parry also interrupts the attacking enemy (cancels its follow-up); death drops no gold yet (gold arrives with loot in M3); campfire respawn = world spawn point until campfires exist (M5). Tests freeze enemies via `enemy.frozen`.
- Graphiti memory MCP: skipped (cloud container can't reach a hosted graph DB). This file is the project memory instead — keep Status and Decisions up to date.
