import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import fs from 'fs/promises';
import path from 'path';

const BUNDLED_DATA_DIR = path.join(process.cwd(), 'data');
const LEGACY_DB_FILE = path.join(BUNDLED_DATA_DIR, 'tracker-db.json');

// Na Vercel o diretório /var/task é somente-leitura (EROFS), então usamos /tmp quando em ambiente serverless sem KV
const WRITABLE_BASE_DIR = process.env.VERCEL
  ? path.join('/tmp', 'cd-import-tracker-data')
  : BUNDLED_DATA_DIR;
const USERS_DIR = path.join(WRITABLE_BASE_DIR, 'users');

// Suporte nativo (zero dependências) para Vercel KV / Upstash Redis caso configurado na Vercel
const KV_URL =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

function getUserDbFile(userId: string): string {
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(USERS_DIR, `${safeUserId}.json`);
}

async function kvGet(key: string): Promise<string | null> {
  if (!KV_URL || !KV_TOKEN) return null;
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: 'no-store',
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

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userDbFile = getUserDbFile(userId);

  try {
    let raw: string | null = null;

    if (KV_URL && KV_TOKEN) {
      raw = await kvGet(`cd_tracker:user:${userId}`);
    } else {
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
      return NextResponse.json({ exists: false, userId });
    }

    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.shipments) && Array.isArray(parsed.cdItems)) {
      // Espelha localmente em desenvolvimento para manter data/tracker-db.json e data/users/<id>.json atualizados
      if (!process.env.VERCEL && KV_URL && KV_TOKEN) {
        try {
          await fs.mkdir(USERS_DIR, { recursive: true });
          await fs.writeFile(userDbFile, raw, 'utf-8');
          await fs.writeFile(LEGACY_DB_FILE, raw, 'utf-8');
        } catch {
          // ignora erro de escrita de espelhamento local
        }
      }

      return NextResponse.json({
        exists: true,
        userId,
        shipments: parsed.shipments,
        cdItems: parsed.cdItems,
        updatedAt: parsed.updatedAt || parsed.exportedAt || null,
      });
    }
    return NextResponse.json({ exists: false, userId });
  } catch {
    return NextResponse.json({ exists: false, userId });
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (!Array.isArray(body.shipments) || !Array.isArray(body.cdItems)) {
      return NextResponse.json(
        { error: 'Invalid payload' },
        { status: 400 }
      );
    }

    const payload = {
      version: 2,
      userId,
      updatedAt: new Date().toISOString(),
      shipments: body.shipments,
      cdItems: body.cdItems,
    };
    const serialized = JSON.stringify(payload, null, 2);

    if (KV_URL && KV_TOKEN) {
      await kvSet(`cd_tracker:user:${userId}`, serialized);
    }

    if (!process.env.VERCEL || !(KV_URL && KV_TOKEN)) {
      await fs.mkdir(USERS_DIR, { recursive: true });
      const userDbFile = getUserDbFile(userId);
      await fs.writeFile(userDbFile, serialized, 'utf-8');
      if (!process.env.VERCEL) {
        await fs.writeFile(LEGACY_DB_FILE, serialized, 'utf-8');
      }
    }

    return NextResponse.json({ ok: true, updatedAt: payload.updatedAt });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
