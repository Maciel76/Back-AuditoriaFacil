import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from '../../node_modules/mongoose/index.js';
import express from '../../node_modules/express/index.js';
import routes from '../../src/routes/automacao.routes.js';
import { Automacao, AutomacaoJob, ImportacaoLock } from '../../src/models/Automacao.js';
import { Usuario } from '../../src/models/Usuario.js';
import { Loja } from '../../src/models/Loja.js';
import { AuditItem } from '../../src/models/AuditItem.js';
import { assinarToken } from '../../src/utils/jwt.js';
import { errorMiddleware } from '../../src/utils/http.js';
import { processarPlanilha } from '../../src/services/auditoriaProcessor.js';

let mongo, server, base, user, loja, token;
const id = randomUUID();
const rotina = { nome: 'Teste', caminho: '/auditoria', tipo: 'ETIQUETA', intervaloMinutos: 60, usuarioSeletor: '#user', senhaSeletor: '#pass', entrarSeletor: '#login', prontoSeletor: '#ready', downloadSeletor: '#export', passos: [] };
async function call(route, { key = token, agent, job, method = 'GET', body } = {}) {
  const headers = { Authorization: `Bearer ${key}` };
  if (agent) headers['x-agente-id'] = agent;
  if (job) headers['x-execucao-token'] = job.token;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  const res = await fetch(base + route, { method, headers, body });
  return { status: res.status, data: await res.json() };
}
before(async () => {
  mongo = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  await mongoose.connect(mongo.getUri());
  await Promise.all([Automacao.init(), AutomacaoJob.init(), ImportacaoLock.init()]);
  loja = await Loja.create({ nome: 'Loja teste', slug: 'teste' });
  user = await Usuario.create({ nome: 'Admin', email: 'test@example.invalid', senhaHash: 'unused', role: 'STORE_ADMIN', loja: loja._id });
  token = assinarToken({ sub: user.id });
  const app = express(); app.use(express.json()); app.use('/api/automacao', routes); app.use(errorMiddleware);
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/automacao`;
});
after(async () => { if (server) await new Promise(r => server.close(r)); await mongoose.disconnect(); await mongo?.stop(); });

test('conexão, isolamento de lojas, fila atômica e importação única', async () => {
  const generated = await call('/chave', { method: 'POST', body: {} });
  assert.equal(generated.status, 200);
  const key = generated.data.chave;
  const stored = await Automacao.findOne({ loja: loja._id }).select('+chaveHash');
  assert.notEqual(stored.chaveHash, key);
  assert.equal((await call('/')).data.config.chaveHash, undefined);
  assert.equal((await call('/rotina', { method: 'PUT', body: { rotina, habilitada: false } })).status, 200);
  const poll = (agent = id, ocupado = false) => call('/agente/poll', { key, agent, method: 'POST', body: { nomeMaquina: 'TESTE', versao: '1', ocupado } });
  assert.equal((await poll()).status, 200);
  assert.equal((await call('/')).data.online, true);
  assert.equal((await poll(randomUUID())).status, 409);
  const otherLoja = await Loja.create({ nome: 'Outra', slug: 'outra' });
  const otherUser = await Usuario.create({ nome: 'Outro', email: 'other@example.invalid', senhaHash: 'unused', role: 'STORE_ADMIN', loja: otherLoja.id });
  const otherToken = assinarToken({ sub: otherUser.id });
  assert.equal((await call(`/?lojaId=${loja.id}`, { key: otherToken })).data.config, null);
  const queued = await Promise.all(Array.from({ length: 3 }, () => call('/executar', { method: 'POST', body: { dataAlvo: '2026-10-10' } })));
  assert.equal(queued.filter(r => r.status === 202).length, 1);
  assert.equal(queued.filter(r => r.status === 409).length, 2);
  assert.equal((await poll(id, true)).data.job, null);
  const claims = await Promise.all([poll(), poll()]);
  const jobs = claims.map(r => r.data.job).filter(Boolean);
  assert.equal(jobs.length, 1);
  const job = jobs[0];
  assert.equal((await call(`/agente/jobs/${job.id}`, { key, agent: id, job: { token: 'wrong' } })).status, 404);
  const csv = 'SKU,Produto,Situação,Auditado em,Usuário\n00123,Arroz,Atualizado,10/10/2026,10 (João)\n';
  function form(text, filename = 'auditoria.csv') { const data = new FormData(); data.append('arquivo', new Blob([text]), filename); return data; }
  assert.equal((await call(`/agente/jobs/${job.id}/arquivo`, { key, agent: id, job, method: 'POST', body: form(csv.replace('10/10/2026', '09/10/2026')) })).status, 400);
  assert.equal(await AuditItem.countDocuments(), 0);
  assert.equal((await call(`/agente/jobs/${job.id}/arquivo`, { key, agent: id, job, method: 'POST', body: form(csv) })).status, 202);
  assert.equal((await call(`/agente/jobs/${job.id}/arquivo`, { key, agent: id, job, method: 'POST', body: form(csv) })).status, 409);
  let done;
  for (let attempt = 0; attempt < 100; attempt++) {
    done = await AutomacaoJob.findById(job.id);
    if (!done.ativa) break;
    await new Promise(r => setTimeout(r, 50));
  }
  assert.equal(done.status, 'concluida');
  assert.equal(await AuditItem.countDocuments(), 1);
  assert.equal((await AuditItem.findOne()).codigo, '00123');
  assert.equal(await ImportacaoLock.countDocuments(), 0);
  const renewed = await call('/chave', { method: 'POST', body: {} });
  assert.equal(renewed.status, 200);
  assert.equal((await poll()).status, 401);
  assert.equal((await call('/')).data.config.habilitada, false);
  await call('/chave', { method: 'DELETE' });
  assert.equal((await call('/agente/poll', { key: renewed.data.chave, agent: id, method: 'POST', body: { nomeMaquina: 'X', versao: '1' } })).status, 401);
});

test('bloqueio de importação impede colisão entre agente e upload manual', async () => {
  await ImportacaoLock.create({ _id: loja.id });
  await assert.rejects(processarPlanilha({ lojaId: loja.id }), /importação em andamento/);
  assert.equal(await ImportacaoLock.countDocuments(), 1);
  await ImportacaoLock.deleteOne({ _id: loja.id });
});

test('agendamento retoma só uma vez e execuções expiradas não são reimportadas', async () => {
  const { data: { chave: key } } = await call('/chave', { method: 'POST', body: {} });
  await call('/rotina', { method: 'PUT', body: { rotina, habilitada: true } });
  await Automacao.updateOne({ loja: loja.id }, { $set: { proximaExecucao: new Date(0) } });
  const a = { key, agent: id, method: 'POST', body: { nomeMaquina: 'TESTE', versao: '1' } };
  const first = await call('/agente/poll', a);
  assert.ok(first.data.job);
  assert.equal((await call('/agente/poll', a)).data.job, null);
  await AutomacaoJob.updateOne({ _id: first.data.job.id }, { $set: { expiraEm: new Date(0) } });
  assert.equal((await call('/agente/poll', a)).data.job, null);
  assert.equal((await AutomacaoJob.findById(first.data.job.id)).status, 'erro');
});
