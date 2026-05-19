import { Router } from "express";
import dayjs from "dayjs";
import {
  autenticar,
  escopoLoja,
  exigirEscopoLoja,
} from "../middlewares/auth.js";
import { autenticarColaborador } from "../middlewares/authColaborador.js";
import { asyncHandler } from "../utils/http.js";
import { MetricaDiaria } from "../models/MetricaDiaria.js";
import { Auditoria, TIPOS_AUDITORIA } from "../models/Auditoria.js";
import { AuditItem } from "../models/AuditItem.js";
import { Colaborador } from "../models/Colaborador.js";
import { Loja } from "../models/Loja.js";
import { ROLES } from "../models/Usuario.js";
import { resolverConquistasPortal } from "../services/conquistasService.js";
import mongoose from "mongoose";

const router = Router();
const FILTRO_ITENS_ATIVOS = { cancelada: { $ne: true } };
const SITUACOES_DASHBOARD_PRESENCA = Object.freeze({
  lidos: "Com Presença e com Estoque",
  naoLidos: "Sem Presença e Com Estoque",
});

function somarSituacaoMapa(situacao) {
  return {
    $sum: {
      $ifNull: [{ $getField: { field: situacao, input: "$situacoes" } }, 0],
    },
  };
}

function resumirPresencaDashboard(row) {
  const itensLidos = Number(row?.presencaComEstoque || 0);
  const itensNaoLidos = Number(row?.semPresencaComEstoque || 0);
  const totalItens = itensLidos + itensNaoLidos;

  return {
    totalItens,
    itensLidos,
    itensNaoLidos,
    taxaConformidade:
      totalItens > 0
        ? Number(((itensLidos / totalItens) * 100).toFixed(2))
        : 0,
  };
}

/**
 * Calcula intervalo de datas a partir do nome do período.
 * Períodos suportados: 1d (hoje), semana, mes, ano, 7d, 30d, 90d, tudo, custom.
 * Para custom: opts.dataInicio e opts.dataFim (strings YYYY-MM-DD).
 */
async function obterDataReferencia({ model = MetricaDiaria, match = {} } = {}) {
  const ultimoRegistro = await model
    .findOne(match)
    .sort({ data: -1 })
    .select({ data: 1 })
    .lean();
  return ultimoRegistro?.data ? dayjs(ultimoRegistro.data) : dayjs();
}

async function intervaloPeriodo(periodo = "1d", opts = {}) {
  const agora = await obterDataReferencia({
    model: opts.model,
    match: opts.match,
  });
  let inicio, fim;

  switch (periodo) {
    case "1d":
    case "hoje":
      inicio = agora.startOf("day");
      fim = agora.endOf("day");
      break;
    case "semana":
    case "7d":
      inicio = agora.subtract(6, "day").startOf("day");
      fim = agora.endOf("day");
      break;
    case "mes":
    case "30d":
      inicio = agora.startOf("month");
      fim = agora.endOf("month");
      break;
    case "90d":
      inicio = agora.subtract(89, "day").startOf("day");
      fim = agora.endOf("day");
      break;
    case "ano":
      inicio = agora.startOf("year");
      fim = agora.endOf("year");
      break;
    case "tudo":
      return {
        inicio: new Date("2020-01-01"),
        fim: agora.endOf("day").toDate(),
      };
    case "custom":
      if (opts.dataInicio && opts.dataFim) {
        return {
          inicio: dayjs(opts.dataInicio).startOf("day").toDate(),
          fim: dayjs(opts.dataFim).endOf("day").toDate(),
        };
      }
      // fall through — sem datas → usa mês corrente
      inicio = agora.startOf("month");
      fim = agora.endOf("month");
      break;
    default:
      inicio = agora.startOf("month");
      fim = agora.endOf("month");
  }

  return { inicio: inicio.toDate(), fim: fim.toDate() };
}

function expressaoDimensaoRelatorio(campo, fallback) {
  return {
    $cond: [
      {
        $or: [{ $eq: [`$${campo}`, null] }, { $eq: [`$${campo}`, ""] }],
      },
      fallback,
      `$${campo}`,
    ],
  };
}

async function montarRelatorioDimensao({
  escopoLojaId,
  periodo,
  tipo,
  dataInicio,
  dataFim,
  campo,
  fallback,
}) {
  const matchBase = {};
  if (escopoLojaId) matchBase.loja = new mongoose.Types.ObjectId(escopoLojaId);
  if (tipo) matchBase.tipo = tipo;

  const { inicio, fim } = await intervaloPeriodo(periodo, {
    dataInicio,
    dataFim,
    model: AuditItem,
    match: { ...matchBase, ...FILTRO_ITENS_ATIVOS },
  });
  const match = {
    ...matchBase,
    ...FILTRO_ITENS_ATIVOS,
    data: { $gte: inicio, $lte: fim },
  };

  const expressaoDimensao = expressaoDimensaoRelatorio(campo, fallback);

  const itemsBase = await AuditItem.aggregate([
    { $match: match },
    {
      $group: {
        _id: expressaoDimensao,
        totalItens: { $sum: 1 },
        totalLidos: {
          $sum: { $cond: [{ $in: ["$conforme", [true, false]] }, 1, 0] },
        },
        conformes: { $sum: { $cond: [{ $eq: ["$conforme", true] }, 1, 0] } },
        naoConformes: {
          $sum: { $cond: [{ $eq: ["$conforme", false] }, 1, 0] },
        },
        custoRuptura: { $sum: { $ifNull: ["$custoRuptura", 0] } },
        pontuacao: { $sum: { $ifNull: ["$pontos", 0] } },
        tipos: { $addToSet: "$tipo" },
        ultimaAuditoriaEm: { $max: "$data" },
      },
    },
    {
      $addFields: {
        semLeitura: {
          $max: [{ $subtract: ["$totalItens", "$totalLidos"] }, 0],
        },
        taxaConformidade: {
          $cond: [
            { $gt: ["$totalLidos", 0] },
            { $multiply: [{ $divide: ["$conformes", "$totalLidos"] }, 100] },
            0,
          ],
        },
      },
    },
    {
      $project: {
        _id: 0,
        nome: "$_id",
        totalItens: 1,
        totalLidos: 1,
        conformes: 1,
        naoConformes: 1,
        semLeitura: 1,
        tipos: 1,
        ultimaAuditoriaEm: 1,
        custoRuptura: { $round: ["$custoRuptura", 2] },
        pontuacao: { $round: ["$pontuacao", 2] },
        taxaConformidade: { $round: ["$taxaConformidade", 2] },
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
          colaborador: "$colaborador",
          colaboradorNome: {
            $cond: [
              {
                $or: [
                  { $eq: ["$colaboradorNome", null] },
                  { $eq: ["$colaboradorNome", ""] },
                ],
              },
              "Sem colaborador",
              "$colaboradorNome",
            ],
          },
          colaboradorCodigo: {
            $cond: [
              {
                $or: [
                  { $eq: ["$colaboradorCodigo", null] },
                  { $eq: ["$colaboradorCodigo", ""] },
                ],
              },
              "-",
              "$colaboradorCodigo",
            ],
          },
        },
        totalItens: { $sum: 1 },
        totalLidos: {
          $sum: { $cond: [{ $in: ["$conforme", [true, false]] }, 1, 0] },
        },
        conformes: { $sum: { $cond: [{ $eq: ["$conforme", true] }, 1, 0] } },
        naoConformes: {
          $sum: { $cond: [{ $eq: ["$conforme", false] }, 1, 0] },
        },
      },
    },
    { $match: { totalLidos: { $gt: 0 } } },
    {
      $lookup: {
        from: "colaboradors",
        localField: "_id.colaborador",
        foreignField: "_id",
        as: "colaborador",
      },
    },
    {
      $project: {
        _id: 0,
        nomeDimensao: "$_id.nomeDimensao",
        nome: "$_id.colaboradorNome",
        codigoExterno: "$_id.colaboradorCodigo",
        avatarUrl: {
          $ifNull: [{ $arrayElemAt: ["$colaborador.avatarUrl", 0] }, ""],
        },
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
      avatarUrl: linha.avatarUrl,
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

async function montarPerfilColaborador({
  colaboradorId,
  escopoLojaId,
  periodo,
  tipo,
  dataInicio,
  dataFim,
}) {
  const filtroColab = escopoLojaId
    ? { _id: colaboradorId, loja: new mongoose.Types.ObjectId(escopoLojaId) }
    : { _id: colaboradorId };
  const colab = await Colaborador.findOne(filtroColab).lean();
  if (!colab) return null;

  const matchColabBase = { colaborador: colab._id };
  if (escopoLojaId)
    matchColabBase.loja = new mongoose.Types.ObjectId(escopoLojaId);
  if (tipo && Object.values(TIPOS_AUDITORIA).includes(tipo))
    matchColabBase.tipo = tipo;

  const { inicio, fim } = await intervaloPeriodo(periodo, {
    dataInicio,
    dataFim,
    match: { ...matchColabBase, cancelada: { $ne: true } },
  });

  const matchColab = {
    ...matchColabBase,
    cancelada: { $ne: true },
    data: { $gte: inicio, $lte: fim },
  };

  const porTipo = await MetricaDiaria.aggregate([
    { $match: matchColab },
    {
      $group: {
        _id: "$tipo",
        totalLidos: { $sum: "$totalLidos" },
        totalConformes: { $sum: "$totalConformes" },
        totalNaoConformes: { $sum: "$totalNaoConformes" },
        pontuacao: { $sum: "$pontuacao" },
      },
    },
  ]);

  const serie = await MetricaDiaria.aggregate([
    { $match: matchColab },
    {
      $group: {
        _id: {
          dia: { $dateToString: { format: "%Y-%m-%d", date: "$data" } },
          tipo: "$tipo",
        },
        totalLidos: { $sum: "$totalLidos" },
        totalConformes: { $sum: "$totalConformes" },
        pontuacao: { $sum: "$pontuacao" },
      },
    },
    { $sort: { "_id.dia": 1 } },
  ]);

  return { colaborador: colab, periodo: { inicio, fim }, porTipo, serie };
}

async function montarPerfilLoja({
  lojaId,
  periodo,
  tipo,
  dataInicio,
  dataFim,
}) {
  if (!mongoose.Types.ObjectId.isValid(lojaId)) return null;

  const lojaObjectId = new mongoose.Types.ObjectId(lojaId);
  const loja = await Loja.findById(lojaObjectId).lean();
  if (!loja) return null;

  const matchMetricasBase = { loja: lojaObjectId, colaborador: null };
  if (tipo) matchMetricasBase.tipo = tipo;

  const { inicio, fim } = await intervaloPeriodo(periodo, {
    dataInicio,
    dataFim,
    match: matchMetricasBase,
  });

  const matchMetricas = {
    ...matchMetricasBase,
    cancelada: { $ne: true },
    data: { $gte: inicio, $lte: fim },
  };

  const calcTaxaPerfil = (tipoAtual, row) => {
    if (tipoAtual === "ETIQUETA") {
      return row.totalItensAuditaveis > 0
        ? Number(((row.totalLidos / row.totalItensAuditaveis) * 100).toFixed(2))
        : 0;
    }
    return row.totalLidos > 0
      ? Number(((row.totalConformes / row.totalLidos) * 100).toFixed(2))
      : 0;
  };

  const porTipo = await MetricaDiaria.aggregate([
    { $match: matchMetricas },
    {
      $group: {
        _id: "$tipo",
        totalLidos: { $sum: "$totalLidos" },
        totalItensAuditaveis: { $sum: "$totalItensAuditaveis" },
        totalConformes: { $sum: "$totalConformes" },
        totalNaoConformes: { $sum: "$totalNaoConformes" },
        pontuacao: { $sum: "$pontuacao" },
        custoRuptura: { $sum: "$custoRuptura" },
        dias: { $sum: 1 },
      },
    },
  ]);

  const totaisPorTipo = {};
  for (const tipoAuditoria of Object.values(TIPOS_AUDITORIA)) {
    const atual = porTipo.find((item) => item._id === tipoAuditoria);
    totaisPorTipo[tipoAuditoria] = atual
      ? {
          totalLidos: atual.totalLidos,
          totalItensAuditaveis: atual.totalItensAuditaveis,
          totalConformes: atual.totalConformes,
          totalNaoConformes: atual.totalNaoConformes,
          pontuacao: Number(atual.pontuacao.toFixed(2)),
          custoRuptura: Number(atual.custoRuptura.toFixed(2)),
          taxaConformidade: calcTaxaPerfil(tipoAuditoria, atual),
          dias: atual.dias,
        }
      : {
          totalLidos: 0,
          totalItensAuditaveis: 0,
          totalConformes: 0,
          totalNaoConformes: 0,
          pontuacao: 0,
          custoRuptura: 0,
          taxaConformidade: 0,
          dias: 0,
        };
  }

  const totalGeral = Object.values(totaisPorTipo).reduce(
    (acumulado, item) => ({
      totalLidos: acumulado.totalLidos + item.totalLidos,
      totalItensAuditaveis:
        acumulado.totalItensAuditaveis + item.totalItensAuditaveis,
      totalConformes: acumulado.totalConformes + item.totalConformes,
      totalNaoConformes: acumulado.totalNaoConformes + item.totalNaoConformes,
      pontuacao: acumulado.pontuacao + item.pontuacao,
      custoRuptura: acumulado.custoRuptura + item.custoRuptura,
    }),
    {
      totalLidos: 0,
      totalItensAuditaveis: 0,
      totalConformes: 0,
      totalNaoConformes: 0,
      pontuacao: 0,
      custoRuptura: 0,
    },
  );
  totalGeral.pontuacao = Number(totalGeral.pontuacao.toFixed(2));
  totalGeral.custoRuptura = Number(totalGeral.custoRuptura.toFixed(2));
  // Taxa geral: soma ponderada. ETIQUETA usa lidos/auditáveis; demais usam conformes/lidos.
  const etiquetaRow = totaisPorTipo["ETIQUETA"];
  const outrosLidos = totalGeral.totalLidos - (etiquetaRow?.totalLidos || 0);
  const outrosConformes =
    totalGeral.totalConformes - (etiquetaRow?.totalConformes || 0);
  const taxaEtiqueta = calcTaxaPerfil(
    "ETIQUETA",
    etiquetaRow || { totalLidos: 0, totalItensAuditaveis: 0 },
  );
  const taxaOutros =
    outrosLidos > 0 ? (outrosConformes / outrosLidos) * 100 : 0;
  const pesoTotal = (etiquetaRow?.totalItensAuditaveis || 0) + outrosLidos;
  totalGeral.taxaConformidade =
    pesoTotal > 0
      ? Number(
          (
            (taxaEtiqueta * (etiquetaRow?.totalItensAuditaveis || 0) +
              taxaOutros * outrosLidos) /
            pesoTotal
          ).toFixed(2),
        )
      : 0;

  const serie = await MetricaDiaria.aggregate([
    { $match: matchMetricas },
    {
      $group: {
        _id: {
          dia: { $dateToString: { format: "%Y-%m-%d", date: "$data" } },
          tipo: "$tipo",
        },
        totalLidos: { $sum: "$totalLidos" },
        totalConformes: { $sum: "$totalConformes" },
        taxaConformidade: { $avg: "$taxaConformidade" },
        pontuacao: { $sum: "$pontuacao" },
      },
    },
    { $sort: { "_id.dia": 1 } },
  ]);

  const matchItens = {
    loja: lojaObjectId,
    ...FILTRO_ITENS_ATIVOS,
    data: { $gte: inicio, $lte: fim },
  };
  if (tipo) matchItens.tipo = tipo;

  const situacoes = await AuditItem.aggregate([
    { $match: matchItens },
    {
      $group: {
        _id: { tipo: "$tipo", situacao: "$situacao" },
        total: { $sum: 1 },
        custoRuptura: { $sum: "$custoRuptura" },
      },
    },
    { $sort: { total: -1 } },
  ]);

  const [{ items: classes }, { items: corredores }] = await Promise.all([
    montarRelatorioDimensao({
      escopoLojaId: lojaObjectId.toString(),
      periodo,
      tipo,
      dataInicio,
      dataFim,
      campo: "classeRaiz",
      fallback: "Sem classe",
    }),
    montarRelatorioDimensao({
      escopoLojaId: lojaObjectId.toString(),
      periodo,
      tipo,
      dataInicio,
      dataFim,
      campo: "local",
      fallback: "Sem corredor",
    }),
  ]);

  const filtroAuditorias = {
    loja: lojaObjectId,
    data: { $gte: inicio, $lte: fim },
  };
  if (tipo) filtroAuditorias.tipo = tipo;

  const filtroAuditoriasAtivas = {
    ...filtroAuditorias,
    status: { $ne: "CANCELADA" },
  };
  const filtroAuditoriasCanceladas = {
    ...filtroAuditorias,
    status: "CANCELADA",
  };

  const [
    colaboradoresAtivos,
    auditoriasNoPeriodo,
    auditoriasCanceladasNoPeriodo,
    ultimasAuditorias,
  ] = await Promise.all([
    Colaborador.countDocuments({ loja: lojaObjectId, ativo: true }),
    Auditoria.countDocuments(filtroAuditoriasAtivas),
    Auditoria.countDocuments(filtroAuditoriasCanceladas),
    Auditoria.find(tipo ? { loja: lojaObjectId, tipo } : { loja: lojaObjectId })
      .sort({ data: -1, createdAt: -1 })
      .limit(6)
      .lean(),
  ]);

  return {
    loja,
    periodo: { inicio, fim, label: periodo },
    totalGeral,
    totaisPorTipo,
    serie,
    situacoes,
    classes,
    corredores,
    colaboradoresAtivos,
    auditoriasNoPeriodo,
    auditoriasCanceladasNoPeriodo,
    ultimasAuditorias,
  };
}

router.get(
  "/portal/me",
  autenticarColaborador,
  asyncHandler(async (req, res) => {
    const dados = await montarPerfilColaborador({
      colaboradorId: req.colaborador._id,
      escopoLojaId: req.escopoLojaId,
      periodo: req.query.periodo || "tudo",
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
    });
    if (!dados)
      return res.status(404).json({ error: "Colaborador não encontrado" });

    const colabId = new mongoose.Types.ObjectId(req.colaborador._id);
    const matchCorredores = { colaborador: colabId, ...FILTRO_ITENS_ATIVOS };
    if (
      req.query.tipo &&
      Object.values(TIPOS_AUDITORIA).includes(req.query.tipo)
    )
      matchCorredores.tipo = req.query.tipo;
    matchCorredores.data = {
      $gte: dados.periodo.inicio,
      $lte: dados.periodo.fim,
    };

    const corredoresAgg = await AuditItem.aggregate([
      { $match: matchCorredores },
      {
        $group: {
          _id: {
            local: { $ifNull: ["$local", "Sem corredor"] },
            tipo: "$tipo",
          },
          totalLidos: { $sum: 1 },
          totalConformes: {
            $sum: { $cond: [{ $eq: ["$conforme", true] }, 1, 0] },
          },
          ultimaData: { $max: "$data" },
        },
      },
      { $sort: { totalLidos: -1 } },
      { $limit: 60 },
    ]);

    const corredoresMap = new Map();
    for (const r of corredoresAgg) {
      const local = r._id.local || "Sem corredor";
      const atual = corredoresMap.get(local) || {
        local,
        totalLidos: 0,
        totalConformes: 0,
        ultimaData: null,
        porTipo: {},
      };
      atual.totalLidos += r.totalLidos;
      atual.totalConformes += r.totalConformes;
      atual.porTipo[r._id.tipo] =
        (atual.porTipo[r._id.tipo] || 0) + r.totalLidos;
      if (!atual.ultimaData || r.ultimaData > atual.ultimaData)
        atual.ultimaData = r.ultimaData;
      corredoresMap.set(local, atual);
    }
    const corredores = [...corredoresMap.values()]
      .map((c) => ({
        ...c,
        taxaConformidade:
          c.totalLidos > 0
            ? Number(((c.totalConformes / c.totalLidos) * 100).toFixed(1))
            : 0,
      }))
      .sort((a, b) => b.totalLidos - a.totalLidos);

    const colabFull = await Colaborador.findById(req.colaborador._id).lean();
    const conquistas = await resolverConquistasPortal(colabFull || {});

    res.json({ ...dados, corredores, conquistas });
  }),
);

router.use(autenticar);

// ============ DASHBOARD: KPIs gerais ============
router.get(
  "/dashboard",
  escopoLoja,
  asyncHandler(async (req, res) => {
    const periodo = req.query.periodo || "1d";
    const matchBase = { colaborador: null };
    if (req.escopoLojaId)
      matchBase.loja = new mongoose.Types.ObjectId(req.escopoLojaId);
    if (req.query.tipo) matchBase.tipo = req.query.tipo;

    const { inicio, fim } = await intervaloPeriodo(periodo, {
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
      match: matchBase,
    });

    // Super admin sem lojaId → visão global (todas as lojas)
    const match = {
      ...matchBase,
      cancelada: { $ne: true },
      data: { $gte: inicio, $lte: fim },
    };

    const porTipo = await MetricaDiaria.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$tipo",
          totalItensAuditaveis: { $sum: "$totalItensAuditaveis" },
          totalLidos: { $sum: "$totalLidos" },
          totalConformes: { $sum: "$totalConformes" },
          totalNaoConformes: { $sum: "$totalNaoConformes" },
          pontuacao: { $sum: "$pontuacao" },
          custoRuptura: { $sum: "$custoRuptura" },
          presencaComEstoque: somarSituacaoMapa(
            SITUACOES_DASHBOARD_PRESENCA.lidos,
          ),
          semPresencaComEstoque: somarSituacaoMapa(
            SITUACOES_DASHBOARD_PRESENCA.naoLidos,
          ),
          dias: { $sum: 1 },
        },
      },
    ]);

    const totaisPorTipo = {};
    for (const t of Object.values(TIPOS_AUDITORIA)) {
      const r = porTipo.find((p) => p._id === t);
      // ETIQUETA: taxa = lidos / auditaveis (cobertura de leitura)
      // PRESENCA/RUPTURA: taxa = conformes / lidos (qualidade)
      const calcTaxa = (tipo, row) => {
        if (tipo === "ETIQUETA") {
          return row.totalItensAuditaveis > 0
            ? Number(
                ((row.totalLidos / row.totalItensAuditaveis) * 100).toFixed(2),
              )
            : 0;
        }
        return row.totalLidos > 0
          ? Number(((row.totalConformes / row.totalLidos) * 100).toFixed(2))
          : 0;
      };
      const resumoPresenca =
        t === TIPOS_AUDITORIA.PRESENCA ? resumirPresencaDashboard(r) : null;
      totaisPorTipo[t] = r
        ? {
            totalItensAuditaveis: resumoPresenca
              ? resumoPresenca.totalItens
              : r.totalItensAuditaveis,
            totalLidos: resumoPresenca ? resumoPresenca.totalItens : r.totalLidos,
            totalConformes: resumoPresenca
              ? resumoPresenca.itensLidos
              : r.totalConformes,
            totalNaoConformes: resumoPresenca
              ? resumoPresenca.itensNaoLidos
              : r.totalNaoConformes,
            pontuacao: Number(r.pontuacao.toFixed(2)),
            custoRuptura: Number(r.custoRuptura.toFixed(2)),
            taxaConformidade: resumoPresenca
              ? resumoPresenca.taxaConformidade
              : calcTaxa(t, r),
            dias: r.dias,
          }
        : {
            totalItensAuditaveis: 0,
            totalLidos: 0,
            totalConformes: 0,
            totalNaoConformes: 0,
            pontuacao: 0,
            custoRuptura: 0,
            taxaConformidade: 0,
            dias: 0,
          };
    }

    const totalGeral = Object.values(totaisPorTipo).reduce(
      (a, b) => ({
        totalItensAuditaveis: a.totalItensAuditaveis + b.totalItensAuditaveis,
        totalLidos: a.totalLidos + b.totalLidos,
        totalConformes: a.totalConformes + b.totalConformes,
        totalNaoConformes: a.totalNaoConformes + b.totalNaoConformes,
        pontuacao: a.pontuacao + b.pontuacao,
        custoRuptura: a.custoRuptura + b.custoRuptura,
      }),
      {
        totalItensAuditaveis: 0,
        totalLidos: 0,
        totalConformes: 0,
        totalNaoConformes: 0,
        pontuacao: 0,
        custoRuptura: 0,
      },
    );
    // Taxa geral: media ponderada por volume de cada tipo
    // ETIQUETA usa lidos/auditaveis; PRESENCA/RUPTURA usam conformes/lidos
    {
      let numerador = 0;
      let denominador = 0;
      const et = totaisPorTipo["ETIQUETA"];
      if (et && et.totalItensAuditaveis > 0) {
        numerador += et.totalLidos;
        denominador += et.totalItensAuditaveis;
      }
      for (const t of ["PRESENCA", "RUPTURA"]) {
        const r = totaisPorTipo[t];
        if (r && r.totalLidos > 0) {
          numerador += r.totalConformes;
          denominador += r.totalLidos;
        }
      }
      totalGeral.taxaConformidade =
        denominador > 0
          ? Number(((numerador / denominador) * 100).toFixed(2))
          : 0;
    }

    // série temporal por dia
    const serieBruta = await MetricaDiaria.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            dia: { $dateToString: { format: "%Y-%m-%d", date: "$data" } },
            tipo: "$tipo",
          },
          totalLidos: { $sum: "$totalLidos" },
          totalConformes: { $sum: "$totalConformes" },
          presencaComEstoque: somarSituacaoMapa(
            SITUACOES_DASHBOARD_PRESENCA.lidos,
          ),
          semPresencaComEstoque: somarSituacaoMapa(
            SITUACOES_DASHBOARD_PRESENCA.naoLidos,
          ),
          taxaConformidade: { $avg: "$taxaConformidade" },
          pontuacao: { $sum: "$pontuacao" },
        },
      },
      { $sort: { "_id.dia": 1 } },
    ]);

    const serie = serieBruta.map((linha) => {
      if (linha._id.tipo !== TIPOS_AUDITORIA.PRESENCA) return linha;
      const resumoPresenca = resumirPresencaDashboard(linha);
      return {
        ...linha,
        totalLidos: resumoPresenca.totalItens,
        totalConformes: resumoPresenca.itensLidos,
        taxaConformidade: resumoPresenca.taxaConformidade,
      };
    });

    const filtroAuditorias = req.escopoLojaId ? { loja: req.escopoLojaId } : {};
    if (req.query.tipo) filtroAuditorias.tipo = req.query.tipo;
    const matchAuditoriasResumo = {
      data: { $gte: inicio, $lte: fim },
      status: { $ne: "CANCELADA" },
      ...(req.escopoLojaId
        ? { loja: new mongoose.Types.ObjectId(req.escopoLojaId) }
        : {}),
      ...(req.query.tipo ? { tipo: req.query.tipo } : {}),
    };
    const matchAuditoriasRuptura = {
      data: { $gte: inicio, $lte: fim },
      tipo: TIPOS_AUDITORIA.RUPTURA,
      status: { $ne: "CANCELADA" },
      ...(req.escopoLojaId
        ? { loja: new mongoose.Types.ObjectId(req.escopoLojaId) }
        : {}),
    };
    const matchProdutosNaoAuditados = {
      ...FILTRO_ITENS_ATIVOS,
      data: { $gte: inicio, $lte: fim },
      ...(req.escopoLojaId
        ? { loja: new mongoose.Types.ObjectId(req.escopoLojaId) }
        : {}),
      ...(req.query.tipo === TIPOS_AUDITORIA.ETIQUETA
        ? {
            tipo: TIPOS_AUDITORIA.ETIQUETA,
            situacao: "Não lidos com estoque",
          }
        : req.query.tipo === TIPOS_AUDITORIA.PRESENCA ||
            req.query.tipo === TIPOS_AUDITORIA.RUPTURA
          ? {
              tipo: req.query.tipo,
              situacao: "Sem Presença e Com Estoque",
            }
          : {
              $or: [
                {
                  tipo: TIPOS_AUDITORIA.ETIQUETA,
                  situacao: "Não lidos com estoque",
                },
                {
                  tipo: TIPOS_AUDITORIA.PRESENCA,
                  situacao: "Sem Presença e Com Estoque",
                },
                {
                  tipo: TIPOS_AUDITORIA.RUPTURA,
                  situacao: "Sem Presença e Com Estoque",
                },
              ],
            }),
    };
    const matchColaboradoresDistintos = {
      data: { $gte: inicio, $lte: fim },
      colaborador: { $ne: null },
      totalLidos: { $gt: 0 },
      ...(req.escopoLojaId
        ? { loja: new mongoose.Types.ObjectId(req.escopoLojaId) }
        : {}),
    };

    // Contagens específicas de ETIQUETA no período (mantidas por compatibilidade)
    const matchEtiquetaBase = {
      tipo: "ETIQUETA",
      ...FILTRO_ITENS_ATIVOS,
      data: { $gte: inicio, $lte: fim },
    };
    if (req.escopoLojaId)
      matchEtiquetaBase.loja = new mongoose.Types.ObjectId(req.escopoLojaId);
    const [
      resumoAuditorias,
      produtosNaoAuditados,
      resumoRuptura,
      colaboradoresDistintos,
      colaboradoresAtivos,
      ultimasAuditorias,
      totalDesatualizados,
      totalNaoLidos,
    ] = await Promise.all([
      Auditoria.aggregate([
        { $match: matchAuditoriasResumo },
        {
          $group: {
            _id: null,
            produtosAuditados: { $sum: { $ifNull: ["$totalLidos", 0] } },
            mediaConclusao: { $avg: { $ifNull: ["$taxaConformidade", 0] } },
          },
        },
      ]),
      AuditItem.countDocuments(matchProdutosNaoAuditados),
      Auditoria.aggregate([
        { $match: matchAuditoriasRuptura },
        {
          $group: {
            _id: null,
            custoRuptura: { $sum: { $ifNull: ["$custoRupturaTotal", 0] } },
          },
        },
      ]),
      MetricaDiaria.distinct("colaborador", matchColaboradoresDistintos),
      Colaborador.countDocuments(
        req.escopoLojaId
          ? { loja: req.escopoLojaId, ativo: true }
          : { ativo: true },
      ),
      Auditoria.find(filtroAuditorias)
        .sort({ data: -1, createdAt: -1 })
        .limit(5)
        .lean(),
      AuditItem.countDocuments({
        ...matchEtiquetaBase,
        situacao: "Desatualizado",
      }),
      AuditItem.countDocuments({
        ...matchEtiquetaBase,
        situacao: "Não lidos com estoque",
      }),
    ]);

    const resumoCardsPresenca =
      req.query.tipo === TIPOS_AUDITORIA.PRESENCA
        ? totaisPorTipo[TIPOS_AUDITORIA.PRESENCA]
        : null;
    const produtosAuditadosResumo = Number(
      resumoCardsPresenca?.totalLidos || resumoAuditorias[0]?.produtosAuditados || 0,
    );
    const mediaConclusaoResumo = Number(
      (
        resumoCardsPresenca?.taxaConformidade ||
        resumoAuditorias[0]?.mediaConclusao ||
        0
      ).toFixed(2),
    );

    const cardsResumo = {
      produtosAuditados: produtosAuditadosResumo,
      mediaConclusao: mediaConclusaoResumo,
      produtosNaoAuditados: Number(produtosNaoAuditados || 0),
      custoRupturaRuptura: Number(
        (resumoRuptura[0]?.custoRuptura || 0).toFixed(2),
      ),
      totalColaboradores: colaboradoresDistintos.length,
    };

    res.json({
      periodo: { inicio, fim, label: req.query.periodo || "1d" },
      totaisPorTipo,
      totalGeral,
      cardsResumo,
      serie,
      colaboradoresAtivos,
      totalDesatualizados,
      totalNaoLidos,
      ultimasAuditorias,
    });
  }),
);

// ============ ÚLTIMA DATA com dados disponíveis ============
router.get(
  "/ultima-data",
  escopoLoja,
  asyncHandler(async (req, res) => {
    const q = { colaborador: null };
    if (req.escopoLojaId)
      q.loja = new mongoose.Types.ObjectId(req.escopoLojaId);
    const ultima = await MetricaDiaria.findOne(q).sort({ data: -1 }).lean();
    res.json({ data: ultima?.data || null });
  }),
);

// ============ RANKING DE COLABORADORES (escopo loja) ============
router.get(
  "/ranking/colaboradores",
  escopoLoja,
  asyncHandler(async (req, res) => {
    const periodo = req.query.periodo || "1d";
    const tipoFilter = req.query.tipo;
    const matchBase = { colaborador: { $ne: null } };
    if (req.escopoLojaId)
      matchBase.loja = new mongoose.Types.ObjectId(req.escopoLojaId);
    if (tipoFilter) matchBase.tipo = tipoFilter;

    const { inicio, fim } = await intervaloPeriodo(periodo, {
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
      match: matchBase,
    });
    const match = {
      ...matchBase,
      cancelada: { $ne: true },
      data: { $gte: inicio, $lte: fim },
    };

    const ranking = await MetricaDiaria.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$colaborador",
          totalLidos: { $sum: "$totalLidos" },
          totalConformes: { $sum: "$totalConformes" },
          totalNaoConformes: { $sum: "$totalNaoConformes" },
          pontuacao: { $sum: "$pontuacao" },
          dias: { $sum: 1 },
        },
      },
      {
        $addFields: {
          taxaConformidade: {
            $cond: [
              { $gt: ["$totalLidos", 0] },
              {
                $multiply: [
                  { $divide: ["$totalConformes", "$totalLidos"] },
                  100,
                ],
              },
              0,
            ],
          },
        },
      },
      { $sort: { pontuacao: -1, totalLidos: -1 } },
      { $limit: 100 },
      {
        $lookup: {
          from: "colaboradors",
          localField: "_id",
          foreignField: "_id",
          as: "colaborador",
        },
      },
      { $unwind: "$colaborador" },
      {
        $project: {
          _id: 1,
          totalLidos: 1,
          totalConformes: 1,
          totalNaoConformes: 1,
          pontuacao: { $round: ["$pontuacao", 2] },
          taxaConformidade: { $round: ["$taxaConformidade", 2] },
          dias: 1,
          nome: "$colaborador.nome",
          codigoExterno: "$colaborador.codigoExterno",
          nivel: "$colaborador.nivel",
          avatarUrl: "$colaborador.avatarUrl",
          conquistas: "$colaborador.conquistas",
        },
      },
    ]);

    res.json({ periodo: { inicio, fim }, items: ranking });
  }),
);

// ============ RANKING DE LOJAS (visão global / super admin) ============
router.get(
  "/ranking/lojas",
  asyncHandler(async (req, res) => {
    const periodo = req.query.periodo || "1d";
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
          _id: "$loja",
          totalLidos: { $sum: "$totalLidos" },
          totalItensAuditaveis: { $sum: "$totalItensAuditaveis" },
          totalConformes: { $sum: "$totalConformes" },
          totalNaoConformes: { $sum: "$totalNaoConformes" },
          pontuacao: { $sum: "$pontuacao" },
          custoRuptura: { $sum: "$custoRuptura" },
          auditoriasCanceladas: {
            $sum: { $cond: [{ $eq: ["$cancelada", true] }, 1, 0] },
          },
        },
      },
      {
        $addFields: {
          taxaConformidade:
            tipoFilter === "ETIQUETA"
              ? {
                  $cond: [
                    { $gt: ["$totalItensAuditaveis", 0] },
                    {
                      $multiply: [
                        { $divide: ["$totalLidos", "$totalItensAuditaveis"] },
                        100,
                      ],
                    },
                    0,
                  ],
                }
              : {
                  $cond: [
                    { $gt: ["$totalLidos", 0] },
                    {
                      $multiply: [
                        { $divide: ["$totalConformes", "$totalLidos"] },
                        100,
                      ],
                    },
                    0,
                  ],
                },
        },
      },
      { $sort: { pontuacao: -1 } },
      { $limit: 100 },
      {
        $lookup: {
          from: "lojas",
          localField: "_id",
          foreignField: "_id",
          as: "loja",
        },
      },
      { $unwind: "$loja" },
      {
        $project: {
          _id: 1,
          nome: "$loja.nome",
          slug: "$loja.slug",
          codigo: "$loja.codigo",
          cidade: "$loja.cidade",
          estado: "$loja.estado",
          avatarUrl: "$loja.avatarUrl",
          nivel: "$loja.nivel",
          totalLidos: 1,
          totalConformes: 1,
          totalNaoConformes: 1,
          pontuacao: { $round: ["$pontuacao", 2] },
          taxaConformidade: { $round: ["$taxaConformidade", 2] },
          custoRuptura: { $round: ["$custoRuptura", 2] },
          auditoriasCanceladas: 1,
        },
      },
    ]);

    // SUPER_ADMIN e STORE_ADMIN enxergam ranking geral de lojas.
    // Perfis fora do escopo administrativo continuam restritos à própria loja.
    let items = ranking;
    if (
      ![ROLES.SUPER_ADMIN, ROLES.STORE_ADMIN].includes(req.usuario.role) &&
      req.usuario.loja
    ) {
      items = ranking.filter((r) => String(r._id) === String(req.usuario.loja));
    }
    res.json({ periodo: { inicio, fim }, items });
  }),
);

// ============ DETALHE DE UM COLABORADOR ============
router.get(
  "/colaboradores/:id/perfil",
  escopoLoja,
  asyncHandler(async (req, res) => {
    const dados = await montarPerfilColaborador({
      colaboradorId: req.params.id,
      escopoLojaId: req.escopoLojaId,
      periodo: req.query.periodo || "tudo",
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
    });
    if (!dados)
      return res.status(404).json({ error: "Colaborador não encontrado" });
    res.json(dados);
  }),
);

// ============ PERFIL PÚBLICO DE LOJA (autenticado) ============
router.get(
  "/lojas/:id/perfil",
  asyncHandler(async (req, res) => {
    const dados = await montarPerfilLoja({
      lojaId: req.params.id,
      periodo: req.query.periodo || "1d",
      tipo: req.query.tipo,
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
    });
    if (!dados) return res.status(404).json({ error: "Loja não encontrada" });
    res.json(dados);
  }),
);

// ============ RELATÓRIOS ============
router.get(
  "/relatorios/situacoes",
  escopoLoja,
  asyncHandler(async (req, res) => {
    const periodo = req.query.periodo || "1d";
    const matchBase = {};
    if (req.escopoLojaId)
      matchBase.loja = new mongoose.Types.ObjectId(req.escopoLojaId);
    if (req.query.tipo) matchBase.tipo = req.query.tipo;

    const { inicio, fim } = await intervaloPeriodo(periodo, {
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
      model: AuditItem,
      match: { ...matchBase, ...FILTRO_ITENS_ATIVOS },
    });
    const match = {
      ...matchBase,
      ...FILTRO_ITENS_ATIVOS,
      data: { $gte: inicio, $lte: fim },
    };

    const r = await AuditItem.aggregate([
      { $match: match },
      {
        $group: {
          _id: { tipo: "$tipo", situacao: "$situacao" },
          total: { $sum: 1 },
          custoRuptura: { $sum: "$custoRuptura" },
        },
      },
      { $sort: { total: -1 } },
    ]);
    res.json({ periodo: { inicio, fim }, items: r });
  }),
);

router.get(
  "/relatorios/classes",
  escopoLoja,
  asyncHandler(async (req, res) => {
    const dados = await montarRelatorioDimensao({
      escopoLojaId: req.escopoLojaId,
      periodo: req.query.periodo || "1d",
      tipo: req.query.tipo,
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
      campo: "classeRaiz",
      fallback: "Sem classe",
    });
    res.json(dados);
  }),
);

router.get(
  "/relatorios/setores",
  escopoLoja,
  asyncHandler(async (req, res) => {
    const dados = await montarRelatorioDimensao({
      escopoLojaId: req.escopoLojaId,
      periodo: req.query.periodo || "1d",
      tipo: req.query.tipo,
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
      campo: "classeRaiz",
      fallback: "Sem classe",
    });
    res.json(dados);
  }),
);

router.get(
  "/relatorios/corredores",
  escopoLoja,
  asyncHandler(async (req, res) => {
    const dados = await montarRelatorioDimensao({
      escopoLojaId: req.escopoLojaId,
      periodo: req.query.periodo || "1d",
      tipo: req.query.tipo,
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
      campo: "local",
      fallback: "Sem corredor",
    });
    res.json(dados);
  }),
);

export default router;
