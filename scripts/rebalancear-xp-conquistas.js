/**
 * Rebalanceia o XP das conquistas e recalcula o nivel de todos os colaboradores.
 *
 * POR QUE ISSO EXISTE
 * -------------------
 * Duas conquistas usam como metrica o proprio XP do colaborador: "Coletor de XP"
 * (metricaBase = pontuacao) e "Auditor Veterano" (metricaBase = nivel). Quando
 * esses tiers passam a PAGAR XP, vira realimentacao: o bonus aumenta a
 * pontuacao, a pontuacao destrava o proximo tier, que paga mais bonus, e assim
 * por diante ate o ponto fixo. Com bonus de +100.000 por tier isso levou
 * colaboradores a nivel 4000.
 *
 * O que este script faz:
 *   1) Salva um backup das conquistas atuais (para poder voltar atras).
 *   2) Reescreve meta e xpBonus de cada tier com uma curva equilibrada,
 *      PRESERVANDO titulo e imagem que voce ja cadastrou no painel.
 *   3) Zera o XP das conquistas de pontuacao/nivel (viram so prestigio).
 *   4) Recalcula todos os colaboradores a partir da MetricaDiaria, que e a
 *      fonte real do XP de auditoria. O XP final e substituido, nunca somado.
 *
 * USO (dentro da pasta do backend, no servidor):
 *   node --env-file=.env scripts/rebalancear-xp-conquistas.js
 *       -> so simula e mostra o antes/depois. Nao grava nada.
 *
 *   node --env-file=.env scripts/rebalancear-xp-conquistas.js --aplicar
 *       -> grava as conquistas e recalcula todo mundo.
 *
 *   node --env-file=.env scripts/rebalancear-xp-conquistas.js --aplicar --escalar-extras
 *       -> tambem corrige conquistas criadas por voce que nao estao no plano.
 *
 *   node --env-file=.env scripts/rebalancear-xp-conquistas.js --restaurar backups/conquistas-<data>.json
 *       -> volta tudo como estava e recalcula de novo.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";

import { connectDB } from "../src/config/db.js";
import { Conquista, TIERS } from "../src/models/Conquista.js";
import { Colaborador } from "../src/models/Colaborador.js";
import { MetricaDiaria } from "../src/models/MetricaDiaria.js";
import { recalcularConquistasColaboradores } from "../src/services/conquistasService.js";
import { normalizarMetricasPorTipo } from "../src/services/colaboradorMetricas.js";

const APLICAR = process.argv.includes("--aplicar");
const ESCALAR_EXTRAS = process.argv.includes("--escalar-extras");
const indiceRestaurar = process.argv.indexOf("--restaurar");
const ARQUIVO_RESTAURAR =
  indiceRestaurar >= 0 ? process.argv[indiceRestaurar + 1] : "";

const XP_POR_NIVEL = 500; // mesma regra do backend: nivel = floor(xp / 500) + 1

/**
 * Curva base de XP por tier (peso 1). Cada tier vale um pouco menos que o
 * dobro do anterior: premia evoluir sem transformar o topo em um salto que
 * apaga todo o XP ganho lendo item.
 */
const CURVA_BASE = {
  comum: 25,
  raro: 60,
  epico: 130,
  lendario: 260,
  diamante: 450,
  mitico: 750,
  suprema: 1200,
  transcendente: 2000,
};

/**
 * Peso de cada conquista sobre a curva base.
 *   1.0  pilares (contam tudo que a pessoa fez)
 *   0.8  qualidade e destaque
 *   0.5  por tipo de auditoria — sao os MESMOS itens ja pagos pelos pilares,
 *        entao valem menos para nao pagar duas vezes pelo mesmo trabalho
 *   0    metricas derivadas do proprio XP (viram so prestigio)
 */
const ORDEM_TIERS = [
  "comum",
  "raro",
  "epico",
  "lendario",
  "diamante",
  "mitico",
  "suprema",
  "transcendente",
];

const faltandoNoPlano = TIERS.filter((tier) => !ORDEM_TIERS.includes(tier));
if (faltandoNoPlano.length) {
  throw new Error(
    `O modelo tem tiers que este script nao conhece: ${faltandoNoPlano.join(", ")}. ` +
      "Atualize ORDEM_TIERS e as metas do PLANO antes de rodar.",
  );
}

const PLANO = [
  {
    codigo: "ITENS_LIDOS",
    peso: 1,
    metas: [100, 500, 2000, 5000, 12000, 30000, 75000, 150000],
  },
  {
    codigo: "ITENS_CONFORMES",
    peso: 1,
    metas: [100, 500, 1800, 4500, 10000, 25000, 60000, 120000],
  },
  {
    codigo: "AUDITORIAS",
    peso: 1,
    metas: [1, 10, 30, 75, 150, 300, 600, 1000],
  },
  {
    // Taxa em %: os degraus ficam apertados de proposito no topo — de 97 para
    // 99 e muito mais dificil do que de 75 para 85.
    codigo: "CONFORMIDADE",
    peso: 0.8,
    metas: [75, 85, 90, 93, 95, 97, 99, 99.9],
  },
  {
    // Prestigio: paga 0 XP porque a metrica E o XP. Qualquer valor aqui
    // realimenta o calculo e estoura o nivel.
    codigo: "PONTUACAO",
    peso: 0,
    metas: [500, 2000, 5000, 10000, 20000, 40000, 80000, 150000],
  },
  {
    // Mesmo motivo do Coletor de XP: nivel e derivado da pontuacao.
    codigo: "NIVEL",
    peso: 0,
    metas: [2, 5, 10, 20, 40, 80, 160, 300],
  },
  {
    codigo: "ETIQUETA_ITENS",
    peso: 0.5,
    metas: [50, 300, 1200, 3000, 7500, 18000, 45000, 90000],
  },
  {
    codigo: "ETIQUETA_AUDITORIAS",
    peso: 0.4,
    metas: [1, 8, 25, 60, 120, 240, 480, 800],
  },
  {
    codigo: "PRESENCA_ITENS",
    peso: 0.5,
    metas: [50, 300, 1200, 3000, 7500, 18000, 45000, 90000],
  },
  {
    codigo: "PRESENCA_AUDITORIAS",
    peso: 0.4,
    metas: [1, 6, 20, 50, 100, 200, 400, 700],
  },
  {
    codigo: "RUPTURA_ITENS",
    peso: 0.5,
    metas: [40, 200, 800, 2000, 5000, 12000, 30000, 60000],
  },
  {
    codigo: "RUPTURA_AUDITORIAS",
    peso: 0.4,
    metas: [1, 5, 16, 40, 80, 160, 320, 600],
  },
  {
    // Soma os itens da loja inteira nos dias em que a pessoa participou, entao
    // as metas sao ordens de grandeza maiores que as individuais.
    codigo: "PARTICIPACAO_LOJA",
    peso: 0.6,
    metas: [10000, 50000, 150000, 400000, 800000, 1500000, 3000000, 6000000],
  },
  {
    codigo: "LIDER_PODIUM",
    peso: 0.8,
    metas: [1, 5, 15, 30, 60, 120, 250, 500],
  },
];

const PLANO_POR_CODIGO = new Map(PLANO.map((item) => [item.codigo, item]));

const nf = new Intl.NumberFormat("pt-BR");
const fmt = (valor) => nf.format(Number(valor || 0));
const arredondarXp = (valor) => Number(Number(valor || 0).toFixed(2));
const calcularNivel = (xp) => Math.max(1, Math.floor(arredondarXp(xp) / XP_POR_NIVEL) + 1);

/** XP de um tier: curva base x peso, arredondado em multiplos de 5. */
function xpDoTier(nivel, peso) {
  const base = CURVA_BASE[nivel] || 0;
  if (!peso) return 0;
  return Math.max(5, Math.round((base * peso) / 5) * 5);
}

/**
 * Monta os tiers novos de uma conquista.
 *
 * Titulo e imagem sao SEMPRE preservados: voce cadastrou arte por tier no
 * painel e o script nao tem o que colocar no lugar. So meta e xpBonus mudam.
 */
function montarTiers(conquista, plano) {
  const atuaisPorNivel = new Map(
    (conquista.tiers || []).map((tier) => [tier.nivel, tier]),
  );

  return ORDEM_TIERS.map((nivel, indice) => {
    const atual = atuaisPorNivel.get(nivel);
    return {
      nivel,
      meta: plano.metas[indice],
      xpBonus: xpDoTier(nivel, plano.peso),
      titulo: atual?.titulo || "",
      imagemUrl: atual?.imagemUrl || "",
    };
  });
}

/** Conquista fora do plano: mantem as metas, so reescreve o XP pela curva. */
function reescalarTiersExtras(conquista) {
  return (conquista.tiers || [])
    .map((tier) => ({
      nivel: tier.nivel,
      meta: Number(tier.meta || 0),
      xpBonus: xpDoTier(tier.nivel, 0.5),
      titulo: tier.titulo || "",
      imagemUrl: tier.imagemUrl || "",
    }))
    .sort((a, b) => a.meta - b.meta);
}

const somarXp = (tiers) =>
  (tiers || []).reduce((total, tier) => total + Number(tier.xpBonus || 0), 0);

/* ───────────────────────── Projeção (sem gravar nada) ───────────────────── */

function valorDaMetrica(colab, metricaBase, tipoAuditoria, pontuacaoProjetada) {
  const porTipo = tipoAuditoria
    ? normalizarMetricasPorTipo(colab.metricasPorTipo)[tipoAuditoria]
    : null;

  switch (metricaBase) {
    case "totalItensLidos":
      return porTipo?.totalItensLidos ?? (colab.totalItensLidos || 0);
    case "totalItensConformes":
      return porTipo?.totalItensConformes ?? (colab.totalItensConformes || 0);
    case "totalAuditorias":
      return porTipo?.totalAuditorias ?? (colab.totalAuditorias || 0);
    case "totalItensParticipacaoLoja":
      return colab.totalItensParticipacaoLoja || 0;
    case "totalLiderPodium":
      return colab.totalLiderPodium || 0;
    case "taxaConformidadeAcumulada": {
      const lidos = porTipo?.totalItensLidos ?? (colab.totalItensLidos || 0);
      const conformes =
        porTipo?.totalItensConformes ?? (colab.totalItensConformes || 0);
      return lidos > 0 ? (conformes / lidos) * 100 : 0;
    }
    case "pontuacao":
      return pontuacaoProjetada;
    case "nivel":
      return calcularNivel(pontuacaoProjetada);
    default:
      return 0;
  }
}

/**
 * Repete o mesmo laco do backend: conquista de pontuacao/nivel muda o proprio
 * insumo do calculo, entao o total so fecha quando para de mudar.
 */
function projetarXp(colab, definicoes, pontuacaoBase) {
  let projetada = arredondarXp(pontuacaoBase);

  for (let tentativa = 0; tentativa < 30; tentativa += 1) {
    const bonus = definicoes.reduce((total, def) => {
      const valor = valorDaMetrica(
        colab,
        def.metricaBase,
        def.tipoAuditoria,
        projetada,
      );
      const tiers = [...(def.tiers || [])].sort((a, b) => a.meta - b.meta);
      return (
        total +
        tiers.reduce(
          (soma, tier) =>
            valor >= Number(tier.meta || 0)
              ? soma + Number(tier.xpBonus || 0)
              : soma,
          0,
        )
      );
    }, 0);

    const proxima = arredondarXp(pontuacaoBase + bonus);
    if (proxima === projetada) {
      return { pontuacao: proxima, xpConquistas: arredondarXp(bonus) };
    }
    projetada = proxima;
  }

  // Nao estabilizou: e exatamente o sintoma da realimentacao descontrolada.
  return { pontuacao: projetada, xpConquistas: arredondarXp(projetada - pontuacaoBase), instavel: true };
}

/* ───────────────────────────── Relatórios ──────────────────────────────── */

async function pontuacaoDeAuditoriaPorColaborador() {
  const linhas = await MetricaDiaria.aggregate([
    { $match: { colaborador: { $ne: null }, cancelada: { $ne: true } } },
    {
      $group: {
        _id: "$colaborador",
        pontuacao: { $sum: { $ifNull: ["$pontuacao", 0] } },
      },
    },
  ]);

  return new Map(
    linhas.map((linha) => [String(linha._id), arredondarXp(linha.pontuacao)]),
  );
}

function imprimirTabelaConquistas(conquistas, definicoesNovas) {
  const novasPorCodigo = new Map(
    definicoesNovas.map((def) => [def.codigo, def]),
  );

  console.log("\nCONQUISTAS (XP somando todos os tiers)");
  console.log("".padEnd(78, "-"));
  console.log(
    "CODIGO".padEnd(24) +
      "XP HOJE".padStart(12) +
      "XP NOVO".padStart(12) +
      "  OBSERVACAO",
  );
  console.log("".padEnd(78, "-"));

  let totalAntes = 0;
  let totalDepois = 0;

  for (const conquista of conquistas) {
    const nova = novasPorCodigo.get(conquista.codigo);
    const antes = somarXp(conquista.tiers);
    const depois = somarXp(nova?.tiers);
    totalAntes += antes;
    totalDepois += depois;

    let observacao = "";
    if (!PLANO_POR_CODIGO.has(conquista.codigo)) {
      observacao = ESCALAR_EXTRAS
        ? "fora do plano - XP reescalado"
        : "fora do plano - NAO alterada";
    } else if (PLANO_POR_CODIGO.get(conquista.codigo).peso === 0) {
      observacao = "prestigio - XP zerado de proposito";
    }

    console.log(
      conquista.codigo.padEnd(24) +
        fmt(antes).padStart(12) +
        fmt(depois).padStart(12) +
        (observacao ? `  ${observacao}` : ""),
    );
  }

  console.log("".padEnd(78, "-"));
  console.log(
    "TOTAL".padEnd(24) + fmt(totalAntes).padStart(12) + fmt(totalDepois).padStart(12),
  );
  console.log(
    `\nTeto teorico: quem destravasse TODOS os tiers sairia de ${fmt(totalAntes)} ` +
      `para ${fmt(totalDepois)} XP de bonus (nivel ${fmt(calcularNivel(totalAntes))} ` +
      `-> ${fmt(calcularNivel(totalDepois))} so de conquista).`,
  );

  const faltando = PLANO.filter(
    (item) => !conquistas.some((c) => c.codigo === item.codigo),
  );
  if (faltando.length) {
    console.log(
      `\nAviso: ${faltando.length} conquista(s) do plano nao existem no banco: ` +
        `${faltando.map((i) => i.codigo).join(", ")}.`,
    );
    console.log(
      "       Rode scripts/sync-conquistas-padrao.js antes se quiser cria-las.",
    );
  }
}

function imprimirImpacto(amostras) {
  const ordenados = [...amostras].sort((a, b) => b.antesXp - a.antesXp);
  const maiorNivelAntes = amostras.reduce((maior, a) => Math.max(maior, a.antesNivel), 1);
  const maiorNivelDepois = amostras.reduce((maior, a) => Math.max(maior, a.depoisNivel), 1);
  const mediaAntes =
    amostras.reduce((total, a) => total + a.antesXp, 0) / (amostras.length || 1);
  const mediaDepois =
    amostras.reduce((total, a) => total + a.depoisXp, 0) / (amostras.length || 1);
  const instaveis = amostras.filter((a) => a.instavel).length;

  console.log(`\nCOLABORADORES (${fmt(amostras.length)})`);
  console.log("".padEnd(78, "-"));
  console.log(`XP medio     ${fmt(Math.round(mediaAntes))} -> ${fmt(Math.round(mediaDepois))}`);
  console.log(`Maior nivel  ${fmt(maiorNivelAntes)} -> ${fmt(maiorNivelDepois)}`);
  if (instaveis) {
    console.log(
      `Atencao: ${fmt(instaveis)} colaborador(es) nao estabilizam com o XP ATUAL ` +
        "(realimentacao de pontuacao/nivel).",
    );
  }

  console.log("\nTOP 15 (pelo XP de hoje)");
  console.log("".padEnd(78, "-"));
  console.log(
    "NOME".padEnd(28) +
      "XP HOJE".padStart(12) +
      "XP NOVO".padStart(12) +
      "NIVEL".padStart(14),
  );
  for (const item of ordenados.slice(0, 15)) {
    console.log(
      String(item.nome).slice(0, 27).padEnd(28) +
        fmt(Math.round(item.antesXp)).padStart(12) +
        fmt(Math.round(item.depoisXp)).padStart(12) +
        `${fmt(item.antesNivel)} -> ${fmt(item.depoisNivel)}`.padStart(14),
    );
  }
}

/* ─────────────────────────────── Execução ──────────────────────────────── */

function salvarBackup(conquistas) {
  const pasta = path.resolve(process.cwd(), "backups");
  fs.mkdirSync(pasta, { recursive: true });

  const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
  const arquivo = path.join(pasta, `conquistas-${carimbo}.json`);
  fs.writeFileSync(
    arquivo,
    JSON.stringify(
      conquistas.map((c) => ({ codigo: c.codigo, tiers: c.tiers })),
      null,
      2,
    ),
  );
  return arquivo;
}

async function restaurar(arquivo) {
  const caminho = path.resolve(process.cwd(), arquivo);
  if (!fs.existsSync(caminho)) {
    throw new Error(`backup nao encontrado: ${caminho}`);
  }

  const dados = JSON.parse(fs.readFileSync(caminho, "utf8"));
  console.log(`\nRestaurando ${fmt(dados.length)} conquista(s) de ${caminho}`);

  for (const item of dados) {
    await Conquista.updateOne(
      { codigo: item.codigo },
      { $set: { tiers: item.tiers } },
    );
  }

  console.log("Recalculando colaboradores...");
  const resumo = await recalcularConquistasColaboradores();
  console.log(
    `Pronto: ${fmt(resumo.colaboradores)} colaborador(es), ` +
      `${fmt(resumo.alterados)} com XP alterado.`,
  );
}

async function main() {
  await connectDB();

  if (ARQUIVO_RESTAURAR) {
    await restaurar(ARQUIVO_RESTAURAR);
    return;
  }

  const conquistas = await Conquista.find({}).sort({ ordem: 1 }).lean();
  if (!conquistas.length) {
    console.log("Nenhuma conquista cadastrada. Nada a fazer.");
    return;
  }

  // Definições novas, em memória, para poder projetar antes de gravar.
  const definicoesNovas = conquistas.map((conquista) => {
    const plano = PLANO_POR_CODIGO.get(conquista.codigo);
    if (plano) {
      return { ...conquista, tiers: montarTiers(conquista, plano) };
    }
    return {
      ...conquista,
      tiers: ESCALAR_EXTRAS ? reescalarTiersExtras(conquista) : conquista.tiers,
    };
  });

  console.log("\n=== REBALANCEAMENTO DE XP DAS CONQUISTAS ===");
  console.log(
    APLICAR ? "MODO GRAVACAO — as alteracoes serao persistidas" : "MODO SIMULACAO — nada sera gravado",
  );

  imprimirTabelaConquistas(conquistas, definicoesNovas);

  const ativasAgora = conquistas.filter((c) => c.ativa !== false);
  const ativasNovas = definicoesNovas.filter((c) => c.ativa !== false);
  const pontosAuditoria = await pontuacaoDeAuditoriaPorColaborador();

  const amostras = [];
  const cursor = Colaborador.find({}).lean().cursor();
  for await (const colab of cursor) {
    const base = pontosAuditoria.get(String(colab._id)) || 0;
    const antes = projetarXp(colab, ativasAgora, base);
    const depois = projetarXp(colab, ativasNovas, base);

    amostras.push({
      nome: colab.nome,
      antesXp: Number(colab.pontuacao || antes.pontuacao),
      antesNivel: calcularNivel(colab.pontuacao || antes.pontuacao),
      depoisXp: depois.pontuacao,
      depoisNivel: calcularNivel(depois.pontuacao),
      instavel: !!antes.instavel,
    });
  }

  if (amostras.length) imprimirImpacto(amostras);

  if (!APLICAR) {
    console.log(
      "\nSimulacao encerrada. Rode de novo com --aplicar para gravar.\n",
    );
    return;
  }

  const backup = salvarBackup(conquistas);
  console.log(`\nBackup salvo em ${backup}`);

  let gravadas = 0;
  for (const definicao of definicoesNovas) {
    const original = conquistas.find((c) => c.codigo === definicao.codigo);
    if (JSON.stringify(original.tiers) === JSON.stringify(definicao.tiers)) {
      continue;
    }
    await Conquista.updateOne(
      { codigo: definicao.codigo },
      { $set: { tiers: definicao.tiers } },
    );
    gravadas += 1;
  }
  console.log(`${fmt(gravadas)} conquista(s) atualizada(s).`);

  console.log("Recalculando XP e nivel de todos os colaboradores...");
  const resumo = await recalcularConquistasColaboradores();
  console.log(
    `Concluido: ${fmt(resumo.colaboradores)} colaborador(es), ` +
      `${fmt(resumo.alterados)} com XP alterado. ` +
      `XP total ${fmt(Math.round(resumo.xpAntes))} -> ${fmt(Math.round(resumo.xpDepois))}.`,
  );
  console.log(
    "\nReinicie a API para limpar o cache de conquistas: pm2 restart flashrub-backend\n",
  );
}

main()
  .catch((erro) => {
    console.error("\n[rebalancear-xp] falhou:", erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
