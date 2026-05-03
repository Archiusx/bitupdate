import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'bit-updates-db';
const STORE_NAME = 'profile';

export interface Profile {
  id: string;
  name: string;
  email: string;
  bio: string;
}

let dbPromise: Promise<IDBPDatabase>;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

export async function saveProfile(profile: Profile): Promise<void> {
  const db = await getDb();
  await db.put(STORE_NAME, profile);
}

export async function getProfile(id: string): Promise<Profile | undefined> {
  const db = await getDb();
  return db.get(STORE_NAME, id);
}
