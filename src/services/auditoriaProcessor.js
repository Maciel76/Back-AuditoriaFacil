import dayjs from "dayjs";
import { Auditoria, TIPOS_AUDITORIA } from "../models/Auditoria.js";
import { AuditItem } from "../models/AuditItem.js";
import { Colaborador } from "../models/Colaborador.js";
import { MetricaDiaria } from "../models/MetricaDiaria.js";
import { Loja } from "../models/Loja.js";
import { lerPlanilha } from "./planilhaParser.js";
import { classificar, REGRAS } from "./regras.js";
import { avaliarConquistas } from "./conquistasService.js";
import { normalizarMetricasPorTipo } from "./colaboradorMetricas.js";
import { zerarMetricasCanceladas } from "./auditoriaCancelamento.js";

function reportProgress(onProgress, progress, stage) {
  if (typeof onProgress !== "function") return;
  onProgress({
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    stage,
  });
}

/**
 * Garante existência de um Colaborador (loja+codigoExterno) e devolve seu _id.
 */
async function ensureColaborador(lojaId, codigo, nome, cache) {
  if (!codigo) return null;
  const key = `${lojaId}:${codigo}`;
  if (cache.has(key)) return cache.get(key);
  let col = await Colaborador.findOne({ loja: lojaId, codigoExterno: codigo });
  if (!col) {
    col = await Colaborador.create({
      loja: lojaId,
      codigoExterno: codigo,
      nome: nome || codigo,
    });
  } else if (nome && col.nome !== nome) {
    col.nome = nome;
    await col.save();
  }
  cache.set(key, col._id);
  return col._id;
}

function calcNivel(pontuacao) {
  // cada 500 pontos = 1 nível
  return Math.max(1, Math.floor(pontuacao / 500) + 1);
}

// Conquistas agora vivem no model Conquista (CRUD via /api/conquistas) e
// são avaliadas dinamicamente por avaliarConquistas() do conquistasService.

/**
 * Processa um upload completo: cria/atualiza Auditoria, AuditItem em massa,
 * recalcula MetricaDiaria, atualiza pontuação de Loja e Colaboradores.
 *
 * Estratégia idempotente: para a mesma (loja, tipo, dia) reaproveita a Auditoria
 * existente substituindo seus AuditItem (re-upload do mesmo dia atualiza valores).
 */
export async function processarPlanilha({
  buffer,
  filename,
  lojaId,
  usuarioId,
  tipoForcado,
  onProgress,
}) {
  reportProgress(onProgress, 5, "Lendo planilha");
  const {
    tipo,
    dataAuditoria,
    linhas,
    situacoes: distribOriginal,
  } = lerPlanilha(buffer, {
    filename,
    tipoForcado,
  });
  reportProgress(onProgress, 14, "Preparando auditoria");

  const loja = await Loja.findById(lojaId);
  if (!loja) throw new Error("Loja não encontrada");

  // Re-upload: apaga itens antigos do mesmo dia/tipo
  let auditoria = await Auditoria.findOne({
    loja: lojaId,
    tipo,
    data: dataAuditoria,
  });
  const isReUpload = !!auditoria;
  const auditoriaCancelada = auditoria?.status === "CANCELADA";

  // Captura contribuições anteriores para revertê-las dos acumulados ao substituir upload do mesmo dia
  let prevLojaMetrica = null;
  const prevColabMetricasMap = new Map();
  if (isReUpload) {
    prevLojaMetrica = await MetricaDiaria.findOne({
      loja: lojaId,
      tipo,
      data: dataAuditoria,
      colaborador: null,
    });
    const prevColabMetricas = await MetricaDiaria.find({
      loja: lojaId,
      tipo,
      data: dataAuditoria,
      colaborador: { $ne: null },
    });
    for (const m of prevColabMetricas)
      prevColabMetricasMap.set(String(m.colaborador), m);
  }

  if (auditoria) {
    await AuditItem.deleteMany({ auditoria: auditoria._id });
    auditoria.status = auditoriaCancelada ? "CANCELADA" : "PROCESSANDO";
    auditoria.arquivoOriginal = filename;
    auditoria.enviadoPor = usuarioId;
    await auditoria.save();
  } else {
    auditoria = await Auditoria.create({
      loja: lojaId,
      tipo,
      data: dataAuditoria,
      arquivoOriginal: filename,
      enviadoPor: usuarioId,
      status: "PROCESSANDO",
    });
  }
  reportProgress(onProgress, 24, "Identificando colaboradores");

  // Resolve colaboradores (cache)
  const cache = new Map();
  const colaboradoresUnicos = new Map();
  for (const r of linhas) {
    if (r.colaboradorCodigo && !colaboradoresUnicos.has(r.colaboradorCodigo)) {
      colaboradoresUnicos.set(r.colaboradorCodigo, r.colaboradorNome);
    }
  }
  const colaboradoresEntries = [...colaboradoresUnicos.entries()];
  const passoColaboradores = Math.max(
    1,
    Math.floor(Math.max(1, colaboradoresEntries.length) / 6),
  );
  for (let index = 0; index < colaboradoresEntries.length; index += 1) {
    const [cod, nome] = colaboradoresEntries[index];
    await ensureColaborador(lojaId, cod, nome, cache);
    if (
      (index + 1) % passoColaboradores === 0 ||
      index === colaboradoresEntries.length - 1
    ) {
      reportProgress(
        onProgress,
        24 + ((index + 1) / Math.max(1, colaboradoresEntries.length)) * 12,
        "Identificando colaboradores",
      );
    }
  }
  reportProgress(onProgress, 38, "Classificando itens");

  // Monta documentos AuditItem
  const docs = [];
  let totalLidos = 0; // itens fisicamente lidos (conta:true)
  let totalItensAuditaveis = 0; // itens auditaveis = lidos + Nao lidos com estoque (conforme != null)
  let totalConformes = 0;
  let totalNaoConformes = 0;
  let pontuacao = 0;
  let custoRupturaTotal = 0;
  const distrib = {};
  const porColaborador = new Map();

  const passoLinhas = Math.max(1, Math.floor(Math.max(1, linhas.length) / 10));
  for (let index = 0; index < linhas.length; index += 1) {
    const r = linhas[index];
    const cls = classificar(tipo, r.situacao);
    const colaboradorId = r.colaboradorCodigo
      ? cache.get(`${lojaId}:${r.colaboradorCodigo}`)
      : null;

    if (cls.conforme !== null) totalItensAuditaveis += 1;
    if (cls.conta) {
      totalLidos += 1;
      if (cls.conforme === true) totalConformes += 1;
      else if (cls.conforme === false) totalNaoConformes += 1;
      pontuacao += cls.pontos;
    }
    if (typeof r.custoRuptura === "number" && cls.conforme === false) {
      custoRupturaTotal += r.custoRuptura;
    }
    if (r.situacao) distrib[r.situacao] = (distrib[r.situacao] || 0) + 1;

    if (colaboradorId) {
      const k = String(colaboradorId);
      const c = porColaborador.get(k) || {
        colaborador: colaboradorId,
        nome: r.colaboradorNome,
        codigoExterno: r.colaboradorCodigo,
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

    docs.push({
      auditoria: auditoria._id,
      loja: lojaId,
      tipo,
      data: dataAuditoria,
      codigo: r.codigo,
      produto: r.produto,
      classeRaiz: r.classeRaiz,
      classe: r.classe,
      setor: r.setor,
      local: r.local,
      colaborador: colaboradorId,
      colaboradorCodigo: r.colaboradorCodigo,
      colaboradorNome: r.colaboradorNome,
      situacao: r.situacao,
      situacaoAuditoria: r.situacaoAuditoria,
      auditadoEm: r.auditadoEm,
      presencaConfirmadaEm: r.presencaConfirmadaEm,
      ultimaCompraEm: r.ultimaCompraEm,
      estoqueAtual: r.estoqueAtual,
      estoqueLeitura: r.estoqueLeitura,
      diasSemVenda: r.diasSemVenda,
      custoRuptura: r.custoRuptura,
      residuo: r.residuo,
      fornecedor: r.fornecedor,
      conforme: cls.conforme,
      pontos: cls.conta ? cls.pontos : 0,
      cancelada: auditoriaCancelada,
    });

    if ((index + 1) % passoLinhas === 0 || index === linhas.length - 1) {
      reportProgress(
        onProgress,
        38 + ((index + 1) / Math.max(1, linhas.length)) * 22,
        "Classificando itens",
      );
    }
  }

  // Insere em chunks
  const CHUNK = 1000;
  reportProgress(onProgress, 62, "Gravando itens");
  for (let i = 0; i < docs.length; i += CHUNK) {
    await AuditItem.insertMany(docs.slice(i, i + CHUNK), { ordered: false });
    reportProgress(
      onProgress,
      62 + (Math.min(i + CHUNK, docs.length) / Math.max(1, docs.length)) * 14,
      "Gravando itens",
    );
  }

  // ETIQUETA: % de itens auditaveis que foram lidos (cobertura da auditoria)
  // PRESENCA / RUPTURA: % de itens lidos que estao conformes (qualidade)
  const taxaConformidade =
    tipo === "ETIQUETA"
      ? totalItensAuditaveis > 0
        ? (totalLidos / totalItensAuditaveis) * 100
        : 0
      : totalLidos > 0
        ? (totalConformes / totalLidos) * 100
        : 0;

  auditoria.totalItens = linhas.length;
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
  auditoria.status = auditoriaCancelada ? "CANCELADA" : "CONCLUIDA";
  await auditoria.save();
  reportProgress(onProgress, 78, "Consolidando auditoria");

  if (auditoriaCancelada) {
    await zerarMetricasCanceladas({
      auditoria,
      usuarioId: auditoria.canceladaPor || usuarioId,
      motivo: auditoria.motivoCancelamento || "Auditoria cancelada",
    });
    reportProgress(
      onProgress,
      100,
      "Auditoria cancelada. Métricas mantidas zeradas.",
    );
    return {
      auditoriaId: auditoria._id,
      tipo,
      dataAuditoria,
      totalItens: linhas.length,
      totalLidos,
      totalConformes,
      totalNaoConformes,
      taxaConformidade: auditoria.taxaConformidade,
      pontuacao: auditoria.pontuacao,
      custoRupturaTotal: auditoria.custoRupturaTotal,
      situacoes: distrib,
      distribOriginal,
      regrasUsadas: REGRAS[tipo].label,
      status: auditoria.status,
      cancelada: true,
      metricasIgnoradas: true,
      mensagemCancelamento:
        "Auditoria cancelada. Os dados foram recebidos, mas não contam para métricas, rankings ou acumulados.",
    };
  }

  // Métrica diária consolidada (loja)
  await MetricaDiaria.findOneAndUpdate(
    { loja: lojaId, tipo, data: dataAuditoria, colaborador: null },
    {
      $set: {
        totalItens: linhas.length,
        totalItensAuditaveis,
        totalLidos,
        totalConformes,
        totalNaoConformes,
        taxaConformidade: auditoria.taxaConformidade,
        pontuacao: auditoria.pontuacao,
        custoRuptura: auditoria.custoRupturaTotal,
        situacoes: distrib,
      },
    },
    { upsert: true, new: true },
  );
  reportProgress(onProgress, 84, "Atualizando métricas");

  const itensParticipacaoLojaAtual = totalLidos;
  const itensParticipacaoLojaAnterior = Number(
    prevLojaMetrica?.totalLidos || 0,
  );

  // Métrica diária por colaborador
  const colaboradoresMetricas = [...porColaborador.values()];
  const passoMetricas = Math.max(
    1,
    Math.floor(Math.max(1, colaboradoresMetricas.length) / 4),
  );
  for (let index = 0; index < colaboradoresMetricas.length; index += 1) {
    const c = colaboradoresMetricas[index];
    const taxa = c.itens > 0 ? (c.conformes / c.itens) * 100 : 0;
    await MetricaDiaria.findOneAndUpdate(
      { loja: lojaId, tipo, data: dataAuditoria, colaborador: c.colaborador },
      {
        $set: {
          totalItens: c.itens,
          totalItensAuditaveis: c.itens, // por colaborador contamos so itens lidos (conta:true)
          totalLidos: c.itens,
          totalConformes: c.conformes,
          totalNaoConformes: c.naoConformes,
          taxaConformidade: Number(taxa.toFixed(2)),
          pontuacao: Number(c.pontuacao.toFixed(2)),
        },
      },
      { upsert: true, new: true },
    );
    if (
      (index + 1) % passoMetricas === 0 ||
      index === colaboradoresMetricas.length - 1
    ) {
      reportProgress(
        onProgress,
        84 + ((index + 1) / Math.max(1, colaboradoresMetricas.length)) * 6,
        "Atualizando métricas",
      );
    }
  }

  // Atualiza estatísticas acumuladas dos colaboradores
  reportProgress(onProgress, 90, "Atualizando colaboradores");
  const colaboradoresAcumulados = [...porColaborador.values()];
  const novoColabIds = new Set([...porColaborador.keys()]);
  const passoAcumulados = Math.max(
    1,
    Math.floor(Math.max(1, colaboradoresAcumulados.length) / 5),
  );
  for (let index = 0; index < colaboradoresAcumulados.length; index += 1) {
    const c = colaboradoresAcumulados[index];
    const colab = await Colaborador.findById(c.colaborador);
    if (!colab) continue;
    const metricasPorTipo = normalizarMetricasPorTipo(colab.metricasPorTipo);
    colab.totalItensParticipacaoLoja = Number(
      colab.totalItensParticipacaoLoja || 0,
    );

    if (isReUpload) {
      const prev = prevColabMetricasMap.get(String(c.colaborador));
      if (prev) {
        // Já participou deste dia: reverte contribuição anterior antes de somar a nova
        colab.totalItensLidos = Math.max(
          0,
          colab.totalItensLidos - (prev.totalLidos || 0),
        );
        colab.totalItensConformes = Math.max(
          0,
          colab.totalItensConformes - (prev.totalConformes || 0),
        );
        colab.pontuacao = Math.max(
          0,
          Number((colab.pontuacao - (prev.pontuacao || 0)).toFixed(2)),
        );
        colab.totalItensParticipacaoLoja = Math.max(
          0,
          colab.totalItensParticipacaoLoja - itensParticipacaoLojaAnterior,
        );
        metricasPorTipo[tipo].totalItensLidos = Math.max(
          0,
          metricasPorTipo[tipo].totalItensLidos - (prev.totalLidos || 0),
        );
        metricasPorTipo[tipo].totalItensConformes = Math.max(
          0,
          metricasPorTipo[tipo].totalItensConformes -
            (prev.totalConformes || 0),
        );
        // totalAuditorias não muda: dia já foi contabilizado antes
      } else {
        // Colaborador novo neste re-upload: conta a participação
        colab.totalAuditorias += 1;
        metricasPorTipo[tipo].totalAuditorias += 1;
      }
    } else {
      colab.totalAuditorias += 1;
      metricasPorTipo[tipo].totalAuditorias += 1;
    }

    colab.totalItensLidos += c.itens;
    colab.totalItensConformes += c.conformes;
    colab.pontuacao = Number((colab.pontuacao + c.pontuacao).toFixed(2));
    colab.totalItensParticipacaoLoja += itensParticipacaoLojaAtual;
    metricasPorTipo[tipo].totalItensLidos += c.itens;
    metricasPorTipo[tipo].totalItensConformes += c.conformes;
    colab.metricasPorTipo = metricasPorTipo;
    colab.nivel = calcNivel(colab.pontuacao);
    await avaliarConquistas(colab);
    colab.nivel = calcNivel(colab.pontuacao);
    await colab.save();
    if (
      (index + 1) % passoAcumulados === 0 ||
      index === colaboradoresAcumulados.length - 1
    ) {
      reportProgress(
        onProgress,
        90 + ((index + 1) / Math.max(1, colaboradoresAcumulados.length)) * 8,
        "Atualizando colaboradores",
      );
    }
  }

  // Em re-upload: reverte colaboradores que existiam antes mas não estão na nova planilha
  if (isReUpload) {
    for (const [colabIdStr, prev] of prevColabMetricasMap) {
      if (!novoColabIds.has(colabIdStr)) {
        const colab = await Colaborador.findById(colabIdStr);
        if (colab) {
          const metricasPorTipo = normalizarMetricasPorTipo(
            colab.metricasPorTipo,
          );
          colab.totalItensParticipacaoLoja = Number(
            colab.totalItensParticipacaoLoja || 0,
          );
          colab.totalItensLidos = Math.max(
            0,
            colab.totalItensLidos - (prev.totalLidos || 0),
          );
          colab.totalItensConformes = Math.max(
            0,
            colab.totalItensConformes - (prev.totalConformes || 0),
          );
          colab.pontuacao = Math.max(
            0,
            Number((colab.pontuacao - (prev.pontuacao || 0)).toFixed(2)),
          );
          colab.totalAuditorias = Math.max(0, colab.totalAuditorias - 1);
          colab.totalItensParticipacaoLoja = Math.max(
            0,
            colab.totalItensParticipacaoLoja - itensParticipacaoLojaAnterior,
          );
          metricasPorTipo[tipo].totalItensLidos = Math.max(
            0,
            metricasPorTipo[tipo].totalItensLidos - (prev.totalLidos || 0),
          );
          metricasPorTipo[tipo].totalItensConformes = Math.max(
            0,
            metricasPorTipo[tipo].totalItensConformes -
              (prev.totalConformes || 0),
          );
          metricasPorTipo[tipo].totalAuditorias = Math.max(
            0,
            metricasPorTipo[tipo].totalAuditorias - 1,
          );
          colab.metricasPorTipo = metricasPorTipo;
          colab.nivel = calcNivel(colab.pontuacao);
          await avaliarConquistas(colab);
          colab.nivel = calcNivel(colab.pontuacao);
          await colab.save();
        }
        // Remove MetricaDiaria do colaborador que não aparece mais nesta auditoria
        await MetricaDiaria.deleteOne({
          loja: lojaId,
          tipo,
          data: dataAuditoria,
          colaborador: prev.colaborador,
        });
      }
    }
  }

  // Atualiza pontuação da loja
  reportProgress(onProgress, 99, "Atualizando loja");
  if (isReUpload && prevLojaMetrica) {
    // Desconta a contribuição do upload anterior do mesmo dia antes de somar o novo
    loja.pontuacao = Math.max(
      0,
      Number((loja.pontuacao - (prevLojaMetrica.pontuacao || 0)).toFixed(2)),
    );
  }
  loja.pontuacao = Number((loja.pontuacao + pontuacao).toFixed(2));
  loja.nivel = calcNivel(loja.pontuacao);
  await loja.save();
  reportProgress(onProgress, 100, "Concluído");

  return {
    auditoriaId: auditoria._id,
    tipo,
    dataAuditoria,
    totalItens: linhas.length,
    totalLidos,
    totalConformes,
    totalNaoConformes,
    taxaConformidade: auditoria.taxaConformidade,
    pontuacao: auditoria.pontuacao,
    custoRupturaTotal: auditoria.custoRupturaTotal,
    situacoes: distrib,
    distribOriginal,
    regrasUsadas: REGRAS[tipo].label,
  };
}
