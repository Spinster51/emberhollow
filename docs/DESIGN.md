# Emberhollow — Design Document

Source of truth for the game. Agreed with the owner in a grilling session; change it only by agreement.

## 1. Pitch
A browser-based, single-player, third-person action RPG with a chunky "3D pixel-art" look. You pick one of four classes, explore an open world by running, climbing and gliding, and grind enemies, bosses and hidden chests for better gear. The game is original: genre mechanics only, no names, characters, art, music or levels from any existing game.

## 2. Scope of the first release (playable slice)
- One open world: a central town and 3 regions, plus one dungeon with a 2-phase boss.
- All 4 classes, the full loot → craft → upgrade loop, level cap 15.
- About 3–5 h to beat the boss, 10+ h to chase legendaries.

## 3. Platform and tech
| Item | Decision |
|---|---|
| Engine | Three.js + TypeScript, built with Vite. All code written by Claude; owner play-tests. |
| Target | Desktop Chrome, Edge, Firefox. 60 fps on a mid-range laptop with integrated graphics. |
| Graphics presets | Low / Medium / High. |
| Input | Keyboard + mouse (pointer lock) and gamepad. Rebindable keys later. |
| Saves | IndexedDB in the browser, export/import of save files. 4 character slots. Autosave at campfires, on region change, and every 2 min. |
| Hosting | GitHub repo `emberhollow` (Spinster51), published to GitHub Pages on every push. |
| Multiplayer | None. |

## 4. Look and sound
- Chunky 3D pixel art: render at a fraction of screen resolution and upscale with nearest-neighbour. Settings slider, default ½ (⅓ = very chunky). Toon lighting and outlines.
- Assets (all CC0):
  - Characters and animations: Quaternius characters + Universal Animation Library (vols 1–2). Real climb animations; if no glide animation exists, reuse a hang/fall animation held under the glider.
  - Weapons/armour pieces: Quaternius modular parts.
  - Dungeon and props: KayKit (Dungeon, Skeletons). Nature: Kenney.
  - Sound: Kenney audio packs. Music: CC0 loops from OpenGameArt — one per region, town, dungeon and boss.

## 5. Camera and controls
- Full third-person camera behind the player, orbited with the mouse / right stick, with zoom.
- Lock-on: Tab / middle mouse / left trigger. Keeps the target framed; circle-strafe; flick to the next target. Without lock-on, attacks go where the camera faces; the mage gets a crosshair.

| Action | Keyboard / mouse |
|---|---|
| Move | WASD (camera-relative) |
| Look | Mouse |
| Attack | Left click |
| Block (Tank) / Aim (Mage) | Right click |
| Lock-on | Tab / middle click |
| Jump / climb-jump / open-close glider | Space (on a wall, S + Space jumps off) |
| Dodge-roll | Shift tap |
| Sprint | Shift hold |
| Skills | 1–4 |
| Health / mana potion | Q / R |
| Interact | E |
| Inventory / skills / map | I / K / M |

Gamepad uses the usual layout for the same actions.

## 6. Movement
Walk, sprint, dodge-roll, jump, climb, glide.

### Stamina
One stamina wheel used by sprint, dodge, climb and glide. Refills when on the ground and not spending. Empty mid-climb = you let go; empty mid-glide = the glider closes. Max stamina grows with Vitality and the random gear stat "+Stamina".

### Climbing (almost anything)
Terrain, rocks, cliffs and building walls are climbable. Only dungeon walls and the world edge are not.
Techniques studied from Veloren (GPL-3.0 — ideas and numbers only, our own code):
- **Start:** touching a wall, in the air or pushing into it, input pointing into the wall, stamina > 0. Detect the wall with a short raycast/shape-cast along the movement direction and use the hit normal.
- **While climbing:** cancel gravity so the player hangs still; project input onto the wall plane (up/down + sideways); keep a small push into the wall so the player sticks; turn to face the wall.
- **Stamina:** a small drain while hanging still (~1/s), a larger drain climbing up (~15/s at full input), sideways in between, almost nothing climbing down. Tune in play-tests.
- **Leave:** no wall under you, landing, stamina empty, or jump. Jumping off a wall pushes you away from it along the look direction.
- **Top-out (our addition — Veloren has none):** when the wall ends near the top of the body, play a mantle and place the player on the ledge.
- **Animation:** use the real climb animation, with playback speed driven by climb speed.

### Gliding
- Unlocked by an early town quest (~20–30 min in, after the meadow).
- Open with jump while in the air; closes on landing, in water, when hit hard, or when stamina runs out.
- **Model (our choice):** a simple arcade glide, not a full aerodynamics sim. Constant forward speed (~8 m/s), capped sink rate (~2 m/s), steer with WASD relative to the camera, turn smoothly, bank the body into turns. Hitting a wall while gliding switches to climbing.
- **Stamina:** gliding drains stamina steadily (~6/s) — a deliberate difference from Veloren, where gliding is free — so gear "+Stamina" extends glide range.
- Learned from Veloren: when touching a wall during a glide, hand off to climb; land automatically when on the ground and slow; tilt the body with turning and speed.
- Updraft zones (campfire smoke, cliffs) can be added later as a fun extra.

### Falls
Fall damage from high drops without gliding: none below ~5 m, a 20 m drop costs about 60 HP, ~30 m+ is lethal.

## 7. World
- About 600 × 600 m, one seamless map streamed in chunks, distance fog.
- Built from small heightmap and region-colour images plus a data file of trees, rocks, camps and chests (with some random scatter).
- Layout: town in the middle; Meadow (levels 1–5), Forest (5–10), Ruins (10–15). The dungeon entrance is in the Ruins.
- Campfires: rest point, respawn point, fast travel.
- Exploration rewards: chests on cliff-tops, ledges and islands reachable only by gliding — better loot, materials, occasional guaranteed rare.
- Enemy respawn: camps respawn a few minutes after being cleared once you are out of sight; resting at a campfire resets the world.
- Fixed region levels (no level scaling).

### Enemies (draft)
| Region | Enemies |
|---|---|
| Meadow | Slimes, boars, bandits |
| Forest | Wolves, spiders, goblin archers |
| Ruins | Skeletons, golems, cultist casters |
| Dungeon | Mix + a 2-phase boss with its own loot table, re-fightable |

Each enemy family drops its own crafting material.

### Dungeon
A separate interior map entered through a door. Puzzles any class can solve: keys and locked doors, pressure plates, push blocks, timed levers, hit-switches.

## 8. Classes
Class is permanent per character.

| Class | Weapon | Identity |
|---|---|---|
| Warrior | Sword / greatsword | Balanced melee, combos, a charge. Easiest. |
| Tank | Shield + mace | Blocking and parrying build a meter for big counter-attacks; a taunt that slows enemies. Built to be fun solo. |
| Mage | Staff | Projectiles, area spells, blink, mana management. Fragile. |
| Assassin | Daggers | Fast, lots of dodging, bonus damage from behind, short stealth, crits. |

Each class: 4 active skills + a skill tree.

## 9. Character progression
- Levels 1–15. Levels give skill points and attribute points; gear gives most of your power (~70% gear, ~30% level).
- Attributes: 5 points per level.
  - **Strength** — melee damage, some armour
  - **Intelligence** — spell damage, mana
  - **Dexterity** — crit chance, attack speed, dodge
  - **Vitality** — HP, regen, stamina
- Respec in town for gold.
- Gear needs a minimum level, never minimum attributes.

## 10. Gear and loot
- 8 slots: weapon, off-hand, helmet, chest, gloves, boots, ring, amulet.
- 5 rarities: common, uncommon, rare, epic, legendary. Higher rarity = more random affixes; legendaries have a unique effect.
- Random affixes include +attributes, damage, armour, HP, crit, attack speed, move speed, cooldown reduction, elemental damage/resistance, +Stamina.
- Visible gear: weapon, off-hand, helmet and chest show on the character; rarity adds a glow.
- Drops show a light beam in the rarity colour.
- Tooltips compare against equipped gear (↑/↓).

### Crafting
- Salvage gear into materials.
- Upgrade +1 to +10 with materials and gold; always succeeds, cost rises each level.
- Re-roll one random affix.

### Inventory
40-slot bag; 100-slot shared chest in town, usable by all characters.

## 11. Combat
Real-time action: attacks with wind-up / active / recovery, dodge-roll with invulnerability frames, block and parry, lock-on. Starting numbers below come from studying Veloren; tune in play-tests.

- **Attack phases:** each strike has a wind-up, a swing (the hit lands at a set point in the swing, once per strike) and a recovery. Attack speed shortens all three.
- **Combos:** pressing attack during the swing chains straight into the next strike and skips recovery; otherwise the recovery plays. Each strike in a combo costs a little stamina; the combo ends when you run out.
- **Input buffering:** presses are queued briefly so a button tapped slightly early still fires.
- **Dodge-roll:** ~0.05 s start, ~0.36 s roll, ~0.125 s recovery. Invulnerable during the start and roll (~0.4 s), not the recovery. Fast at the start, slowing down. Costs stamina (about 10); rolling out of an attack's wind-up or recovery costs more. You cannot roll during the swing itself. Jump can cancel the roll's recovery.
- **Block (Tank, others weakly):** hold to block in a 90° cone in front; slows movement to ~40%. Blocked damage is reduced by the shield's block strength.
- **Parry:** a short window at the start of a block fully cancels a hit and fills the Tank's counter meter; the Tank's riposte only fires after a successful parry.
- **Stagger (poise):** enemies and the player have poise. Hits drain it; past thresholds the target is interrupted (~0.2 s), stunned (~0.35 s), dazed (~0.75 s) or knocked down (~1.5 s). Poise refills after a stagger, with a ~1 s grace period so you can't stun-lock. Staggered targets take bonus damage.

### Death
Respawn at the last campfire; drop some gold where you died, recoverable.

## 12. HUD and UI
HP and mana bars, stamina wheel, skill bar with cooldowns, minimap, floating damage numbers (bigger for crits), rarity loot beams, comparison tooltips. Menus: inventory, skill tree, map, settings (graphics preset, pixel scale, controls).

## 13. Story
Light: a few townspeople, simple kill/collect quests, the glider quest, and a reason to beat the dungeon boss.

## 14. Build order (each milestone is playable)
1. **Moving around:** third-person camera, terrain, walk/sprint/jump/dodge, climb and glide, stamina — in a test map.
2. **Combat:** Warrior, lock-on, 3 meadow enemies, damage and death.
3. **Loot:** drops, rarities, inventory, visible gear, the shared chest.
4. **Classes:** all 4 classes, skills, skill trees, attributes.
5. **World:** full map, town, NPCs, quests, campfires, fast travel, saving.
6. **Dungeon:** puzzles and the 2-phase boss.
7. **Crafting and polish:** crafting, sound, menus, graphics presets, balance, GitHub Pages deploy.

## 15. Reference and licensing rules
- Studied for ideas only: Veloren (GPL-3.0). No code copied.
- No assets, code or data taken from commercial games.
- Only CC0 (or similarly free) assets; credit list kept in `CREDITS.md`.
