#!/usr/bin/env node
/**
 * Script de sincronização inteligente entre os bancos:
 * - Banco local no computador (data/tracker-db.json e data/users/<userId>.json)
 * - Banco oficial na nuvem Upstash Redis (compartilhado com a Vercel em Produção)
 *
 * Comandos:
 *   node scripts/db-sync.mjs status            -> Mostra status comparativo (Nuvem vs Local)
 *   node scripts/db-sync.mjs sync              -> Compara timestamps; sincroniza apenas se houver diferença
 *   node scripts/db-sync.mjs pull              -> Força download da nuvem para o local
 *   node scripts/db-sync.mjs push              -> Força upload do local para a nuvem
 *   node scripts/db-sync.mjs watch [minutos]   -> Executa em loop a cada N minutos (padrão: 30)
 *   node scripts/db-sync.mjs daemon-install    -> Instala serviço nativo de 30min no macOS (LaunchAgent)
 *   node scripts/db-sync.mjs daemon-uninstall  -> Remove o serviço nativo do macOS
 */

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const ROOT_DIR = process.cwd();
const ENV_FILE = path.join(ROOT_DIR, '.env.local');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');
const LOCAL_DB_FILE = path.join(DATA_DIR, 'tracker-db.json');
const LOG_FILE = path.join(DATA_DIR, 'sync.log');
const LAUNCH_AGENT_ID = 'com.cdimporter.dbsync';

// UserId padrão do Clerk
const DEFAULT_USER_ID = 'user_3KtfOrzGAERR0WSQDlHlX5DdLXe';

async function logToFile(message) {
  try {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.appendFile(LOG_FILE, line, 'utf-8');
  } catch {
    // ignora falha de escrita em log
  }
}

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
    signal: AbortSignal.timeout(10000),
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
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`Upstash SET error: ${res.status} ${res.statusText}`);
  }
  return true;
}

/**
 * Executa uma verificação comparativa inteligente entre Local e Nuvem
 * Se houver diferença, atualiza o que estiver defasado. Se não houver, nada faz.
 */
async function executeSmartSync({ kvUrl, kvToken, userKey, userFile, userId, silent = false }) {
  let rawCloud = null;
  try {
    rawCloud = await kvGet(kvUrl, kvToken, userKey);
  } catch (err) {
    const msg = `⚠️ Falha ao consultar Upstash: ${err.message}`;
    if (!silent) console.warn(msg);
    await logToFile(msg);
    return { status: 'error', reason: err.message };
  }

  let rawLocal = null;
  try {
    rawLocal = await fs.readFile(LOCAL_DB_FILE, 'utf-8');
  } catch {
    // Local ainda não existe
  }

  // 1. Ambos vazios
  if (!rawCloud && !rawLocal) {
    const msg = 'ℹ️ Ambos os bancos (Nuvem e Local) estão vazios. Nenhuma ação necessária.';
    if (!silent) console.log(msg);
    return { status: 'noop' };
  }

  // 2. Existe na nuvem, mas local inexiste -> PULL
  if (rawCloud && !rawLocal) {
    const parsed = JSON.parse(rawCloud);
    const serialized = JSON.stringify(parsed, null, 2);
    await fs.mkdir(USERS_DIR, { recursive: true });
    await fs.writeFile(userFile, serialized, 'utf-8');
    await fs.writeFile(LOCAL_DB_FILE, serialized, 'utf-8');
    const msg = `📥 PULL inicial efetuado: ${parsed.shipments?.length || 0} pacotes baixados para o computador.`;
    if (!silent) console.log(`✅ ${msg}`);
    await logToFile(msg);
    return { status: 'pulled', count: parsed.shipments?.length || 0 };
  }

  // 3. Existe no local, mas nuvem vazia -> PUSH
  if (!rawCloud && rawLocal) {
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
    const msg = `📤 PUSH inicial efetuado: ${payload.shipments.length} pacotes enviados para a nuvem.`;
    if (!silent) console.log(`✅ ${msg}`);
    await logToFile(msg);
    return { status: 'pushed', count: payload.shipments.length };
  }

  // 4. Ambos existem: analisar versões
  const cloud = JSON.parse(rawCloud);
  const local = JSON.parse(rawLocal);

  const cloudDateStr = cloud.updatedAt || cloud.exportedAt || '';
  const localDateStr = local.updatedAt || local.exportedAt || '';
  const cloudTime = cloudDateStr ? new Date(cloudDateStr).getTime() : 0;
  const localTime = localDateStr ? new Date(localDateStr).getTime() : 0;

  const cloudCount = `${cloud.shipments?.length || 0} pacotes | ${cloud.cdItems?.length || 0} CDs`;
  const localCount = `${local.shipments?.length || 0} pacotes | ${local.cdItems?.length || 0} CDs`;

  // Compara se o conteúdo dos pedidos é idêntico
  const cloudBody = JSON.stringify({ s: cloud.shipments, c: cloud.cdItems });
  const localBody = JSON.stringify({ s: local.shipments, c: local.cdItems });

  if (cloudBody === localBody || cloudTime === localTime) {
    const msg = `Tudo sincronizado. Sem mudanças (${cloudCount}). Nenhuma ação necessária.`;
    if (!silent) console.log(`✅ ${msg}`);
    await logToFile(msg);
    return { status: 'synced', shipmentsCount: cloud.shipments?.length || 0 };
  }

  // Se a nuvem for mais recente -> PULL para o computador local
  if (cloudTime > localTime) {
    const serialized = JSON.stringify(cloud, null, 2);
    await fs.mkdir(USERS_DIR, { recursive: true });
    await fs.writeFile(userFile, serialized, 'utf-8');
    await fs.writeFile(LOCAL_DB_FILE, serialized, 'utf-8');
    const msg = `📥 PULL efetuado: Nuvem mais recente (${cloudDateStr} > ${localDateStr}). Atualizado localmente para ${cloudCount}.`;
    if (!silent) console.log(`✅ ${msg}`);
    await logToFile(msg);
    return { status: 'pulled', count: cloud.shipments?.length || 0 };
  }

  // Se o computador local for mais recente -> PUSH para a nuvem
  const payload = {
    version: 2,
    userId,
    updatedAt: local.updatedAt || new Date().toISOString(),
    shipments: local.shipments || [],
    cdItems: local.cdItems || [],
  };
  const serialized = JSON.stringify(payload, null, 2);
  await kvSet(kvUrl, kvToken, userKey, serialized);
  const msg = `📤 PUSH efetuado: Local mais recente (${localDateStr} > ${cloudDateStr}). Atualizada a nuvem para ${localCount}.`;
  if (!silent) console.log(`✅ ${msg}`);
  await logToFile(msg);
  return { status: 'pushed', count: payload.shipments.length };
}

async function installLaunchAgent() {
  const homeDir = process.env.HOME;
  if (!homeDir) {
    throw new Error('Variável HOME não encontrada');
  }

  const agentsDir = path.join(homeDir, 'Library', 'LaunchAgents');
  await fs.mkdir(agentsDir, { recursive: true });

  const plistPath = path.join(agentsDir, `${LAUNCH_AGENT_ID}.plist`);
  const nodeBin = process.execPath;
  const scriptPath = path.join(ROOT_DIR, 'scripts', 'db-sync.mjs');

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCH_AGENT_ID}</string>
    <key>WorkingDirectory</key>
    <string>${ROOT_DIR}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodeBin}</string>
        <string>${scriptPath}</string>
        <string>sync</string>
    </array>
    <key>StartInterval</key>
    <integer>1800</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOG_FILE}</string>
    <key>StandardErrorPath</key>
    <string>${LOG_FILE}</string>
</dict>
</plist>
`;

  await fs.writeFile(plistPath, plistContent, 'utf-8');

  try {
    await execAsync(`launchctl unload "${plistPath}" 2>/dev/null || true`);
  } catch {
    // ignora se não estava carregado
  }

  await execAsync(`launchctl load "${plistPath}"`);

  console.log(`🎉 Serviço macOS agendado com sucesso!`);
  console.log(`   ⏰ Frequência: a cada 30 minutos (1800s) em background`);
  console.log(`   📄 Arquivo Plist: ${plistPath}`);
  console.log(`   📝 Arquivo de Log: ${LOG_FILE}`);
  console.log(`   🔄 Executa automaticamente ao ligar/despertar o Mac, sem necessidade de terminal aberto.`);
}

async function uninstallLaunchAgent() {
  const homeDir = process.env.HOME;
  const plistPath = path.join(homeDir, 'Library', 'LaunchAgents', `${LAUNCH_AGENT_ID}.plist`);

  try {
    await execAsync(`launchctl unload "${plistPath}" 2>/dev/null || true`);
  } catch {
    // ignora
  }

  try {
    await fs.unlink(plistPath);
    console.log(`🛑 Serviço macOS ${LAUNCH_AGENT_ID} removido com sucesso.`);
  } catch {
    console.log(`ℹ️ O arquivo plist não estava presente.`);
  }
}

async function main() {
  const action = process.argv[2] || 'status';

  if (action === 'daemon-install') {
    await installLaunchAgent();
    return;
  }

  if (action === 'daemon-uninstall') {
    await uninstallLaunchAgent();
    return;
  }

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

  if (action === 'sync') {
    console.log('🔄 Executando verificação de sincronização inteligente...');
    await executeSmartSync({ kvUrl, kvToken, userKey, userFile, userId, silent: false });
    return;
  }

  if (action === 'watch') {
    const minutes = parseInt(process.argv[3], 10) || 30;
    const intervalMs = minutes * 60 * 1000;
    console.log(`🕒 [Auto-Sync Watch] Verificando sincronização a cada ${minutes} minutos...`);
    console.log(`   Pressione Ctrl+C para encerrar.\n`);

    await executeSmartSync({ kvUrl, kvToken, userKey, userFile, userId, silent: false });

    setInterval(async () => {
      try {
        await executeSmartSync({ kvUrl, kvToken, userKey, userFile, userId, silent: false });
      } catch (err) {
        console.error(`❌ Erro no ciclo de sync:`, err.message);
      }
    }, intervalMs);

    return; // mantém processo vivo
  }

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
      console.warn(`⚠️ Aviso no pull do Upstash: ${err.message}`);
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
  let cloudTime = 0;
  let localTime = 0;

  if (rawCloud) {
    const cloud = JSON.parse(rawCloud);
    cloudTime = cloud.updatedAt ? new Date(cloud.updatedAt).getTime() : 0;
    console.log(`☁️  Nuvem (Upstash): ${cloud.shipments?.length || 0} pacotes | ${cloud.cdItems?.length || 0} CDs | Atualizado: ${cloud.updatedAt || 'N/A'}`);
  } else {
    console.log('☁️  Nuvem (Upstash): VAZIO');
  }

  if (rawLocal) {
    const local = JSON.parse(rawLocal);
    localTime = local.updatedAt ? new Date(local.updatedAt).getTime() : 0;
    console.log(`💻 Local (JSON):    ${local.shipments?.length || 0} pacotes | ${local.cdItems?.length || 0} CDs | Atualizado: ${local.updatedAt || local.exportedAt || 'N/A'}`);
  } else {
    console.log('💻 Local (JSON):    NÃO ENCONTRADO');
  }

  console.log('-----------------------------------------------------------');
  if (cloudTime && localTime && cloudTime === localTime) {
    console.log('✨ Status: 100% SINCRONIZADOS (Mesmo timestamp).');
  } else if (cloudTime > localTime) {
    console.log('⚠️ Status: NUVEM MAIS RECENTE que o local (Necessita PULL).');
  } else if (localTime > cloudTime) {
    console.log('⚠️ Status: LOCAL MAIS RECENTE que a nuvem (Necessita PUSH).');
  } else {
    console.log('✨ Status: Bancos verificados.');
  }
}

main().catch((err) => {
  console.error('❌ Erro:', err);
  process.exit(1);
});
