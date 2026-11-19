# 3D asset checklist

Every model the game needs, for the art pass (milestone 8). Tick a box when a CC0 model is found, downloaded and swapped in. Add the source and author to `CREDITS.md` at the same time.

Rules: CC0 preferred (Quaternius, KayKit, Kenney, Poly Haven); CC-BY allowed with a credit in `CREDITS.md` (personal game, agreed in M8). Poly Pizza stays off. Use glTF/GLB. Items marked *tint* share one model with a colour change.

## Weapons (6 models)
- [ ] Sword (Rusty, Iron; Emberfang uses a tint)
- [ ] Greatsword
- [ ] Mace (Rusty, Flanged)
- [ ] Staff (Oak, Runed; Cinderstaff uses a tint)
- [ ] Daggers pair (Rusty, Steel; Bloodfangs uses a tint)
- [ ] Parrying dagger

## Off-hand (3 models)
- [ ] Wooden shield
- [ ] Iron shield
- [ ] Spell tome

## Armour (8 models)
- [ ] Leather cap
- [ ] Iron helm
- [ ] Padded tunic
- [ ] Chainmail
- [ ] Leather gloves
- [ ] Gauntlets
- [ ] Leather boots
- [ ] Iron greaves

## Jewellery (2 models)
- [ ] Ring
- [ ] Amulet (Bone Charm)

## Characters (3 models, with animations)
- [x] Player body: idle, walk, run, roll, attack, block, climb, glide, stagger, death
  - KayKit Adventurers 1.0 (CC0): one body per class (Barbarian, Knight, Mage, Rogue hooded) on one shared rig. Clips used: Idle, 2H_Melee_Idle, Walking_A, Running_A, Jump_Start, Jump_Idle, Dodge_Forward (roll), 1H/2H/Dualwield melee attacks, Spellcast_Shoot/_Raise/_Long, Throw, Cheer, Block, Blocking, Hit_A, Hit_B, Death_A. Attacks and rolls are scrubbed to the game's own timings. Climb, mantle and glide are procedural bone poses on top of Jump_Idle, because the pack has no such clips.
- [ ] Villager body (recoloured for 6 NPCs; the carpenter and elder can add a prop)
- [ ] Villager accessories (hats, props) if the base pack lacks them

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

## Home base and furniture (about 15 models)
- [ ] Table
- [ ] Chair
- [ ] Bookshelf
- [ ] Rug
- [ ] Potted plant
- [ ] Standing lantern
- [ ] Banner
- [ ] Barrel
- [ ] Mount (horse or similar)
- [ ] Bed
- [ ] Training book
- [ ] Storage chest
- [ ] Display stand (gear rack)
- [ ] Trinket table
- [ ] Furniture crate

## World and dungeon (about 12 models)
- [ ] Exploration chest
- [ ] Campfire
- [ ] Dungeon gate
- [ ] Crystal (hit switch)
- [ ] Lever
- [ ] Brazier
- [ ] Pressure plate
- [ ] Push block
- [ ] Locked door
- [ ] Key chest
- [ ] Rune (block reset)
- [ ] Town house

## Environment (not yet counted)
- [ ] Trees, rocks, bushes, fences, cliff and spire pieces, roads and bridges. Currently built from boxes; count to be confirmed in an audit before the art pass.

## Not needed yet
- Health and mana potions (Q/R), added in milestone 7.
