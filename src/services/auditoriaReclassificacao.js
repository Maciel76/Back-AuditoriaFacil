import { Auditoria, TIPOS_AUDITORIA } from "../models/Auditoria.js";
import { AuditItem } from "../models/AuditItem.js";
import { MetricaDiaria } from "../models/MetricaDiaria.js";
import { classificar, REGRAS } from "./regras.js";
import { recomputarAcumuladosLoja } from "./auditoriaCancelamento.js";

/**
 * Reclassifica uma auditoria para um novo tipo (ETIQUETA/PRESENCA/RUPTURA).
 * Todos os AuditItem desta auditoria são reavaliados com as novas regras,
 * a Auditoria recebe o novo tipo e os totais recomputados, as MetricaDiaria
 * antigas (loja, tipoAntigo, data) são removidas e novas (loja, novoTipo, data)
 * são criadas. Por fim, os acumulados da loja são recalculados.
 *
 * Lança erro de conflito quando já existe uma auditoria distinta para
 * (loja, novoTipo, data), pois o índice único da Auditoria impede duplicidade.
 */
export async function reclassificarAuditoria({
  auditoriaId,
  lojaId,
  novoTipo,
  usuarioId,
}) {
  if (!Object.values(TIPOS_AUDITORIA).includes(novoTipo)) {
    const err = new Error("Tipo de auditoria inválido");
    err.status = 400;
    throw err;
  }

  const auditoria = await Auditoria.findOne({ _id: auditoriaId, loja: lojaId });
  if (!auditoria) return null;

  if (auditoria.status === "CANCELADA") {
    const err = new Error(
      "Auditoria cancelada não pode ser reclassificada. Restaure o upload antes de reclassificar.",
    );
    err.status = 409;
    throw err;
  }

  const tipoAntigo = auditoria.tipo;
  if (tipoAntigo === novoTipo) {
    return auditoria;
  }

  const conflito = await Auditoria.findOne({
    _id: { $ne: auditoria._id },
    loja: lojaId,
    tipo: novoTipo,
    data: auditoria.data,
  }).lean();
  if (conflito) {
    const err = new Error(
      `Já existe uma auditoria de ${REGRAS[novoTipo].label} para esta loja no mesmo dia. Exclua ou cancele a outra antes de reclassificar.`,
    );
    err.status = 409;
    throw err;
  }

  const itens = await AuditItem.find({ auditoria: auditoria._id });

  let totalLidos = 0;
  let totalItensAuditaveis = 0;
  let totalConformes = 0;
  let totalNaoConformes = 0;
  let pontuacao = 0;
  let custoRupturaTotal = 0;
  const distrib = {};
  const porColaborador = new Map();

  for (const item of itens) {
    const cls = classificar(novoTipo, item.situacao);
    if (cls.conforme !== null) totalItensAuditaveis += 1;
    if (cls.conta) {
      totalLidos += 1;
      if (cls.conforme === true) totalConformes += 1;
      else if (cls.conforme === false) totalNaoConformes += 1;
      pontuacao += cls.pontos;
    }
    if (typeof item.custoRuptura === "number" && cls.conforme === false) {
      custoRupturaTotal += item.custoRuptura;
    }
    if (item.situacao) distrib[item.situacao] = (distrib[item.situacao] || 0) + 1;

    item.tipo = novoTipo;
    item.conforme = cls.conforme;
    item.pontos = cls.conta ? cls.pontos : 0;
    await item.save();

    if (item.colaborador) {
      const k = String(item.colaborador);
      const c = porColaborador.get(k) || {
        colaborador: item.colaborador,
        nome: item.colaboradorNome,
        codigoExterno: item.colaboradorCodigo,
        itens: 0,
        conformes: 0,
        naoConformes: 0,
        pontuacao: 0,
      };
      if (cls.conta) {
        c.itens += 1;
        if (cls.conforme === true) c.conformes += 1;
        else if (cls.conforme === false) c.naoConformes += 1;
        c.pontuacao += cls.pontos;
      }
      porColaborador.set(k, c);
    }
  }

  const taxaConformidade =
    novoTipo === "ETIQUETA"
      ? totalItensAuditaveis > 0
        ? (totalLidos / totalItensAuditaveis) * 100
        : 0
      : totalLidos > 0
        ? (totalConformes / totalLidos) * 100
        : 0;

  auditoria.tipo = novoTipo;
  auditoria.totalLidos = totalLidos;
  auditoria.totalConformes = totalConformes;
  auditoria.totalNaoConformes = totalNaoConformes;
  auditoria.taxaConformidade = Number(taxaConformidade.toFixed(2));
  auditoria.pontuacao = Number(pontuacao.toFixed(2));
  auditoria.custoRupturaTotal = Number(custoRupturaTotal.toFixed(2));
  auditoria.situacoes = distrib;
  auditoria.topColaboradores = [...porColaborador.values()]
    .sort((a, b) => b.pontuacao - a.pontuacao)
    .slice(0, 10);
  if (auditoria.status !== "ERRO") auditoria.status = "CONCLUIDA";
  await auditoria.save();

  // Remove métricas diárias antigas (tipo antigo) deste dia
  await MetricaDiaria.deleteMany({
    loja: lojaId,
    tipo: tipoAntigo,
    data: auditoria.data,
  });

  // Remove eventuais métricas pré-existentes do novo tipo para o mesmo dia
  await MetricaDiaria.deleteMany({
    loja: lojaId,
    tipo: novoTipo,
    data: auditoria.data,
  });

  // Recria métrica diária consolidada da loja
  await MetricaDiaria.create({
    loja: lojaId,
    tipo: novoTipo,
    data: auditoria.data,
    colaborador: null,
    totalItens: itens.length,
    totalItensAuditaveis,
    totalLidos,
    totalConformes,
    totalNaoConformes,
    taxaConformidade: auditoria.taxaConformidade,
    pontuacao: auditoria.pontuacao,
    custoRuptura: auditoria.custoRupturaTotal,
    situacoes: distrib,
  });

  // Métricas diárias por colaborador
  for (const c of porColaborador.values()) {
    const taxa = c.itens > 0 ? (c.conformes / c.itens) * 100 : 0;
    await MetricaDiaria.create({
      loja: lojaId,
      tipo: novoTipo,
      data: auditoria.data,
      colaborador: c.colaborador,
      totalItens: c.itens,
      totalItensAuditaveis: c.itens,
      totalLidos: c.itens,
      totalConformes: c.conformes,
      totalNaoConformes: c.naoConformes,
      taxaConformidade: Number(taxa.toFixed(2)),
      pontuacao: Number(c.pontuacao.toFixed(2)),
    });
  }

  await recomputarAcumuladosLoja(lojaId);

  return auditoria;
}
