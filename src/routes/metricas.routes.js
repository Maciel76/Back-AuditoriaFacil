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
import { tituloLojaPerfil, fundoLojaPerfil, mascoteLojaPerfil } from "../services/lojaPortalService.js";
import { classificar, REGRAS } from "../services/regras.js";
import mongoose from "mongoose";

const router = Router();
const FILTRO_ITENS_ATIVOS = { cancelada: { $ne: true } };
const SITUACOES_DASHBOARD_PRESENCA = Object.freeze({
  lidos: "Com Presença e com Estoque",
  naoLidos: "Sem Presença e Com Estoque",
});
const SITUACOES_FILTRO_RELATORIO_CORREDOR = Object.freeze({
  [TIPOS_AUDITORIA.ETIQUETA]: Object.freeze({
    naoLidos: "Não lidos com estoque",
  }),
  [TIPOS_AUDITORIA.PRESENCA]: Object.freeze({
    naoLidos: SITUACOES_DASHBOARD_PRESENCA.naoLidos,
  }),
  [TIPOS_AUDITORIA.RUPTURA]: Object.freeze({
    naoLidos: SITUACOES_DASHBOARD_PRESENCA.naoLidos,
  }),
});
const SITUACOES_LIDAS_RUPTURA = Object.freeze(
  Object.entries(REGRAS[TIPOS_AUDITORIA.RUPTURA]?.situacoes || {})
    .filter(([, regra]) => regra?.conta)
    .map(([situacao]) => situacao),
);

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
      totalItens > 0 ? Number(((itensLidos / totalItens) * 100).toFixed(2)) : 0,
  };
}

function inicioSemanaOperacional(data) {
  const dia = dayjs(data).startOf("day");
  if (!dia.isValid()) return null;
  const deslocamento = (dia.day() + 6) % 7;
  return dia.subtract(deslocamento, "day");
}

function chaveDiaOperacional(data) {
  const dia = dayjs(data).startOf("day");
  return dia.isValid() ? dia.format("YYYY-MM-DD") : null;
}

function chavePresencaReferenciaRuptura(dataRuptura) {
  const ruptura = dayjs(dataRuptura).startOf("day");
  if (!ruptura.isValid()) return null;

  const presencaAnterior = ruptura.subtract(1, "day");
  const semanaRuptura = inicioSemanaOperacional(ruptura);
  const semanaPresenca = inicioSemanaOperacional(presencaAnterior);

  if (!semanaRuptura || !semanaPresenca) return null;
  if (!semanaRuptura.isSame(semanaPresenca, "day")) return null;

  return presencaAnterior.format("YYYY-MM-DD");
}

function intervaloPresencaReferencia(inicio, fim) {
  return {
    inicio: dayjs(inicio).subtract(1, "day").startOf("day").toDate(),
    fim: dayjs(fim).subtract(1, "day").endOf("day").toDate(),
  };
}

function resumirRupturaIntegradaDashboard(
  rupturaRow,
  presencaAnteriorRow,
  dataRuptura = rupturaRow?._id?.dia || rupturaRow?.data,
) {
  if (!chavePresencaReferenciaRuptura(dataRuptura) || !presencaAnteriorRow) {
    return {
      basePresenca: 0,
      itensConcluidos: 0,
      itensRestantes: 0,
      taxaConformidade: 0,
    };
  }

  const basePresenca =
    Number(presencaAnteriorRow?.presencaComEstoque || 0) +
    Number(presencaAnteriorRow?.semPresencaComEstoque || 0);
  const itensRestantes = Number(rupturaRow?.semPresencaComEstoque || 0);
  const itensConcluidos = Math.max(basePresenca - itensRestantes, 0);

  return {
    basePresenca,
    itensConcluidos,
    itensRestantes,
    taxaConformidade:
      basePresenca > 0
        ? Number(((itensConcluidos / basePresenca) * 100).toFixed(2))
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

function criarAcumuladorContinuidadeRuptura() {
  return {
    baseContinuidade: 0,
    concluidosContinuidade: 0,
    restantesContinuidade: 0,
  };
}

function acumularContinuidadeRuptura(acumulado, resumo) {
  if (!resumo?.basePresenca) return acumulado;

  acumulado.baseContinuidade += Number(resumo.basePresenca || 0);
  acumulado.concluidosContinuidade += Number(resumo.itensConcluidos || 0);
  acumulado.restantesContinuidade += Number(resumo.itensRestantes || 0);
  return acumulado;
}

function taxaContinuidadeRuptura(acumulado, casas = 2) {
  if (!acumulado?.baseContinuidade) return 0;
  return Number(
    (
      (Number(acumulado.concluidosContinuidade || 0) /
        Number(acumulado.baseContinuidade || 0)) *
      100
    ).toFixed(casas),
  );
}

function aplicarContinuidadeRupturaAoResumo(item, acumulado) {
  if (!acumulado?.baseContinuidade) return item;

  return {
    ...item,
    baseContinuidade: Number(acumulado.baseContinuidade || 0),
    concluidosContinuidade: Number(acumulado.concluidosContinuidade || 0),
    restantesContinuidade: Number(acumulado.restantesContinuidade || 0),
    taxaConformidade: taxaContinuidadeRuptura(acumulado),
  };
}

async function carregarMapaContinuidadeRupturaPorGrupo({
  escopoLojaId,
  inicio,
  fim,
  expressaoGrupo,
}) {
  const matchEscopo = escopoLojaId
    ? { loja: new mongoose.Types.ObjectId(escopoLojaId) }
    : {};
  const intervaloReferencia = intervaloPresencaReferencia(inicio, fim);

  const [presencas, rupturas] = await Promise.all([
    AuditItem.aggregate([
      {
        $match: {
          ...matchEscopo,
          ...FILTRO_ITENS_ATIVOS,
          tipo: TIPOS_AUDITORIA.PRESENCA,
          data: {
            $gte: intervaloReferencia.inicio,
            $lte: intervaloReferencia.fim,
          },
        },
      },
      {
        $group: {
          _id: {
            grupo: expressaoGrupo,
            dia: { $dateToString: { format: "%Y-%m-%d", date: "$data" } },
          },
          presencaComEstoque: {
            $sum: {
              $cond: [
                { $eq: ["$situacao", SITUACOES_DASHBOARD_PRESENCA.lidos] },
                1,
                0,
              ],
            },
          },
          semPresencaComEstoque: {
            $sum: {
              $cond: [
                { $eq: ["$situacao", SITUACOES_DASHBOARD_PRESENCA.naoLidos] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
    AuditItem.aggregate([
      {
        $match: {
          ...matchEscopo,
          ...FILTRO_ITENS_ATIVOS,
          tipo: TIPOS_AUDITORIA.RUPTURA,
          data: { $gte: inicio, $lte: fim },
        },
      },
      {
        $group: {
          _id: {
            grupo: expressaoGrupo,
            dia: { $dateToString: { format: "%Y-%m-%d", date: "$data" } },
          },
          semPresencaComEstoque: {
            $sum: {
              $cond: [
                { $eq: ["$situacao", SITUACOES_DASHBOARD_PRESENCA.naoLidos] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  const presencaPorGrupoDia = new Map(
    presencas.map((linha) => [`${linha._id.grupo}|${linha._id.dia}`, linha]),
  );
  const continuidadePorGrupo = new Map();

  for (const ruptura of rupturas) {
    const diaPresencaAnterior = chavePresencaReferenciaRuptura(ruptura._id.dia);
    if (!diaPresencaAnterior) continue;

    const resumo = resumirRupturaIntegradaDashboard(
      ruptura,
      presencaPorGrupoDia.get(`${ruptura._id.grupo}|${diaPresencaAnterior}`),
      ruptura._id.dia,
    );

    if (!resumo.basePresenca) continue;

    const acumulado =
      continuidadePorGrupo.get(ruptura._id.grupo) ||
      criarAcumuladorContinuidadeRuptura();
    continuidadePorGrupo.set(
      ruptura._id.grupo,
      acumularContinuidadeRuptura(acumulado, resumo),
    );
  }

  return continuidadePorGrupo;
}

async function carregarPresencaReferenciaMetricasPorDia({
  lojaId,
  colaboradorId,
  inicio,
  fim,
}) {
  const intervaloReferencia = intervaloPresencaReferencia(inicio, fim);
  const match = {
    cancelada: { $ne: true },
    tipo: TIPOS_AUDITORIA.PRESENCA,
    data: {
      $gte: intervaloReferencia.inicio,
      $lte: intervaloReferencia.fim,
    },
  };

  if (lojaId) match.loja = new mongoose.Types.ObjectId(lojaId);
  if (colaboradorId === null) match.colaborador = null;
  else if (colaboradorId) {
    match.colaborador = new mongoose.Types.ObjectId(colaboradorId);
  }

  const linhas = await MetricaDiaria.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          dia: { $dateToString: { format: "%Y-%m-%d", date: "$data" } },
        },
        presencaComEstoque: {
          $sum: somarSituacaoMapa(SITUACOES_DASHBOARD_PRESENCA.lidos),
        },
        semPresencaComEstoque: {
          $sum: somarSituacaoMapa(SITUACOES_DASHBOARD_PRESENCA.naoLidos),
        },
      },
    },
  ]);

  return new Map(linhas.map((linha) => [linha._id.dia, linha]));
}

function resumirLinhaSerieRupturaContinuada(linha, presencaReferenciaPorDia) {
  if (linha?._id?.tipo !== TIPOS_AUDITORIA.RUPTURA) return null;

  const diaPresencaAnterior = chavePresencaReferenciaRuptura(linha._id.dia);
  if (!diaPresencaAnterior) return null;

  return resumirRupturaIntegradaDashboard(
    {
      semPresencaComEstoque: Number(linha.semPresencaComEstoque || 0),
    },
    presencaReferenciaPorDia.get(diaPresencaAnterior),
    linha._id.dia,
  );
}

function aplicarContinuidadeRupturaNaLinhaSerie(
  linha,
  presencaReferenciaPorDia,
) {
  const resumo = resumirLinhaSerieRupturaContinuada(
    linha,
    presencaReferenciaPorDia,
  );
  if (!resumo?.basePresenca) return linha;

  return {
    ...linha,
    baseContinuidade: Number(resumo.basePresenca || 0),
    concluidosContinuidade: Number(resumo.itensConcluidos || 0),
    restantesContinuidade: Number(resumo.itensRestantes || 0),
    taxaConformidade: Number(resumo.percentualConclusao || 0),
  };
}

function resumirContinuidadeRupturaDaSerie(serie, presencaReferenciaPorDia) {
  return (serie || []).reduce((acumulado, linha) => {
    const resumo = resumirLinhaSerieRupturaContinuada(
      linha,
      presencaReferenciaPorDia,
    );
    return acumularContinuidadeRuptura(acumulado, resumo);
  }, criarAcumuladorContinuidadeRuptura());
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

  if (tipo === TIPOS_AUDITORIA.RUPTURA) {
    const continuidadePorDimensao =
      await carregarMapaContinuidadeRupturaPorGrupo({
        escopoLojaId,
        inicio,
        fim,
        expressaoGrupo: expressaoDimensao,
      });

    return {
      periodo: { inicio, fim },
      items: items.map((item) =>
        aplicarContinuidadeRupturaAoResumo(
          item,
          continuidadePorDimensao.get(item.nome),
        ),
      ),
    };
  }

  return { periodo: { inicio, fim }, items };
}

function criarResumoRelatorioCorredor(local) {
  return {
    local,
    totalItens: 0,
    totalLidos: 0,
    conformes: 0,
    naoConformes: 0,
    custoRuptura: 0,
    pontuacao: 0,
    ultimaAuditoriaEm: null,
    tipos: new Set(),
    participantesMap: new Map(),
  };
}

function atualizarMetricasRelatorioCorredor(resumo, item, cls) {
  if (item?.tipo) resumo.tipos.add(item.tipo);
  resumo.custoRuptura += Number(item?.custoRuptura || 0);
  resumo.pontuacao += Number(item?.pontos || 0);

  const dataMovimento =
    item?.auditadoEm ||
    item?.updatedAt ||
    item?.createdAt ||
    item?.data ||
    null;
  if (
    dataMovimento &&
    (!resumo.ultimaAuditoriaEm ||
      new Date(dataMovimento) > new Date(resumo.ultimaAuditoriaEm))
  ) {
    resumo.ultimaAuditoriaEm = dataMovimento;
  }

  if (cls.conforme !== null) resumo.totalItens += 1;
  if (cls.conta) resumo.totalLidos += 1;
  if (cls.conta && cls.conforme === true) resumo.conformes += 1;
  if (cls.conta && cls.conforme === false) resumo.naoConformes += 1;
}

function calcularTaxaResumoRelatorioCorredor(resumo, tipoSelecionado = "") {
  const tiposResumo = Array.from(resumo?.tipos || []).filter(Boolean);
  const tipoBase =
    tipoSelecionado || (tiposResumo.length === 1 ? tiposResumo[0] : "");

  return calcularTaxaConformidadeCorredor(tipoBase, {
    totalItensAuditaveis: Number(resumo?.totalItens || 0),
    totalLidos: Number(resumo?.totalLidos || 0),
    totalConformes: Number(resumo?.conformes || 0),
  });
}

function finalizarResumoRelatorioCorredor(resumo, tipoSelecionado = "") {
  const participantes = Array.from(resumo.participantesMap.values())
    .filter((participante) => participante.totalLidos > 0)
    .sort((a, b) => {
      if ((a.totalLidos || 0) !== (b.totalLidos || 0)) {
        return (b.totalLidos || 0) - (a.totalLidos || 0);
      }
      return a.nome.localeCompare(b.nome, "pt-BR");
    })
    .map((participante) => ({
      nome: participante.nome,
      codigoExterno: participante.codigoExterno,
      avatarUrl: participante.avatarUrl,
      totalItens: participante.totalItens,
      totalLidos: participante.totalLidos,
      conformes: participante.conformes,
      naoConformes: participante.naoConformes,
    }));

  const taxaConformidade = calcularTaxaResumoRelatorioCorredor(
    resumo,
    tipoSelecionado,
  );

  return {
    nome: resumo.local,
    totalItens: resumo.totalItens,
    totalLidos: resumo.totalLidos,
    conformes: resumo.conformes,
    naoConformes: resumo.naoConformes,
    semLeitura: Math.max(resumo.totalItens - resumo.totalLidos, 0),
    tipos: Array.from(resumo.tipos),
    ultimaAuditoriaEm: resumo.ultimaAuditoriaEm,
    custoRuptura: Number(resumo.custoRuptura.toFixed(2)),
    pontuacao: Number(resumo.pontuacao.toFixed(2)),
    taxaConformidade,
    colaboradores: participantes,
    totalColaboradores: participantes.length,
  };
}

async function carregarItensRelatorioCorredor({
  escopoLojaId,
  periodo,
  tipo,
  dataInicio,
  dataFim,
  matchExtra = {},
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
    ...matchExtra,
    data: { $gte: inicio, $lte: fim },
  };

  const items = await AuditItem.find(match)
    .select({
      _id: 1,
      tipo: 1,
      situacao: 1,
      local: 1,
      codigo: 1,
      produto: 1,
      classeRaiz: 1,
      setor: 1,
      colaborador: 1,
      colaboradorCodigo: 1,
      colaboradorNome: 1,
      custoRuptura: 1,
      pontos: 1,
      estoqueAtual: 1,
      diasSemVenda: 1,
      ultimaCompraEm: 1,
      data: 1,
      auditadoEm: 1,
      updatedAt: 1,
      createdAt: 1,
    })
    .lean();

  return { inicio, fim, items };
}

async function montarRelatorioCorredores({
  escopoLojaId,
  periodo,
  tipo,
  dataInicio,
  dataFim,
}) {
  const { inicio, fim, items } = await carregarItensRelatorioCorredor({
    escopoLojaId,
    periodo,
    tipo,
    dataInicio,
    dataFim,
  });

  const corredoresMap = new Map();
  const colaboradoresIds = new Set();

  for (const item of items) {
    const local = normalizarLocalCorredor(item.local);
    const cls = classificar(item.tipo, item.situacao);
    const corredorAtual =
      corredoresMap.get(local) || criarResumoRelatorioCorredor(local);

    atualizarMetricasRelatorioCorredor(corredorAtual, item, cls);

    const participanteId = item.colaborador ? String(item.colaborador) : null;
    const participanteKey =
      participanteId ||
      `sem:${item.colaboradorCodigo || item.colaboradorNome || "colaborador"}`;
    const participanteAtual = corredorAtual.participantesMap.get(
      participanteKey,
    ) || {
      colaboradorId: participanteId,
      codigoExterno: item.colaboradorCodigo || "",
      nome: item.colaboradorNome || "Sem colaborador",
      avatarUrl: "",
      totalItens: 0,
      totalLidos: 0,
      conformes: 0,
      naoConformes: 0,
    };

    if (cls.conforme !== null) participanteAtual.totalItens += 1;
    if (cls.conta) participanteAtual.totalLidos += 1;
    if (cls.conta && cls.conforme === true) participanteAtual.conformes += 1;
    if (cls.conta && cls.conforme === false)
      participanteAtual.naoConformes += 1;

    corredorAtual.participantesMap.set(participanteKey, participanteAtual);
    corredoresMap.set(local, corredorAtual);

    if (participanteId) colaboradoresIds.add(participanteId);
  }

  if (colaboradoresIds.size) {
    const colaboradores = await Colaborador.find({
      _id: { $in: Array.from(colaboradoresIds) },
    })
      .select({ _id: 1, avatarUrl: 1 })
      .lean();
    const avatarPorColaborador = new Map(
      colaboradores.map((colaborador) => [
        String(colaborador._id),
        colaborador.avatarUrl || "",
      ]),
    );

    for (const corredor of corredoresMap.values()) {
      for (const participante of corredor.participantesMap.values()) {
        if (participante.colaboradorId) {
          participante.avatarUrl =
            avatarPorColaborador.get(participante.colaboradorId) || "";
        }
      }
    }
  }

  const itemsResumo = Array.from(corredoresMap.values())
    .map((corredor) => finalizarResumoRelatorioCorredor(corredor, tipo))
    .filter((corredor) => corredor.totalItens > 0)
    .sort(
      (a, b) =>
        b.totalLidos - a.totalLidos || a.nome.localeCompare(b.nome, "pt-BR"),
    );

  if (tipo === TIPOS_AUDITORIA.RUPTURA) {
    const continuidadePorCorredor =
      await carregarMapaContinuidadeRupturaPorGrupo({
        escopoLojaId,
        inicio,
        fim,
        expressaoGrupo: expressaoDimensaoRelatorio("local", "Sem corredor"),
      });

    return {
      periodo: { inicio, fim },
      items: itemsResumo.map((item) =>
        aplicarContinuidadeRupturaAoResumo(
          item,
          continuidadePorCorredor.get(item.nome),
        ),
      ),
    };
  }

  return { periodo: { inicio, fim }, items: itemsResumo };
}

function calcularDiasSemVendaRelatorio(item) {
  const diasSemVenda = Number(item?.diasSemVenda);
  if (Number.isFinite(diasSemVenda) && diasSemVenda >= 0) {
    return Math.round(diasSemVenda);
  }

  const ultimaVenda = item?.ultimaCompraEm ? dayjs(item.ultimaCompraEm) : null;
  if (!ultimaVenda?.isValid()) return null;

  const referenciaBase =
    item?.auditadoEm || item?.data || item?.updatedAt || item?.createdAt;
  const referencia = referenciaBase ? dayjs(referenciaBase) : dayjs();
  if (!referencia.isValid()) return null;

  return Math.max(
    referencia.startOf("day").diff(ultimaVenda.startOf("day"), "day"),
    0,
  );
}

function serializarProdutoRelatorioCorredor(item, cls) {
  return {
    _id: item._id,
    codigo: item.codigo || "-",
    produto: item.produto || "Produto sem descrição",
    classeRaiz: item.classeRaiz || "",
    setor: item.setor || "",
    colaboradorNome: item.colaboradorNome || "Sem colaborador",
    colaboradorCodigo: item.colaboradorCodigo || "",
    situacao: item.situacao || "Sem situação",
    tipo: item.tipo || "",
    conforme: cls.conforme,
    foiLido: Boolean(cls.conta),
    estoqueAtual: item.estoqueAtual,
    diasSemVenda: calcularDiasSemVendaRelatorio(item),
    ultimaVendaEm: item.ultimaCompraEm || null,
    auditadoEm:
      item.auditadoEm || item.updatedAt || item.createdAt || item.data || null,
  };
}

function resolverFiltroLeituraRelatorioCorredor(item, cls) {
  if (cls.conforme === null) return "ignorar";

  const situacaoNaoLida =
    SITUACOES_FILTRO_RELATORIO_CORREDOR[item?.tipo]?.naoLidos || null;

  if (situacaoNaoLida) {
    return item?.situacao === situacaoNaoLida ? "nao-lido" : "lido";
  }

  return cls.conta ? "lido" : "nao-lido";
}

async function montarDetalheRelatorioCorredor({
  escopoLojaId,
  periodo,
  tipo,
  dataInicio,
  dataFim,
  corredor,
}) {
  const { inicio, fim, items } = await carregarItensRelatorioCorredor({
    escopoLojaId,
    periodo,
    tipo,
    dataInicio,
    dataFim,
    matchExtra: montarMatchLocalCorredor(corredor),
  });

  const itensLidos = [];
  const itensNaoLidos = [];
  let semEstoqueIgnorados = 0;

  for (const item of items) {
    const cls = classificar(item.tipo, item.situacao);
    const filtroLeitura = resolverFiltroLeituraRelatorioCorredor(item, cls);

    if (filtroLeitura === "ignorar") {
      semEstoqueIgnorados += 1;
      continue;
    }

    const produto = {
      ...serializarProdutoRelatorioCorredor(item, cls),
      foiLido: filtroLeitura === "lido",
    };

    if (filtroLeitura === "lido") itensLidos.push(produto);
    else itensNaoLidos.push(produto);
  }

  itensLidos.sort((a, b) => {
    const dataA = a.auditadoEm ? new Date(a.auditadoEm).getTime() : 0;
    const dataB = b.auditadoEm ? new Date(b.auditadoEm).getTime() : 0;
    if (dataA !== dataB) return dataB - dataA;
    return `${a.produto}`.localeCompare(`${b.produto}`, "pt-BR");
  });
  itensNaoLidos.sort(
    (a, b) =>
      `${a.produto}`.localeCompare(`${b.produto}`, "pt-BR") ||
      `${a.codigo}`.localeCompare(`${b.codigo}`, "pt-BR"),
  );

  return {
    periodo: { inicio, fim },
    corredor,
    semEstoqueIgnorados,
    itensLidos,
    itensNaoLidos,
  };
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

  const porTipoBruto = await MetricaDiaria.aggregate([
    { $match: matchColab },
    {
      $group: {
        _id: "$tipo",
        totalLidos: { $sum: "$totalLidos" },
        totalItensAuditaveis: { $sum: "$totalItensAuditaveis" },
        totalConformes: { $sum: "$totalConformes" },
        totalNaoConformes: { $sum: "$totalNaoConformes" },
        pontuacao: { $sum: "$pontuacao" },
      },
    },
  ]);

  const serieBruta = await MetricaDiaria.aggregate([
    { $match: matchColab },
    {
      $group: {
        _id: {
          dia: { $dateToString: { format: "%Y-%m-%d", date: "$data" } },
          tipo: "$tipo",
        },
        totalLidos: { $sum: "$totalLidos" },
        totalConformes: { $sum: "$totalConformes" },
        semPresencaComEstoque: {
          $sum: somarSituacaoMapa(SITUACOES_DASHBOARD_PRESENCA.naoLidos),
        },
        pontuacao: { $sum: "$pontuacao" },
      },
    },
    { $sort: { "_id.dia": 1 } },
  ]);

  let porTipo = porTipoBruto.map((item) => ({
    ...item,
    taxaConformidade: calcTaxaPerfil(item._id, item),
  }));
  let serie = serieBruta;

  if (
    porTipo.some(
      (item) =>
        item._id === TIPOS_AUDITORIA.RUPTURA &&
        Number(item.totalLidos || 0) > 0,
    )
  ) {
    const presencaReferenciaPorDia =
      await carregarPresencaReferenciaMetricasPorDia({
        lojaId: escopoLojaId || colab.loja,
        colaboradorId: colab._id,
        inicio,
        fim,
      });

    serie = serieBruta.map((linha) =>
      aplicarContinuidadeRupturaNaLinhaSerie(linha, presencaReferenciaPorDia),
    );

    const resumoRupturaContinuada = resumirContinuidadeRupturaDaSerie(
      serieBruta,
      presencaReferenciaPorDia,
    );

    if (resumoRupturaContinuada.baseContinuidade) {
      porTipo = porTipo.map((item) =>
        item._id === TIPOS_AUDITORIA.RUPTURA
          ? aplicarContinuidadeRupturaAoResumo(item, resumoRupturaContinuada)
          : item,
      );
    }
  }

  return { colaborador: colab, periodo: { inicio, fim }, porTipo, serie };
}

function calcTaxaPerfil(tipoAtual, row) {
  if (tipoAtual === "ETIQUETA") {
    return row.totalItensAuditaveis > 0
      ? Number(((row.totalLidos / row.totalItensAuditaveis) * 100).toFixed(2))
      : 0;
  }
  return row.totalLidos > 0
    ? Number(((row.totalConformes / row.totalLidos) * 100).toFixed(2))
    : 0;
}

function calcularTaxaConformidadeColaborador(colaborador) {
  const totalLidos = Number(colaborador?.totalItensLidos || 0);
  const totalConformes = Number(colaborador?.totalItensConformes || 0);
  if (!totalLidos) return 0;
  return Number(((totalConformes / totalLidos) * 100).toFixed(1));
}

function resumirColegaPortal(colaborador) {
  return {
    _id: colaborador._id,
    nome: colaborador.nome,
    cargo: colaborador.cargo || "",
    avatarUrl: colaborador.avatarUrl || "",
    fundoPerfil: fundoLojaPerfil(colaborador),
    mascotePerfil: mascoteLojaPerfil(colaborador),
    nivel: Number(colaborador.nivel || 1),
    pontuacao: Number(colaborador.pontuacao || 0),
    totalAuditorias: Number(colaborador.totalAuditorias || 0),
    totalItensLidos: Number(colaborador.totalItensLidos || 0),
    taxaConformidade: calcularTaxaConformidadeColaborador(colaborador),
  };
}

function montarCabecalhoPerfilPublicoColaborador(colaborador) {
  const titulo = tituloLojaPerfil(colaborador);
  return {
    _id: colaborador._id,
    nome: colaborador.nome,
    cargo: colaborador.cargo || "",
    avatarUrl: colaborador.avatarUrl || "",
    conquistasExibidas: colaborador.conquistasExibidas,
    tiersConquistasExibidas: colaborador.tiersConquistasExibidas,
    tituloPerfil: titulo ? { nome: titulo.nome, cor: titulo.cor, icone: titulo.icone } : null,
    mascotePerfil: mascoteLojaPerfil(colaborador),
    fundoPerfil: fundoLojaPerfil(colaborador),
    nivel: Number(colaborador.nivel || 1),
    pontuacao: Number(colaborador.pontuacao || 0),
    totalAuditorias: Number(colaborador.totalAuditorias || 0),
    totalItensLidos: Number(colaborador.totalItensLidos || 0),
    totalItensConformes: Number(colaborador.totalItensConformes || 0),
    taxaConformidade: calcularTaxaConformidadeColaborador(colaborador),
  };
}

function normalizarLocalCorredor(local) {
  const valor = String(local || "").trim();
  return valor || "Sem corredor";
}

function montarMatchLocalCorredor(local) {
  return local === "Sem corredor"
    ? { $or: [{ local: null }, { local: "" }, { local: { $exists: false } }] }
    : { local };
}

function estatisticasLinhaAuditoria(tipo, item) {
  const cls = classificar(tipo, item.situacao);
  return {
    totalItens: 1,
    totalItensAuditaveis: cls.conforme !== null ? 1 : 0,
    totalLidos: cls.conta ? 1 : 0,
    totalConformes: cls.conta && cls.conforme === true ? 1 : 0,
    totalNaoConformes: cls.conta && cls.conforme === false ? 1 : 0,
  };
}

function calcularPctConclusaoCorredor(resumo) {
  if (!resumo.totalItensAuditaveis) return 0;
  return Number(
    ((resumo.totalLidos / resumo.totalItensAuditaveis) * 100).toFixed(1),
  );
}

function calcularTaxaConformidadeCorredor(tipo, resumo) {
  if (tipo === TIPOS_AUDITORIA.ETIQUETA) {
    if (!resumo.totalItensAuditaveis) return 0;
    return Number(
      ((resumo.totalLidos / resumo.totalItensAuditaveis) * 100).toFixed(1),
    );
  }
  if (!resumo.totalLidos) return 0;
  return Number(((resumo.totalConformes / resumo.totalLidos) * 100).toFixed(1));
}

function ordenarCorredoresResumo(a, b) {
  if (a.emDestaque !== b.emDestaque) return a.emDestaque ? -1 : 1;
  if (a.meuCorredor !== b.meuCorredor) return a.meuCorredor ? -1 : 1;
  if ((a.minhaLeitura || 0) !== (b.minhaLeitura || 0)) {
    return (b.minhaLeitura || 0) - (a.minhaLeitura || 0);
  }
  if ((a.totalLidos || 0) !== (b.totalLidos || 0)) {
    return (b.totalLidos || 0) - (a.totalLidos || 0);
  }
  return a.local.localeCompare(b.local, "pt-BR");
}

async function montarCorredoresAuditoria({ auditoria, colaboradorId, itens }) {
  const colaboradorIdStr = String(colaboradorId);
  const corredoresMap = new Map();
  const colaboradoresIds = new Set();

  // Para PRESENCA, mapear corredores com "Sem Presença e Com Estoque" mesmo sem leitura
  const corredoresSemPresenca = new Set();

  for (const item of itens) {
    const local = normalizarLocalCorredor(item.local);
    const estatisticas = estatisticasLinhaAuditoria(auditoria.tipo, item);
    const corredorAtual = corredoresMap.get(local) || {
      local,
      totalItens: 0,
      totalItensAuditaveis: 0,
      totalLidos: 0,
      totalConformes: 0,
      totalNaoConformes: 0,
      meuCorredor: false,
      minhaLeitura: 0,
      ultimoMovimentoMeu: null,
      participantesMap: new Map(),
    };

    // Marcar corredores com "Sem Presença e Com Estoque" para PRESENCA
    if (
      auditoria.tipo === "PRESENCA" &&
      item.situacao === "Sem Presença e Com Estoque"
    ) {
      corredoresSemPresenca.add(local);
    }

    corredorAtual.totalItens += estatisticas.totalItens;
    corredorAtual.totalItensAuditaveis += estatisticas.totalItensAuditaveis;
    corredorAtual.totalLidos += estatisticas.totalLidos;
    corredorAtual.totalConformes += estatisticas.totalConformes;
    corredorAtual.totalNaoConformes += estatisticas.totalNaoConformes;

    const participanteId = item.colaborador ? String(item.colaborador) : null;
    const participanteKey =
      participanteId ||
      `sem:${item.colaboradorCodigo || item.colaboradorNome || "colaborador"}`;
    const participanteAtual = corredorAtual.participantesMap.get(
      participanteKey,
    ) || {
      colaboradorId: participanteId,
      codigoExterno: item.colaboradorCodigo || "",
      nome: item.colaboradorNome || "Sem colaborador",
      avatarUrl: "",
      totalItens: 0,
      totalItensAuditaveis: 0,
      totalLidos: 0,
      totalConformes: 0,
      totalNaoConformes: 0,
      eu: participanteId === colaboradorIdStr,
    };

    participanteAtual.totalItens += estatisticas.totalItens;
    participanteAtual.totalItensAuditaveis += estatisticas.totalItensAuditaveis;
    participanteAtual.totalLidos += estatisticas.totalLidos;
    participanteAtual.totalConformes += estatisticas.totalConformes;
    participanteAtual.totalNaoConformes += estatisticas.totalNaoConformes;

    if (participanteAtual.eu) {
      corredorAtual.meuCorredor = true;
      corredorAtual.minhaLeitura += estatisticas.totalLidos;
      const movimentoAtual =
        item.auditadoEm || item.updatedAt || item.createdAt;
      if (
        movimentoAtual &&
        (!corredorAtual.ultimoMovimentoMeu ||
          new Date(movimentoAtual) > new Date(corredorAtual.ultimoMovimentoMeu))
      ) {
        corredorAtual.ultimoMovimentoMeu = movimentoAtual;
      }
    }

    corredorAtual.participantesMap.set(participanteKey, participanteAtual);
    corredoresMap.set(local, corredorAtual);

    if (participanteId) colaboradoresIds.add(participanteId);
  }

  // Para PRESENCA, marcar como meuCorredor se houver "Sem Presença e Com Estoque" mesmo sem leitura
  if (auditoria.tipo === "PRESENCA") {
    for (const local of corredoresSemPresenca) {
      const corredor = corredoresMap.get(local);
      if (corredor && !corredor.meuCorredor) {
        corredor.meuCorredor = true;
      }
    }
  }

  const colaboradores = colaboradoresIds.size
    ? await Colaborador.find({ _id: { $in: Array.from(colaboradoresIds) } })
        .select({ _id: 1, nome: 1, codigoExterno: 1, avatarUrl: 1 })
        .lean()
    : [];
  const colaboradoresMap = new Map(
    colaboradores.map((item) => [String(item._id), item]),
  );

  const corredores = [...corredoresMap.values()].map((corredor) => {
    const participantes = [...corredor.participantesMap.values()]
      .map((participante) => {
        const dadosColab = participante.colaboradorId
          ? colaboradoresMap.get(participante.colaboradorId)
          : null;
        return {
          ...participante,
          nome: participante.nome || dadosColab?.nome || "Sem colaborador",
          codigoExterno:
            participante.codigoExterno || dadosColab?.codigoExterno || "",
          avatarUrl: dadosColab?.avatarUrl || "",
          progressoPct: calcularPctConclusaoCorredor(participante),
          taxaConformidade: calcularTaxaConformidadeCorredor(
            auditoria.tipo,
            participante,
          ),
        };
      })
      .sort((a, b) => {
        if (a.eu !== b.eu) return a.eu ? -1 : 1;
        if (a.totalLidos !== b.totalLidos) return b.totalLidos - a.totalLidos;
        return a.nome.localeCompare(b.nome, "pt-BR");
      });

    return {
      local: corredor.local,
      totalItens: corredor.totalItens,
      totalItensAuditaveis: corredor.totalItensAuditaveis,
      totalLidos: corredor.totalLidos,
      totalConformes: corredor.totalConformes,
      totalNaoConformes: corredor.totalNaoConformes,
      meuCorredor: corredor.meuCorredor,
      minhaLeitura: corredor.minhaLeitura,
      ultimoMovimentoMeu: corredor.ultimoMovimentoMeu,
      participantes,
      totalParticipantes: participantes.length,
      progressoPct: calcularPctConclusaoCorredor(corredor),
      taxaConformidade: calcularTaxaConformidadeCorredor(
        auditoria.tipo,
        corredor,
      ),
      emDestaque: false,
    };
  });

  const corredorAtual = corredores
    .filter((item) => item.meuCorredor)
    .sort((a, b) => {
      const dataA = a.ultimoMovimentoMeu
        ? new Date(a.ultimoMovimentoMeu).getTime()
        : 0;
      const dataB = b.ultimoMovimentoMeu
        ? new Date(b.ultimoMovimentoMeu).getTime()
        : 0;
      if (dataA !== dataB) return dataB - dataA;
      return (b.minhaLeitura || 0) - (a.minhaLeitura || 0);
    })[0];

  const corredoresMarcados = corredores.map((item) => ({
    ...item,
    emDestaque: item.local === corredorAtual?.local,
  }));

  return corredoresMarcados.sort(ordenarCorredoresResumo);
}

async function encontrarAuditoriasPortal(lojaId) {
  const lojaObjectId = new mongoose.Types.ObjectId(lojaId);
  const inicioHoje = dayjs().startOf("day").toDate();
  const fimHoje = dayjs().endOf("day").toDate();

  const filtroBase = {
    loja: lojaObjectId,
    status: { $ne: "CANCELADA" },
  };

  const auditoriaHoje = await Auditoria.findOne({
    ...filtroBase,
    data: { $gte: inicioHoje, $lte: fimHoje },
  })
    .sort({ data: -1, createdAt: -1 })
    .lean();

  if (auditoriaHoje) {
    return {
      auditoriaHoje,
      auditoriaAnterior: await Auditoria.findOne({
        ...filtroBase,
        data: { $lt: inicioHoje },
      })
        .sort({ data: -1, createdAt: -1 })
        .lean(),
    };
  }

  const auditoriaAnterior = await Auditoria.findOne({
    ...filtroBase,
    data: { $lt: inicioHoje },
  })
    .sort({ data: -1, createdAt: -1 })
    .lean();

  return { auditoriaHoje: null, auditoriaAnterior };
}

function montarAvisoAuditoriaPortal({
  origem,
  auditoriaHoje,
  auditoriaAnterior,
  auditoriaSelecionada,
}) {
  if (auditoriaSelecionada) {
    if (origem === "anterior") {
      return auditoriaHoje
        ? "Exibindo a auditoria anterior por solicitação."
        : "Sem auditoria em andamento hoje. Exibindo a última auditoria anterior disponível para consulta.";
    }
    return "";
  }

  if (origem === "anterior") {
    return "Não há auditoria anterior disponível para consulta.";
  }

  if (auditoriaAnterior) {
    return "Não há auditoria em andamento hoje. Use o botão para consultar a auditoria anterior.";
  }

  return "Não há auditoria em andamento hoje e nenhuma auditoria anterior disponível para consulta.";
}

async function montarAuditoriaDoDiaPortal({
  colaboradorId,
  escopoLojaId,
  origem = "hoje",
}) {
  const filtroColab = escopoLojaId
    ? { _id: colaboradorId, loja: new mongoose.Types.ObjectId(escopoLojaId) }
    : { _id: colaboradorId };
  const colab = await Colaborador.findOne(filtroColab)
    .select({ _id: 1, loja: 1 })
    .lean();
  if (!colab) return null;

  const { auditoriaHoje, auditoriaAnterior } = await encontrarAuditoriasPortal(
    colab.loja,
  );
  const auditoria = origem === "anterior" ? auditoriaAnterior : auditoriaHoje;
  const exibindoAnterior = origem === "anterior" && Boolean(auditoria);
  const aviso = montarAvisoAuditoriaPortal({
    origem,
    auditoriaHoje,
    auditoriaAnterior,
    auditoriaSelecionada: auditoria,
  });

  if (!auditoria) {
    return {
      auditoria: null,
      meusCorredores: [],
      demaisCorredores: [],
      totalCorredores: 0,
      origem,
      exibindoAnterior: false,
      temAuditoriaHoje: Boolean(auditoriaHoje),
      temAuditoriaAnterior: Boolean(auditoriaAnterior),
      aviso,
    };
  }

  const itens = await AuditItem.find({
    auditoria: auditoria._id,
    ...FILTRO_ITENS_ATIVOS,
  })
    .select({
      local: 1,
      tipo: 1,
      situacao: 1,
      colaborador: 1,
      colaboradorCodigo: 1,
      colaboradorNome: 1,
      auditadoEm: 1,
      updatedAt: 1,
      createdAt: 1,
    })
    .lean();

  const corredores = await montarCorredoresAuditoria({
    auditoria,
    colaboradorId,
    itens,
  });

  return {
    auditoria: {
      _id: auditoria._id,
      tipo: auditoria.tipo,
      data: auditoria.data,
      status: auditoria.status,
      origem: exibindoAnterior ? "anterior" : "hoje",
    },
    meusCorredores: corredores.filter((item) => item.meuCorredor),
    demaisCorredores: corredores.filter((item) => !item.meuCorredor),
    totalCorredores: corredores.length,
    origem: exibindoAnterior ? "anterior" : "hoje",
    exibindoAnterior,
    temAuditoriaHoje: Boolean(auditoriaHoje),
    temAuditoriaAnterior: Boolean(auditoriaAnterior),
    aviso,
  };
}

async function montarDetalheCorredorPortal({
  colaboradorId,
  escopoLojaId,
  auditoriaId,
  local,
}) {
  const filtroAuditoria = {
    _id: new mongoose.Types.ObjectId(auditoriaId),
    status: { $ne: "CANCELADA" },
  };
  if (escopoLojaId)
    filtroAuditoria.loja = new mongoose.Types.ObjectId(escopoLojaId);

  const auditoria = await Auditoria.findOne(filtroAuditoria).lean();
  if (!auditoria) return null;

  const itens = await AuditItem.find({
    auditoria: auditoria._id,
    ...FILTRO_ITENS_ATIVOS,
    ...montarMatchLocalCorredor(local),
  })
    .select({
      codigo: 1,
      produto: 1,
      classeRaiz: 1,
      classe: 1,
      setor: 1,
      local: 1,
      colaborador: 1,
      colaboradorCodigo: 1,
      colaboradorNome: 1,
      situacao: 1,
      conforme: 1,
      auditadoEm: 1,
      estoqueAtual: 1,
      estoqueLeitura: 1,
      diasSemVenda: 1,
      custoRuptura: 1,
      updatedAt: 1,
      createdAt: 1,
    })
    .sort({ auditadoEm: -1, produto: 1, codigo: 1 })
    .lean();

  const [corredor] = await montarCorredoresAuditoria({
    auditoria,
    colaboradorId,
    itens,
  });

  return {
    auditoria: {
      _id: auditoria._id,
      tipo: auditoria.tipo,
      data: auditoria.data,
      status: auditoria.status,
    },
    corredor,
    itens: itens.map((item) => {
      const cls = classificar(auditoria.tipo, item.situacao);
      const foiLido = Boolean(cls.conta);

      return {
        _id: item._id,
        codigo: item.codigo || "-",
        produto: item.produto || "Produto sem descrição",
        classeRaiz: item.classeRaiz || "",
        classe: item.classe || "",
        setor: item.setor || "",
        local: normalizarLocalCorredor(item.local),
        colaboradorId: item.colaborador ? String(item.colaborador) : null,
        colaboradorCodigo: item.colaboradorCodigo || "",
        colaboradorNome: item.colaboradorNome || "Sem colaborador",
        situacao: item.situacao || "Sem situação",
        conforme: item.conforme,
        foiLido,
        statusLeitura: foiLido ? "lido" : "nao-lido",
        auditadoEm: item.auditadoEm || item.updatedAt || item.createdAt || null,
        estoqueAtual: item.estoqueAtual,
        estoqueLeitura: item.estoqueLeitura,
        diasSemVenda: item.diasSemVenda,
        custoRuptura: item.custoRuptura,
      };
    }),
  };
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

  const serieBruta = await MetricaDiaria.aggregate([
    { $match: matchMetricas },
    {
      $group: {
        _id: {
          dia: { $dateToString: { format: "%Y-%m-%d", date: "$data" } },
          tipo: "$tipo",
        },
        totalLidos: { $sum: "$totalLidos" },
        totalConformes: { $sum: "$totalConformes" },
        semPresencaComEstoque: {
          $sum: somarSituacaoMapa(SITUACOES_DASHBOARD_PRESENCA.naoLidos),
        },
        taxaConformidade: { $avg: "$taxaConformidade" },
        pontuacao: { $sum: "$pontuacao" },
      },
    },
    { $sort: { "_id.dia": 1 } },
  ]);

  let serie = serieBruta;
  let resumoRupturaContinuada = null;

  if (Number(totaisPorTipo[TIPOS_AUDITORIA.RUPTURA]?.totalLidos || 0) > 0) {
    const presencaReferenciaPorDia =
      await carregarPresencaReferenciaMetricasPorDia({
        lojaId: lojaObjectId,
        colaboradorId: null,
        inicio,
        fim,
      });

    serie = serieBruta.map((linha) =>
      aplicarContinuidadeRupturaNaLinhaSerie(linha, presencaReferenciaPorDia),
    );

    resumoRupturaContinuada = resumirContinuidadeRupturaDaSerie(
      serieBruta,
      presencaReferenciaPorDia,
    );

    if (resumoRupturaContinuada.baseContinuidade) {
      totaisPorTipo[TIPOS_AUDITORIA.RUPTURA] =
        aplicarContinuidadeRupturaAoResumo(
          totaisPorTipo[TIPOS_AUDITORIA.RUPTURA],
          resumoRupturaContinuada,
        );
    }
  }

  {
    let numerador = 0;
    let denominador = 0;

    const etiquetaResumo = totaisPorTipo[TIPOS_AUDITORIA.ETIQUETA];
    if (Number(etiquetaResumo?.totalItensAuditaveis || 0) > 0) {
      numerador += Number(etiquetaResumo.totalLidos || 0);
      denominador += Number(etiquetaResumo.totalItensAuditaveis || 0);
    }

    const presencaResumo = totaisPorTipo[TIPOS_AUDITORIA.PRESENCA];
    if (Number(presencaResumo?.totalLidos || 0) > 0) {
      numerador += Number(presencaResumo.totalConformes || 0);
      denominador += Number(presencaResumo.totalLidos || 0);
    }

    if (Number(resumoRupturaContinuada?.baseContinuidade || 0) > 0) {
      numerador += Number(resumoRupturaContinuada.concluidosContinuidade || 0);
      denominador += Number(resumoRupturaContinuada.baseContinuidade || 0);
    } else {
      const rupturaResumo = totaisPorTipo[TIPOS_AUDITORIA.RUPTURA];
      if (Number(rupturaResumo?.totalLidos || 0) > 0) {
        numerador += Number(rupturaResumo.totalConformes || 0);
        denominador += Number(rupturaResumo.totalLidos || 0);
      }
    }

    totalGeral.taxaConformidade = denominador
      ? Number(((numerador / denominador) * 100).toFixed(2))
      : 0;
  }

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
  "/portal/me/auditoria-do-dia",
  autenticarColaborador,
  asyncHandler(async (req, res) => {
    const origem =
      String(req.query.origem || "hoje")
        .trim()
        .toLowerCase() === "anterior"
        ? "anterior"
        : "hoje";
    const dados = await montarAuditoriaDoDiaPortal({
      colaboradorId: req.colaborador._id,
      escopoLojaId: req.escopoLojaId,
      origem,
    });
    if (!dados)
      return res.status(404).json({ error: "Colaborador não encontrado" });
    res.json(dados);
  }),
);

router.get(
  "/portal/me/auditoria-do-dia/corredor",
  autenticarColaborador,
  asyncHandler(async (req, res) => {
    const auditoriaId = String(req.query.auditoriaId || "").trim();
    const local = normalizarLocalCorredor(req.query.local);

    if (!mongoose.Types.ObjectId.isValid(auditoriaId)) {
      return res.status(400).json({ error: "auditoriaId inválido" });
    }

    const dados = await montarDetalheCorredorPortal({
      colaboradorId: req.colaborador._id,
      escopoLojaId: req.escopoLojaId,
      auditoriaId,
      local,
    });
    if (!dados)
      return res
        .status(404)
        .json({ error: "Corredor ou auditoria não encontrados" });
    res.json(dados);
  }),
);

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

    const colabFull = await Colaborador.findById(req.colaborador._id).lean();
    const conquistas = await resolverConquistasPortal(colabFull || {});

    res.json({ ...dados, conquistas });
  }),
);

router.get(
  "/portal/me/colegas",
  autenticarColaborador,
  asyncHandler(async (req, res) => {
    const filtro = {
      ativo: true,
      _id: { $ne: req.colaborador._id },
      loja: new mongoose.Types.ObjectId(req.escopoLojaId),
    };

    const colegas = await Colaborador.find(filtro)
      .select({
        nome: 1,
        cargo: 1,
        avatarUrl: 1,
        fundoPerfilCodigo: 1,
        mascotePerfilCodigo: 1,
        "itensLoja.codigo": 1,
        nivel: 1,
        pontuacao: 1,
        totalAuditorias: 1,
        totalItensLidos: 1,
        totalItensConformes: 1,
      })
      .sort({ nivel: -1, pontuacao: -1, nome: 1 })
      .lean();

    res.json({ items: colegas.map(resumirColegaPortal) });
  }),
);

router.get(
  "/portal/me/colegas/:id/perfil",
  autenticarColaborador,
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Colaborador inválido" });
    }

    const dados = await montarPerfilColaborador({
      colaboradorId: req.params.id,
      escopoLojaId: req.escopoLojaId,
      periodo: req.query.periodo || "tudo",
      tipo: req.query.tipo,
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
    });

    if (!dados?.colaborador?.ativo) {
      return res.status(404).json({ error: "Colaborador não encontrado" });
    }

    const conquistas = await resolverConquistasPortal(dados.colaborador || {});
    const rankingGeral = await calcularRankingGeralPortal(
      req.escopoLojaId,
      req.params.id,
    );

    res.json({
      ...dados,
      colaborador: montarCabecalhoPerfilPublicoColaborador(dados.colaborador),
      conquistas,
      rankingGeral,
    });
  }),
);

// ============ RANKING GERAL DO PORTAL (por mais itens lidos, histórico) ============
async function calcularRankingGeralPortal(escopoLojaId, colaboradorId) {
  const lojaId = escopoLojaId
    ? new mongoose.Types.ObjectId(escopoLojaId)
    : null;

  const matchBase = { colaborador: { $ne: null }, cancelada: { $ne: true } };
  if (lojaId) matchBase.loja = lojaId;

  const ranking = await MetricaDiaria.aggregate([
    { $match: matchBase },
    {
      $group: {
        _id: "$colaborador",
        totalLidos: { $sum: "$totalLidos" },
      },
    },
    {
      $lookup: {
        from: "colaboradors",
        localField: "_id",
        foreignField: "_id",
        as: "colaborador",
      },
    },
    { $unwind: "$colaborador" },
    { $match: { "colaborador.ativo": true } },
    { $sort: { totalLidos: -1 } },
  ]);

  const idStr = colaboradorId.toString();
  const posicao = ranking.findIndex((r) => r._id.toString() === idStr) + 1;
  const totalColaboradores = ranking.length;
  const totalItensLidos =
    ranking.find((r) => r._id.toString() === idStr)?.totalLidos || 0;

  return {
    posicao: posicao > 0 ? posicao : null,
    totalColaboradores,
    totalItensLidos,
  };
}

router.get(
  "/portal/me/ranking-geral",
  autenticarColaborador,
  asyncHandler(async (req, res) => {
    const rankingGeral = await calcularRankingGeralPortal(
      req.escopoLojaId,
      req.colaborador._id,
    );
    res.json(rankingGeral);
  }),
);

router.get(
  "/portal/me/ranking-loja",
  autenticarColaborador,
  asyncHandler(async (req, res) => {
    const escopoLojaId =
      req.escopoLojaId || req.colaborador.loja?.toString() || null;
    const { inicio, fim, items } = await executarRankingColaboradores({
      escopoLojaId,
      periodo: req.query.periodo,
      tipo: req.query.tipo,
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
    });
    const itemsOrdenados = [...items].sort(
      (a, b) =>
        Number(b?.totalLidos || 0) - Number(a?.totalLidos || 0) ||
        Number(b?.pontuacao || 0) - Number(a?.pontuacao || 0) ||
        String(a?.nome || "").localeCompare(String(b?.nome || ""), "pt-BR"),
    );

    res.json({ periodo: { inicio, fim }, items: itemsOrdenados });
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
    const integraRupturaComPresenca =
      req.query.tipo === TIPOS_AUDITORIA.RUPTURA;

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
            totalLidos: resumoPresenca
              ? resumoPresenca.totalItens
              : r.totalLidos,
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

    let presencaReferenciaPorDia = new Map();
    if (integraRupturaComPresenca) {
      const inicioPresencaReferencia = dayjs(inicio)
        .subtract(1, "day")
        .startOf("day")
        .toDate();
      const fimPresencaReferencia = dayjs(fim)
        .subtract(1, "day")
        .endOf("day")
        .toDate();

      const presencaReferenciaBruta = await MetricaDiaria.aggregate([
        {
          $match: {
            colaborador: null,
            cancelada: { $ne: true },
            tipo: TIPOS_AUDITORIA.PRESENCA,
            data: {
              $gte: inicioPresencaReferencia,
              $lte: fimPresencaReferencia,
            },
            ...(req.escopoLojaId
              ? { loja: new mongoose.Types.ObjectId(req.escopoLojaId) }
              : {}),
          },
        },
        {
          $group: {
            _id: {
              dia: { $dateToString: { format: "%Y-%m-%d", date: "$data" } },
            },
            presencaComEstoque: somarSituacaoMapa(
              SITUACOES_DASHBOARD_PRESENCA.lidos,
            ),
            semPresencaComEstoque: somarSituacaoMapa(
              SITUACOES_DASHBOARD_PRESENCA.naoLidos,
            ),
          },
        },
      ]);

      presencaReferenciaPorDia = new Map(
        presencaReferenciaBruta.map((linha) => [linha._id.dia, linha]),
      );
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

    const resumoRupturaIntegrada = integraRupturaComPresenca
      ? serieBruta
          .filter((linha) => linha._id.tipo === TIPOS_AUDITORIA.RUPTURA)
          .reduce(
            (acumulado, linha) => {
              const diaPresencaAnterior = chavePresencaReferenciaRuptura(
                linha._id.dia,
              );
              if (!diaPresencaAnterior) return acumulado;
              const resumo = resumirRupturaIntegradaDashboard(
                linha,
                presencaReferenciaPorDia.get(diaPresencaAnterior),
                linha._id.dia,
              );

              if (resumo.basePresenca <= 0) return acumulado;

              acumulado.basePresenca += resumo.basePresenca;
              acumulado.itensConcluidos += resumo.itensConcluidos;
              acumulado.itensRestantes += resumo.itensRestantes;
              return acumulado;
            },
            { basePresenca: 0, itensConcluidos: 0, itensRestantes: 0 },
          )
      : null;

    if (resumoRupturaIntegrada?.basePresenca > 0) {
      resumoRupturaIntegrada.taxaConformidade = Number(
        (
          (resumoRupturaIntegrada.itensConcluidos /
            resumoRupturaIntegrada.basePresenca) *
          100
        ).toFixed(2),
      );

      totaisPorTipo[TIPOS_AUDITORIA.RUPTURA] = {
        ...totaisPorTipo[TIPOS_AUDITORIA.RUPTURA],
        totalItensAuditaveis: resumoRupturaIntegrada.basePresenca,
        totalLidos: resumoRupturaIntegrada.basePresenca,
        totalConformes: resumoRupturaIntegrada.itensConcluidos,
        totalNaoConformes: resumoRupturaIntegrada.itensRestantes,
        taxaConformidade: resumoRupturaIntegrada.taxaConformidade,
      };

      totalGeral.totalItensAuditaveis = resumoRupturaIntegrada.basePresenca;
      totalGeral.totalLidos = resumoRupturaIntegrada.basePresenca;
      totalGeral.totalConformes = resumoRupturaIntegrada.itensConcluidos;
      totalGeral.totalNaoConformes = resumoRupturaIntegrada.itensRestantes;
      totalGeral.taxaConformidade = resumoRupturaIntegrada.taxaConformidade;
    }

    const serie = serieBruta.map((linha) => {
      if (linha._id.tipo === TIPOS_AUDITORIA.PRESENCA) {
        const resumoPresenca = resumirPresencaDashboard(linha);
        return {
          ...linha,
          totalLidos: resumoPresenca.totalItens,
          totalConformes: resumoPresenca.itensLidos,
          taxaConformidade: resumoPresenca.taxaConformidade,
        };
      }

      if (
        integraRupturaComPresenca &&
        linha._id.tipo === TIPOS_AUDITORIA.RUPTURA
      ) {
        const diaPresencaAnterior = chavePresencaReferenciaRuptura(
          linha._id.dia,
        );
        if (!diaPresencaAnterior) return linha;
        const resumoRuptura = resumirRupturaIntegradaDashboard(
          linha,
          presencaReferenciaPorDia.get(diaPresencaAnterior),
          linha._id.dia,
        );

        if (resumoRuptura.basePresenca > 0) {
          return {
            ...linha,
            totalItensAuditaveis: resumoRuptura.basePresenca,
            totalLidos: resumoRuptura.basePresenca,
            totalConformes: resumoRuptura.itensConcluidos,
            totalNaoConformes: resumoRuptura.itensRestantes,
            taxaConformidade: resumoRuptura.taxaConformidade,
          };
        }
      }

      return linha;
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
    const matchCustoRupturaPresenca = {
      tipo: TIPOS_AUDITORIA.PRESENCA,
      situacao: "Sem Presença e Com Estoque",
      ...FILTRO_ITENS_ATIVOS,
      data: { $gte: inicio, $lte: fim },
      ...(req.escopoLojaId
        ? { loja: new mongoose.Types.ObjectId(req.escopoLojaId) }
        : {}),
    };
    const matchCustoRupturaRuptura = {
      tipo: TIPOS_AUDITORIA.RUPTURA,
      situacao: "Sem Presença e Com Estoque",
      ...FILTRO_ITENS_ATIVOS,
      data: { $gte: inicio, $lte: fim },
      ...(req.escopoLojaId
        ? { loja: new mongoose.Types.ObjectId(req.escopoLojaId) }
        : {}),
    };
    const [
      resumoAuditorias,
      produtosNaoAuditados,
      resumoRuptura,
      colaboradoresDistintos,
      colaboradoresAtivos,
      ultimasAuditorias,
      totalDesatualizados,
      totalNaoLidos,
      resumoCustoRupturaPresenca,
      resumoCustoRupturaRuptura,
    ] = await Promise.all([
      Auditoria.aggregate([
        { $match: matchAuditoriasResumo },
        {
          $group: {
            _id: null,
            totalAuditorias: { $sum: 1 },
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
      AuditItem.aggregate([
        { $match: matchCustoRupturaPresenca },
        {
          $group: {
            _id: null,
            total: { $sum: { $ifNull: ["$custoRuptura", 0] } },
          },
        },
      ]),
      AuditItem.aggregate([
        { $match: matchCustoRupturaRuptura },
        {
          $group: {
            _id: null,
            total: { $sum: { $ifNull: ["$custoRuptura", 0] } },
          },
        },
      ]),
    ]);

    const resumoCardsPresenca =
      req.query.tipo === TIPOS_AUDITORIA.PRESENCA
        ? totaisPorTipo[TIPOS_AUDITORIA.PRESENCA]
        : null;
    const resumoCardsRupturaIntegrada =
      req.query.tipo === TIPOS_AUDITORIA.RUPTURA &&
      resumoRupturaIntegrada?.basePresenca > 0
        ? resumoRupturaIntegrada
        : null;
    const produtosAuditadosResumo = Number(
      resumoCardsPresenca?.totalLidos ||
        resumoAuditorias[0]?.produtosAuditados ||
        0,
    );
    const mediaConclusaoResumo = Number(
      (
        resumoCardsRupturaIntegrada?.taxaConformidade ??
        resumoCardsPresenca?.taxaConformidade ??
        resumoAuditorias[0]?.mediaConclusao ??
        0
      ).toFixed(2),
    );

    const cardsResumo = {
      totalAuditorias: Number(resumoAuditorias[0]?.totalAuditorias || 0),
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
      custoRupturaPresenca: Number(
        (resumoCustoRupturaPresenca[0]?.total || 0).toFixed(2),
      ),
      custoRupturaOperacionalRuptura: Number(
        (resumoCustoRupturaRuptura[0]?.total || 0).toFixed(2),
      ),
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
function calcularTaxaResumoPadrao(tipoAtual, resumo) {
  if (tipoAtual === TIPOS_AUDITORIA.ETIQUETA) {
    return Number(resumo?.totalItensAuditaveis || 0) > 0
      ? Number(
          (
            (Number(resumo?.totalLidos || 0) /
              Number(resumo?.totalItensAuditaveis || 0)) *
            100
          ).toFixed(2),
        )
      : 0;
  }

  return Number(resumo?.totalLidos || 0) > 0
    ? Number(
        (
          (Number(resumo?.totalConformes || 0) /
            Number(resumo?.totalLidos || 0)) *
          100
        ).toFixed(2),
      )
    : 0;
}

function calcularPercentualConclusaoPadrao(resumo) {
  return Number(resumo?.totalItensAuditaveis || 0) > 0
    ? Number(
        (
          (Number(resumo?.totalLidos || 0) /
            Number(resumo?.totalItensAuditaveis || 0)) *
          100
        ).toFixed(2),
      )
    : null;
}

function calcularPercentualRestante(percentualConclusao) {
  return percentualConclusao == null
    ? null
    : Number(Math.max(0, 100 - Number(percentualConclusao || 0)).toFixed(2));
}

async function carregarCustoRupturaEvitadoPorColaborador({
  escopoLojaId,
  inicio,
  fim,
}) {
  const match = {
    ...FILTRO_ITENS_ATIVOS,
    colaborador: { $ne: null },
    tipo: TIPOS_AUDITORIA.RUPTURA,
    data: { $gte: inicio, $lte: fim },
    situacao: { $in: SITUACOES_LIDAS_RUPTURA },
  };

  if (escopoLojaId) {
    match.loja = new mongoose.Types.ObjectId(escopoLojaId);
  }

  const rows = await AuditItem.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$colaborador",
        custoRupturaEvitado: { $sum: { $ifNull: ["$custoRuptura", 0] } },
      },
    },
  ]);

  return new Map(
    rows.map((row) => [
      String(row._id),
      Number(Number(row.custoRupturaEvitado || 0).toFixed(2)),
    ]),
  );
}

async function carregarCustoRupturaEvitadoPorLoja({ inicio, fim }) {
  const rows = await AuditItem.aggregate([
    {
      $match: {
        ...FILTRO_ITENS_ATIVOS,
        tipo: TIPOS_AUDITORIA.RUPTURA,
        data: { $gte: inicio, $lte: fim },
        situacao: { $in: SITUACOES_LIDAS_RUPTURA },
      },
    },
    {
      $group: {
        _id: "$loja",
        custoRupturaEvitado: { $sum: { $ifNull: ["$custoRuptura", 0] } },
      },
    },
  ]);

  return new Map(
    rows.map((row) => [
      String(row._id),
      Number(Number(row.custoRupturaEvitado || 0).toFixed(2)),
    ]),
  );
}

function obterCustoRupturaEvitado(mapa, colaboradorId) {
  return Number(Number(mapa.get(String(colaboradorId)) || 0).toFixed(2));
}

async function executarRankingColaboradoresRupturaContinuada({
  escopoLojaId,
  inicio,
  fim,
}) {
  const matchEscopo = escopoLojaId
    ? { loja: new mongoose.Types.ObjectId(escopoLojaId) }
    : {};
  const matchRuptura = {
    ...matchEscopo,
    colaborador: { $ne: null },
    cancelada: { $ne: true },
    tipo: TIPOS_AUDITORIA.RUPTURA,
    data: { $gte: inicio, $lte: fim },
  };
  const referenciaPresenca = intervaloPresencaReferencia(inicio, fim);
  const matchPresenca = {
    ...matchEscopo,
    colaborador: { $ne: null },
    cancelada: { $ne: true },
    tipo: TIPOS_AUDITORIA.PRESENCA,
    data: {
      $gte: referenciaPresenca.inicio,
      $lte: referenciaPresenca.fim,
    },
  };

  const [rupturas, presencas, custoRupturaEvitadoPorColaborador] =
    await Promise.all([
      MetricaDiaria.aggregate([
        { $match: matchRuptura },
        {
          $group: {
            _id: {
              colaborador: "$colaborador",
              dia: { $dateToString: { format: "%Y-%m-%d", date: "$data" } },
            },
            totalLidos: { $sum: "$totalLidos" },
            totalItensAuditaveis: { $sum: "$totalItensAuditaveis" },
            totalConformes: { $sum: "$totalConformes" },
            totalNaoConformes: { $sum: "$totalNaoConformes" },
            pontuacao: { $sum: "$pontuacao" },
            custoRuptura: { $sum: "$custoRuptura" },
            semPresencaComEstoque: somarSituacaoMapa(
              SITUACOES_DASHBOARD_PRESENCA.naoLidos,
            ),
          },
        },
      ]),
      MetricaDiaria.aggregate([
        { $match: matchPresenca },
        {
          $group: {
            _id: {
              colaborador: "$colaborador",
              dia: { $dateToString: { format: "%Y-%m-%d", date: "$data" } },
            },
            presencaComEstoque: somarSituacaoMapa(
              SITUACOES_DASHBOARD_PRESENCA.lidos,
            ),
            semPresencaComEstoque: somarSituacaoMapa(
              SITUACOES_DASHBOARD_PRESENCA.naoLidos,
            ),
          },
        },
      ]),
      carregarCustoRupturaEvitadoPorColaborador({ escopoLojaId, inicio, fim }),
    ]);

  const presencaPorColaboradorDia = new Map(
    presencas.map((linha) => [
      `${linha._id.colaborador}|${linha._id.dia}`,
      linha,
    ]),
  );
  const rankingMap = new Map();

  for (const ruptura of rupturas) {
    const colaboradorId = String(ruptura._id.colaborador);
    const itemAtual = rankingMap.get(colaboradorId) || {
      _id: ruptura._id.colaborador,
      totalLidos: 0,
      totalItensAuditaveis: 0,
      totalConformes: 0,
      totalNaoConformes: 0,
      pontuacao: 0,
      custoRuptura: 0,
      dias: 0,
      totalAuditorias: 0,
      auditoriasEtiqueta: 0,
      auditoriasPresenca: 0,
      auditoriasRuptura: 0,
      continuidade: criarAcumuladorContinuidadeRuptura(),
    };

    itemAtual.totalLidos += Number(ruptura.totalLidos || 0);
    itemAtual.totalItensAuditaveis += Number(ruptura.totalItensAuditaveis || 0);
    itemAtual.totalConformes += Number(ruptura.totalConformes || 0);
    itemAtual.totalNaoConformes += Number(ruptura.totalNaoConformes || 0);
    itemAtual.pontuacao += Number(ruptura.pontuacao || 0);
    itemAtual.custoRuptura += Number(ruptura.custoRuptura || 0);
    itemAtual.dias += 1;
    itemAtual.totalAuditorias += 1;
    itemAtual.auditoriasRuptura += 1;

    const diaPresencaAnterior = chavePresencaReferenciaRuptura(ruptura._id.dia);
    if (diaPresencaAnterior) {
      const resumo = resumirRupturaIntegradaDashboard(
        ruptura,
        presencaPorColaboradorDia.get(
          `${colaboradorId}|${diaPresencaAnterior}`,
        ),
        ruptura._id.dia,
      );
      acumularContinuidadeRuptura(itemAtual.continuidade, resumo);
    }

    rankingMap.set(colaboradorId, itemAtual);
  }

  const colaboradoresIds = Array.from(rankingMap.keys()).map(
    (id) => new mongoose.Types.ObjectId(id),
  );
  const colaboradores = colaboradoresIds.length
    ? await Colaborador.find({ _id: { $in: colaboradoresIds }, ativo: true })
        .select({
          _id: 1,
          nome: 1,
          codigoExterno: 1,
          nivel: 1,
          avatarUrl: 1,
          conquistas: 1,
        })
        .lean()
    : [];
  const colaboradorPorId = new Map(
    colaboradores.map((colaborador) => [String(colaborador._id), colaborador]),
  );

  return Array.from(rankingMap.values())
    .map((item) => {
      const percentualConclusao = item.continuidade.baseContinuidade
        ? taxaContinuidadeRuptura(item.continuidade)
        : calcularPercentualConclusaoPadrao(item);
      const taxaConformidade = item.continuidade.baseContinuidade
        ? taxaContinuidadeRuptura(item.continuidade)
        : calcularTaxaResumoPadrao(TIPOS_AUDITORIA.RUPTURA, item);
      const colaborador = colaboradorPorId.get(String(item._id));

      if (!colaborador) return null;

      return {
        _id: item._id,
        totalLidos: item.totalLidos,
        totalItensAuditaveis: item.totalItensAuditaveis,
        totalConformes: item.totalConformes,
        totalNaoConformes: item.totalNaoConformes,
        pontuacao: Number(item.pontuacao.toFixed(2)),
        taxaConformidade,
        custoRuptura: Number(item.custoRuptura.toFixed(2)),
        custoRupturaEvitado: obterCustoRupturaEvitado(
          custoRupturaEvitadoPorColaborador,
          item._id,
        ),
        percentualConclusao,
        percentualRestante: calcularPercentualRestante(percentualConclusao),
        totalAuditorias: item.totalAuditorias,
        auditoriasPorTipo: {
          ETIQUETA: item.auditoriasEtiqueta,
          PRESENCA: item.auditoriasPresenca,
          RUPTURA: item.auditoriasRuptura,
        },
        dias: item.dias,
        nome: colaborador.nome,
        codigoExterno: colaborador.codigoExterno,
        nivel: Number(colaborador.nivel || 1),
        avatarUrl: colaborador.avatarUrl || "",
        conquistas: colaborador.conquistas || [],
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.pontuacao - a.pontuacao || b.totalLidos - a.totalLidos)
    .slice(0, 100);
}

async function executarRankingLojasRupturaContinuada({ inicio, fim }) {
  const referenciaPresenca = intervaloPresencaReferencia(inicio, fim);

  const [rupturas, presencas, custoRupturaEvitadoPorLoja] = await Promise.all([
    MetricaDiaria.aggregate([
      {
        $match: {
          colaborador: null,
          tipo: TIPOS_AUDITORIA.RUPTURA,
          data: { $gte: inicio, $lte: fim },
        },
      },
      {
        $group: {
          _id: {
            loja: "$loja",
            dia: { $dateToString: { format: "%Y-%m-%d", date: "$data" } },
          },
          totalLidos: { $sum: "$totalLidos" },
          totalItensAuditaveis: { $sum: "$totalItensAuditaveis" },
          totalConformes: { $sum: "$totalConformes" },
          totalNaoConformes: { $sum: "$totalNaoConformes" },
          pontuacao: { $sum: "$pontuacao" },
          custoRuptura: { $sum: "$custoRuptura" },
          cancelada: { $max: "$cancelada" },
          semPresencaComEstoque: somarSituacaoMapa(
            SITUACOES_DASHBOARD_PRESENCA.naoLidos,
          ),
        },
      },
    ]),
    MetricaDiaria.aggregate([
      {
        $match: {
          colaborador: null,
          tipo: TIPOS_AUDITORIA.PRESENCA,
          data: {
            $gte: referenciaPresenca.inicio,
            $lte: referenciaPresenca.fim,
          },
        },
      },
      {
        $group: {
          _id: {
            loja: "$loja",
            dia: { $dateToString: { format: "%Y-%m-%d", date: "$data" } },
          },
          presencaComEstoque: somarSituacaoMapa(
            SITUACOES_DASHBOARD_PRESENCA.lidos,
          ),
          semPresencaComEstoque: somarSituacaoMapa(
            SITUACOES_DASHBOARD_PRESENCA.naoLidos,
          ),
        },
      },
    ]),
    carregarCustoRupturaEvitadoPorLoja({ inicio, fim }),
  ]);

  const presencaPorLojaDia = new Map(
    presencas.map((linha) => [`${linha._id.loja}|${linha._id.dia}`, linha]),
  );
  const rankingMap = new Map();

  for (const ruptura of rupturas) {
    const lojaId = String(ruptura._id.loja);
    const itemAtual = rankingMap.get(lojaId) || {
      _id: ruptura._id.loja,
      totalLidos: 0,
      totalItensAuditaveis: 0,
      totalConformes: 0,
      totalNaoConformes: 0,
      pontuacao: 0,
      custoRuptura: 0,
      totalAuditorias: 0,
      auditoriasEtiqueta: 0,
      auditoriasPresenca: 0,
      auditoriasRuptura: 0,
      auditoriasCanceladas: 0,
      dias: 0,
      continuidade: criarAcumuladorContinuidadeRuptura(),
    };

    itemAtual.totalLidos += Number(ruptura.totalLidos || 0);
    itemAtual.totalItensAuditaveis += Number(ruptura.totalItensAuditaveis || 0);
    itemAtual.totalConformes += Number(ruptura.totalConformes || 0);
    itemAtual.totalNaoConformes += Number(ruptura.totalNaoConformes || 0);
    itemAtual.pontuacao += Number(ruptura.pontuacao || 0);
    itemAtual.custoRuptura += Number(ruptura.custoRuptura || 0);
    itemAtual.totalAuditorias += 1;
    itemAtual.auditoriasRuptura += 1;
    itemAtual.auditoriasCanceladas += ruptura.cancelada ? 1 : 0;
    itemAtual.dias += 1;

    const diaPresencaAnterior = chavePresencaReferenciaRuptura(ruptura._id.dia);
    if (diaPresencaAnterior) {
      const resumo = resumirRupturaIntegradaDashboard(
        ruptura,
        presencaPorLojaDia.get(`${lojaId}|${diaPresencaAnterior}`),
        ruptura._id.dia,
      );
      acumularContinuidadeRuptura(itemAtual.continuidade, resumo);
    }

    rankingMap.set(lojaId, itemAtual);
  }

  const lojasIds = Array.from(rankingMap.keys()).map(
    (id) => new mongoose.Types.ObjectId(id),
  );
  const lojas = lojasIds.length
    ? await Loja.find({ _id: { $in: lojasIds } })
        .select({
          _id: 1,
          nome: 1,
          slug: 1,
          codigo: 1,
          cidade: 1,
          estado: 1,
          avatarUrl: 1,
          nivel: 1,
        })
        .lean()
    : [];
  const lojaPorId = new Map(lojas.map((loja) => [String(loja._id), loja]));

  return Array.from(rankingMap.values())
    .map((item) => {
      const percentualConclusao = item.continuidade.baseContinuidade
        ? taxaContinuidadeRuptura(item.continuidade)
        : calcularPercentualConclusaoPadrao(item);
      const taxaConformidade = item.continuidade.baseContinuidade
        ? taxaContinuidadeRuptura(item.continuidade)
        : calcularTaxaResumoPadrao(TIPOS_AUDITORIA.RUPTURA, item);
      const loja = lojaPorId.get(String(item._id)) || {};

      return {
        _id: item._id,
        nome: loja.nome || "Loja sem nome",
        slug: loja.slug || "",
        codigo: loja.codigo || "",
        cidade: loja.cidade || "",
        estado: loja.estado || "",
        avatarUrl: loja.avatarUrl || "",
        nivel: Number(loja.nivel || 1),
        totalLidos: item.totalLidos,
        totalItensAuditaveis: item.totalItensAuditaveis,
        totalConformes: item.totalConformes,
        totalNaoConformes: item.totalNaoConformes,
        pontuacao: Number(item.pontuacao.toFixed(2)),
        taxaConformidade,
        custoRuptura: Number(item.custoRuptura.toFixed(2)),
        custoRupturaEvitado: obterCustoRupturaEvitado(
          custoRupturaEvitadoPorLoja,
          item._id,
        ),
        percentualConclusao,
        percentualRestante: calcularPercentualRestante(percentualConclusao),
        totalAuditorias: item.totalAuditorias,
        auditoriasPorTipo: {
          ETIQUETA: item.auditoriasEtiqueta,
          PRESENCA: item.auditoriasPresenca,
          RUPTURA: item.auditoriasRuptura,
        },
        auditoriasCanceladas: item.auditoriasCanceladas,
        dias: item.dias,
      };
    })
    .sort((a, b) => b.pontuacao - a.pontuacao)
    .slice(0, 100);
}

async function executarRankingColaboradores({
  escopoLojaId,
  periodo = "1d",
  tipo,
  dataInicio,
  dataFim,
}) {
  const matchBase = { colaborador: { $ne: null } };
  if (escopoLojaId) matchBase.loja = new mongoose.Types.ObjectId(escopoLojaId);
  if (tipo) matchBase.tipo = tipo;

  const { inicio, fim } = await intervaloPeriodo(periodo, {
    dataInicio,
    dataFim,
    match: matchBase,
  });

  if (tipo === TIPOS_AUDITORIA.RUPTURA) {
    return {
      inicio,
      fim,
      items: await executarRankingColaboradoresRupturaContinuada({
        escopoLojaId,
        inicio,
        fim,
      }),
    };
  }

  const match = {
    ...matchBase,
    cancelada: { $ne: true },
    data: { $gte: inicio, $lte: fim },
  };

  const [rankingBase, custoRupturaEvitadoPorColaborador] = await Promise.all([
    MetricaDiaria.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$colaborador",
          totalLidos: { $sum: "$totalLidos" },
          totalItensAuditaveis: { $sum: "$totalItensAuditaveis" },
          totalConformes: { $sum: "$totalConformes" },
          totalNaoConformes: { $sum: "$totalNaoConformes" },
          pontuacao: { $sum: "$pontuacao" },
          custoRuptura: { $sum: "$custoRuptura" },
          dias: { $sum: 1 },
          auditoriasEtiqueta: {
            $sum: { $cond: [{ $eq: ["$tipo", "ETIQUETA"] }, 1, 0] },
          },
          auditoriasPresenca: {
            $sum: { $cond: [{ $eq: ["$tipo", "PRESENCA"] }, 1, 0] },
          },
          auditoriasRuptura: {
            $sum: { $cond: [{ $eq: ["$tipo", "RUPTURA"] }, 1, 0] },
          },
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
          percentualConclusao: {
            $cond: [
              { $gt: ["$totalItensAuditaveis", 0] },
              {
                $multiply: [
                  { $divide: ["$totalLidos", "$totalItensAuditaveis"] },
                  100,
                ],
              },
              null,
            ],
          },
          totalAuditorias: {
            $add: [
              "$auditoriasEtiqueta",
              "$auditoriasPresenca",
              "$auditoriasRuptura",
            ],
          },
        },
      },
      {
        $addFields: {
          percentualRestante: {
            $cond: [
              { $eq: ["$percentualConclusao", null] },
              null,
              {
                $max: [0, { $subtract: [100, "$percentualConclusao"] }],
              },
            ],
          },
        },
      },
      {
        $lookup: {
          from: "colaboradors",
          localField: "_id",
          foreignField: "_id",
          as: "colaborador",
        },
      },
      { $unwind: "$colaborador" },
      { $match: { "colaborador.ativo": true } },
      { $sort: { pontuacao: -1, totalLidos: -1 } },
      { $limit: 100 },
      {
        $project: {
          _id: 1,
          totalLidos: 1,
          totalItensAuditaveis: 1,
          totalConformes: 1,
          totalNaoConformes: 1,
          pontuacao: { $round: ["$pontuacao", 2] },
          taxaConformidade: { $round: ["$taxaConformidade", 2] },
          custoRuptura: { $round: ["$custoRuptura", 2] },
          percentualConclusao: {
            $cond: [
              { $eq: ["$percentualConclusao", null] },
              null,
              { $round: ["$percentualConclusao", 2] },
            ],
          },
          percentualRestante: {
            $cond: [
              { $eq: ["$percentualRestante", null] },
              null,
              { $round: ["$percentualRestante", 2] },
            ],
          },
          totalAuditorias: 1,
          auditoriasPorTipo: {
            ETIQUETA: "$auditoriasEtiqueta",
            PRESENCA: "$auditoriasPresenca",
            RUPTURA: "$auditoriasRuptura",
          },
          dias: 1,
          nome: "$colaborador.nome",
          codigoExterno: "$colaborador.codigoExterno",
          nivel: "$colaborador.nivel",
          avatarUrl: "$colaborador.avatarUrl",
          conquistas: "$colaborador.conquistas",
        },
      },
    ]),
    tipo === TIPOS_AUDITORIA.ETIQUETA || tipo === TIPOS_AUDITORIA.PRESENCA
      ? Promise.resolve(new Map())
      : carregarCustoRupturaEvitadoPorColaborador({
          escopoLojaId,
          inicio,
          fim,
        }),
  ]);

  const ranking = rankingBase.map((item) => ({
    ...item,
    custoRupturaEvitado: obterCustoRupturaEvitado(
      custoRupturaEvitadoPorColaborador,
      item._id,
    ),
  }));

  return { inicio, fim, items: ranking };
}

router.get(
  "/ranking/colaboradores",
  escopoLoja,
  asyncHandler(async (req, res) => {
    const { inicio, fim, items } = await executarRankingColaboradores({
      escopoLojaId: req.escopoLojaId,
      periodo: req.query.periodo,
      tipo: req.query.tipo,
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
    });
    res.json({ periodo: { inicio, fim }, items });
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

    if (tipoFilter === TIPOS_AUDITORIA.RUPTURA) {
      let items = await executarRankingLojasRupturaContinuada({ inicio, fim });
      if (
        ![ROLES.SUPER_ADMIN, ROLES.STORE_ADMIN].includes(req.usuario.role) &&
        req.usuario.loja
      ) {
        items = items.filter((r) => String(r._id) === String(req.usuario.loja));
      }
      return res.json({ periodo: { inicio, fim }, items });
    }

    const match = { ...matchBase, data: { $gte: inicio, $lte: fim } };

    const ranking = await MetricaDiaria.aggregate([
      { $match: match },
      {
        $group: {
          _id: { loja: "$loja", tipo: "$tipo", data: "$data" },
          totalLidos: { $sum: "$totalLidos" },
          totalItensAuditaveis: { $sum: "$totalItensAuditaveis" },
          totalConformes: { $sum: "$totalConformes" },
          totalNaoConformes: { $sum: "$totalNaoConformes" },
          pontuacao: { $sum: "$pontuacao" },
          custoRuptura: { $sum: "$custoRuptura" },
          cancelada: { $max: "$cancelada" },
        },
      },
      {
        $group: {
          _id: "$_id.loja",
          totalLidos: { $sum: "$totalLidos" },
          totalItensAuditaveis: { $sum: "$totalItensAuditaveis" },
          totalConformes: { $sum: "$totalConformes" },
          totalNaoConformes: { $sum: "$totalNaoConformes" },
          pontuacao: { $sum: "$pontuacao" },
          custoRuptura: { $sum: "$custoRuptura" },
          auditoriasCanceladas: {
            $sum: { $cond: [{ $eq: ["$cancelada", true] }, 1, 0] },
          },
          auditoriasEtiqueta: {
            $sum: { $cond: [{ $eq: ["$_id.tipo", "ETIQUETA"] }, 1, 0] },
          },
          auditoriasPresenca: {
            $sum: { $cond: [{ $eq: ["$_id.tipo", "PRESENCA"] }, 1, 0] },
          },
          auditoriasRuptura: {
            $sum: { $cond: [{ $eq: ["$_id.tipo", "RUPTURA"] }, 1, 0] },
          },
        },
      },
      {
        $addFields: {
          totalAuditorias: {
            $add: [
              "$auditoriasEtiqueta",
              "$auditoriasPresenca",
              "$auditoriasRuptura",
            ],
          },
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
          percentualConclusao: {
            $cond: [
              { $gt: ["$totalItensAuditaveis", 0] },
              {
                $multiply: [
                  { $divide: ["$totalLidos", "$totalItensAuditaveis"] },
                  100,
                ],
              },
              null,
            ],
          },
        },
      },
      {
        $addFields: {
          percentualRestante: {
            $cond: [
              { $eq: ["$percentualConclusao", null] },
              null,
              {
                $max: [0, { $subtract: [100, "$percentualConclusao"] }],
              },
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
          totalItensAuditaveis: 1,
          totalConformes: 1,
          totalNaoConformes: 1,
          pontuacao: { $round: ["$pontuacao", 2] },
          taxaConformidade: { $round: ["$taxaConformidade", 2] },
          custoRuptura: { $round: ["$custoRuptura", 2] },
          percentualConclusao: {
            $cond: [
              { $eq: ["$percentualConclusao", null] },
              null,
              { $round: ["$percentualConclusao", 2] },
            ],
          },
          percentualRestante: {
            $cond: [
              { $eq: ["$percentualRestante", null] },
              null,
              { $round: ["$percentualRestante", 2] },
            ],
          },
          totalAuditorias: 1,
          auditoriasPorTipo: {
            ETIQUETA: "$auditoriasEtiqueta",
            PRESENCA: "$auditoriasPresenca",
            RUPTURA: "$auditoriasRuptura",
          },
          auditoriasCanceladas: 1,
        },
      },
    ]);

    const custoRupturaEvitadoPorLoja =
      tipoFilter === TIPOS_AUDITORIA.ETIQUETA ||
      tipoFilter === TIPOS_AUDITORIA.PRESENCA
        ? new Map()
        : await carregarCustoRupturaEvitadoPorLoja({ inicio, fim });

    const rankingComCustoEvitado = ranking.map((item) => ({
      ...item,
      custoRupturaEvitado: obterCustoRupturaEvitado(
        custoRupturaEvitadoPorLoja,
        item._id,
      ),
    }));

    // SUPER_ADMIN e STORE_ADMIN enxergam ranking geral de lojas.
    // Perfis fora do escopo administrativo continuam restritos à própria loja.
    let items = rankingComCustoEvitado;
    if (
      ![ROLES.SUPER_ADMIN, ROLES.STORE_ADMIN].includes(req.usuario.role) &&
      req.usuario.loja
    ) {
      items = rankingComCustoEvitado.filter(
        (r) => String(r._id) === String(req.usuario.loja),
      );
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

    // A tela de administração mostra o MESMO perfil que o colaborador vê de si
    // no portal, então precisa do mesmo conteúdo: conquistas com tiers e a
    // posição no ranking geral. Sem isso o administrador veria menos do que o
    // próprio colaborador.
    const conquistas = await resolverConquistasPortal(dados.colaborador || {});

    // O ranking geral é sempre dentro da loja do colaborador. Para o super
    // admin sem loja no escopo, `req.escopoLojaId` vem vazio e a posição sairia
    // comparando colaborador de loja diferente.
    const rankingGeral = await calcularRankingGeralPortal(
      req.escopoLojaId || dados.colaborador.loja?.toString() || null,
      req.params.id,
    );

    res.json({ ...dados, conquistas, rankingGeral });
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
    const dados = await montarRelatorioCorredores({
      escopoLojaId: req.escopoLojaId,
      periodo: req.query.periodo || "1d",
      tipo: req.query.tipo,
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
    });
    res.json(dados);
  }),
);

router.get(
  "/relatorios/corredores/detalhe",
  escopoLoja,
  asyncHandler(async (req, res) => {
    const corredor = String(req.query.corredor || "").trim();
    if (!corredor) {
      return res.status(400).json({ error: "Corredor é obrigatório." });
    }

    const dados = await montarDetalheRelatorioCorredor({
      escopoLojaId: req.escopoLojaId,
      periodo: req.query.periodo || "1d",
      tipo: req.query.tipo,
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
      corredor,
    });
    res.json(dados);
  }),
);

export default router;
