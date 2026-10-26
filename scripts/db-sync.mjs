#!/usr/bin/env node
/**
 * Script de sincronização direta entre o arquivo local (data/tracker-db.json)
 * e o banco na nuvem Upstash Redis / Vercel KV (compartilhado entre Produção, Local e Agente Antigravity).
 *
 * Comandos:
 *   node scripts/db-sync.mjs status   -> Mostra o status e resumo dos pacotes na nuvem e localmente
 *   node scripts/db-sync.mjs pull     -> Baixa os dados mais recentes da nuvem (Upstash) para data/tracker-db.json
 *   node scripts/db-sync.mjs push     -> Envia os dados de data/tracker-db.json para a nuvem (Upstash)
 */

import fs from 'fs/promises';
import path from 'path';

const ROOT_DIR = process.cwd();
const ENV_FILE = path.join(ROOT_DIR, '.env.local');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');
const LOCAL_DB_FILE = path.join(DATA_DIR, 'tracker-db.json');

// UserId principal do Clerk
const DEFAULT_USER_ID = 'user_3KtfOrzGAERR0WSQDlHlX5DdLXe';

async function loadEnv() {
  const env = { ...process.env };
  try {
    const raw = await fs.readFile(ENV_FILE, 'utf-8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  } catch {
    // ignore
  }
  return env;
}

async function kvGet(url, token, key) {
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Upstash GET error: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return typeof data?.result === 'string' ? data.result : null;
}

async function kvSet(url, token, key, value) {
  const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: value,
  });
  if (!res.ok) {
    throw new Error(`Upstash SET error: ${res.status} ${res.statusText}`);
  }
  return true;
}

async function main() {
  const action = process.argv[2] || 'status';
  const env = await loadEnv();
  const kvUrl = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const kvToken = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  const userId = env.TRACKER_USER_ID || DEFAULT_USER_ID;

  if (!kvUrl || !kvToken) {
    console.error('❌ KV_REST_API_URL ou KV_REST_API_TOKEN não encontrados no .env.local');
    process.exit(1);
  }

  const userKey = `cd_tracker:user:${userId}`;
  const userFile = path.join(USERS_DIR, `${userId}.json`);

  if (action === 'push') {
    const rawLocal = await fs.readFile(LOCAL_DB_FILE, 'utf-8');
    const parsed = JSON.parse(rawLocal);
    const payload = {
      version: 2,
      userId,
      updatedAt: parsed.updatedAt || parsed.exportedAt || new Date().toISOString(),
      shipments: parsed.shipments || [],
      cdItems: parsed.cdItems || [],
    };
    const serialized = JSON.stringify(payload, null, 2);

    await kvSet(kvUrl, kvToken, 'cd_tracker:first_owner', userId);
    await kvSet(kvUrl, kvToken, userKey, serialized);

    await fs.mkdir(USERS_DIR, { recursive: true });
    await fs.writeFile(userFile, serialized, 'utf-8');
    await fs.writeFile(LOCAL_DB_FILE, serialized, 'utf-8');

    console.log(`✅ PUSH concluído com sucesso para o Upstash Redis!`);
    console.log(`   👤 Usuário: ${userId}`);
    console.log(`   📦 Pacotes: ${payload.shipments.length}`);
    console.log(`   💿 CDs:     ${payload.cdItems.length}`);
    console.log(`   🕒 Updated: ${payload.updatedAt}`);
    return;
  }

  if (action === 'pull') {
    try {
      const rawCloud = await kvGet(kvUrl, kvToken, userKey);
      if (!rawCloud) {
        console.log('⚠️ Nenhum dado encontrado na nuvem para a chave:', userKey);
        return;
      }
      const parsed = JSON.parse(rawCloud);
      const serialized = JSON.stringify(parsed, null, 2);

      await fs.mkdir(USERS_DIR, { recursive: true });
      await fs.writeFile(userFile, serialized, 'utf-8');
      await fs.writeFile(LOCAL_DB_FILE, serialized, 'utf-8');

      console.log(`✅ PULL concluído! Arquivos locais sincronizados com a nuvem.`);
      console.log(`   👤 Usuário: ${userId}`);
      console.log(`   📦 Pacotes: ${parsed.shipments?.length || 0}`);
      console.log(`   💿 CDs:     ${parsed.cdItems?.length || 0}`);
      console.log(`   🕒 Updated: ${parsed.updatedAt || parsed.exportedAt || 'N/A'}`);
    } catch (err) {
      console.warn(`⚠️ Aviso no pull do Upstash (usando cache local): ${err.message}`);
    }
    return;
  }

  // status
  const rawCloud = await kvGet(kvUrl, kvToken, userKey);
  let rawLocal = null;
  try {
    rawLocal = await fs.readFile(LOCAL_DB_FILE, 'utf-8');
  } catch {
    // ignore
  }

  console.log('=== 📊 STATUS DA BASE DE DADOS (UPSTASH CLOUD vs LOCAL) ===');
  if (rawCloud) {
    const cloud = JSON.parse(rawCloud);
    console.log(`☁️  Nuvem (Upstash): ${cloud.shipments?.length || 0} pacotes | ${cloud.cdItems?.length || 0} CDs | Atualizado em: ${cloud.updatedAt || 'N/A'}`);
  } else {
    console.log('☁️  Nuvem (Upstash): VAZIO');
  }

  if (rawLocal) {
    const local = JSON.parse(rawLocal);
    console.log(`💻 Local (JSON):    ${local.shipments?.length || 0} pacotes | ${local.cdItems?.length || 0} CDs | Atualizado em: ${local.updatedAt || local.exportedAt || 'N/A'}`);
  } else {
    console.log('💻 Local (JSON):    NÃO ENCONTRADO');
  }
}

main().catch((err) => {
  console.error('❌ Erro:', err);
  process.exit(1);
});
