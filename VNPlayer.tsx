import { SavedStage, SavedWeek, ArchiveCharacter, ArchiveBackground } from './EditorTypes';

const DB_NAME = 'FNREditorDB';
const STORE_NAME = 'stages';
const SETTINGS_STORE = 'settings';
const WEEKS_STORE = 'weeks';
const ARCHIVE_CHARACTERS_STORE = 'archive_characters';
const ARCHIVE_BACKGROUNDS_STORE = 'archive_backgrounds';

export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 4);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE);
      }
      if (!db.objectStoreNames.contains(WEEKS_STORE)) {
        db.createObjectStore(WEEKS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(ARCHIVE_CHARACTERS_STORE)) {
        db.createObjectStore(ARCHIVE_CHARACTERS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(ARCHIVE_BACKGROUNDS_STORE)) {
        db.createObjectStore(ARCHIVE_BACKGROUNDS_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const saveStagesToDB = async (stages: SavedStage[]) => {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  
  store.clear();
  stages.forEach(stage => store.put(stage));
  
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
};

export const loadStagesFromDB = async (): Promise<SavedStage[]> => {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const request = store.getAll();
  
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const saveWeeksToDB = async (weeks: SavedWeek[]) => {
  const db = await initDB();
  const tx = db.transaction(WEEKS_STORE, 'readwrite');
  const store = tx.objectStore(WEEKS_STORE);
  
  store.clear();
  weeks.forEach(week => store.put(week));
  
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
};

export const loadWeeksFromDB = async (): Promise<SavedWeek[]> => {
  const db = await initDB();
  const tx = db.transaction(WEEKS_STORE, 'readonly');
  const store = tx.objectStore(WEEKS_STORE);
  const request = store.getAll();
  
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const saveArchiveCharacters = async (characters: ArchiveCharacter[]) => {
  const db = await initDB();
  const tx = db.transaction('archive_characters', 'readwrite');
  const store = tx.objectStore('archive_characters');
  store.clear();
  characters.forEach(c => store.put(c));
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
};

export const loadArchiveCharacters = async (): Promise<ArchiveCharacter[]> => {
  const db = await initDB();
  const tx = db.transaction('archive_characters', 'readonly');
  const store = tx.objectStore('archive_characters');
  const request = store.getAll();
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const saveArchiveBackgrounds = async (backgrounds: ArchiveBackground[]) => {
  const db = await initDB();
  const tx = db.transaction('archive_backgrounds', 'readwrite');
  const store = tx.objectStore('archive_backgrounds');
  store.clear();
  backgrounds.forEach(b => store.put(b));
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
};

export const loadArchiveBackgrounds = async (): Promise<ArchiveBackground[]> => {
  const db = await initDB();
  const tx = db.transaction('archive_backgrounds', 'readonly');
  const store = tx.objectStore('archive_backgrounds');
  const request = store.getAll();
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const saveSetting = async (key: string, value: any) => {
  console.log(`Storage: Saving setting ${key}`, typeof value === 'object' && value instanceof ArrayBuffer ? `ArrayBuffer(${value.byteLength})` : value);
  const db = await initDB();
  const tx = db.transaction(SETTINGS_STORE, 'readwrite');
  const store = tx.objectStore(SETTINGS_STORE);
  store.put(value, key);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      console.log(`Storage: Setting ${key} saved successfully`);
      resolve(undefined);
    };
    tx.onerror = () => {
      console.error(`Storage: Failed to save setting ${key}`, tx.error);
      reject(tx.error);
    };
  });
};

export const getSetting = async (key: string): Promise<any> => {
  console.log(`Storage: Getting setting ${key}`);
  const db = await initDB();
  const tx = db.transaction(SETTINGS_STORE, 'readonly');
  const store = tx.objectStore(SETTINGS_STORE);
  const request = store.get(key);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      console.log(`Storage: Setting ${key} retrieved`, request.result ? (typeof request.result === 'object' && request.result instanceof ArrayBuffer ? `ArrayBuffer(${request.result.byteLength})` : 'exists') : 'not found');
      resolve(request.result);
    };
    request.onerror = () => {
      console.error(`Storage: Failed to get setting ${key}`, request.error);
      reject(request.error);
    };
  });
};
