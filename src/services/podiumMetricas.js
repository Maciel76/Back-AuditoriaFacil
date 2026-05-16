import mongoose from "mongoose";
import { MetricaDiaria } from "../models/MetricaDiaria.js";

function normalizarLojaId(lojaId) {
  if (!lojaId) return null;
  if (lojaId instanceof mongoose.Types.ObjectId) return lojaId;
  return new mongoose.Types.ObjectId(lojaId);
}

export async function calcularMapaTotalLiderPodium({ lojaId = null } = {}) {
  const match = {
    colaborador: { $ne: null },
    cancelada: { $ne: true },
  };

  const lojaObjectId = normalizarLojaId(lojaId);
  if (lojaObjectId) match.loja = lojaObjectId;

  const rankingDiario = await MetricaDiaria.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          loja: "$loja",
          data: "$data",
          colaborador: "$colaborador",
        },
        totalLidos: { $sum: "$totalLidos" },
        pontuacao: { $sum: "$pontuacao" },
        totalConformes: { $sum: "$totalConformes" },
      },
    },
    {
      $sort: {
        "_id.loja": 1,
        "_id.data": 1,
        totalLidos: -1,
        pontuacao: -1,
        totalConformes: -1,
        "_id.colaborador": 1,
      },
    },
  ]);

  const totais = new Map();
  const colocacoesPorDia = new Map();

  for (const item of rankingDiario) {
    const lojaAtual = String(item?._id?.loja || "");
    const dataAtual = item?._id?.data ? new Date(item._id.data).getTime() : 0;
    const chaveDia = `${lojaAtual}:${dataAtual}`;
    const colocacoesRegistradas = Number(colocacoesPorDia.get(chaveDia) || 0);
    if (colocacoesRegistradas >= 3) continue;

    colocacoesPorDia.set(chaveDia, colocacoesRegistradas + 1);
    const colaboradorId = String(item?._id?.colaborador || "");
    totais.set(colaboradorId, Number(totais.get(colaboradorId) || 0) + 1);
  }

  return totais;
}
