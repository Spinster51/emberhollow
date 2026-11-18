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
- `src/world/layouts.ts` — `TEST_LAYOUT` (small test map, used by `?test`) and `MAIN_LAYOUT` (600 m world: town Emberhollow, Sunmeadow 1–5, Gloamwood 5–10, Sundered Ruins 10–15, roads, spires, camps, campfires, chests, dungeon gate). `?test&world=main` loads the main map in tests.
- `src/world/World.ts` — heightmap terrain from a layout (50 m chunks, heightmap normals), boxes with a 16 m spatial grid, collision queries (`heightAt`, `groundAt`, `resolveBoxes`, `terrainWall`, `isSolid`), `regionAt`, `addSolid`/`removeSolid`.
- `src/world/` also: `Campfires.ts`, `Chests.ts`, `Town.ts` (NPCs, talk, furniture shop), `quests.ts` (13 quests + `QuestLog`).
- `src/world/Dungeon.ts` — the Ember Vault (M6): rooms built from boxes high above the NW corner (`VAULT`, y = 300, so nothing outside can see or aggro it), doors (colliders via `world.addCollider/removeCollider`), push block + plate, crystal hit-switch (`strike`, `projectileHit`), key chest + locked door, timed lever, brazier, exits; `save()/load()`. Boxes have `noClimb` and `zone: 'dungeon'`.
- `src/game/Adventure.ts` — M5 glue: campfire rest/fast travel, chests, quests turn-in, lost gold on death, regions + autosave, furniture placement, save slots (serialize/apply).
- `src/save/Save.ts` — IndexedDB account save (shared home + 4 slots), validate, export/import JSON.
- `src/ui/` also: `Dialog.ts` (talk/menu box), `StartPage.ts` (title start page: New game, Continue, Load, Settings, Import), `SlotSelect.ts` (slot list opened from Load / a full New game), `MapView.ts` (minimap, M map, quest tracker).
- `src/player/Player.ts` — state machine: ground / air / roll / climb / climbJump / mantle / glide / attack / stagger / dead; stamina; fall damage; 3-hit combo with input buffer; block/parry; `takeHit`.
- `src/combat/` — `combat.ts` (Hit, Poise + stagger thresholds, `inArc`), `Enemy.ts` (AI state machine: idle/chase/windup/active/recover/stagger/return/dead/phase; boss moves `BOSS_MOVES`, phase 2, summoned adds), `EnemyModel.ts` (blocky slime/boar/bandit), `Enemies.ts` (camps, strikes, separation, respawn), `LockOn.ts` (target pick + flick switch).
- `src/player/PlayerModel.ts` — KayKit rigged body per class (clips mapped from Player states; attacks/roll scrubbed to game timings; climb/mantle/glide/block guard are procedural bone aims); gear holders mount on hand/head bones. Falls back to the old blocky model (with its procedural poses) if a model fails to load.
- `src/core/models.ts` — glTF loader with a promise cache, `cloneModel` (SkeletonUtils), `cloneNode`, `modelsSettled`; converts materials to toon + skinned outlines. `src/core/rig.ts` — `Rig`: mixer, `play`/`scrub` (fades out every mixed-in clip, frozen ones too), `turn`/`aim` bone overrides, restores hand-posed bones each frame; `node()` accepts glTF names with dots (GLTFLoader strips them). `src/art/assets.ts` — art manifest: model paths, class→body, bone names, attack/skill clip maps with measured swing windows.
- `src/classes/` — `classes.ts` (4 class defs: stats, combos, skills, passives; XP curve), `Progression.ts` (level, XP, attributes, tree ranks, respec), `Skills.ts` (16 skills on keys 1–4: cooldowns, mana, effects).
- `src/combat/Projectiles.ts` — mage bolts, fireball, meteor, thrown knives; area blasts. All player damage goes through `Enemies.damage()` (fire, backstab, burn, lifesteal).
- `src/ui/CharacterUI.ts` — K menu (attributes, skill tree, respec at the home's training book) and the class pick screen (`game.showClassSelect()`; skipped in `?test`, default Warrior; `game.chooseClass(id)`).
- `src/items/` — `items.ts` (slots, rarities, bases, affixes, legendary uniques, `rollItem`, `itemStats`, `refreshName`, `rerollAffix`), `crafting.ts` (salvage, upgrade +1..+10, re-roll: costs and rules), `Inventory.ts` (40-slot bag, equipment, gold, materials, `derive()` → player stats), `ItemMesh.ts` (3D item models with rarity glow).
- `src/core/settings.ts` — saved settings (volume, mute, quality, pixel scale) in one localStorage record. `src/core/sound.ts` — WebAudio sound effects (`sound.play(name)`), no audio files. `src/ui/SettingsUI.ts` — the O panel.
- `src/loot/Loot.ts` — drops from kills (loot tables in `TUNING.enemies.loot`), rarity beams, gold/material auto-pickup, `Interactable` (E prompts).
- `src/home/Home.ts` — home base at `world.homeSite`: locked until bought (main map), back room (expansion), shared chest, mounts, stands, trinket table, bed, training book, furniture crate, placed furniture; `save()`/`load()`. `furniture.ts` = catalogue + models.
- `src/ui/InventoryUI.ts` — I menu (equipment + bag + stats), chest and display-rack modes, comparison tooltips. `game.menuOpen` suppresses game input.
- `src/camera/ThirdPersonCamera.ts` — orbit camera with wall pull-in; lock-on follow + shoulder offset; trauma shake.
- `src/ui/Hud.ts` — HP, stamina wheel, debug, pixel-size slider, toasts; damage numbers, enemy HP bars, lock-on reticle.

## Rules
- Original game: genre mechanics only. No names, art, music, levels or code from commercial games.
- Veloren (GPL-3.0) was studied for ideas/numbers only — never copy its code.
- Assets: CC0 preferred (KayKit, Quaternius, Kenney, Poly Haven); CC-BY allowed with credit (owner, M8: personal game). Source extra models through the Blender MCP (Poly Haven, Sketchfab; Poly Pizza stays off). List every model with author, URL and licence in `CREDITS.md`.
- Multi-agent work: the main session plans and reviews; subagents do the work. Haiku for read-only file scans, one subagent per category, and state each subagent's model and task before launching. Only one agent at a time may use the repo's test port (4179) or Blender.
- Commit and push to `origin main` (github.com/Spinster51/emberhollow) after each verified step — the cloud container is wiped between sessions.
- Break multi-step work into small tasks; mark done only when verified.

## Status
- Milestone 1 (movement) — done.
- Milestone 2 (combat) — done.
- Milestone 3 (loot + test home base) — done.
- Milestone 4 (classes) — done.
- Milestone 5 (world) — done: 600 m map with 3 regions + town, 6 new enemy kinds (57 enemies), 7 campfires, 10 chests, 6 villagers, 12 quests (house, glider, story hook), furniture, bed, expansion, IndexedDB saves with 4 slots, minimap and map.
- Milestone 6 (dungeon) — done: the Ember Vault (6 rooms, plate + push block, crystal hit-switch, key + locked door, timed lever, brazier), the 2-phase Cinder Warden with its own loot, quest "Embers Below". 149/149 smoke checks.
- Milestone 7 (crafting and polish) — done: workbench in the home (salvage, +1..+10 upgrades, re-roll), synthesised sound with volume and mute, settings panel (O) with Low/Medium/High graphics presets, GitHub Pages workflow. Balance is a paper pass only; it needs play-testing.
- Milestone 8 prelude (start page) — done: title start page as the first screen; HUD, minimap and tracker hidden until a character is in play (`Game.setPlaying`). Smoke checks for the start page and HUD.
- Milestone 8 (art pass) — in progress. Done: loader + rig + player bodies (KayKit, 4 classes, pack helmet for helm items, shield guard while blocking), 190/190 smoke checks. Next categories, one commit each: enemies + boss + adds, items/weapons, furniture/home, town NPCs, world props/dungeon/environment; then re-tune reach in TUNING from screenshots.

## Decisions log
- Skills: only project-relevant ones kept, stored in `.claude/skills/` (see its README for the list and sources). Other-engine and unrelated skills removed.
- Combat (M2): parry also interrupts the attacking enemy (cancels its follow-up); death drops no gold yet (gold arrives with loot in M3); campfire respawn = world spawn point until campfires exist (M5). Tests freeze enemies via `enemy.frozen`.
- Home base (agreed after M2): bought in town via an early quest, expandable; shared chest, gear display racks, bed, furniture. M3 = test house (chest + racks); M5 = town house, quest, expansions, bed, decor. See DESIGN.md §10 "Home base".
- Loot (M3): no saving yet (bag, chest and displays reset on reload until M5 saves); item icons are text labels until an icon pass; attributes give a first-pass effect (Str dmg/armour, Dex crit/speed, Vit HP/stamina) to be revisited in M4; greatsword is not two-handed yet.
- Classes (M4): attributes start at 0 and come only from level-ups (5/level) and gear, so class identity is in base stats (HP, mana, crit, armour); every class has mana for skills; skills unlock at levels 1/2/4/6; weapons are class-locked (armour is shared); off-hands: shields (Warrior, Tank), tome (Mage), parrying dagger (Assassin); respec is at the home's training book (home moves into town in M5); a parry briefly opens the Tank's Riposte (1.5 s). Potions (Q/R) not built yet.
- World (M5): the home, its furniture, displays and the storage chest are account-wide (shared by all 4 slots); quests, campfires found, chests opened and the glider are per character. Death drops 20% of carried gold where you fell (never expires). Resting at a campfire resets all enemies. Region/place/NPC/quest names are original. Gear from the main map needs level = item level − 1.
- Dungeon (M6): the vault is part of the main World (high above the NW corner) rather than a separate scene, so every system keeps one world. Enemies only aggro within 6 m of height, so ground and vault enemies never mix. Dungeon enemies respawn like camps; the boss too (re-fightable). Pushing the block is an E action (one 2 m step) rather than walking into it. A rune resets it. Phase-2 skeleton adds vanish when they die or when the boss resets.
- Art pass (agreed after M5): build milestones 6–7 first, then a new milestone 8 replaces the placeholder models with CC0 low-poly glTF (three.js loads glTF/GLB natively).
- Crafting (M7): the workbench sits in the home (front-left). Salvage gives the slot's material: weapon → Golem Core, helmet/chest → Boar Hide, offhand → Old Bone, gloves/boots → Bandit Cloth, ring/amulet → Spider Silk. Yield by rarity: 1/2/3/5/8. Upgrade to +N costs 10·N² gold, ceil(N/2) slot material, and from +8 one Warden Ember each; each +1 multiplies positive stats by 8% (`TUNING.crafting`). Re-roll costs 2 Cult Ash and 25 gold per item level; it replaces one affix with one the slot can roll and that the item lacks. Gel, Wolf Fang and Goblin Feather have no craft use yet (open: sell or vendor use).
- Balance (M7, on paper): one weapon to +10 needs 30 Golem Cores and 3,850 gold in total; three Warden Embers from +8; a re-roll is about 3 cultist kills. Golems drop a core on 90% of kills, so weapons are gated on golems. Tune in play-tests, all in `TUNING.crafting`.
- Sound (M7): every effect is synthesised in WebAudio, so there is nothing to credit. Hooks: combat results (`Game.playEvents`), swing on a landed strike, loot feed, level-up (jumps of 1–2 levels only, so a loaded save is silent), roll and death transitions, chest open, workbench.
- Settings (M7): one localStorage record (`emberhollow.settings`), read with try/catch. Quality changes sun shadows only (Low off, Medium 1024 map, High 2048). The HUD pixel slider moved into the O panel.
- GitHub Pages (M7): `.github/workflows/pages.yml` builds on every push to main and deploys `dist`; `base: './'` keeps it working under `/emberhollow/`. `enablement: true` turns Pages on the first time.
- Start page (M8 prelude): the first screen. New game takes the first empty slot; if all four are full it opens the slot list with Overwrite (confirmed, never silent). Continue loads `account.lastSlot` (saved with the account in IndexedDB, set on every save and play), falling back to the first used slot (`continueSlot`); disabled with a hint when there is no save. Load opens the slot list (Back returns). Settings opens the O panel, which works without a character. Import reads a save file and lists the slots.
- HUD on title (M8 prelude bug): the HUD, minimap and tracker drew over the slot list because nothing tied them to game state and they paint after the overlay. Fix: `Game.setPlaying` toggles a `title` class on the HUD root; CSS hides every child except `.classpick` and `.settings-panel`. `?test` calls `setPlaying(true)`.
- Art pass, player (M8): KayKit Adventurers 1.0 (CC0) instead of Quaternius (DESIGN.md §4): one shared 41-joint rig, four bodies that fit the classes (Warrior = Barbarian, Tank = Knight, Mage = Mage, Assassin = Rogue hooded), weapons included. Clips live in `knight.glb` (33 kept, trimmed with glTF-Transform; 2.3 MB for all four). Game timings rule: attack and roll clips are frozen and scrubbed, with the clip's measured swing window stretched over `attackTimes()`. The pack's Dodge_Forward is a lunge, so the roll adds a procedural flip. Equipped items are still the game's own models (items get their own category); helm items use the pack's `Knight_Helmet`, caps keep the box; chest items are hidden on the rig (still equipped). Owner approved the look ("go on with ur recommendation"). Licences: CC-BY is allowed with credit (personal game); Poly Pizza stays off. Playwright is installed locally with `npm i --no-save playwright` + `npx playwright install chromium`; the smoke test starts vite preview with node (not npx) so it runs on Windows.
- Art pass, enemy plan (M8, research): KayKit Skeletons share the Adventurers rig → skeleton, boss adds, cultist (Skeleton_Mage), Cinder Warden (enlarged Skeleton_Warrior, ember tint); bandit/goblin = KayKit Rogue variants; Quaternius (CC0, Google Drive): Wolf, GreenBlob/Slime, Spider (FBX → convert), Yeti as golem (grey), Bull as boar (dark). No CC0 boar/golem with attacks; CC-BY Sketchfab fallbacks: "Boar" by polynudj, "Lava Golem" by lucasctnh. Slime and spider lack hit clips → procedural flinch.
- Graphiti memory MCP: skipped (cloud container can't reach a hosted graph DB). This file is the project memory instead — keep Status and Decisions up to date.
