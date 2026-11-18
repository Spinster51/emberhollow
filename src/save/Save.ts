// Saves (DESIGN §3): IndexedDB in the browser, one account record holding the shared home
// (storage chest, displays, furniture) and 4 character slots. Export/import as a JSON file.

import type { HomeSave } from '../home/Home';
import type { Item } from '../items/items';
import type { ClassId, Attr } from '../classes/classes';
import type { QuestState } from '../world/quests';
import type { DungeonSave } from '../world/Dungeon';

export const SAVE_VERSION = 1;
export const SLOTS = 4;

export interface CharSave {
  cls: ClassId;
  level: number;
  xp: number;
  attrs: Record<Attr, number>;
  attrPoints: number;
  skillPoints: number;
  ranks: Record<string, number>;
  inv: {
    bag: (Item | null)[];
    equipped: Record<string, Item | null>;
    gold: number;
    materials: Record<string, number>;
  };
  pos: [number, number, number];
  respawn: [number, number, number] | null;
  discovered: string[];
  opened: string[];
  quests: Record<string, QuestState>;
  glider: boolean;
  /** Dungeon puzzle progress (milestone 6; missing in older saves). */
  dungeon?: DungeonSave;
  playTime: number;
  savedAt: number;
}

export interface AccountSave {
  version: number;
  home: HomeSave | null;
  slots: (CharSave | null)[];
}

export function emptyAccount(): AccountSave {
  return { version: SAVE_VERSION, home: null, slots: new Array(SLOTS).fill(null) };
}

/** Check (and lightly repair) data from a file or an older save. Throws on garbage. */
export function validateAccount(data: unknown): AccountSave {
  const d = data as AccountSave;
  if (!d || typeof d !== 'object' || !Array.isArray(d.slots)) throw new Error('Not an Emberhollow save file.');
  if (typeof d.version !== 'number' || d.version > SAVE_VERSION) throw new Error('This save comes from a newer version of the game.');
  const slots = d.slots.slice(0, SLOTS);
  while (slots.length < SLOTS) slots.push(null);
  for (const s of slots) {
    if (s && (typeof s.cls !== 'string' || typeof s.level !== 'number' || !s.inv)) throw new Error('A character in this file is damaged.');
  }
  return { version: SAVE_VERSION, home: d.home ?? null, slots };
}

const DB = 'emberhollow';
const STORE = 'save';
const KEY = 'account';

/** IndexedDB key-value store, with an in-memory fallback (private windows, blocked storage). */
export class SaveStore {
  private memory: AccountSave | null = null;
  private dbPromise: Promise<IDBDatabase | null>;

  constructor() {
    this.dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async load(): Promise<AccountSave> {
    const db = await this.dbPromise;
    if (!db) return this.memory ?? emptyAccount();
    const data = await new Promise<unknown>((resolve) => {
      try {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    if (!data) return emptyAccount();
    try {
      return validateAccount(data);
    } catch {
      return emptyAccount();
    }
  }

  async save(data: AccountSave): Promise<boolean> {
    const copy = JSON.parse(JSON.stringify(data)) as AccountSave;
    const db = await this.dbPromise;
    if (!db) {
      this.memory = copy;
      return false;
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(copy, KEY);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }
}

/** Download the account as a .json file. */
export function exportFile(data: AccountSave): void {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `emberhollow-save-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Ask for a .json file and parse it. */
export function importFile(): Promise<AccountSave> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (!file) throw new Error('No file chosen.');
        resolve(validateAccount(JSON.parse(await file.text())));
      } catch (e) {
        reject(e);
      }
    };
    input.click();
  });
}
