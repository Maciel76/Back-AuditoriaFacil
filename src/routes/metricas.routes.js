import { Router } from 'express';
import dayjs from 'dayjs';
import { autenticar, escopoLoja, exigirEscopoLoja } from '../middlewares/auth.js';
import { autenticarColaborador } from '../middlewares/authColaborador.js';
import { asyncHandler } from '../utils/http.js';
import { MetricaDiaria } from '../models/MetricaDiaria.js';
import { Auditoria, TIPOS_AUDITORIA } from '../models/Auditoria.js';
import { AuditItem } from '../models/AuditItem.js';
import { Colaborador } from '../models/Colaborador.js';
import { Loja } from '../models/Loja.js';
import mongoose from 'mongoose';

const router = Router();

/**
 * Calcula intervalo de datas a partir do nome do período.
 * Períodos suportados: 1d (hoje), semana, mes, ano, 7d, 30d, 90d, tudo, custom.
 * Para custom: opts.dataInicio e opts.dataFim (strings YYYY-MM-DD).
 */
async function obterDataReferencia({ model = MetricaDiaria, match = {} } = {}) {
  const ultimoRegistro = await model.findOne(match).sort({ data: -1 }).select({ data: 1 }).lean();
  return ultimoRegistro?.data ? dayjs(ultimoRegistro.data) : dayjs();
}

async function intervaloPeriodo(periodo = '1d', opts = {}) {
  const agora = await obterDataReferencia({
    model: opts.model,
    match: opts.match,
  });
  let inicio, fim;

  switch (periodo) {
    case '1d':
    case 'hoje':
      inicio = agora.startOf('day');
      fim    = agora.endOf('day');
      break;
    case 'semana':
    case '7d':
      inicio = agora.subtract(6, 'day').startOf('day');
      fim    = agora.endOf('day');
      break;
    case 'mes':
    case '30d':
      inicio = agora.startOf('month');
      fim    = agora.endOf('month');
      break;
    case '90d':
      inicio = agora.subtract(89, 'day').startOf('day');
      fim    = agora.endOf('day');
      break;
    case 'ano':
      inicio = agora.startOf('year');
      fim    = agora.endOf('year');
      break;
    case 'tudo':
      return { inicio: new Date('2020-01-01'), fim: agora.endOf('day').toDate() };
    case 'custom':
      if (opts.dataInicio && opts.dataFim) {
        return {
          inicio: dayjs(opts.dataInicio).startOf('day').toDate(),
          fim:    dayjs(opts.dataFim).endOf('day').toDate(),
        };
      }
      // fall through — sem datas → usa mês corrente
      inicio = agora.startOf('month');
      fim    = agora.endOf('month');
      break;
    default:
      inicio = agora.startOf('month');
      fim    = agora.endOf('month');
  }

  return { inicio: inicio.toDate(), fim: fim.toDate() };
}

function expressaoDimensaoRelatorio(campo, fallback) {
  return {
    $cond: [
      {
        $or: [
          { $eq: [`$${campo}`, null] },
          { $eq: [`$${campo}`, ''] },
        ],
      },
      fallback,
      `$${campo}`,
    ],
  };
}

async function montarRelatorioDimensao({ escopoLojaId, periodo, tipo, dataInicio, dataFim, campo, fallback }) {
  const matchBase = {};
  if (escopoLojaId) matchBase.loja = new mongoose.Types.ObjectId(escopoLojaId);
  if (tipo) matchBase.tipo = tipo;

  const { inicio, fim } = await intervaloPeriodo(periodo, {
    dataInicio,
    dataFim,
    model: AuditItem,
    match: matchBase,
  });
  const match = { ...matchBase, data: { $gte: inicio, $lte: fim } };

  const expressaoDimensao = expressaoDimensaoRelatorio(campo, fallback);

  const itemsBase = await AuditItem.aggregate([
    { $match: match },
    {
      $group: {
        _id: expressaoDimensao,
        totalItens: { $sum: 1 },
        totalLidos: { $sum: { $cond: [{ $in: ['$conforme', [true, false]] }, 1, 0] } },
        conformes: { $sum: { $cond: [{ $eq: ['$conforme', true] }, 1, 0] } },
        naoConformes: { $sum: { $cond: [{ $eq: ['$conforme', false] }, 1, 0] } },
        custoRuptura: { $sum: { $ifNull: ['$custoRuptura', 0] } },
        pontuacao: { $sum: { $ifNull: ['$pontos', 0] } },
        tipos: { $addToSet: '$tipo' },
        ultimaAuditoriaEm: { $max: '$data' },
      },
    },
    {
      $addFields: {
        semLeitura: { $max: [{ $subtract: ['$totalItens', '$totalLidos'] }, 0] },
        taxaConformidade: {
          $cond: [
            { $gt: ['$totalLidos', 0] },
            { $multiply: [{ $divide: ['$conformes', '$totalLidos'] }, 100] },
            0,
          ],
        },
      },
    },
    {
      $project: {
        _id: 0,
        nome: '$_id',
        totalItens: 1,
        totalLidos: 1,
        conformes: 1,
        naoConformes: 1,
        semLeitura: 1,
        tipos: 1,
        ultimaAuditoriaEm: 1,
        custoRuptura: { $round: ['$custoRuptura', 2] },
        pontuacao: { $round: ['$pontuacao', 2] },
        taxaConformidade: { $round: ['$taxaConformidade', 2] },
      },
    },
    { $sort: { totalLidos: -1, nome: 1 } },
  ]);

  const colaboradoresPorDimensao = await AuditItem.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          nomeDimensao: expressaoDimensao,
          colaboradorNome: {
            $cond: [
              {
                $or: [
                  { $eq: ['$colaboradorNome', null] },
                  { $eq: ['$colaboradorNome', ''] },
                ],
              },
              'Sem colaborador',
              '$colaboradorNome',
            ],
          },
          colaboradorCodigo: {
            $cond: [
              {
                $or: [
                  { $eq: ['$colaboradorCodigo', null] },
                  { $eq: ['$colaboradorCodigo', ''] },
                ],
              },
              '-',
              '$colaboradorCodigo',
            ],
          },
        },
        totalItens: { $sum: 1 },
        totalLidos: { $sum: { $cond: [{ $in: ['$conforme', [true, false]] }, 1, 0] } },
        conformes: { $sum: { $cond: [{ $eq: ['$conforme', true] }, 1, 0] } },
        naoConformes: { $sum: { $cond: [{ $eq: ['$conforme', false] }, 1, 0] } },
      },
    },
    { $match: { totalLidos: { $gt: 0 } } },
    {
      $project: {
        _id: 0,
        nomeDimensao: '$_id.nomeDimensao',
        nome: '$_id.colaboradorNome',
        codigoExterno: '$_id.colaboradorCodigo',
        totalItens: 1,
        totalLidos: 1,
        conformes: 1,
        naoConformes: 1,
      },
    },
    { $sort: { nomeDimensao: 1, totalLidos: -1, nome: 1 } },
  ]);

  const mapaColaboradores = new Map();
  for (const linha of colaboradoresPorDimensao) {
    const chave = linha.nomeDimensao;
    if (!mapaColaboradores.has(chave)) mapaColaboradores.set(chave, []);
    mapaColaboradores.get(chave).push({
      nome: linha.nome,
      codigoExterno: linha.codigoExterno,
      totalItens: linha.totalItens,
      totalLidos: linha.totalLidos,
      conformes: linha.conformes,
      naoConformes: linha.naoConformes,
    });
  }

  const items = itemsBase.map((item) => {
    const colaboradores = mapaColaboradores.get(item.nome) || [];
    return {
      ...item,
      colaboradores,
      totalColaboradores: colaboradores.length,
    };
  });

  return { periodo: { inicio, fim }, items };
}

async function montarPerfilColaborador({ colaboradorId, escopoLojaId, periodo, dataInicio, dataFim }) {
  const filtroColab = escopoLojaId
    ? { _id: colaboradorId, loja: new mongoose.Types.ObjectId(escopoLojaId) }
    : { _id: colaboradorId };
  const colab = await Colaborador.findOne(filtroColab).lean();
  if (!colab) return null;

  const matchColabBase = { colaborador: colab._id };
  if (escopoLojaId) matchColabBase.loja = new mongoose.Types.ObjectId(escopoLojaId);

  const { inicio, fim } = await intervaloPeriodo(periodo, {
    dataInicio,
    dataFim,
    match: matchColabBase,
  });

  const matchColab = { ...matchColabBase, data: { $gte: inicio, $lte: fim } };

  const porTipo = await MetricaDiaria.aggregate([
    { $match: matchColab },
    {
      $group: {
        _id: '$tipo',
        totalLidos: { $sum: '$totalLidos' },
        totalConformes: { $sum: '$totalConformes' },
        totalNaoConformes: { $sum: '$totalNaoConformes' },
        pontuacao: { $sum: '$pontuacao' },
      },
    },
  ]);

  const serie = await MetricaDiaria.aggregate([
    { $match: matchColab },
    {
      $group: {
        _id: { dia: { $dateToString: { format: '%Y-%m-%d', date: '$data' } }, tipo: '$tipo' },
        totalLidos: { $sum: '$totalLidos' },
        totalConformes: { $sum: '$totalConformes' },
        pontuacao: { $sum: '$pontuacao' },
      },
    },
    { $sort: { '_id.dia': 1 } },
  ]);

  return { colaborador: colab, periodo: { inicio, fim }, porTipo, serie };
}

router.get(
  '/portal/me',
  autenticarColaborador,
  asyncHandler(async (req, res) => {
    const dados = await montarPerfilColaborador({
      colaboradorId: req.colaborador._id,
      escopoLojaId: req.escopoLojaId,
      periodo: req.query.periodo || 'tudo',
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
    });
    if (!dados) return res.status(404).json({ error: 'Colaborador não encontrado' });
    res.json(dados);
  })
);

router.use(autenticar);

// ============ DASHBOARD: KPIs gerais ============
router.get(
  '/dashboard',
  escopoLoja,
  asyncHandler(async (req, res) => {
    const periodo = req.query.periodo || '1d';
    const matchBase = { colaborador: null };
    if (req.escopoLojaId) matchBase.loja = new mongoose.Types.ObjectId(req.escopoLojaId);

    const { inicio, fim } = await intervaloPeriodo(periodo, {
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
      match: matchBase,
    });

    // Super admin sem lojaId → visão global (todas as lojas)
    const match = { ...matchBase, data: { $gte: inicio, $lte: fim } };

    const porTipo = await MetricaDiaria.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$tipo',
          totalLidos: { $sum: '$totalLidos' },
          totalConformes: { $sum: '$totalConformes' },
          totalNaoConformes: { $sum: '$totalNaoConformes' },
          pontuacao: { $sum: '$pontuacao' },
          custoRuptura: { $sum: '$custoRuptura' },
          dias: { $sum: 1 },
        },
      },
    ]);

    const totaisPorTipo = {};
    for (const t of Object.values(TIPOS_AUDITORIA)) {
      const r = porTipo.find((p) => p._id === t);
      totaisPorTipo[t] = r
        ? {
            totalLidos: r.totalLidos,
            totalConformes: r.totalConformes,
            totalNaoConformes: r.totalNaoConformes,
            pontuacao: Number(r.pontuacao.toFixed(2)),
            custoRuptura: Number(r.custoRuptura.toFixed(2)),
            taxaConformidade: r.totalLidos ? Number(((r.totalConformes / r.totalLidos) * 100).toFixed(2)) : 0,
            dias: r.dias,
          }
        : { totalLidos: 0, totalConformes: 0, totalNaoConformes: 0, pontuacao: 0, custoRuptura: 0, taxaConformidade: 0, dias: 0 };
    }

    const totalGeral = Object.values(totaisPorTipo).reduce(
      (a, b) => ({
        totalLidos: a.totalLidos + b.totalLidos,
        totalConformes: a.totalConformes + b.totalConformes,
        totalNaoConformes: a.totalNaoConformes + b.totalNaoConformes,
        pontuacao: a.pontuacao + b.pontuacao,
        custoRuptura: a.custoRuptura + b.custoRuptura,
      }),
      { totalLidos: 0, totalConformes: 0, totalNaoConformes: 0, pontuacao: 0, custoRuptura: 0 }
    );
    totalGeral.taxaConformidade = totalGeral.totalLidos
      ? Number(((totalGeral.totalConformes / totalGeral.totalLidos) * 100).toFixed(2))
      : 0;

    // série temporal por dia
    const serie = await MetricaDiaria.aggregate([
      { $match: match },
      {
        $group: {
          _id: { dia: { $dateToString: { format: '%Y-%m-%d', date: '$data' } }, tipo: '$tipo' },
          totalLidos: { $sum: '$totalLidos' },
          totalConformes: { $sum: '$totalConformes' },
          taxaConformidade: { $avg: '$taxaConformidade' },
          pontuacao: { $sum: '$pontuacao' },
        },
      },
      { $sort: { '_id.dia': 1 } },
    ]);

    const colaboradoresAtivos = await Colaborador.countDocuments(
      req.escopoLojaId ? { loja: req.escopoLojaId, ativo: true } : { ativo: true }
    );
    const ultimasAuditorias = await Auditoria.find(req.escopoLojaId ? { loja: req.escopoLojaId } : {})
      .sort({ data: -1, createdAt: -1 })
      .limit(5)
      .lean();

    res.json({
      periodo: { inicio, fim, label: req.query.periodo || '1d' },
      totaisPorTipo,
      totalGeral,
      serie,
      colaboradoresAtivos,
      ultimasAuditorias,
    });
  })
);

// ============ ÚLTIMA DATA com dados disponíveis ============
router.get(
  '/ultima-data',
  escopoLoja,
  asyncHandler(async (req, res) => {
    const q = { colaborador: null };
    if (req.escopoLojaId) q.loja = new mongoose.Types.ObjectId(req.escopoLojaId);
    const ultima = await MetricaDiaria.findOne(q).sort({ data: -1 }).lean();
    res.json({ data: ultima?.data || null });
  })
);

// ============ RANKING DE COLABORADORES (escopo loja) ============
router.get(
  '/ranking/colaboradores',
  escopoLoja,
  asyncHandler(async (req, res) => {
    const periodo = req.query.periodo || '1d';
    const tipoFilter = req.query.tipo;
    const matchBase = { colaborador: { $ne: null } };
    if (req.escopoLojaId) matchBase.loja = new mongoose.Types.ObjectId(req.escopoLojaId);
    if (tipoFilter) matchBase.tipo = tipoFilter;

    const { inicio, fim } = await intervaloPeriodo(periodo, {
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
      match: matchBase,
    });
    const match = { ...matchBase, data: { $gte: inicio, $lte: fim } };

    const ranking = await MetricaDiaria.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$colaborador',
          totalLidos: { $sum: '$totalLidos' },
          totalConformes: { $sum: '$totalConformes' },
          totalNaoConformes: { $sum: '$totalNaoConformes' },
          pontuacao: { $sum: '$pontuacao' },
          dias: { $sum: 1 },
        },
      },
      {
        $addFields: {
          taxaConformidade: {
            $cond: [{ $gt: ['$totalLidos', 0] }, { $multiply: [{ $divide: ['$totalConformes', '$totalLidos'] }, 100] }, 0],
          },
        },
      },
      { $sort: { pontuacao: -1, totalLidos: -1 } },
      { $limit: 100 },
      {
        $lookup: {
          from: 'colaboradors',
          localField: '_id',
          foreignField: '_id',
          as: 'colaborador',
        },
      },
      { $unwind: '$colaborador' },
      {
        $project: {
          _id: 1,
          totalLidos: 1,
          totalConformes: 1,
          totalNaoConformes: 1,
          pontuacao: { $round: ['$pontuacao', 2] },
          taxaConformidade: { $round: ['$taxaConformidade', 2] },
          dias: 1,
          nome: '$colaborador.nome',
          codigoExterno: '$colaborador.codigoExterno',
          nivel: '$colaborador.nivel',
          avatarUrl: '$colaborador.avatarUrl',
          conquistas: '$colaborador.conquistas',
        },
      },
    ]);

    res.json({ periodo: { inicio, fim }, items: ranking });
  })
);

// ============ RANKING DE LOJAS (visão global / super admin) ============
router.get(
  '/ranking/lojas',
  asyncHandler(async (req, res) => {
    const periodo = req.query.periodo || '1d';
    const tipoFilter = req.query.tipo;
    const matchBase = { colaborador: null };
    if (tipoFilter) matchBase.tipo = tipoFilter;

    const { inicio, fim } = await intervaloPeriodo(periodo, {
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
      match: matchBase,
    });
    const match = { ...matchBase, data: { $gte: inicio, $lte: fim } };

    const ranking = await MetricaDiaria.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$loja',
          totalLidos: { $sum: '$totalLidos' },
          totalConformes: { $sum: '$totalConformes' },
          totalNaoConformes: { $sum: '$totalNaoConformes' },
          pontuacao: { $sum: '$pontuacao' },
          custoRuptura: { $sum: '$custoRuptura' },
        },
      },
      {
        $addFields: {
          taxaConformidade: {
            $cond: [{ $gt: ['$totalLidos', 0] }, { $multiply: [{ $divide: ['$totalConformes', '$totalLidos'] }, 100] }, 0],
          },
        },
      },
      { $sort: { pontuacao: -1 } },
      { $limit: 100 },
      { $lookup: { from: 'lojas', localField: '_id', foreignField: '_id', as: 'loja' } },
      { $unwind: '$loja' },
      {
        $project: {
          _id: 1,
          nome: '$loja.nome',
          slug: '$loja.slug',
          codigo: '$loja.codigo',
          cidade: '$loja.cidade',
          estado: '$loja.estado',
          nivel: '$loja.nivel',
          totalLidos: 1,
          totalConformes: 1,
          totalNaoConformes: 1,
          pontuacao: { $round: ['$pontuacao', 2] },
          taxaConformidade: { $round: ['$taxaConformidade', 2] },
          custoRuptura: { $round: ['$custoRuptura', 2] },
        },
      },
    ]);

    // se não for super admin, retorna apenas a própria loja
    let items = ranking;
    if (req.usuario.role !== 'SUPER_ADMIN' && req.usuario.loja) {
      items = ranking.filter((r) => String(r._id) === String(req.usuario.loja));
    }
    res.json({ periodo: { inicio, fim }, items });
  })
);

// ============ DETALHE DE UM COLABORADOR ============
router.get(
  '/colaboradores/:id/perfil',
  escopoLoja,
  asyncHandler(async (req, res) => {
    const dados = await montarPerfilColaborador({
      colaboradorId: req.params.id,
      escopoLojaId: req.escopoLojaId,
      periodo: req.query.periodo || 'tudo',
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
    });
    if (!dados) return res.status(404).json({ error: 'Colaborador não encontrado' });
    res.json(dados);
  })
);

// ============ RELATÓRIOS ============
router.get(
  '/relatorios/situacoes',
  escopoLoja,
  asyncHandler(async (req, res) => {
    const periodo = req.query.periodo || '1d';
    const matchBase = {};
    if (req.escopoLojaId) matchBase.loja = new mongoose.Types.ObjectId(req.escopoLojaId);
    if (req.query.tipo) matchBase.tipo = req.query.tipo;

    const { inicio, fim } = await intervaloPeriodo(periodo, {
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
      model: AuditItem,
      match: matchBase,
    });
    const match = { ...matchBase, data: { $gte: inicio, $lte: fim } };

    const r = await AuditItem.aggregate([
      { $match: match },
      { $group: { _id: { tipo: '$tipo', situacao: '$situacao' }, total: { $sum: 1 }, custoRuptura: { $sum: '$custoRuptura' } } },
      { $sort: { total: -1 } },
    ]);
    res.json({ periodo: { inicio, fim }, items: r });
  })
);

router.get(
  '/relatorios/classes',
  escopoLoja,
  asyncHandler(async (req, res) => {
    const dados = await montarRelatorioDimensao({
      escopoLojaId: req.escopoLojaId,
      periodo: req.query.periodo || '1d',
      tipo: req.query.tipo,
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
      campo: 'classeRaiz',
      fallback: 'Sem classe',
    });
    res.json(dados);
  })
);

router.get(
  '/relatorios/setores',
  escopoLoja,
  asyncHandler(async (req, res) => {
    const dados = await montarRelatorioDimensao({
      escopoLojaId: req.escopoLojaId,
      periodo: req.query.periodo || '1d',
      tipo: req.query.tipo,
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
      campo: 'classeRaiz',
      fallback: 'Sem classe',
    });
    res.json(dados);
  })
);

router.get(
  '/relatorios/corredores',
  escopoLoja,
  asyncHandler(async (req, res) => {
    const dados = await montarRelatorioDimensao({
      escopoLojaId: req.escopoLojaId,
      periodo: req.query.periodo || '1d',
      tipo: req.query.tipo,
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
      campo: 'local',
      fallback: 'Sem corredor',
    });
    res.json(dados);
  })
);

export default router;
