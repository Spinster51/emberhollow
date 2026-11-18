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
- `src/config.ts` — all tuning numbers (`TUNING`). Change feel here, not in logic.
- `src/Game.ts` — renderer (low-res + pixelated upscale), fixed 1/60 s step. `?test` URL → `game.manual = true`; `game.step(frames, input, draw)` for tests; `window.game` exposed.
- `src/core/` — `Input.ts` (keyboard/mouse/gamepad, `setVirtual` for tests), `toon.ts` (toon material + inverted-hull outline), `noise.ts`.
- `src/world/World.ts` — test map: heightmap terrain, boxes, collision queries (`heightAt`, `groundAt`, `resolveBoxes`, `terrainWall`, `isSolid`).
- `src/player/Player.ts` — movement state machine: ground / air / roll / climb / climbJump / mantle / glide; stamina; fall damage.
- `src/player/PlayerModel.ts` — placeholder blocky model with procedural poses (real Quaternius models come later).
- `src/camera/ThirdPersonCamera.ts` — orbit camera with wall pull-in.
- `src/ui/Hud.ts` — HP, stamina wheel, debug, pixel-size slider, toasts.

## Rules
- Original game: genre mechanics only. No names, art, music, levels or code from commercial games.
- Veloren (GPL-3.0) was studied for ideas/numbers only — never copy its code.
- Assets: CC0 only (Quaternius, KayKit, Kenney); list every one in `CREDITS.md`.
- Commit and push to `origin main` (github.com/Spinster51/emberhollow) after each verified step — the cloud container is wiped between sessions.
- Break multi-step work into small tasks; mark done only when verified.

## Status
- Milestone 1 (movement) — done, 20/20 smoke checks.
- Next: milestone 2 — Warrior combat, lock-on, 3 meadow enemies (slime, boar, bandit), damage and death. See DESIGN.md §11 for combat timings.

## Decisions log
- Graphiti memory MCP: skipped (cloud container can't reach a hosted graph DB). This file is the project memory instead — keep Status and Decisions up to date.
