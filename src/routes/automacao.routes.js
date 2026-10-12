import { Router } from 'express';
import mongoose from 'mongoose';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Automacao, AutomacaoJob, ImportacaoLock } from '../models/Automacao.js';
import { Loja } from '../models/Loja.js';
import { Usuario, ROLES } from '../models/Usuario.js';
import { autenticar, escopoLoja, exigirEscopoLoja, exigirRole } from '../middlewares/auth.js';
import { upload } from '../middlewares/upload.js';
import { asyncHandler, httpError } from '../utils/http.js';
import { processarPlanilha } from '../services/auditoriaProcessor.js';
import { lerPlanilha } from '../services/planilhaParser.js';
import { hashChave, novaChave, rotinaSchema, diaBrasil, validarDataAlvo } from '../services/automacaoConfig.js';

const router = Router();
const wrap = asyncHandler;
const pacotePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../releases/FlashubAgente-windows-x64.zip');

async function expirarJobs(loja) {
  await AutomacaoJob.updateMany({ loja, ativa: true, status: { $in: ['aguardando', 'executando'] }, expiraEm: { $lt: new Date() } }, {
    $set: { ativa: false, status: 'erro', concluidaEm: new Date(), mensagem: 'Agente não concluiu no prazo. Verifique a máquina e execute novamente.' },
  });
}
async function enfileirar(config, usuario, origem, dataAlvo) {
  if (!config?.chaveFinal || !config.rotina) throw httpError(400, 'Configure a conexão e salve uma rotina primeiro.');
  if (await ImportacaoLock.exists({ _id: String(config.loja) })) throw httpError(409, 'Há uma importação em andamento ou interrompida. Verifique antes de continuar.');
  await expirarJobs(config.loja);
  try {
    return await AutomacaoJob.create({ loja: config.loja, usuario, origem, rotina: rotinaSchema.parse(config.rotina), dataAlvo,
      expiraEm: new Date(Date.now() + 30 * 60000), mensagem: 'Aguardando agente local' });
  } catch (e) {
    if (e.code === 11000) throw httpError(409, 'Já existe uma execução na fila ou em andamento.');
    throw e;
  }
}

// As rotas do agente usam exclusivamente a chave da loja, nunca o JWT do painel.
router.use('/agente', wrap(async (req, _res, next) => {
  const key = String(req.headers.authorization || '').replace(/^Bearer /, '');
  if (!/^flh_[a-f0-9]{64}$/.test(key)) throw httpError(401, 'Chave de conexão inválida');
  const config = await Automacao.findOne({ chaveHash: hashChave(key) });
  if (!config) throw httpError(401, 'Chave revogada ou inválida');
  const [loja, owner] = await Promise.all([Loja.findById(config.loja), Usuario.findById(config.criadoPor)]);
  if (!loja?.ativa || !owner?.ativo || ![ROLES.SUPER_ADMIN, ROLES.STORE_ADMIN].includes(owner.role)
    || (owner.role !== ROLES.SUPER_ADMIN && String(owner.loja) !== String(config.loja))) throw httpError(403, 'Integração desautorizada');
  const agenteId = req.headers['x-agente-id'];
  if (!/^[a-f0-9-]{36}$/.test(agenteId || '')) throw httpError(400, 'Identificador do agente inválido');
  const bound = await Automacao.findOneAndUpdate({ _id: config._id, chaveHash: hashChave(key),
    $or: [{ agenteId }, { agenteId: null }] }, { $set: { agenteId } }, { new: true });
  if (!bound) throw httpError(409, 'Esta chave já está conectada a outra instalação. Gere uma nova chave para trocar de máquina.');
  req.integracao = bound;
  req.agenteId = agenteId;
  next();
}));

router.post('/agente/poll', wrap(async (req, res) => {
  const body = z.object({ nomeMaquina: z.string().max(100), versao: z.string().max(30), ocupado: z.boolean().default(false) }).parse(req.body);
  const c = req.integracao;
  await Automacao.updateOne({ _id: c._id }, { $set: { vistoEm: new Date(), nomeMaquina: body.nomeMaquina, versao: body.versao } });
  if (body.ocupado) return res.json({ job: null });
  await expirarJobs(c.loja);
  // O relógio é do servidor. Se a máquina esteve desligada, executa uma vez e não acumula atrasos.
  if (c.habilitada && c.rotina && (!c.proximaExecucao || c.proximaExecucao <= new Date())) {
    try {
      await enfileirar(c, c.criadoPor, 'agendamento', diaBrasil());
      await Automacao.updateOne({ _id: c._id }, { $set: { proximaExecucao: new Date(Date.now() + c.rotina.intervaloMinutos * 60000) } });
    } catch (e) { if (e.status !== 409) throw e; }
  }
  const token = novaChave();
  const job = await AutomacaoJob.findOneAndUpdate({ loja: c.loja, ativa: true, status: 'aguardando' }, {
    $set: { status: 'executando', agenteId: req.agenteId, tokenHash: hashChave(token), iniciadaEm: new Date(),
      expiraEm: new Date(Date.now() + 10 * 60000), mensagem: 'Acessando o RUB na máquina local' },
  }, { new: true });
  res.json({ job: job ? { id: job.id, token, rotina: job.rotina, dataAlvo: job.dataAlvo } : null });
}));

async function ownedJob(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, 'Execução não encontrada');
  const token = String(req.headers['x-execucao-token'] || '');
  const job = await AutomacaoJob.findOne({ _id: req.params.id, loja: req.integracao.loja, agenteId: req.agenteId, tokenHash: hashChave(token) });
  if (!job) throw httpError(404, 'Execução não encontrada');
  return job;
}
router.get('/agente/jobs/:id', wrap(async (req, res) => {
  const job = await ownedJob(req);
  res.json({ status: job.status, mensagem: job.mensagem });
}));
router.post('/agente/jobs/:id/erro', wrap(async (req, res) => {
  const job = await ownedJob(req);
  // Erros de importação pertencem ao servidor; o agente não pode encerrar uma escrita ativa.
  await AutomacaoJob.updateOne({ _id: job.id, status: 'executando', ativa: true }, {
    $set: { status: 'erro', ativa: false, concluidaEm: new Date(), mensagem: 'Falha na exportação local. Consulte o agente e revise os seletores e o acesso ao RUB.' },
  });
  res.json({ ok: true });
}));
router.post('/agente/jobs/:id/arquivo', wrap(async (req, _res, next) => {
  const job = await ownedJob(req);
  if (job.status !== 'executando' || !job.ativa || job.expiraEm < new Date()) throw httpError(409, 'Execução encerrada ou arquivo já recebido');
  next();
}), upload.single('arquivo'), wrap(async (req, res) => {
  const job = await ownedJob(req);
  if (!req.file || !/\.(xlsx|xlsm|xlsb|xls|csv|ods)$/i.test(req.file.originalname)) throw httpError(400, 'Envie uma planilha Excel, CSV ou ODS');
  let parsed;
  try {
    parsed = lerPlanilha(req.file.buffer, { filename: req.file.originalname, tipoForcado: job.rotina.tipo });
  } catch {
    throw httpError(400, 'Não foi possível ler a planilha. Verifique as colunas obrigatórias e o formato exportado.');
  }
  // Falha antes de substituir dados se a exportação estiver vazia, sem SKU ou fora do dia pedido.
  if (parsed.linhas.some(r => !r.codigo) || !parsed.linhas.some(r => r.auditadoEm)
    || `${parsed.dataAuditoria.getFullYear()}-${String(parsed.dataAuditoria.getMonth() + 1).padStart(2, '0')}-${String(parsed.dataAuditoria.getDate()).padStart(2, '0')}` !== job.dataAlvo) throw httpError(400, 'Planilha sem códigos ou com data diferente da execução. Revise os filtros.');
  const claimed = await AutomacaoJob.findOneAndUpdate({ _id: job.id, ativa: true, status: 'executando', expiraEm: { $gt: new Date() } }, {
    $set: { status: 'importando', mensagem: 'Planilha recebida. Processando no Flashub.' },
  });
  if (!claimed) throw httpError(409, 'Arquivo já recebido ou execução expirada');
  res.status(202).json({ ok: true });
  // Não reprocessar uploads quando a resposta HTTP se perde; o agente consulta o estado persistido.
  void processarPlanilha({ buffer: req.file.buffer, filename: req.file.originalname, lojaId: job.loja,
    usuarioId: job.usuario, tipoForcado: job.rotina.tipo })
    .then(resultado => AutomacaoJob.updateOne({ _id: job.id }, { $set: {
      status: 'concluida', ativa: false, concluidaEm: new Date(), mensagem: 'Planilha importada com sucesso', resultado,
    } }))
    .catch(async () => {
      await AutomacaoJob.updateOne({ _id: job.id }, { $set: { status: 'erro', ativa: false,
        concluidaEm: new Date(), mensagem: 'Falha na importação. Confira a auditoria antes de executar novamente.' } });
    }).catch(() => console.error('[automacao] Não foi possível persistir o resultado da importação. Revise a execução no banco.'));
}));

router.use(autenticar, exigirRole(ROLES.SUPER_ADMIN, ROLES.STORE_ADMIN), escopoLoja, exigirEscopoLoja);
router.use(wrap(async (req, _res, next) => {
  if (!mongoose.isValidObjectId(req.escopoLojaId) || !await Loja.exists({ _id: req.escopoLojaId, ativa: true })) throw httpError(404, 'Loja não encontrada');
  next();
}));
router.get('/', wrap(async (req, res) => {
  await expirarJobs(req.escopoLojaId);
  const [config, historico, lock] = await Promise.all([
    Automacao.findOne({ loja: req.escopoLojaId }).lean(),
    AutomacaoJob.find({ loja: req.escopoLojaId }).select('-rotina -resultado').sort({ createdAt: -1 }).limit(30).lean(),
    ImportacaoLock.findById(String(req.escopoLojaId)).lean(),
  ]);
  res.json({ config, historico, importacaoBloqueada: !!lock, pacoteDisponivel: fs.existsSync(pacotePath),
    online: !!config?.chaveFinal && !!config?.vistoEm && Date.now() - +new Date(config.vistoEm) < 90000 });
}));
router.post('/chave', wrap(async (req, res) => {
  const chave = novaChave();
  await Automacao.findOneAndUpdate({ loja: req.escopoLojaId }, { $set: {
    criadoPor: req.usuario.id, chaveHash: hashChave(chave), chaveFinal: chave.slice(-6), agenteId: null,
    nomeMaquina: null, vistoEm: null, habilitada: false,
  } }, { upsert: true, new: true });
  await AutomacaoJob.updateMany({ loja: req.escopoLojaId, ativa: true, status: { $in: ['aguardando', 'executando'] } }, {
    $set: { ativa: false, status: 'cancelada', mensagem: 'Chave substituída', concluidaEm: new Date() },
  });
  res.json({ chave });
}));
router.delete('/chave', wrap(async (req, res) => {
  await Automacao.updateOne({ loja: req.escopoLojaId }, { $unset: { chaveHash: 1, chaveFinal: 1, agenteId: 1, vistoEm: 1 }, $set: { habilitada: false } });
  await AutomacaoJob.updateMany({ loja: req.escopoLojaId, ativa: true, status: { $in: ['aguardando', 'executando'] } }, {
    $set: { ativa: false, status: 'cancelada', mensagem: 'Conexão revogada', concluidaEm: new Date() },
  });
  res.json({ ok: true });
}));
router.put('/rotina', wrap(async (req, res) => {
  const result = z.object({ rotina: rotinaSchema, habilitada: z.boolean() }).safeParse(req.body);
  if (!result.success) throw httpError(400, 'Preencha os campos da rotina corretamente.', result.error.flatten());
  if (await AutomacaoJob.exists({ loja: req.escopoLojaId, ativa: true })) throw httpError(409, 'Aguarde a execução atual antes de editar a rotina.');
  const config = await Automacao.findOne({ loja: req.escopoLojaId });
  if (!config?.chaveFinal) throw httpError(400, 'Gere a chave de conexão primeiro.');
  config.rotina = result.data.rotina;
  config.habilitada = result.data.habilitada;
  config.proximaExecucao = new Date(Date.now() + config.rotina.intervaloMinutos * 60000);
  await config.save();
  res.json({ ok: true });
}));
router.post('/executar', wrap(async (req, res) => {
  const dataAlvo = req.body?.dataAlvo || diaBrasil();
  if (!validarDataAlvo(dataAlvo)) throw httpError(400, 'Data inválida');
  const config = await Automacao.findOne({ loja: req.escopoLojaId });
  const job = await enfileirar(config, req.usuario.id, 'manual', dataAlvo);
  res.status(202).json({ id: job.id });
}));
router.post('/cancelar', wrap(async (req, res) => {
  await AutomacaoJob.updateMany({ loja: req.escopoLojaId, ativa: true, status: 'aguardando' }, {
    $set: { ativa: false, status: 'cancelada', mensagem: 'Cancelada pelo administrador', concluidaEm: new Date() },
  });
  res.json({ ok: true });
}));
router.get('/download', (req, res, next) => {
  if (!fs.existsSync(pacotePath)) return next(httpError(404, 'Pacote Windows ainda não publicado neste servidor.'));
  res.download(pacotePath, 'FlashubAgente-windows-x64.zip');
});
export default router;
