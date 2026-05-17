/**
 * Migracao/recompute idempotente para garantir que somente os dados da
 * ULTIMA planilha enviada de cada (loja, tipo, dia) sao considerados em
 * todos os periodos analiticos.
 *
 * O que o script faz (em ordem):
 *   1) Detecta Auditorias duplicadas para a mesma (loja, tipo, dia) e mescla,
 *      mantendo a mais recente por updatedAt e descartando AuditItem antigos.
 *   2) Reconstroi MetricaDiaria (consolidada por loja e por colaborador)
 *      a partir do AuditItem deduplicado.
 *   3) Recalcula campos acumulados de Colaborador (totalItensLidos,
 *      totalItensConformes, totalAuditorias, pontuacao, nivel, conquistas)
 *      a partir de MetricaDiaria.
 *   4) Recalcula Loja.pontuacao e Loja.nivel a partir de MetricaDiaria
 *      consolidada (colaborador=null).
 *   5) Garante o indice unico em Auditoria(loja, tipo, data).
 *
 * Execucao:
 *   node --env-file=.env scripts/recompute-acumulados.js
 *   node --env-file=.env scripts/recompute-acumulados.js --dry-run
 */
import 'dotenv/config';
import mongoose from 'mongoose';

import { connectDB } from '../src/config/db.js';
import { Auditoria } from '../src/models/Auditoria.js';
import { AuditItem } from '../src/models/AuditItem.js';
import { MetricaDiaria } from '../src/models/MetricaDiaria.js';
import { Colaborador } from '../src/models/Colaborador.js';
import { Loja } from '../src/models/Loja.js';

const DRY_RUN = process.argv.includes('--dry-run');

const CONQUISTAS = [
  { codigo: 'PRIMEIRA_AUDITORIA', nome: 'Primeira Auditoria', cond: (c) => c.totalAuditorias >= 1 },
  { codigo: 'CEM_LIDOS', nome: '100 Itens Lidos', cond: (c) => c.totalItensLidos >= 100 },
  { codigo: 'MIL_LIDOS', nome: '1.000 Itens Lidos', cond: (c) => c.totalItensLidos >= 1000 },
  { codigo: 'DEZ_MIL_LIDOS', nome: '10.000 Itens Lidos', cond: (c) => c.totalItensLidos >= 10000 },
  { codigo: 'CONFORMIDADE_95', nome: 'Mestre da Conformidade', cond: (c) => c.totalItensLidos >= 200 && c.totalItensConformes / Math.max(1, c.totalItensLidos) >= 0.95 },
  { codigo: 'NIVEL_5', nome: 'Auditor Veterano', cond: (c) => c.nivel >= 5 },
];

const calcNivel = (pontuacao) => Math.max(1, Math.floor(pontuacao / 500) + 1);

function recalcConquistas(colab) {
  const novas = [];
  const atuais = new Map((colab.conquistas || []).map((c) => [c.codigo, c]));
  for (const c of CONQUISTAS) {
    if (c.cond(colab)) {
      const existing = atuais.get(c.codigo);
      novas.push({
        codigo: c.codigo,
        nome: c.nome,
        conquistadaEm: existing?.conquistadaEm || new Date(),
      });
    }
  }
  return novas;
}

const stats = {
  duplicatasMescladas: 0,
  auditItemsRemovidos: 0,
  metricasRecriadas: 0,
  colaboradoresAjustados: 0,
  lojasAjustadas: 0,
};

async function passo1_mesclarAuditoriasDuplicadas() {
  console.log('\n[1] Detectando Auditorias duplicadas por (loja, tipo, dia)...');
  const grupos = await Auditoria.aggregate([
    { $group: {
        _id: { loja: '$loja', tipo: '$tipo', data: '$data' },
        ids: { $push: { _id: '$_id', updatedAt: '$updatedAt', createdAt: '$createdAt' } },
        n: { $sum: 1 },
    } },
    { $match: { n: { $gt: 1 } } },
  ]);

  if (grupos.length === 0) {
    console.log('    Nenhuma duplicata encontrada.');
    return;
  }

  console.log(`    ${grupos.length} grupo(s) duplicado(s) detectado(s).`);

  for (const g of grupos) {
    g.ids.sort((a, b) => {
      const ta = (a.updatedAt || a.createdAt || 0).valueOf();
      const tb = (b.updatedAt || b.createdAt || 0).valueOf();
      return tb - ta;
    });
    const manterId = g.ids[0]._id;
    const removerIds = g.ids.slice(1).map((x) => x._id);

    if (DRY_RUN) {
      console.log(`    [dry] manter ${manterId}, remover ${removerIds.length}`);
    } else {
      const r = await AuditItem.deleteMany({ auditoria: { $in: removerIds } });
      stats.auditItemsRemovidos += r.deletedCount || 0;
      await Auditoria.deleteMany({ _id: { $in: removerIds } });
      stats.duplicatasMescladas += removerIds.length;
    }
  }
}

async function passo2_reconstruirMetricaDiaria() {
  console.log('\n[2] Reconstruindo MetricaDiaria a partir de AuditItem...');

  // Pega todas as combinacoes existentes em AuditItem
  const grupos = await AuditItem.aggregate([
    { $group: { _id: { loja: '$loja', tipo: '$tipo', data: '$data' } } },
  ]);

  console.log(`    ${grupos.length} (loja, tipo, dia) com itens.`);

  if (DRY_RUN) return;

  // Apaga MetricaDiaria existente para reconstruir
  await MetricaDiaria.deleteMany({});

  for (const g of grupos) {
    const { loja, tipo, data } = g._id;
    const match = { loja, tipo, data };

    // Consolidado por loja (colaborador = null)
    const totaisLoja = await AuditItem.aggregate([
      { $match: match },
      { $group: {
          _id: null,
          totalItens: { $sum: 1 },
          totalLidos: { $sum: { $cond: [{ $in: ['$conforme', [true, false]] }, 1, 0] } },
          totalConformes: { $sum: { $cond: [{ $eq: ['$conforme', true] }, 1, 0] } },
          totalNaoConformes: { $sum: { $cond: [{ $eq: ['$conforme', false] }, 1, 0] } },
          pontuacao: { $sum: { $ifNull: ['$pontos', 0] } },
          custoRuptura: { $sum: { $ifNull: ['$custoRuptura', 0] } },
      } },
    ]);

    const situacoes = await AuditItem.aggregate([
      { $match: match },
      { $group: { _id: '$situacao', count: { $sum: 1 } } },
    ]);
    const situacoesMap = {};
    for (const s of situacoes) if (s._id) situacoesMap[s._id] = s.count;

    const tl = totaisLoja[0] || {};
    const taxaLoja = tl.totalLidos > 0 ? (tl.totalConformes / tl.totalLidos) * 100 : 0;

    await MetricaDiaria.create({
      loja, tipo, data, colaborador: null,
      totalItens: tl.totalItens || 0,
      totalLidos: tl.totalLidos || 0,
      totalConformes: tl.totalConformes || 0,
      totalNaoConformes: tl.totalNaoConformes || 0,
      taxaConformidade: Number(taxaLoja.toFixed(2)),
      pontuacao: Number((tl.pontuacao || 0).toFixed(2)),
      custoRuptura: Number((tl.custoRuptura || 0).toFixed(2)),
      situacoes: situacoesMap,
    });
    stats.metricasRecriadas++;

    // Por colaborador
    const porColab = await AuditItem.aggregate([
      { $match: { ...match, colaborador: { $ne: null } } },
      { $group: {
          _id: '$colaborador',
          totalItens: { $sum: 1 },
          totalLidos: { $sum: { $cond: [{ $in: ['$conforme', [true, false]] }, 1, 0] } },
          totalConformes: { $sum: { $cond: [{ $eq: ['$conforme', true] }, 1, 0] } },
          totalNaoConformes: { $sum: { $cond: [{ $eq: ['$conforme', false] }, 1, 0] } },
          pontuacao: { $sum: { $ifNull: ['$pontos', 0] } },
      } },
    ]);

    for (const c of porColab) {
      const taxa = c.totalLidos > 0 ? (c.totalConformes / c.totalLidos) * 100 : 0;
      await MetricaDiaria.create({
        loja, tipo, data, colaborador: c._id,
        totalItens: c.totalItens || 0,
        totalLidos: c.totalLidos || 0,
        totalConformes: c.totalConformes || 0,
        totalNaoConformes: c.totalNaoConformes || 0,
        taxaConformidade: Number(taxa.toFixed(2)),
        pontuacao: Number((c.pontuacao || 0).toFixed(2)),
      });
      stats.metricasRecriadas++;
    }

    // Atualiza Auditoria com os totais consolidados
    await Auditoria.updateOne(
      { loja, tipo, data },
      { $set: {
          totalItens: tl.totalItens || 0,
          totalLidos: tl.totalLidos || 0,
          totalConformes: tl.totalConformes || 0,
          totalNaoConformes: tl.totalNaoConformes || 0,
          taxaConformidade: Number(taxaLoja.toFixed(2)),
          pontuacao: Number((tl.pontuacao || 0).toFixed(2)),
          custoRupturaTotal: Number((tl.custoRuptura || 0).toFixed(2)),
          situacoes: situacoesMap,
          status: 'CONCLUIDA',
      } }
    );
  }
}

async function passo3_recalcularColaboradores() {
  console.log('\n[3] Recalculando acumulados de Colaborador a partir de MetricaDiaria...');
  const colaboradores = await Colaborador.find();
  console.log(`    ${colaboradores.length} colaborador(es) encontrados.`);

  for (const colab of colaboradores) {
    const agg = await MetricaDiaria.aggregate([
      { $match: { loja: colab.loja, colaborador: colab._id } },
      { $group: {
          _id: null,
          totalLidos: { $sum: '$totalLidos' },
          totalConformes: { $sum: '$totalConformes' },
          pontuacao: { $sum: '$pontuacao' },
          dias: { $addToSet: { tipo: '$tipo', data: '$data' } },
      } },
    ]);
    const a = agg[0] || {};
    const novoTotalAuditorias = (a.dias || []).length;
    const novaPontuacao = Number((a.pontuacao || 0).toFixed(2));

    if (DRY_RUN) {
      console.log(`    [dry] ${colab.nome} (${colab.codigoExterno}): ` +
        `lidos ${colab.totalItensLidos} -> ${a.totalLidos || 0}, ` +
        `conformes ${colab.totalItensConformes} -> ${a.totalConformes || 0}, ` +
        `pts ${colab.pontuacao} -> ${novaPontuacao}, ` +
        `aud ${colab.totalAuditorias} -> ${novoTotalAuditorias}`);
      continue;
    }

    colab.totalItensLidos = a.totalLidos || 0;
    colab.totalItensConformes = a.totalConformes || 0;
    colab.totalAuditorias = novoTotalAuditorias;
    colab.pontuacao = novaPontuacao;
    colab.nivel = calcNivel(colab.pontuacao);
    colab.conquistas = recalcConquistas(colab);
    await colab.save();
    stats.colaboradoresAjustados++;
  }
}

async function passo4_recalcularLojas() {
  console.log('\n[4] Recalculando Loja.pontuacao e nivel a partir de MetricaDiaria...');
  const lojas = await Loja.find();
  console.log(`    ${lojas.length} loja(s).`);

  for (const loja of lojas) {
    const agg = await MetricaDiaria.aggregate([
      { $match: { loja: loja._id, colaborador: null } },
      { $group: { _id: null, pontuacao: { $sum: '$pontuacao' } } },
    ]);
    const novaPontuacao = Number((agg[0]?.pontuacao || 0).toFixed(2));

    if (DRY_RUN) {
      console.log(`    [dry] ${loja.nome}: pts ${loja.pontuacao} -> ${novaPontuacao}`);
      continue;
    }

    loja.pontuacao = novaPontuacao;
    loja.nivel = calcNivel(loja.pontuacao);
    await loja.save();
    stats.lojasAjustadas++;
  }
}

async function passo5_garantirIndiceUnico() {
  console.log('\n[5] Garantindo indice unico em Auditoria(loja, tipo, data)...');
  if (DRY_RUN) {
    console.log('    [dry] indice nao alterado');
    return;
  }
  const indices = await Auditoria.collection.indexes();
  const cobrem = indices.filter((i) => {
    const k = i.key || {};
    return k.loja === 1 && k.tipo === 1 && (k.data === 1 || k.data === -1);
  });
  const temUnico = cobrem.find((i) => i.unique);
  if (temUnico) {
    console.log(`    Indice unico ja existe (${temUnico.name}).`);
    // Limpa indices nao-unique redundantes
    for (const i of cobrem) {
      if (!i.unique) {
        console.log(`    Removendo indice redundante nao-unico: ${i.name}`);
        await Auditoria.collection.dropIndex(i.name);
      }
    }
    return;
  }
  // Nenhum unique: dropa todos os redundantes e cria o unique
  for (const i of cobrem) {
    console.log(`    Removendo indice nao-unico: ${i.name}`);
    await Auditoria.collection.dropIndex(i.name);
  }
  await Auditoria.collection.createIndex(
    { loja: 1, tipo: 1, data: 1 },
    { unique: true, name: 'loja_tipo_data_unique' }
  );
  console.log('    Indice unico criado.');
}

async function main() {
  await connectDB();
  console.log('\n\u2550\u2550\u2550 RECOMPUTE/MIGRACAO ACUMULADOS \u2550\u2550\u2550');
  if (DRY_RUN) console.log('  MODO DRY-RUN - nenhuma alteracao sera persistida\n');

  await passo1_mesclarAuditoriasDuplicadas();
  await passo2_reconstruirMetricaDiaria();
  await passo3_recalcularColaboradores();
  await passo4_recalcularLojas();
  await passo5_garantirIndiceUnico();

  console.log('\n\u2550\u2550\u2550 RESUMO \u2550\u2550\u2550');
  console.log(JSON.stringify(stats, null, 2));
  console.log('\nConcluido.\n');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error('Erro inesperado:', e);
  process.exit(1);
});
