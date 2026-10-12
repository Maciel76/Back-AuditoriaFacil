import os from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { configFromEnv } from './config.js';
import { baixarPlanilha } from './rub.js';

if (process.argv.includes('--self-test')) {
  console.log('Flashub Agente 1.0.0: runtime e automação carregados.');
  process.exit(0);
}
const log = message => console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${message}`);
let config;
try { config = configFromEnv(); } catch (e) { console.error(e.message); process.exit(1); }
// Não repassar credenciais aos processos de navegador que serão iniciados.
for (const key of ['FLASHUB_KEY', 'RUB_USER', 'RUB_PASS']) delete process.env[key];
const shutdown = new AbortController();
let current = null;
let busy = false;
const stop = () => { shutdown.abort(); current?.abort(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.stdin.setEncoding('utf8');
process.stdin.on('data', line => { if (line.trim() === 'stop') stop(); });
// Fechar o launcher encerra o agente, mesmo se o Windows fechar a janela à força.
process.stdin.on('end', stop);

async function request(route, { method = 'POST', body, job, timeout = 30000 } = {}) {
  const headers = { Authorization: `Bearer ${config.chave}`, 'x-agente-id': config.id };
  if (job) headers['x-execucao-token'] = job.token;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  const res = await fetch(config.api + '/automacao/agente' + route, {
    method, headers, body, redirect: 'error', signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(timeout)]),
  });
  if (!res.ok) {
    const error = new Error(`A API respondeu HTTP ${res.status}.`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}
const poll = ocupado => request('/poll', { body: { ocupado, nomeMaquina: os.hostname(), versao: '1.0.0' } });

async function executar(job) {
  busy = true;
  current = new AbortController();
  // Prazo menor que a concessão de 10 minutos no servidor.
  const deadline = setTimeout(() => current?.abort(), 8 * 60000);
  let submitted = false;
  try {
    log(`Iniciando rotina para ${job.dataAlvo}.`);
    const file = await baixarPlanilha(config, job, log, current.signal);
    const form = new FormData();
    form.append('arquivo', new Blob([file.buffer]), file.filename);
    log('Enviando a planilha ao Flashub.');
    try {
      await request(`/jobs/${job.id}/arquivo`, { body: form, job, timeout: 180000 });
      submitted = true;
    } catch (error) {
      // Nunca repetir o envio sem saber se a API já aceitou o arquivo.
      const state = await request(`/jobs/${job.id}`, { method: 'GET', job });
      if (['importando', 'concluida'].includes(state.status)) submitted = true;
      else throw error;
    }
    log('Arquivo recebido. Acompanhe a importação no painel.');
  } catch (e) {
    // Mensagens do Playwright podem conter valores de campos. Não imprimir stack ou dados de entrada.
    log(`Execução não concluída${e.status ? ` (HTTP ${e.status})` : ''}. Verifique rede, credenciais, navegador e etapas da rotina.`);
    if (!submitted && !shutdown.signal.aborted) await request(`/jobs/${job.id}/erro`, { body: {}, job }).catch(() => {});
  } finally { clearTimeout(deadline); busy = false; current = null; }
}

// Batimento independente durante downloads; nunca retira outra tarefa enquanto ocupado.
let beating = false;
const heartbeat = setInterval(async () => {
  if (!busy || beating || shutdown.signal.aborted) return;
  beating = true;
  try { await poll(true); }
  catch (e) { if ([401, 403, 409].includes(e.status)) current?.abort(); }
  finally { beating = false; }
}, 20000);
log('Conectando ao Flashub.');
let online = false;
try {
  while (!shutdown.signal.aborted) {
    try {
      const { job } = await poll(false);
      if (!online) { online = true; log('Online. Aguardando solicitações do painel.'); }
      if (job) await executar(job);
    } catch (e) {
      if (shutdown.signal.aborted) break;
      if (online || !e.status) log('Sem conexão com a API. Nova tentativa em 20 segundos.');
      online = false;
      if ([401, 403, 409].includes(e.status)) {
        log('Conexão recusada. Confira a chave, a loja e se já existe outro agente conectado.');
        break;
      }
    }
    await sleep(20000, undefined, { signal: shutdown.signal }).catch(() => {});
  }
} finally {
  clearInterval(heartbeat);
  log('Agente desconectado.');
  process.exit(0);
}
