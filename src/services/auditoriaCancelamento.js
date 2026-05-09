import mongoose from "mongoose";
import { Auditoria } from "../models/Auditoria.js";
import { AuditItem } from "../models/AuditItem.js";
import { Colaborador } from "../models/Colaborador.js";
import { Loja } from "../models/Loja.js";
import { MetricaDiaria } from "../models/MetricaDiaria.js";
import { avaliarConquistas } from "./conquistasService.js";
import { normalizarMetricasPorTipo } from "./colaboradorMetricas.js";

function calcNivel(pontuacao) {
  return Math.max(1, Math.floor(Number(pontuacao || 0) / 500) + 1);
}

const METRICA_ZERADA = {
  totalItens: 0,
  totalItensAuditaveis: 0,
  totalLidos: 0,
  totalConformes: 0,
  totalNaoConformes: 0,
  taxaConformidade: 0,
  pontuacao: 0,
  custoRuptura: 0,
  situacoes: {},
};

export async function recomputarAcumuladosLoja(lojaId) {
  const lojaObjectId = new mongoose.Types.ObjectId(lojaId);

  const agregadosColaboradores = await MetricaDiaria.aggregate([
    {
      $match: {
        loja: lojaObjectId,
        colaborador: { $ne: null },
        cancelada: { $ne: true },
      },
    },
    {
      $lookup: {
        from: MetricaDiaria.collection.name,
        let: { loja: "$loja", tipo: "$tipo", data: "$data" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$loja", "$$loja"] },
                  { $eq: ["$tipo", "$$tipo"] },
                  { $eq: ["$data", "$$data"] },
                  { $eq: ["$colaborador", null] },
                  { $ne: ["$cancelada", true] },
                ],
              },
            },
          },
          { $project: { totalLidos: 1 } },
        ],
        as: "metricaLojaParticipacao",
      },
    },
    {
      $addFields: {
        itensParticipacaoLoja: {
          $ifNull: [
            { $arrayElemAt: ["$metricaLojaParticipacao.totalLidos", 0] },
            0,
          ],
        },
      },
    },
    {
      $group: {
        _id: "$colaborador",
        totalAuditorias: { $sum: 1 },
        totalItensLidos: { $sum: "$totalLidos" },
        totalItensConformes: { $sum: "$totalConformes" },
        totalItensParticipacaoLoja: { $sum: "$itensParticipacaoLoja" },
        pontuacao: { $sum: "$pontuacao" },
        auditoriasEtiqueta: {
          $sum: { $cond: [{ $eq: ["$tipo", "ETIQUETA"] }, 1, 0] },
        },
        auditoriasPresenca: {
          $sum: { $cond: [{ $eq: ["$tipo", "PRESENCA"] }, 1, 0] },
        },
        auditoriasRuptura: {
          $sum: { $cond: [{ $eq: ["$tipo", "RUPTURA"] }, 1, 0] },
        },
        itensLidosEtiqueta: {
          $sum: {
            $cond: [{ $eq: ["$tipo", "ETIQUETA"] }, "$totalLidos", 0],
          },
        },
        itensLidosPresenca: {
          $sum: {
            $cond: [{ $eq: ["$tipo", "PRESENCA"] }, "$totalLidos", 0],
          },
        },
        itensLidosRuptura: {
          $sum: {
            $cond: [{ $eq: ["$tipo", "RUPTURA"] }, "$totalLidos", 0],
          },
        },
        itensConformesEtiqueta: {
          $sum: {
            $cond: [{ $eq: ["$tipo", "ETIQUETA"] }, "$totalConformes", 0],
          },
        },
        itensConformesPresenca: {
          $sum: {
            $cond: [{ $eq: ["$tipo", "PRESENCA"] }, "$totalConformes", 0],
          },
        },
        itensConformesRuptura: {
          $sum: {
            $cond: [{ $eq: ["$tipo", "RUPTURA"] }, "$totalConformes", 0],
          },
        },
      },
    },
  ]);

  const agregadosPorColaborador = new Map(
    agregadosColaboradores.map((item) => [String(item._id), item]),
  );

  const colaboradores = await Colaborador.find({ loja: lojaObjectId });
  for (const colaborador of colaboradores) {
    const agregado = agregadosPorColaborador.get(String(colaborador._id));
    colaborador.totalAuditorias = Number(agregado?.totalAuditorias || 0);
    colaborador.totalItensLidos = Number(agregado?.totalItensLidos || 0);
    colaborador.totalItensConformes = Number(
      agregado?.totalItensConformes || 0,
    );
    colaborador.totalItensParticipacaoLoja = Number(
      agregado?.totalItensParticipacaoLoja || 0,
    );
    colaborador.metricasPorTipo = normalizarMetricasPorTipo({
      ETIQUETA: {
        totalAuditorias: agregado?.auditoriasEtiqueta || 0,
        totalItensLidos: agregado?.itensLidosEtiqueta || 0,
        totalItensConformes: agregado?.itensConformesEtiqueta || 0,
      },
      PRESENCA: {
        totalAuditorias: agregado?.auditoriasPresenca || 0,
        totalItensLidos: agregado?.itensLidosPresenca || 0,
        totalItensConformes: agregado?.itensConformesPresenca || 0,
      },
      RUPTURA: {
        totalAuditorias: agregado?.auditoriasRuptura || 0,
        totalItensLidos: agregado?.itensLidosRuptura || 0,
        totalItensConformes: agregado?.itensConformesRuptura || 0,
      },
    });
    colaborador.pontuacao = Number(Number(agregado?.pontuacao || 0).toFixed(2));
    colaborador.conquistas = [];
    colaborador.nivel = calcNivel(colaborador.pontuacao);
    await avaliarConquistas(colaborador);
    colaborador.nivel = calcNivel(colaborador.pontuacao);
    await colaborador.save();
  }

  const [lojaAgregado] = await MetricaDiaria.aggregate([
    {
      $match: {
        loja: lojaObjectId,
        colaborador: null,
        cancelada: { $ne: true },
      },
    },
    {
      $group: {
        _id: "$loja",
        pontuacao: { $sum: "$pontuacao" },
      },
    },
  ]);

  const loja = await Loja.findById(lojaObjectId);
  if (loja) {
    loja.pontuacao = Number(Number(lojaAgregado?.pontuacao || 0).toFixed(2));
    loja.nivel = calcNivel(loja.pontuacao);
    await loja.save();
  }
}

export async function zerarMetricasCanceladas({
  auditoria,
  usuarioId,
  motivo = "",
}) {
  const canceladaEm = auditoria.canceladaEm || new Date();
  await MetricaDiaria.updateMany(
    { loja: auditoria.loja, tipo: auditoria.tipo, data: auditoria.data },
    {
      $set: {
        ...METRICA_ZERADA,
        cancelada: true,
        canceladaEm,
        canceladaPor: usuarioId,
        motivoCancelamento: motivo,
      },
    },
  );

  await MetricaDiaria.findOneAndUpdate(
    {
      loja: auditoria.loja,
      tipo: auditoria.tipo,
      data: auditoria.data,
      colaborador: null,
    },
    {
      $set: {
        loja: auditoria.loja,
        tipo: auditoria.tipo,
        data: auditoria.data,
        colaborador: null,
        ...METRICA_ZERADA,
        cancelada: true,
        canceladaEm,
        canceladaPor: usuarioId,
        motivoCancelamento: motivo,
      },
    },
    { upsert: true, new: true },
  );
}

export async function cancelarAuditoria({
  auditoriaId,
  lojaId,
  usuarioId,
  motivo = "",
}) {
  const auditoria = await Auditoria.findOne({ _id: auditoriaId, loja: lojaId });
  if (!auditoria) return null;

  if (auditoria.status !== "CANCELADA") {
    auditoria.status = "CANCELADA";
    auditoria.canceladaEm = new Date();
    auditoria.canceladaPor = usuarioId;
    auditoria.motivoCancelamento = motivo;
    await auditoria.save();
  }

  await AuditItem.updateMany(
    { auditoria: auditoria._id },
    { $set: { cancelada: true } },
  );

  await zerarMetricasCanceladas({ auditoria, usuarioId, motivo });
  await recomputarAcumuladosLoja(auditoria.loja);

  return auditoria;
}
