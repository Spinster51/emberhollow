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
- `src/classes/` — `classes.ts` (4 class defs: stats, combos, skills, passives; XP curve), `Progression.ts` (level, XP, attributes, tree ranks, respec), `Skills.ts` (16 skills on keys 1–4: cooldowns, mana, effects).
- `src/combat/Projectiles.ts` — mage bolts, fireball, meteor, thrown knives; area blasts. All player damage goes through `Enemies.damage()` (fire, backstab, burn, lifesteal).
- `src/ui/CharacterUI.ts` — K menu (attributes, skill tree, respec at the home's training book) and the class pick screen (`game.showClassSelect()`; skipped in `?test`, default Warrior; `game.chooseClass(id)`).
- `src/items/` — `items.ts` (slots, rarities, bases, affixes, legendary uniques, `rollItem`, `itemStats`), `Inventory.ts` (40-slot bag, equipment, gold, materials, `derive()` → player stats), `ItemMesh.ts` (3D item models with rarity glow).
- `src/loot/Loot.ts` — drops from kills (loot tables in `TUNING.enemies.loot`), rarity beams, gold/material auto-pickup, `Interactable` (E prompts).
- `src/home/Home.ts` — test home base at `world.homeSite`: house, 100-slot shared chest, weapon mounts, armour stands, trinket table.
- `src/ui/InventoryUI.ts` — I menu (equipment + bag + stats), chest and display-rack modes, comparison tooltips. `game.menuOpen` suppresses game input.
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
- Milestone 2 (combat) — done.
- Milestone 3 (loot + test home base) — done.
- Milestone 4 (classes) — done: Warrior, Tank, Mage, Assassin with own combos, 16 skills, 4×8-node trees, attributes, XP/levels 1–15, respec, class gear and drops. 101/101 smoke checks.
- Next: milestone 5 — world: full map, town (with the home base, house quest, bed, furniture), NPCs, quests, campfires, fast travel, saving (4 character slots).

## Decisions log
- Skills: only project-relevant ones kept, stored in `.claude/skills/` (see its README for the list and sources). Other-engine and unrelated skills removed.
- Combat (M2): parry also interrupts the attacking enemy (cancels its follow-up); death drops no gold yet (gold arrives with loot in M3); campfire respawn = world spawn point until campfires exist (M5). Tests freeze enemies via `enemy.frozen`.
- Home base (agreed after M2): bought in town via an early quest, expandable; shared chest, gear display racks, bed, furniture. M3 = test house (chest + racks); M5 = town house, quest, expansions, bed, decor. See DESIGN.md §10 "Home base".
- Loot (M3): no saving yet (bag, chest and displays reset on reload until M5 saves); item icons are text labels until an icon pass; attributes give a first-pass effect (Str dmg/armour, Dex crit/speed, Vit HP/stamina) to be revisited in M4; greatsword is not two-handed yet.
- Classes (M4): attributes start at 0 and come only from level-ups (5/level) and gear, so class identity is in base stats (HP, mana, crit, armour); every class has mana for skills; skills unlock at levels 1/2/4/6; weapons are class-locked (armour is shared); off-hands: shields (Warrior, Tank), tome (Mage), parrying dagger (Assassin); respec is at the home's training book (home moves into town in M5); a parry briefly opens the Tank's Riposte (1.5 s). Potions (Q/R) not built yet.
- Graphiti memory MCP: skipped (cloud container can't reach a hosted graph DB). This file is the project memory instead — keep Status and Decisions up to date.
