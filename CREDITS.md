# Credits

- Engine: [three.js](https://threejs.org) (MIT).
- Movement design studied from [Veloren](https://gitlab.com/veloren/veloren) (GPL-3.0). Ideas and tuning numbers only; no code copied.
- Art: anything not listed here is still placeholder shapes.
  - [KayKit Adventurers Character Pack 1.0](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) by Kay Lousberg (KayKit), CC0 1.0.
    - Files (trimmed with glTF-Transform) in `public/models/chars/`: `knight.glb` (Knight body plus the pack's 33 shared animation clips), `barbarian.glb`, `mage.glb`, `rogue_hooded.glb`.
    - Used for the player body: Warrior = Barbarian, Tank = Knight, Mage = Mage, Assassin = Rogue (hooded).
    - The pack's held props (weapons, shields, books) are hidden in game; equipped items are still the game's own models.
    - Enemy body (M8): the non-hooded Rogue is `public/models/enemies/bandit.glb` (bandit and goblin archer), trimmed to the mesh with no clips. It keeps the pack's knife, crossbow and throwable props. The goblin repaints four palette cells of the pack's texture in code (green skin, leather clothes, dark hair) and adds two pointed ears made in code.
  - [KayKit Character Pack: Skeletons 1.0](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0) by Kay Lousberg (KayKit), CC0 1.0.
    - Files (trimmed with glTF-Transform) in `public/models/enemies/`: `skeleton_warrior.glb`, `skeleton_minion.glb`, `skeleton_mage.glb` (meshes only, no clips; they share the Adventurers rig and play the clips in `knight.glb`) and `clips_extra.glb` (15 clips from the skeleton pack's character file that `knight.glb` lacks: the skeleton-pack clips, plus Running_B, Walking_Backwards and Running_Strafe_Left/Right for enemy locomotion).
    - Weapons (the pack's glTF props, converted to GLB with glTF-Transform) in `public/models/enemies/`: `skeleton_blade.glb` (Skeleton_Blade: skeletons and the boss's adds), `skeleton_shield.glb` (Skeleton_Shield_Small_A: skeletons), `skeleton_staff.glb` (Skeleton_Staff: cultist), `skeleton_axe.glb` (Skeleton_Axe: the Cinder Warden).
  - [Quaternius](https://quaternius.com) low-poly packs, CC0 1.0 ([Public Domain Dedication](https://creativecommons.org/publicdomain/zero/1.0/)). Files (trimmed to the clips the game needs, converted to GLB) in `public/models/enemies/`:
    - [Ultimate Animated Animals](https://quaternius.com/packs/ultimateanimatedanimals.html): `wolf.glb` (Wolf); the Bull's armature and clips (Idle, Walk, Gallop, Attack_Headbutt, Idle_HitReact1, Death) drive the boar in `boar.glb` (see below).
    - [Ultimate Monsters](https://quaternius.com/packs/ultimatemonsters.html): `slime.glb` (GreenBlob), `golem_yeti.glb` (Yeti; fetched from a public GitHub copy of the pack because the pack's Drive file was over its download quota).
    - [Easy Enemy Pack](https://quaternius.com/packs/easyenemy.html): `spider.glb` (Spider; FBX converted to GLB in Blender).
  - ["Low Poly Wild Boar"](https://sketchfab.com/models/c629c82f34754fd09230b2c9563296ac) by Hanabi_Map (Sketchfab), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The mesh of `public/models/enemies/boar.glb` (the boar enemy), changed: turned, scaled, its parts merged, recoloured, the spine raised into a crest with the mane narrowed to a stripe from forehead to tail, and skinned in Blender to the Quaternius Bull's armature (CC0, bones moved to fit the boar) so it plays the bull's clips; the headbutt's head-down is softened and the death lifted to lie on the ground.
