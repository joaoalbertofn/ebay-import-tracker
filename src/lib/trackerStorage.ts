import fs from 'fs/promises';
import path from 'path';
import { CDItem, Shipment } from '@/types/tracker';

const BUNDLED_DATA_DIR = path.join(process.cwd(), 'data');
const LEGACY_DB_FILE = path.join(BUNDLED_DATA_DIR, 'tracker-db.json');

const WRITABLE_BASE_DIR = process.env.VERCEL
  ? path.join('/tmp', 'cd-import-tracker-data')
  : BUNDLED_DATA_DIR;
const USERS_DIR = path.join(WRITABLE_BASE_DIR, 'users');

const KV_URL =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export interface TrackerDbRecord {
  exists: boolean;
  userId: string;
  shipments?: Shipment[];
  cdItems?: CDItem[];
  updatedAt?: string | null;
}

function getUserDbFile(userId: string): string {
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(USERS_DIR, `${safeUserId}.json`);
}

async function kvGet(key: string): Promise<string | null> {
  if (!KV_URL || !KV_TOKEN) return null;
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return typeof data?.result === 'string' ? data.result : null;
}

async function kvSet(key: string, value: string): Promise<boolean> {
  if (!KV_URL || !KV_TOKEN) return false;
  const res = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    body: value,
    signal: AbortSignal.timeout(6000),
  });
  return res.ok;
}

async function migrateLegacyDbIfFirstUser(
  userId: string,
  userDbFile: string
): Promise<string | null> {
  try {
    const legacyRaw = await fs.readFile(LEGACY_DB_FILE, 'utf-8');

    if (KV_URL && KV_TOKEN) {
      const existingOwner = await kvGet('cd_tracker:first_owner');
      if (!existingOwner) {
        await kvSet('cd_tracker:first_owner', userId);
        await kvSet(`cd_tracker:user:${userId}`, legacyRaw);
        return legacyRaw;
      }
      return null;
    }

    await fs.mkdir(USERS_DIR, { recursive: true });
    const existingUserFiles = (await fs.readdir(USERS_DIR)).filter((f) =>
      f.endsWith('.json')
    );
    if (existingUserFiles.length === 0) {
      await fs.writeFile(userDbFile, legacyRaw, 'utf-8');
      return legacyRaw;
    }
  } catch {
    // Sem arquivo legado para migrar
  }
  return null;
}

export async function loadUserTrackerData(
  userId: string
): Promise<TrackerDbRecord> {
  const userDbFile = getUserDbFile(userId);

  try {
    let raw: string | null = null;
    const isUsingKv = Boolean(KV_URL && KV_TOKEN);

    if (isUsingKv) {
      raw = await kvGet(`cd_tracker:user:${userId}`);
    }

    // Fallback para o arquivo JSON local caso o Upstash esteja inacessível (ex: offline/sandbox)
    if (!raw) {
      try {
        raw = await fs.readFile(userDbFile, 'utf-8');
      } catch {
        raw = null;
      }
    }

    if (!raw) {
      raw = await migrateLegacyDbIfFirstUser(userId, userDbFile);
    }

    if (!raw) {
      return { exists: false, userId };
    }

    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.shipments) && Array.isArray(parsed.cdItems)) {
      // Espelha localmente em dev apenas se o arquivo local estiver desatualizado
      if (!process.env.VERCEL && isUsingKv) {
        try {
          const existingLocal = await fs
            .readFile(userDbFile, 'utf-8')
            .catch(() => null);
          if (existingLocal !== raw) {
            await fs.mkdir(USERS_DIR, { recursive: true });
            await Promise.all([
              fs.writeFile(userDbFile, raw, 'utf-8'),
              fs.writeFile(LEGACY_DB_FILE, raw, 'utf-8'),
            ]);
          }
        } catch {
          // ignora erro de espelhamento local
        }
      }

      return {
        exists: true,
        userId,
        shipments: parsed.shipments,
        cdItems: parsed.cdItems,
        updatedAt: parsed.updatedAt || parsed.exportedAt || null,
      };
    }

    return { exists: false, userId };
  } catch {
    return { exists: false, userId };
  }
}

export async function saveUserTrackerData(
  userId: string,
  shipments: Shipment[],
  cdItems: CDItem[]
): Promise<{ updatedAt: string }> {
  const payload = {
    version: 2,
    userId,
    updatedAt: new Date().toISOString(),
    shipments,
    cdItems,
  };
  const serialized = JSON.stringify(payload, null, 2);
  const isUsingKv = Boolean(KV_URL && KV_TOKEN);

  if (isUsingKv) {
    await kvSet(`cd_tracker:user:${userId}`, serialized);
  }

  if (!process.env.VERCEL || !isUsingKv) {
    await fs.mkdir(USERS_DIR, { recursive: true });
    const userDbFile = getUserDbFile(userId);
    const writes: Promise<void>[] = [
      fs.writeFile(userDbFile, serialized, 'utf-8'),
    ];
    if (!process.env.VERCEL) {
      writes.push(fs.writeFile(LEGACY_DB_FILE, serialized, 'utf-8'));
    }
    await Promise.all(writes);
  }

  return { updatedAt: payload.updatedAt };
}
