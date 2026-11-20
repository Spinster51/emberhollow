# 3D asset checklist

Every model the game needs, for the art pass (milestone 8). Tick a box when a CC0 model is found, downloaded and swapped in. Add the source and author to `CREDITS.md` at the same time.

Rules: CC0 preferred (Quaternius, KayKit, Kenney, Poly Haven); CC-BY allowed with a credit in `CREDITS.md` (personal game, agreed in M8). Poly Pizza stays off. Use glTF/GLB. Items marked *tint* share one model with a colour change.

## Items (milestone 8): weapons, off-hands, armour, jewellery
All in `public/models/items/items.glb` (426 KB: 20 models, three 256 px KayKit atlases and one 256 px JPEG) unless noted; placements in `ITEM_ART` (`src/art/assets.ts`). Every item shows its procedural model until its file loads, and keeps it if the file fails. Copies share the file's geometry and one material per (source material, rarity, tint, glow), so loot and racks stay cheap. The rarity glow is the material's emissive (0.75 of the procedural strength, so the model's colours still show). KayKit props sit in item space exactly as the pack holds them on its hand slots, so the pack's clips grip them as designed.
- [x] Sword: Rusty = KayKit Skeletons `Skeleton_Blade` (the skeletons' own `models/enemies/skeleton_blade.glb`, reused); Iron = KayKit `1H_Sword`; Emberfang = "Autumn Sword" by SimberGI (CC BY 4.0), decimated, glow baked into its colour map.
- [x] Greatsword: KayKit `2H_Sword`.
- [x] Mace: Rusty (studded round head) and Flanged, both made for the game in Blender with the KayKit palette; Ember Maul = the flanged mace tinted ember with a glow.
- [x] Staff: Oak = made for the game (gnarled shaft, amber gem); Runed = KayKit `2H_Staff`; Cinderstaff = KayKit Skeletons `Skeleton_Staff` (reused file), tinted ember with a glow.
- [x] Daggers: KayKit `Knife` (the left one turned as the pack holds its off-hand knife); Rusty = rust tint; Bloodfangs = red tint with a glow.
- [x] Parrying dagger: KayKit `1H_Sword` at 55% (a short sword with a broad guard).
- [x] Wooden shield: KayKit `Round_Shield`.
- [x] Iron shield: KayKit `Spike_Shield`, its wooden face re-mapped to the palette's dark iron.
- [x] Spell tome: KayKit `Spellbook` (closed, pages inside the covers), at the tome's own rest in the left fist. The procedural tome (while loading) has its pages inside its covers too.
- [x] Leather cap: made for the game, modelled on the KayKit head (domed leather with crossed straps, rolled brim, ear flaps); worn on the head bone (refitted over the rogue's hood like the helm).
- [x] Iron helm: KayKit `Knight_Helmet` (from `knight.glb`), on the head and, shrunk, on the ground and stands.
- [x] Padded tunic, Chainmail, Leather gloves, Gauntlets, Leather boots, Iron greaves: made for the game in Blender (KayKit palette, chunky shapes). Chest pieces still do not show on the rigged body (only on the ground and stands); gloves and boots never did.
- [x] Copper ring (Band of Thirst tinted) and Bone Charm amulet (Heartstone tinted): made for the game.
- Sketchfab had no free low-poly armour or jewellery in the KayKit style (searched: maces, armour sets); those pieces were modelled in Blender instead.

## Characters (3 models, with animations)
- [x] Player body: idle, walk, run, roll, attack, block, climb, glide, stagger, death
  - KayKit Adventurers 1.0 (CC0): one body per class (Barbarian, Knight, Mage, Rogue hooded) on one shared rig. Clips used: Idle, 2H_Melee_Idle, Walking_A, Running_A, Jump_Start, Jump_Idle, Dodge_Forward (roll), 1H/2H/Dualwield melee attacks, Spellcast_Shoot/_Raise/_Long, Throw, Cheer, Block, Blocking, Hit_A, Hit_B, Death_A. Attacks and rolls are scrubbed to the game's own timings. Climb, mantle and glide are procedural bone poses on top of Jump_Idle, because the pack has no such clips.
- [x] Villager bodies (6 NPCs) — KayKit bodies on the Adventurers rig, each with its own palette repaint (done in code on the villager's copy of the material, so the player's and bandits' textures stay as they are), hats and pack weapons left out, its parts joined into one skinned mesh at load (one draw call and one outline per body). Art per NPC in `NPC_ART` (`src/art/assets.ts`), model in `src/world/NpcModel.ts`. New files in `public/models/npcs/` (about 700 KB): `ranger.glb` and `mage_longhair.glb` (Adventurers 2.0), `npc_clips.glb` (Character Animations 1.1), `npc_props.glb` (RPG Tools Bits).
  - Elder Maren: Adventurers 2.0 Mage, no hat; long white hair, cream robe, wine cape, gold trim. Idle_B (hands behind her back).
  - Steward Ilsa: Adventurers 1.0 Rogue (`bandit.glb`); blonde, teal tunic, slate cape. Holding_B with a ledger (RPG Tools `journal_closed`).
  - Tinker Oswin: Adventurers 1.0 Knight (`knight.glb`) without helmet and cape; ginger, brass-coloured work armour. Working_A with a wrench (`wrench_A`).
  - Hunter Kael: Adventurers 2.0 Ranger; green neckerchief and cape, quiver; the pack's longbow upright at his side. Idle.
  - Scholar Vey: Adventurers 1.0 Mage (`mage.glb`) without hat; auburn hair, navy robe, brown cape. Holding_B reading the pack's open spellbook, a magnifying glass (`magnifying_glass`) in the other hand.
  - Carpenter Bram: Adventurers 1.0 Barbarian (`barbarian.glb`) without its bear hat; bald, brown beard. Hammering on a crate (the furniture file's `Crate`) with a mallet (`mallet`).
  - Conversation: the villager turns to face the player (it rests facing the square), plays Waving once, then Idle with an Interact gesture every 3 s; when the dialog closes it turns back to its role idle. Within 6 m it glances at the player (a head turn). Villagers do not walk. Within 20 m of the player (`NPC_DETAIL_RANGE`) a villager animates every frame with its outline and sun shadow; from 20 to 40 m it animates every other frame without either (the outline is under half a pixel there at the default pixel scale); past 40 m (`NPC_ANIM_RANGE`) its mixer stops. Each shows the old blocky villager until its files load, and keeps it if one fails.
- [x] Villager accessories: the props above (ledger, wrench, magnifying glass, mallet, longbow, spellbook, crate).

## Enemies (10 models, with animations)
Every enemy is fitted to its existing collider (height near `topY`); colliders, hit arcs, AI and timings are unchanged. Attack clips are scrubbed so their measured swing fills the game's active window (`ENEMY_ART` in `src/art/assets.ts`). If a file fails to load, that enemy keeps its blocky model and procedural poses. Rigs far from the player (over 60 m) only animate while awake.

Locomotion: every stride is measured from the planted soles (`Stride` in `assets.ts`), and each clip plays at the speed that matches it to the ground speed, so feet stay put at every speed the AI uses (wander, chase, return, circling). Humanoids pick walk / jog (Running_B) / run by speed, and by travel direction against their facing a strafe (Running_Strafe_Left/Right) or Walking_Backwards; the model leans into a strafe's diagonal (about 30°) and turns round to run when backing off faster than the backwards walk can show. Beasts have only forward clips and turn toward their motion. That turn is visual only and eases back to the logic facing for every attack. The slime hops (Jump) at chase speed with its base held in place while down.
- [x] Slime — Quaternius Ultimate Monsters, GreenBlob. Walk for wandering, Jump as a hop for the chase, Bite_Front for the lunge (plus a hop), HitRecieve, Death.
- [x] Boar — "Low Poly Wild Boar" by Hanabi_Map (Sketchfab, CC BY 4.0): tusks, long snout, dark brown, a crested mane stripe from forehead to tail (the file's broad flat mane patch read as a hollow from the high game camera). Skinned in Blender to the Quaternius Bull's rig (CC0) to play its clips: head-down wind-up from Attack_Headbutt, Gallop through the charge (5.2× at 12 m/s), the head toss on the recovery.
- [x] Bandit — KayKit Adventurers, Rogue with its two knives; Dualwield slice and chop for the 2-hit combo.
- [x] Wolf — Quaternius Ultimate Animated Animals, Wolf. Attack (lunge and bite), Idle_HitReact1, Death.
- [x] Spider — Quaternius Easy Enemy, Spider. Spider_Walk churns at up to 4.5× at chase speed (its own limit, 5×); Spider_Jump for the pounce; no hit clip, so it rears back procedurally.
- [x] Goblin — the KayKit Rogue at 0.75 of the bandit's size with the pack's crossbow (1H_Ranged_Shoot). Its own colours come from repainting palette cells of the pack's texture in code (green skin, leather tunic and cape, dark hair; the bandit keeps the original), plus two pointed ears on the head bone.
- [x] Skeleton (also the boss's summoned adds) — KayKit Skeletons: Skeleton_Warrior with blade and small shield; adds are Skeleton_Minion with a blade and rise with Spawn_Ground_Skeletons. Death_C_Skeletons (falls apart).
- [x] Golem — Quaternius Ultimate Monsters, Yeti, its texture turned to grey stone. Attack (two-fist slam). Its Walk swings the block feet like pendulums and sets them down briefly (stride measured from the landing sweep, 1.4); the chase walks at 1.7×.
- [x] Cultist — KayKit Skeletons, Skeleton_Mage with the pack's staff and purple eye glow; staff raised over the wind-up, Spellcast_Shoot releases the orb.
- [x] Cinder Warden (boss; the largest model) — Skeleton_Warrior at 1.75 scale with the pack's axe and ember eyes; phase 2 still smoulders. The chase jogs (Running_B, 0.9–1.1×); sweep = 1H slice horizontal, slam = 1H jump chop, charge = Running_C (2×), volley = Spellcast_Shoot, nova = Spellcast_Raise, the phase-2 roar = Spellcast_Summon.

## Projectiles and effects (optional; can stay procedural)
- [ ] Mage bolt
- [ ] Fireball
- [ ] Thrown knife
- [ ] Arrow
- [ ] Orb (boss)
- [ ] Meteor

## Loot and currency (2 models)
- [ ] Gold coin
- [ ] Material pickup (one gem or bag, tinted per material; 10 materials)

## Home base and furniture (16 models)
All in `public/models/home/furniture.glb` (about 360 KB: 16 nodes, about 9,500 triangles, one 512 px atlas made of the KayKit Dungeon Remastered, Furniture Bits and Halloween Bits palettes; normals and UVs quantized). Node names and placement in `FURNITURE_ART` / `FIXTURE_ART` (`src/art/assets.ts`). Every node is in metres with its origin at the piece's anchor and faces the way the procedural piece did, so placed furniture, saves, rack anchors, prompts and the chest collider are unchanged. Each piece shows its procedural model until the file loads and keeps it if the file fails; copies share the file's geometry and one toon material (three glow variants: the training book, the anvil, the lantern glass). The carpenter's shop and the furniture crate show a picture of each piece rendered from its model.
- [x] Table: KayKit Dungeon `table_medium`, shortened along its planks to 1.4 × 0.9 m and raised to 0.83 m.
- [x] Chair: KayKit Dungeon `chair`.
- [x] Bookshelf: case built for the game, filled with KayKit Furniture Bits `book_set` / `book_single`.
- [x] Rug: built for the game (red and gold, cream tassels).
- [x] Potted plant (fern): KayKit Furniture Bits cactus pot, taller; fronds with notched leaflets built for the game.
- [x] Standing lantern: KayKit Halloween Bits `lantern_standing` (glowing glass) on a post built for the game.
- [x] Banner: KayKit Dungeon `banner_shield_red`, crest recoloured ember, on a T-stand built for the game.
- [x] Barrel: KayKit Dungeon `barrel_small`.
- [x] Weapon mount (wall rack): built for the game (plank board, iron pegs and nails).
- [x] Bed: KayKit Dungeon `bed_frame`, blanket recoloured blue.
- [x] Training book: lectern and open glowing book built for the game.
- [x] Storage chest: KayKit Dungeon `chest`.
- [x] Display stand (armour stand): built for the game.
- [x] Trinket table: KayKit Dungeon `table_small`.
- [x] Furniture crate: KayKit Dungeon `box_small`.
- [x] Workbench: KayKit Dungeon `table_medium` as the bench; anvil, hammer and tongs built for the game (the anvil keeps its ember glow).

## World and dungeon (about 12 models)
Overworld props and environment live in `public/models/world/world.glb` (895 KB, one 512 px atlas combining the KayKit Forest Nature, Medieval Hexagon, Dungeon Remastered and Halloween Bits palettes; quantized with glTF-Transform). Every model is visual only: colliders, climbable faces, doors, prompts and saves are unchanged, and a missing file keeps the procedural boxes and cone trees without throwing.
- [x] Exploration chest: KayKit Dungeon Remastered `chest` (tier 0) and `chest_gold` (tier 1), body + hinged lid (`CHEST_ART`).
- [x] Campfire: stone ring from KayKit Forest rocks (`Rock_3_A/B/E`) + crossed logs, ash and glowing embers built for the game.
- [x] Dungeon gate: dressed stone pillars, keystone lintel and iron-bound sealed door with glowing purple/ember runes, built for the game to match the gate colliders.
- [x] Crystal (hit switch): carved rune pedestal + floating faceted shard (`CrystalPedestal` / `CrystalGem` in `public/models/dungeon/dungeon.glb`), glowing red until struck to green.
- [x] Lever: stone base + iron crank (`LeverBase` / `LeverArm` in `dungeon.glb`), tilting across when pulled for the timed gate.
- [x] Brazier: iron bowl on tripod legs with glowing embers + tall flame (`BrazierBowl` / `BrazierFlame` in `dungeon.glb`).
- [x] Pressure plate: recessed stone frame + glowing rune pad (`PlateFrame` / `PlatePad` in `dungeon.glb`) that sinks and brightens when weighted.
- [x] Push block: heavy banded monolith (`PushBlock` in `dungeon.glb`) matching the 2 m push-block collider.
- [x] Locked door: four sliding doors (`DoorPlate`, `DoorCrystal`, `DoorLock`, `DoorTimed` in `dungeon.glb`) with stone slab + rune/key/chain motifs.
- [x] Key chest: gilded KayKit Dungeon `chest_gold` reused from `world.glb` (`ChestGoldBody` / `ChestGoldLid`), hinging open when looted.
- [x] Rune (block reset): circular glowing floor seal (`ResetRune` in `dungeon.glb`).
- [x] Ember Vault architecture & dressing (`public/models/dungeon/dungeon.glb`, 503 KB, one 256 px KayKit Dungeon palette atlas, quantized with glTF-Transform; reused `world.glb` banners/barrels/crates/rubble/candles/bones/skulls): KayKit Dungeon Remastered floors, walls (`wall`, `wall_arched`, `wall_cracked`, `wall_pillar`), pillars, archway lintels, railings (`barrier`), entry stairs (`stairs_walled`), ceiling slabs/beams, `ExitPortal`, wall torches (`torch_mounted`), and ceiling chains (`ChainHang`), merged per room in `src/world/Dungeon.ts` via `src/world/kit.ts` with open-doorway room culling and instanced dressing.
- [x] Town house & home shell: timber-frame building kit built for the game on the KayKit Medieval Hexagon palette (plaster, stone footing, corner/panel posts, beams, windows, doors, wall lamps, shingled roofs and ridge), merged per building group in `src/world/kit.ts` and `src/home/Home.ts`. Also town well (`Well`), lamp posts (`post_lantern`), benches (`bench`), crates, barrels, sacks and buckets.
- [x] Glider: arched red-and-gold cloth wing on wooden spars, built for the game (`Glider` in `world.glb`).

## Environment
- [x] Trees, bushes, grass and rocks: KayKit Forest Nature Pack (CC0), all instanced in `src/world/Vegetation.ts` with 24 m spatial grid, near full-detail pools, view-cone far LOD pools, LOD shadow proxies on a shadow-only layer, and camera-to-player occlusion hiding. Sunmeadow (broadleaf), Gloamwood (pines, thinned with glades), Sundered Ruins (bare & autumn trees), plus region-tinted terrain strata and spire-foot crags.
- [x] Ruins and enemy camps: KayKit Dungeon Remastered `wall` (recoloured to sandstone) + square column kit built for the game; enemy camp dressing (A-frame tents, crates, barrels, fences, flags, banners, gravestones, shrines, bones, rubble) merged per camp and distance-culled in `src/world/Scenery.ts`.

## Not needed yet
- Health and mana potions (Q/R), added in milestone 7.
