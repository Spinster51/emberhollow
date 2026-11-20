import * as THREE from 'three';
import type { Game } from '../Game';
import { Campfires, type Campfire } from '../world/Campfires';
import { Chests, type WorldChest } from '../world/Chests';
import { Town } from '../world/Town';
import { QuestLog, type QuestDef, type QuestOwner } from '../world/quests';
import { Dialog } from '../ui/Dialog';
import { SlotSelect } from '../ui/SlotSelect';
import { StartPage } from '../ui/StartPage';
import { SaveStore, continueSlot, emptyAccount, exportFile, importFile, SAVE_VERSION, type AccountSave, type CharSave } from '../save/Save';
import { bumpUid, rollItem, type Item, type Rarity } from '../items/items';
import { sound } from '../core/sound';
import type { Interactable } from '../loot/Loot';
import { buildFurniture, FURNITURE } from '../home/furniture';
import { furnitureIcon } from '../home/furnitureIcons';
import type { ClassId } from '../classes/classes';
import type { Region } from '../world/layouts';
import { Dungeon } from '../world/Dungeon';

const VAULT_REGION: Region = { id: 'dungeon', name: 'The Ember Vault', level: 15 };

const AUTOSAVE_EVERY = 120;

/**
 * Milestone 5 world systems, glued onto the game: campfires (rest, respawn, fast travel), exploration
 * chests, the town (NPCs, quests, furniture shop), dialogs, lost gold on death, regions, saving
 * (4 slots, autosave, export/import) and furniture placement in the home.
 */
export class Adventure {
  readonly campfires: Campfires;
  readonly chests: Chests;
  readonly town: Town;
  /** The dungeon (main map only). */
  readonly dungeon: Dungeon | null = null;
  private lastT = 0;
  readonly quests = new QuestLog();
  readonly dialog: Dialog;
  readonly slotSelect: SlotSelect;
  /** The first screen (title). */
  readonly startPage: StartPage;
  readonly store = new SaveStore();
  account: AccountSave = emptyAccount();
  /** Current character slot, or -1 (tests / not saving). */
  slot = -1;
  playTime = 0;
  region: Region;
  private sinceSave = 0;
  private lastDeaths = 0;
  /** Furniture placement mode. */
  placing: { type: string; rot: number; ghost: THREE.Object3D; ring: THREE.Mesh; valid: boolean } | null = null;
  /** Called when the class pick screen finishes a new character. */
  private pendingSlot = -1;
  lastSave: Promise<boolean> | null = null;

  constructor(private game: Game, hudRoot: HTMLElement) {
    const world = game.world;
    this.campfires = new Campfires(world);
    this.chests = new Chests(world);
    this.dialog = new Dialog(hudRoot, () => game.updateMenus());
    this.slotSelect = new SlotSelect(hudRoot, {
      play: (i) => this.play(i),
      create: (i) => this.create(i),
      overwrite: (i) => this.create(i),
      remove: (i) => this.remove(i),
      back: () => this.showStart(),
      exportSave: () => void this.exportSave(),
      importSave: () => void this.importSave(),
    });
    this.startPage = new StartPage(hudRoot, {
      newGame: () => this.newGame(),
      continueGame: () => this.continueGame(),
      load: () => this.openSlots(),
      settings: () => game.settingsUI.show(),
      importSave: () => void this.importSave(),
    });
    this.town = new Town(world, {
      quests: this.quests,
      owner: () => this.owner(),
      dialog: this.dialog,
      home: game.home,
      gold: () => game.player.inv.gold,
      spendGold: (n) => {
        game.player.inv.gold -= n;
        game.player.inv.changed();
      },
      turnIn: (q) => this.turnIn(q),
      message: (t) => game.player.events.push(t),
      furnitureIcon: (type) => furnitureIcon(game.renderer, type).src,
    });
    game.scene.add(this.campfires.group, this.chests.group, this.town.group);
    if (world.layout.dungeon) {
      const d = new Dungeon(world, game.enemies, hudRoot, {
        message: (t) => game.player.events.push(t),
        heal: () => this.healFull(),
        setRespawn: (at) => {
          game.player.respawnPoint.copy(at);
          void this.autosave();
        },
        leave: () => this.leaveDungeon(),
        gold: (n, at) => game.loot.dropGold(n, at),
      });
      this.dungeon = d;
      game.scene.add(d.group);
      game.projectiles.hitTest = (a, b, r) => d.projectileHit(a, b, r);
    }
    game.player.gliderUnlocked = world.layout.gliderAtStart;
    this.region = world.regionAt(game.player.pos.x, game.player.pos.z);
    const town = this.campfires.get('town');
    if (town) {
      this.campfires.discovered.add('town');
      game.player.respawnPoint.copy(town.pos).add(new THREE.Vector3(0, 0, 2.5));
    }
    game.onKill = (e) => this.quests.onKill(e.kind);

    window.addEventListener('keydown', (e) => {
      if (!this.placing) return;
      if (e.code === 'KeyR') this.placing.rot += Math.PI / 2;
      if (e.code === 'Escape') this.stopPlacing();
    });
    window.addEventListener('beforeunload', () => {
      if (this.slot >= 0) void this.saveNow();
    });
  }

  owner(): QuestOwner {
    const p = this.game.player;
    return { level: p.level, gold: p.inv.gold, material: (id) => p.inv.materials[id] ?? 0 };
  }

  // ---------------------------------------------------------------- per step

  /** Before the player moves: furniture placement eats clicks. */
  preUpdate(): void {
    const pl = this.placing;
    if (!pl) return;
    const input = this.game.input;
    if (input.consumePress('attack') || input.consumePress('interact')) {
      const g = pl.ghost.position;
      if (pl.valid && this.game.home.place(pl.type, g.x, g.z, pl.rot)) {
        this.game.player.events.push(`Placed: ${FURNITURE[pl.type].name}`);
        const more = (this.game.home.stock[pl.type] ?? 0) > 0;
        if (!more) this.stopPlacing();
      } else {
        this.game.player.events.push('It does not fit there.');
      }
    }
  }

  update(dt: number): void {
    const g = this.game;
    const p = g.player;
    this.playTime += dt;
    this.campfires.update(p.pos);
    for (const c of this.campfires.news) p.events.push(`Campfire found: ${c.name} — rest here to fast travel back.`);
    this.campfires.news.length = 0;
    this.quests.onMove(p.pos.x, p.pos.z);
    for (const n of this.quests.news) p.events.push(n);
    this.quests.news.length = 0;

    // Dying drops a fifth of your gold where you fell; go back for it.
    if (p.deaths > this.lastDeaths) {
      this.lastDeaths = p.deaths;
      const lost = Math.floor(p.inv.gold * 0.2);
      if (lost > 0) {
        p.inv.gold -= lost;
        p.inv.changed();
        g.loot.dropGold(lost, p.pos.clone(), true);
        p.events.push(`You dropped ${lost} gold where you fell.`);
      }
    }

    const inside = !!this.dungeon?.contains(p.pos);
    g.setInterior(inside);
    this.dungeon?.update(dt, p);
    const r = inside ? VAULT_REGION : g.world.regionAt(p.pos.x, p.pos.z);
    if (r.id !== this.region.id) {
      this.region = r;
      g.hud.banner(r.name, r.id === 'town' ? 'Safe haven' : r.id === 'dungeon' ? 'Dungeon · Level 15' : `Level ${r.level}`);
      void this.autosave();
    }
    this.sinceSave += dt;
    if (this.sinceSave >= AUTOSAVE_EVERY) void this.autosave();
    this.updatePlacing();
  }

  render(t: number): void {
    const dt = Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    this.dungeon?.animate(t, dt);
    this.campfires.animate(t);
    this.town.animate(t, dt, this.game.player.pos);
  }

  interactables(): Interactable[] {
    const p = this.game.player.pos;
    return [
      ...this.campfires.interactables(p, (c) => this.campfireMenu(c)),
      ...this.chests.interactables(p, (c) => this.openChest(c)),
      ...this.town.interactables(p),
      ...this.gateInteractables(p),
      ...(this.dungeon ? this.dungeon.interactables(p, !this.dungeon.boss.alive) : []),
    ];
  }

  // ---------------------------------------------------------------- dungeon

  /** Is the sealed door open for this character? */
  vaultOpen(): boolean {
    return this.quests.status('sealed') === 'done';
  }

  /** Where the gate's E prompt sits, just south of the door. */
  gatePos(): THREE.Vector3 {
    const [x, z] = this.game.world.layout.dungeon!;
    return new THREE.Vector3(x, this.game.world.groundAt(x, z + 5, 1e9), z + 5);
  }

  private gateInteractables(p: THREE.Vector3): Interactable[] {
    if (!this.dungeon) return [];
    const at = this.gatePos();
    if (Math.hypot(p.x - at.x, p.z - at.z) > 4) return [];
    const open = this.vaultOpen();
    return [{
      pos: at,
      radius: 3.5,
      label: open ? 'Enter the Ember Vault' : 'Examine the sealed door',
      color: open ? '#ffa63a' : '#c070ff',
      act: () => {
        if (open) this.enterDungeon();
        else this.game.player.events.push('A great door, sealed with old carvings. The town elder may know more.');
      },
    }];
  }

  enterDungeon(): void {
    const d = this.dungeon;
    if (!d) return;
    const p = this.game.player;
    const at = d.entryPoint();
    p.pos.set(at.x, this.game.world.groundAt(at.x, at.z, at.y + 2), at.z);
    p.vel.set(0, 0, 0);
    p.facing = 0;
    this.game.cam.yaw = 0;
    this.game.lockOn.target = null;
    void this.autosave();
  }

  leaveDungeon(): void {
    const p = this.game.player;
    const at = this.gatePos();
    p.pos.set(at.x, this.game.world.groundAt(at.x, at.z + 2, 1e9), at.z + 2);
    p.vel.set(0, 0, 0);
    this.game.lockOn.target = null;
    this.game.player.events.push('You climb back out into the ruins.');
    void this.autosave();
  }

  // ---------------------------------------------------------------- campfires, bed, chests

  campfireMenu(c: Campfire): void {
    const others = this.campfires.list.filter((x) => x !== c && this.campfires.discovered.has(x.id));
    this.dialog.show({
      title: c.name,
      text: '<p>The fire crackles. Resting heals you, makes this your respawn point and saves — but the wilds fill up with enemies again.</p>',
      options: [
        { label: 'Rest', action: () => this.rest(c) },
        ...others.map((o) => ({ label: `Travel to ${o.name}`, action: () => this.travel(o) })),
        { label: 'Leave' },
      ],
    });
  }

  /** Rest at a campfire: heal, set respawn, reset the world, save. */
  rest(c: Campfire): void {
    const p = this.game.player;
    this.healFull();
    p.respawnPoint.copy(c.pos).add(new THREE.Vector3(0, 0, 2.5));
    this.game.enemies.respawnAll();
    p.events.push(`Rested at ${c.name}.`);
    void this.autosave();
  }

  travel(c: Campfire): void {
    const p = this.game.player;
    const to = c.pos.clone().add(new THREE.Vector3(0, 0, 2.5));
    p.pos.set(to.x, this.game.world.groundAt(to.x, to.z, to.y + 5), to.z);
    p.vel.set(0, 0, 0);
    this.game.lockOn.target = null;
    p.events.push(`Travelled to ${c.name}.`);
  }

  /** Sleep in your bed: heal, set respawn to the bed, save. */
  sleep(): void {
    const p = this.game.player;
    this.healFull();
    p.respawnPoint.copy(this.game.home.bedPos).add(new THREE.Vector3(-1.2, 0, 0));
    p.events.push('You wake up rested. Respawn point set to your bed.');
    void this.autosave();
  }

  private healFull(): void {
    const p = this.game.player;
    p.refreshStats();
    p.hp = p.stats.maxHp;
    p.mana = p.stats.maxMana;
    p.stamina = p.stats.maxStamina;
    p.exhausted = false;
    p.poisonTime = 0;
  }

  openChest(c: WorldChest): void {
    const g = this.game;
    const p = g.player;
    if (this.chests.opened.has(c.id)) return;
    this.chests.opened.add(c.id);
    this.chests.sync();
    sound.play('chest');
    const level = Math.max(g.world.regionAt(c.x, c.z).level, Math.min(p.level, 15));
    let rarity: Rarity | undefined;
    if (c.tier >= 1) {
      const r = g.loot.rand();
      rarity = r < 0.12 ? 'legendary' : r < 0.45 ? 'epic' : 'rare';
    }
    const at = c.pos.clone().setY(c.pos.y + 0.6);
    g.loot.dropItem(rollItem(g.loot.rand, level, rarity, p.cls), at);
    if (c.tier >= 1) g.loot.dropItem(rollItem(g.loot.rand, level, undefined, p.cls), at);
    g.loot.dropGold(Math.round((c.tier >= 1 ? 60 : 25) * (1 + level * 0.15)), at);
    p.events.push(c.tier >= 1 ? 'A treasure chest!' : 'You open the chest.');
  }

  // ---------------------------------------------------------------- quests

  turnIn(q: QuestDef): void {
    const g = this.game;
    const p = g.player;
    if (!this.quests.ready(q, this.owner())) return;
    for (const o of q.objectives) {
      if (o.type === 'collect') p.inv.materials[o.material] = (p.inv.materials[o.material] ?? 0) - o.count;
      if (o.type === 'pay') p.inv.gold -= o.gold;
    }
    this.quests.complete(q.id);
    const r = q.reward;
    if (r.gold) p.inv.gold += r.gold;
    p.inv.changed();
    if (r.xp) p.gainXp(r.xp);
    if (r.item) {
      const it = rollItem(g.loot.rand, Math.max(1, p.level), r.item, p.cls);
      if (!p.inv.add(it)) g.loot.dropItem(it, p.pos);
      p.events.push(`Reward: ${it.name}`);
    }
    if (r.unlock === 'house') g.home.unlock();
    if (r.unlock === 'expansion') g.home.expand();
    if (r.unlock === 'glider') {
      p.gliderUnlocked = true;
      p.events.push('Glider unlocked! In the air, press Space again to open it.');
    }
    p.events.push(`Quest complete: ${q.name}`);
    void this.autosave();
  }

  // ---------------------------------------------------------------- furniture

  /** The furniture crate: pick a piece to place. */
  furnish(): void {
    const home = this.game.home;
    const owned = Object.entries(home.stock).filter(([, n]) => n > 0);
    this.dialog.show({
      title: 'Furniture crate',
      text: owned.length
        ? '<p>Pick a piece, walk to where you want it and click (or E) to place it. R rotates, Esc stops. Press E next to a placed piece to pick it back up.</p>'
        : '<p>The crate is empty. Carpenter Bram in the square sells furniture.</p>',
      options: [
        ...owned.map(([type, n]) => ({ label: `${FURNITURE[type].name} (${n})`, icon: furnitureIcon(this.game.renderer, type).src, action: () => this.startPlacing(type) })),
        { label: 'Close' },
      ],
    });
  }

  startPlacing(type: string): void {
    this.stopPlacing();
    // The piece sits in its own group: it swaps its procedural children for the model when the file loads.
    const ghost = new THREE.Group();
    ghost.add(buildFurniture(type));
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.75, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x7be06b, transparent: true, opacity: 0.8 }),
    );
    ghost.add(ring);
    this.game.scene.add(ghost);
    this.placing = { type, rot: 0, ghost, ring, valid: false };
    this.updatePlacing();
  }

  stopPlacing(): void {
    if (this.placing) this.game.scene.remove(this.placing.ghost);
    this.placing = null;
  }

  private updatePlacing(): void {
    const pl = this.placing;
    if (!pl) return;
    const p = this.game.player;
    const home = this.game.home;
    const at = p.pos.clone().addScaledVector(p.facingVector(), 2);
    at.x = Math.round(at.x * 4) / 4;
    at.z = Math.round(at.z * 4) / 4;
    pl.ghost.position.set(at.x, home.floorY + 0.02, at.z);
    pl.ghost.rotation.y = pl.rot;
    pl.valid = home.inside(at.x, at.z, 0.4);
    (pl.ring.material as THREE.MeshBasicMaterial).color.setHex(pl.valid ? 0x7be06b : 0xe0503f);
    if (!home.inside(p.pos.x, p.pos.z, -1)) this.stopPlacing();
  }

  // ---------------------------------------------------------------- saving

  /** Load the account and show the start page (real game). */
  async boot(): Promise<void> {
    this.account = await this.store.load();
    if (this.account.home) this.game.home.load(this.account.home);
    this.bumpUids();
    this.showStart();
  }

  /** Title: the start page (the first screen). */
  showStart(note = ''): void {
    this.slotSelect.hide();
    this.startPage.show(this.account, note);
    this.game.updateMenus();
  }

  /** Title: the 4-slot list (Load, a full New game, or after a delete or import). */
  openSlots(note = '', full = false): void {
    this.startPage.hide();
    this.slotSelect.show(this.account, note, full);
    this.game.updateMenus();
  }

  /** New game: the first empty slot; if all four are used, the list so one can be overwritten. */
  newGame(): void {
    const i = this.account.slots.findIndex((s) => !s);
    if (i >= 0) this.create(i);
    else this.openSlots('All four slots are full. Choose one to overwrite, or go back.', true);
  }

  /** Continue: the last-played slot (see continueSlot). */
  continueGame(): void {
    const i = continueSlot(this.account);
    if (i >= 0) this.play(i);
  }

  /** Leave the title screens: the HUD and the world take over. */
  private enterWorld(): void {
    this.startPage.hide();
    this.slotSelect.hide();
    this.game.setPlaying(true);
  }

  private bumpUids(): void {
    let max = 0;
    const scan = (it: Item | null | undefined) => it && (max = Math.max(max, it.uid));
    this.account.home?.chest?.forEach(scan);
    this.account.home?.displays?.forEach(scan);
    for (const s of this.account.slots) {
      s?.inv.bag.forEach(scan);
      if (s) Object.values(s.inv.equipped).forEach(scan);
    }
    bumpUid(max);
  }

  play(i: number): void {
    const s = this.account.slots[i];
    if (!s) return;
    this.slot = i;
    this.account.lastSlot = i;
    void this.store.save(this.account);
    this.apply(s);
    this.enterWorld();
  }

  create(i: number): void {
    this.pendingSlot = i;
    this.startPage.hide();
    this.slotSelect.hide();
    this.game.showClassSelect();
  }

  /** The class pick screen finished: start a fresh character (in the pending slot, if any). */
  onClassPicked(_cls: ClassId): void {
    this.startFresh();
    if (this.pendingSlot >= 0) {
      this.slot = this.pendingSlot;
      this.pendingSlot = -1;
      void this.saveNow();
    }
    this.enterWorld();
  }

  /** Reset per-character world state for a new character. */
  startFresh(): void {
    const g = this.game;
    const p = g.player;
    this.quests.load({});
    this.chests.opened.clear();
    this.chests.sync();
    this.campfires.discovered.clear();
    this.dungeon?.load(null);
    const town = this.campfires.get('town');
    if (town) {
      this.campfires.discovered.add('town');
      p.respawnPoint.copy(town.pos).add(new THREE.Vector3(0, 0, 2.5));
    } else {
      p.respawnPoint.set(NaN, 0, 0);
    }
    p.gliderUnlocked = g.world.layout.gliderAtStart;
    p.respawn();
    this.lastDeaths = p.deaths;
    this.playTime = 0;
    this.sinceSave = 0;
  }

  async remove(i: number): Promise<void> {
    this.account.slots[i] = null;
    if (this.account.lastSlot === i) this.account.lastSlot = null;
    if (this.slot === i) this.slot = -1;
    await this.store.save(this.account);
    this.openSlots();
  }

  /** Save now if playing a slot (autosave points). */
  autosave(): Promise<boolean> {
    this.sinceSave = 0;
    if (this.slot < 0) return Promise.resolve(false);
    return this.saveNow();
  }

  saveNow(): Promise<boolean> {
    this.sinceSave = 0;
    if (this.slot >= 0) {
      this.account.slots[this.slot] = this.serialize();
      this.account.lastSlot = this.slot;
    }
    this.account.home = this.game.home.save();
    this.account.version = SAVE_VERSION;
    this.lastSave = this.store.save(this.account);
    return this.lastSave;
  }

  serialize(): CharSave {
    const p = this.game.player;
    const prog = p.prog;
    const rp = p.respawnPoint;
    return {
      cls: prog.cls,
      level: prog.level,
      xp: prog.xp,
      attrs: { ...prog.attrs },
      attrPoints: prog.attrPoints,
      skillPoints: prog.skillPoints,
      ranks: { ...prog.ranks },
      inv: {
        bag: [...p.inv.bag],
        equipped: { ...p.inv.equipped },
        gold: p.inv.gold,
        materials: { ...p.inv.materials },
      },
      pos: [p.pos.x, p.pos.y, p.pos.z],
      respawn: Number.isNaN(rp.x) ? null : [rp.x, rp.y, rp.z],
      discovered: [...this.campfires.discovered],
      opened: [...this.chests.opened],
      quests: JSON.parse(JSON.stringify(this.quests.toJSON())),
      glider: p.gliderUnlocked,
      dungeon: this.dungeon?.save(),
      playTime: this.playTime,
      savedAt: Date.now(),
    };
  }

  apply(s: CharSave): void {
    const g = this.game;
    const p = g.player;
    g.chooseClass(s.cls);
    const prog = p.prog;
    prog.reset(s.cls);
    prog.level = s.level;
    prog.xp = s.xp;
    Object.assign(prog.attrs, s.attrs);
    prog.attrPoints = s.attrPoints;
    prog.skillPoints = s.skillPoints;
    Object.assign(prog.ranks, s.ranks);
    prog.version++;
    const inv = p.inv;
    inv.cls = s.cls;
    inv.bag.fill(null);
    s.inv.bag.forEach((it, i) => i < inv.bag.length && (inv.bag[i] = it));
    for (const k of Object.keys(inv.equipped) as (keyof typeof inv.equipped)[]) inv.equipped[k] = (s.inv.equipped[k] as Item | null) ?? null;
    inv.gold = s.inv.gold;
    for (const k of Object.keys(inv.materials)) delete inv.materials[k];
    Object.assign(inv.materials, s.inv.materials);
    inv.changed();
    this.quests.load(JSON.parse(JSON.stringify(s.quests ?? {})));
    this.campfires.discovered.clear();
    for (const id of s.discovered ?? []) this.campfires.discovered.add(id);
    this.chests.opened.clear();
    for (const id of s.opened ?? []) this.chests.opened.add(id);
    this.chests.sync();
    this.dungeon?.load(s.dungeon);
    p.gliderUnlocked = s.glider;
    if (s.respawn) p.respawnPoint.set(...s.respawn);
    p.respawn();
    p.pos.set(s.pos[0], g.world.groundAt(s.pos[0], s.pos[2], s.pos[1] + 1), s.pos[2]);
    this.lastDeaths = p.deaths;
    this.playTime = s.playTime ?? 0;
    this.sinceSave = 0;
    this.region = this.dungeon?.contains(p.pos) ? VAULT_REGION : g.world.regionAt(p.pos.x, p.pos.z);
  }

  async exportSave(): Promise<void> {
    if (this.slot >= 0) await this.saveNow();
    exportFile(this.account);
  }

  async importSave(): Promise<void> {
    try {
      const data = await importFile();
      this.account = data;
      await this.store.save(data);
      if (data.home) this.game.home.load(data.home);
      this.bumpUids();
      this.slot = -1;
      this.openSlots('Save file imported.');
    } catch (e) {
      const note = `Could not import: ${(e as Error).message}`;
      if (this.slotSelect.visible) this.openSlots(note);
      else this.showStart(note);
    }
  }
}
