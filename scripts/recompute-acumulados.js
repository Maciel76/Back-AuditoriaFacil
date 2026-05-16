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
import "dotenv/config";
import mongoose from "mongoose";

import { connectDB } from "../src/config/db.js";
import { Auditoria } from "../src/models/Auditoria.js";
import { AuditItem } from "../src/models/AuditItem.js";
import { MetricaDiaria } from "../src/models/MetricaDiaria.js";
import { Colaborador } from "../src/models/Colaborador.js";
import { Loja } from "../src/models/Loja.js";
import { avaliarConquistas } from "../src/services/conquistasService.js";
import { normalizarMetricasPorTipo } from "../src/services/colaboradorMetricas.js";
import { calcularMapaTotalLiderPodium } from "../src/services/podiumMetricas.js";
import { classificar } from "../src/services/regras.js";

const DRY_RUN = process.argv.includes("--dry-run");

const calcNivel = (pontuacao) => Math.max(1, Math.floor(pontuacao / 500) + 1);

const stats = {
  duplicatasMescladas: 0,
  auditItemsRemovidos: 0,
  metricasRecriadas: 0,
  colaboradoresAjustados: 0,
  lojasAjustadas: 0,
};

async function passo1_mesclarAuditoriasDuplicadas() {
  console.log(
    "\n[1] Detectando Auditorias duplicadas por (loja, tipo, dia)...",
  );
  const grupos = await Auditoria.aggregate([
    {
      $group: {
        _id: { loja: "$loja", tipo: "$tipo", data: "$data" },
        ids: {
          $push: {
            _id: "$_id",
            updatedAt: "$updatedAt",
            createdAt: "$createdAt",
          },
        },
        n: { $sum: 1 },
      },
    },
    { $match: { n: { $gt: 1 } } },
  ]);

  if (grupos.length === 0) {
    console.log("    Nenhuma duplicata encontrada.");
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
  console.log("\n[2] Reconstruindo MetricaDiaria a partir de AuditItem...");

  // Pega todas as combinacoes existentes em AuditItem
  const grupos = await AuditItem.aggregate([
    { $group: { _id: { loja: "$loja", tipo: "$tipo", data: "$data" } } },
  ]);

  console.log(`    ${grupos.length} (loja, tipo, dia) com itens.`);

  if (DRY_RUN) return;

  // Apaga MetricaDiaria existente para reconstruir
  await MetricaDiaria.deleteMany({});

  for (const g of grupos) {
    const { loja, tipo, data } = g._id;
    const match = { loja, tipo, data };

    // ----------------------------------------------------------------
    // Consolidado por loja (colaborador = null)
    // Agrega por situacao e usa REGRAS para calcular totais corretamente.
    // Isso garante a mesma logica do auditoriaProcessor.js.
    // ----------------------------------------------------------------
    const porSituacao = await AuditItem.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$situacao",
          count: { $sum: 1 },
          pontuacao: { $sum: { $ifNull: ["$pontos", 0] } },
          custoRuptura: { $sum: { $ifNull: ["$custoRuptura", 0] } },
        },
      },
    ]);

    const situacoesMap = {};
    let totalItens = 0;
    let totalItensAuditaveis = 0; // conforme != null (exclui 'Sem Estoque')
    let totalLidos = 0; // conta:true (itens fisicamente lidos)
    let totalConformes = 0;
    let totalNaoConformes = 0;
    let pontuacaoLoja = 0;
    let custoRupturaLoja = 0;

    for (const s of porSituacao) {
      if (!s._id) continue;
      const cls = classificar(tipo, s._id);
      situacoesMap[s._id] = s.count;
      totalItens += s.count;
      if (cls.conforme !== null) totalItensAuditaveis += s.count;
      if (cls.conta) {
        totalLidos += s.count;
        if (cls.conforme === true) totalConformes += s.count;
        else if (cls.conforme === false) totalNaoConformes += s.count;
        pontuacaoLoja += s.pontuacao;
      }
      if (cls.conforme === false) custoRupturaLoja += s.custoRuptura;
    }

    // ETIQUETA: cobertura = lidos / auditaveis; PRESENCA/RUPTURA: qualidade = conformes / lidos
    const taxaLoja =
      tipo === "ETIQUETA"
        ? totalItensAuditaveis > 0
          ? (totalLidos / totalItensAuditaveis) * 100
          : 0
        : totalLidos > 0
          ? (totalConformes / totalLidos) * 100
          : 0;

    await MetricaDiaria.create({
      loja,
      tipo,
      data,
      colaborador: null,
      totalItens,
      totalItensAuditaveis,
      totalLidos,
      totalConformes,
      totalNaoConformes,
      taxaConformidade: Number(taxaLoja.toFixed(2)),
      pontuacao: Number(pontuacaoLoja.toFixed(2)),
      custoRuptura: Number(custoRupturaLoja.toFixed(2)),
      situacoes: situacoesMap,
    });
    stats.metricasRecriadas++;

    // ----------------------------------------------------------------
    // Por colaborador
    // ----------------------------------------------------------------
    const porColabSituacao = await AuditItem.aggregate([
      { $match: { ...match, colaborador: { $ne: null } } },
      {
        $group: {
          _id: { colaborador: "$colaborador", situacao: "$situacao" },
          count: { $sum: 1 },
          pontuacao: { $sum: { $ifNull: ["$pontos", 0] } },
        },
      },
    ]);

    // Agrupa por colaborador
    const colabMap = new Map();
    for (const row of porColabSituacao) {
      const colabId = String(row._id.colaborador);
      const situacao = row._id.situacao;
      const cls = classificar(tipo, situacao);
      if (!colabMap.has(colabId)) {
        colabMap.set(colabId, {
          colaborador: row._id.colaborador,
          totalItens: 0,
          totalLidos: 0,
          totalConformes: 0,
          totalNaoConformes: 0,
          pontuacao: 0,
        });
      }
      const c = colabMap.get(colabId);
      c.totalItens += row.count;
      if (cls.conta) {
        c.totalLidos += row.count;
        if (cls.conforme === true) c.totalConformes += row.count;
        else if (cls.conforme === false) c.totalNaoConformes += row.count;
        c.pontuacao += row.pontuacao;
      }
    }

    for (const c of colabMap.values()) {
      // Por colaborador: taxa e sempre conformes/lidos (qualidade do que esse auditor fez)
      const taxa =
        c.totalLidos > 0 ? (c.totalConformes / c.totalLidos) * 100 : 0;
      await MetricaDiaria.create({
        loja,
        tipo,
        data,
        colaborador: c.colaborador,
        totalItens: c.totalItens,
        totalItensAuditaveis: c.totalLidos, // por colaborador: so itens lidos (conta:true)
        totalLidos: c.totalLidos,
        totalConformes: c.totalConformes,
        totalNaoConformes: c.totalNaoConformes,
        taxaConformidade: Number(taxa.toFixed(2)),
        pontuacao: Number(c.pontuacao.toFixed(2)),
      });
      stats.metricasRecriadas++;
    }

    // Atualiza Auditoria com os totais consolidados
    await Auditoria.updateOne(
      { loja, tipo, data },
      {
        $set: {
          totalItens,
          totalLidos,
          totalConformes,
          totalNaoConformes,
          taxaConformidade: Number(taxaLoja.toFixed(2)),
          pontuacao: Number(pontuacaoLoja.toFixed(2)),
          custoRupturaTotal: Number(custoRupturaLoja.toFixed(2)),
          situacoes: situacoesMap,
          status: "CONCLUIDA",
        },
      },
    );
  }
}

async function passo3_recalcularColaboradores() {
  console.log(
    "\n[3] Recalculando acumulados de Colaborador a partir de MetricaDiaria...",
  );
  const totaisLiderPodium = await calcularMapaTotalLiderPodium();
  const colaboradores = await Colaborador.find();
  console.log(`    ${colaboradores.length} colaborador(es) encontrados.`);

  for (const colab of colaboradores) {
    const agg = await MetricaDiaria.aggregate([
      { $match: { loja: colab.loja, colaborador: colab._id } },
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
          _id: null,
          totalLidos: { $sum: "$totalLidos" },
          totalConformes: { $sum: "$totalConformes" },
          totalItensParticipacaoLoja: { $sum: "$itensParticipacaoLoja" },
          pontuacao: { $sum: "$pontuacao" },
          totalAuditorias: { $sum: 1 },
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
            $sum: { $cond: [{ $eq: ["$tipo", "ETIQUETA"] }, "$totalLidos", 0] },
          },
          itensLidosPresenca: {
            $sum: { $cond: [{ $eq: ["$tipo", "PRESENCA"] }, "$totalLidos", 0] },
          },
          itensLidosRuptura: {
            $sum: { $cond: [{ $eq: ["$tipo", "RUPTURA"] }, "$totalLidos", 0] },
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
    const a = agg[0] || {};
    const novoTotalAuditorias = a.totalAuditorias || 0;
    const novaPontuacao = Number((a.pontuacao || 0).toFixed(2));
    const novoTotalLiderPodium = Number(
      totaisLiderPodium.get(String(colab._id)) || 0,
    );

    if (DRY_RUN) {
      console.log(
        `    [dry] ${colab.nome} (${colab.codigoExterno}): ` +
          `lidos ${colab.totalItensLidos} -> ${a.totalLidos || 0}, ` +
          `conformes ${colab.totalItensConformes} -> ${a.totalConformes || 0}, ` +
          `pts ${colab.pontuacao} -> ${novaPontuacao}, ` +
          `aud ${colab.totalAuditorias} -> ${novoTotalAuditorias}, ` +
          `podio ${colab.totalLiderPodium || 0} -> ${novoTotalLiderPodium}`,
      );
      continue;
    }

    colab.totalItensLidos = a.totalLidos || 0;
    colab.totalItensConformes = a.totalConformes || 0;
    colab.totalAuditorias = novoTotalAuditorias;
    colab.totalItensParticipacaoLoja = a.totalItensParticipacaoLoja || 0;
    colab.totalLiderPodium = novoTotalLiderPodium;
    colab.metricasPorTipo = normalizarMetricasPorTipo({
      ETIQUETA: {
        totalAuditorias: a.auditoriasEtiqueta || 0,
        totalItensLidos: a.itensLidosEtiqueta || 0,
        totalItensConformes: a.itensConformesEtiqueta || 0,
      },
      PRESENCA: {
        totalAuditorias: a.auditoriasPresenca || 0,
        totalItensLidos: a.itensLidosPresenca || 0,
        totalItensConformes: a.itensConformesPresenca || 0,
      },
      RUPTURA: {
        totalAuditorias: a.auditoriasRuptura || 0,
        totalItensLidos: a.itensLidosRuptura || 0,
        totalItensConformes: a.itensConformesRuptura || 0,
      },
    });
    colab.pontuacao = novaPontuacao;
    colab.nivel = calcNivel(colab.pontuacao);
    colab.conquistas = [];
    await avaliarConquistas(colab);
    colab.nivel = calcNivel(colab.pontuacao);
    await colab.save();
    stats.colaboradoresAjustados++;
  }
}

async function passo4_recalcularLojas() {
  console.log(
    "\n[4] Recalculando Loja.pontuacao e nivel a partir de MetricaDiaria...",
  );
  const lojas = await Loja.find();
  console.log(`    ${lojas.length} loja(s).`);

  for (const loja of lojas) {
    const agg = await MetricaDiaria.aggregate([
      { $match: { loja: loja._id, colaborador: null } },
      { $group: { _id: null, pontuacao: { $sum: "$pontuacao" } } },
    ]);
    const novaPontuacao = Number((agg[0]?.pontuacao || 0).toFixed(2));

    if (DRY_RUN) {
      console.log(
        `    [dry] ${loja.nome}: pts ${loja.pontuacao} -> ${novaPontuacao}`,
      );
      continue;
    }

    loja.pontuacao = novaPontuacao;
    loja.nivel = calcNivel(loja.pontuacao);
    await loja.save();
    stats.lojasAjustadas++;
  }
}

async function passo5_garantirIndiceUnico() {
  console.log(
    "\n[5] Garantindo indice unico em Auditoria(loja, tipo, data)...",
  );
  if (DRY_RUN) {
    console.log("    [dry] indice nao alterado");
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
    { unique: true, name: "loja_tipo_data_unique" },
  );
  console.log("    Indice unico criado.");
}

async function main() {
  await connectDB();
  console.log(
    "\n\u2550\u2550\u2550 RECOMPUTE/MIGRACAO ACUMULADOS \u2550\u2550\u2550",
  );
  if (DRY_RUN)
    console.log("  MODO DRY-RUN - nenhuma alteracao sera persistida\n");

  await passo1_mesclarAuditoriasDuplicadas();
  await passo2_reconstruirMetricaDiaria();
  await passo3_recalcularColaboradores();
  await passo4_recalcularLojas();
  await passo5_garantirIndiceUnico();

  console.log("\n\u2550\u2550\u2550 RESUMO \u2550\u2550\u2550");
  console.log(JSON.stringify(stats, null, 2));
  console.log("\nConcluido.\n");

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error("Erro inesperado:", e);
  process.exit(1);
});
