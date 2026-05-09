import { TIPOS_AUDITORIA } from "../models/Auditoria.js";

export const TIPOS_AUDITORIA_LIST = Object.values(TIPOS_AUDITORIA);

export function criarMetricasPorTipoZeradas() {
  return Object.fromEntries(
    TIPOS_AUDITORIA_LIST.map((tipo) => [
      tipo,
      {
        totalAuditorias: 0,
        totalItensLidos: 0,
        totalItensConformes: 0,
      },
    ]),
  );
}

export function normalizarMetricasPorTipo(metricasPorTipo) {
  const base = criarMetricasPorTipoZeradas();
  for (const tipo of TIPOS_AUDITORIA_LIST) {
    const origem = metricasPorTipo?.[tipo] || {};
    base[tipo] = {
      totalAuditorias: Number(origem.totalAuditorias || 0),
      totalItensLidos: Number(origem.totalItensLidos || 0),
      totalItensConformes: Number(origem.totalItensConformes || 0),
    };
  }
  return base;
}
