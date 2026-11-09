import { MetricaDiaria } from "../models/MetricaDiaria.js";
import { TIPOS_AUDITORIA } from "../models/Auditoria.js";
import { SystemConfig, CONFIG_DEFAULTS } from "../models/SystemConfig.js";

const DIA_MS = 24 * 60 * 60 * 1000;
const COM_ESTOQUE = "Com Presença e com Estoque";
const SEM_PRESENCA = "Sem Presença e Com Estoque";
const tipos = Object.values(TIPOS_AUDITORIA);

function contadores() {
  return { batidas: 0, avaliadas: 0, semBase: 0 };
}

function limiteValido(valor) {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 0 && valor <= 100
    ? valor
    : CONFIG_DEFAULTS.metaPercentualRestante;
}

function resumoVazio(limiteRestante) {
  return {
    ...contadores(),
    limiteRestante,
    limiteConclusao: 100 - limiteRestante,
    porTipo: Object.fromEntries(tipos.map((tipo) => [tipo, contadores()])),
  };
}

function diaUTC(data) {
  const dia = new Date(data);
  return Number.isNaN(dia.getTime()) ? null : dia.toISOString().slice(0, 10);
}

function situacao(linha, nome) {
  const mapa = linha?.situacoes;
  return Number((mapa instanceof Map ? mapa.get(nome) : mapa?.[nome]) ?? 0);
}

function basePresenca(linha) {
  return situacao(linha, COM_ESTOQUE) + situacao(linha, SEM_PRESENCA);
}

// Recebe somente métricas de auditorias concluídas e ativas. A unidade da
// contagem é loja + tipo + dia, inclusive ao consultar todo o histórico.
export function resumirMetasLojas(linhas, {
  inicio, fim, tipo, lojaIds = [], limiteRestante = CONFIG_DEFAULTS.metaPercentualRestante,
}) {
  const limite = limiteValido(limiteRestante);
  const resultado = new Map(lojaIds.map((id) => [String(id), resumoVazio(limite)]));
  const porDia = new Map();
  for (const linha of linhas) {
    const dia = diaUTC(linha.data);
    if (!dia || !tipos.includes(linha.tipo) || linha.cancelada || linha.excluida) continue;
    if (linha.status && linha.status !== "CONCLUIDA") continue;
    porDia.set(`${linha.loja}|${linha.tipo}|${dia}`, linha);
  }

  for (const linha of porDia.values()) {
    const data = new Date(linha.data);
    if (data < inicio || data > fim || (tipo && linha.tipo !== tipo)) continue;
    const lojaId = String(linha.loja);
    if (lojaIds.length && !resultado.has(lojaId)) continue;
    const resumo = resultado.get(lojaId) || resumoVazio(limite);
    const resumoTipo = resumo.porTipo[linha.tipo];
    let base = 0;
    let restantes = 0;

    if (linha.tipo === TIPOS_AUDITORIA.ETIQUETA) {
      base = Number(linha.totalItensAuditaveis || 0);
      restantes = Math.max(0, base - Number(linha.totalLidos || 0));
    } else if (linha.tipo === TIPOS_AUDITORIA.PRESENCA) {
      base = basePresenca(linha);
      restantes = situacao(linha, SEM_PRESENCA);
    } else if (data.getUTCDay() !== 1) {
      // Ruptura continua a Presença do dia anterior, na mesma semana
      // operacional e loja. A referência pode estar fora do filtro de datas.
      const anterior = diaUTC(new Date(`${diaUTC(data)}T00:00:00.000Z`).getTime() - DIA_MS);
      const referencia = porDia.get(`${lojaId}|${TIPOS_AUDITORIA.PRESENCA}|${anterior}`);
      base = basePresenca(referencia);
      restantes = situacao(linha, SEM_PRESENCA);
    }

    if (!(base > 0) || !Number.isFinite(base) || !Number.isFinite(restantes) || restantes < 0) {
      resumo.semBase++;
      resumoTipo.semBase++;
    } else {
      resumo.avaliadas++;
      resumoTipo.avaliadas++;
      // Compara antes de arredondar. Exatamente 2% restante / 98% concluído
      // não satisfaz o critério estrito de abaixo/acima do limite.
      if (restantes * 100 < base * limite) {
        resumo.batidas++;
        resumoTipo.batidas++;
      }
    }
    resultado.set(lojaId, resumo);
  }
  return resultado;
}

export async function carregarMetasLojas({ lojaIds, inicio, fim, tipo }) {
  if (!lojaIds.length) return new Map();
  const precisaReferencia = !tipo || tipo === TIPOS_AUDITORIA.RUPTURA;
  const data = { $gte: inicio, $lte: fim };
  const selecao = tipo ? { tipo, data } : { data };
  const match = {
    loja: { $in: lojaIds },
    colaborador: null,
    cancelada: { $ne: true },
    ...(precisaReferencia ? {
      $or: [selecao, {
        tipo: TIPOS_AUDITORIA.PRESENCA,
        data: { $gte: new Date(inicio.getTime() - DIA_MS), $lte: new Date(fim.getTime() - DIA_MS) },
      }],
    } : selecao),
  };

  const [linhas, config] = await Promise.all([
    MetricaDiaria.aggregate([
      { $match: match },
      {
        $lookup: {
          from: "auditorias",
          let: { loja: "$loja", tipo: "$tipo", data: "$data" },
          pipeline: [
            { $match: {
              status: "CONCLUIDA",
              excluida: { $ne: true },
              $expr: { $and: [
                { $eq: ["$loja", "$$loja"] },
                { $eq: ["$tipo", "$$tipo"] },
                { $eq: ["$data", "$$data"] },
              ] },
            } },
            { $limit: 1 },
            { $project: { _id: 1 } },
          ],
          as: "auditoria",
        },
      },
      { $match: { "auditoria.0": { $exists: true } } },
      { $project: { loja: 1, tipo: 1, data: 1, totalLidos: 1, totalItensAuditaveis: 1, situacoes: 1 } },
    ]),
    SystemConfig.findOne({ chave: "global" }).select("metaPercentualRestante").lean(),
  ]);

  return resumirMetasLojas(linhas, {
    inicio, fim, tipo, lojaIds,
    limiteRestante: config?.metaPercentualRestante,
  });
}
