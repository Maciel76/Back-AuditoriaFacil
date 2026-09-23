import { Conquista, TIER_INFO } from "../models/Conquista.js";
import { Colaborador } from "../models/Colaborador.js";
import { MetricaDiaria } from "../models/MetricaDiaria.js";
import { normalizarMetricasPorTipo } from "./colaboradorMetricas.js";

let cacheConquistas = null;
let cacheCarregadoEm = 0;
const CACHE_TTL_MS = 30_000;

async function carregarConquistasAtivas() {
  const agora = Date.now();
  if (cacheConquistas && agora - cacheCarregadoEm < CACHE_TTL_MS)
    return cacheConquistas;
  cacheConquistas = await Conquista.find({ ativa: true })
    .sort({ ordem: 1 })
    .lean();
  cacheCarregadoEm = agora;
  return cacheConquistas;
}

export function invalidarCacheConquistas() {
  cacheConquistas = null;
  cacheCarregadoEm = 0;
}

function lerMetrica(colab, nome, tipoAuditoria = null) {
  const metricasPorTipo = tipoAuditoria
    ? normalizarMetricasPorTipo(colab.metricasPorTipo)
    : null;
  const metricaTipo = tipoAuditoria ? metricasPorTipo[tipoAuditoria] : null;

  switch (nome) {
    case "totalItensLidos":
      return metricaTipo?.totalItensLidos ?? (colab.totalItensLidos || 0);
    case "totalItensConformes":
      return (
        metricaTipo?.totalItensConformes ?? (colab.totalItensConformes || 0)
      );
    case "totalAuditorias":
      return metricaTipo?.totalAuditorias ?? (colab.totalAuditorias || 0);
    case "totalItensParticipacaoLoja":
      return colab.totalItensParticipacaoLoja || 0;
    case "totalLiderPodium":
      return colab.totalLiderPodium || 0;
    case "taxaConformidadeAcumulada": {
      const lidos =
        metricaTipo?.totalItensLidos ?? (colab.totalItensLidos || 0);
      const conformes =
        metricaTipo?.totalItensConformes ?? (colab.totalItensConformes || 0);
      return lidos > 0 ? (conformes / lidos) * 100 : 0;
    }
    case "pontuacao":
      return colab.pontuacao || 0;
    case "nivel":
      return colab.nivel || 1;
    default:
      return 0;
  }
}

function tierMaisAlto(tiersOrdenados, valor) {
  let alcancado = null;
  const desbloqueados = [];
  for (const t of tiersOrdenados) {
    if (valor >= t.meta) {
      alcancado = t;
      desbloqueados.push(t.nivel);
    } else {
      break;
    }
  }
  return { alcancado, desbloqueados };
}

function ordenarHistoricoPorTier(a, b) {
  return (TIER_INFO[a.nivel]?.ordem || 0) - (TIER_INFO[b.nivel]?.ordem || 0);
}

function arredondarXp(valor) {
  return Number(Number(valor || 0).toFixed(2));
}

function calcularNivel(pontuacao) {
  return Math.max(1, Math.floor(arredondarXp(pontuacao) / 500) + 1);
}

function bonusRegistrado(colab, definicoes) {
  const definicoesPorCodigo = new Map(definicoes.map((d) => [d.codigo, d]));

  return arredondarXp(
    (colab.conquistas || []).reduce((total, estado) => {
      const historico = estado.historicoDesbloqueios || [];
      if (historico.length) {
        return (
          total +
          historico.reduce((soma, item) => soma + Number(item.xpBonus || 0), 0)
        );
      }

      // Compatibilidade com registros criados antes do histórico por tier.
      const definicao = definicoesPorCodigo.get(estado.codigo);
      const desbloqueados = new Set(estado.tiersDesbloqueados || []);
      return (
        total +
        (definicao?.tiers || []).reduce(
          (soma, tier) =>
            soma + (desbloqueados.has(tier.nivel) ? Number(tier.xpBonus || 0) : 0),
          0,
        )
      );
    }, 0),
  );
}

function calcularEstados(colab, definicoes, pontuacaoBase) {
  let pontuacaoProjetada = arredondarXp(pontuacaoBase);
  let estados = [];
  const limiteTentativas =
    definicoes.reduce((total, def) => total + (def.tiers?.length || 0), 0) + 2;

  // Pontuação e nível podem ser métricas de uma conquista. Repetimos até o
  // ponto fixo para que bônus recém-obtidos possam desbloquear outro tier.
  for (let tentativa = 0; tentativa < limiteTentativas; tentativa += 1) {
    const contexto = {
      totalItensLidos: colab.totalItensLidos,
      totalItensConformes: colab.totalItensConformes,
      totalAuditorias: colab.totalAuditorias,
      totalItensParticipacaoLoja: colab.totalItensParticipacaoLoja,
      totalLiderPodium: colab.totalLiderPodium,
      metricasPorTipo: colab.metricasPorTipo,
      pontuacao: pontuacaoProjetada,
      nivel: calcularNivel(pontuacaoProjetada),
    };
    estados = definicoes.map((def) => {
      const tiersOrdenados = [...(def.tiers || [])].sort(
        (a, b) => a.meta - b.meta,
      );
      const valor = lerMetrica(contexto, def.metricaBase, def.tipoAuditoria);
      return {
        def,
        tiersOrdenados,
        valor,
        ...tierMaisAlto(tiersOrdenados, valor),
      };
    });

    const bonus = estados.reduce(
      (total, estado) =>
        total +
        estado.tiersOrdenados.reduce(
          (soma, tier) =>
            soma +
            (estado.desbloqueados.includes(tier.nivel)
              ? Number(tier.xpBonus || 0)
              : 0),
          0,
        ),
      0,
    );
    const proximaPontuacao = arredondarXp(pontuacaoBase + bonus);
    if (proximaPontuacao === pontuacaoProjetada) {
      return { estados, bonusXp: arredondarXp(bonus) };
    }
    pontuacaoProjetada = proximaPontuacao;
  }

  throw new Error(
    "Não foi possível estabilizar conquistas baseadas em pontuação/nível. Revise as metas e bônus.",
  );
}

/**
 * Avalia todas as conquistas ativas para um colaborador, atualizando
 * `colab.conquistas` in place. Retorna um array de eventos com as
 * conquistas/tiers recém-desbloqueados (para exibir notificações ou
 * conceder XP bônus). Não chama `colab.save()`.
 */
export async function avaliarConquistas(colab, opcoes = {}) {
  const definicoes = await carregarConquistasAtivas();
  const bonusAnterior = bonusRegistrado(colab, definicoes);
  const pontuacaoBase = arredondarXp(
    opcoes.pontuacaoBase ?? Math.max(0, Number(colab.pontuacao || 0) - bonusAnterior),
  );

  if (!definicoes.length) {
    colab.conquistas = [];
    colab.pontuacaoAuditorias = pontuacaoBase;
    colab.xpConquistas = 0;
    colab.pontuacao = pontuacaoBase;
    colab.nivel = calcularNivel(pontuacaoBase);
    return [];
  }

  const eventos = [];
  const mapaAtual = new Map();
  for (const c of colab.conquistas || []) mapaAtual.set(c.codigo, c);

  const novaLista = [];
  const { estados, bonusXp } = calcularEstados(colab, definicoes, pontuacaoBase);
  for (const { def, tiersOrdenados, valor, alcancado, desbloqueados } of estados) {
    if (!tiersOrdenados.length) continue;
    const agora = new Date();

    const atual = mapaAtual.get(def.codigo);
    const tiersAntes = new Set(atual?.tiersDesbloqueados || []);
    const novosTiers = desbloqueados.filter((n) => !tiersAntes.has(n));
    const historicoPorNivel = new Map(
      (atual?.historicoDesbloqueios || []).map((item) => [item.nivel, item]),
    );

    for (const nivel of novosTiers) {
      const tierDef = tiersOrdenados.find((t) => t.nivel === nivel);
      if (!tierDef) continue;
      historicoPorNivel.set(nivel, {
        nivel,
        desbloqueadoEm: agora,
        meta: tierDef.meta,
        xpBonus: tierDef.xpBonus || 0,
        titulo: tierDef.titulo || "",
      });
      eventos.push({
        codigo: def.codigo,
        nome: def.nome,
        icone: def.icone,
        tipoAuditoria: def.tipoAuditoria || null,
        tier: nivel,
        tierLabel: TIER_INFO[nivel]?.label || nivel,
        titulo: tierDef.titulo || def.nome,
        meta: tierDef.meta,
        xpBonus: tierDef.xpBonus || 0,
      });
    }

    const historicoDesbloqueios = desbloqueados
      .map((nivel) => {
        const tierDef = tiersOrdenados.find((t) => t.nivel === nivel);
        const historico = historicoPorNivel.get(nivel);
        return {
          nivel,
          desbloqueadoEm:
            historico?.desbloqueadoEm || atual?.desbloqueadaEm || agora,
          // Meta, XP e título devem refletir a definição atual após uma edição.
          meta: tierDef?.meta ?? 0,
          xpBonus: tierDef?.xpBonus ?? 0,
          titulo: tierDef?.titulo || "",
        };
      })
      .sort(ordenarHistoricoPorTier);

    novaLista.push({
      codigo: def.codigo,
      tierAtual: alcancado?.nivel || null,
      tiersDesbloqueados: desbloqueados,
      historicoDesbloqueios,
      progresso: Number(valor.toFixed ? valor.toFixed(2) : valor),
      desbloqueadaEm:
        historicoDesbloqueios[0]?.desbloqueadoEm ||
        atual?.desbloqueadaEm ||
        (alcancado ? agora : undefined),
      ultimaAtualizacao: agora,
    });
  }

  colab.conquistas = novaLista;

  colab.pontuacaoAuditorias = pontuacaoBase;
  colab.xpConquistas = bonusXp;
  colab.pontuacao = arredondarXp(pontuacaoBase + bonusXp);
  colab.nivel = calcularNivel(colab.pontuacao);

  return eventos;
}

/**
 * Reavalia todos os colaboradores usando MetricaDiaria como fonte definitiva
 * dos pontos de auditoria. É seguro executar repetidas vezes: o XP final é
 * substituído, nunca somado sobre o resultado anterior.
 */
export async function recalcularConquistasColaboradores() {
  invalidarCacheConquistas();
  const pontosPorColaborador = await MetricaDiaria.aggregate([
    {
      $match: {
        colaborador: { $ne: null },
        cancelada: { $ne: true },
      },
    },
    {
      $group: {
        _id: "$colaborador",
        pontuacaoAuditorias: { $sum: { $ifNull: ["$pontuacao", 0] } },
      },
    },
  ]);
  const mapaPontos = new Map(
    pontosPorColaborador.map((item) => [
      String(item._id),
      arredondarXp(item.pontuacaoAuditorias),
    ]),
  );

  const resumo = {
    colaboradores: 0,
    alterados: 0,
    xpAntes: 0,
    xpDepois: 0,
  };

  const cursor = Colaborador.find({}).cursor();
  for await (const colaborador of cursor) {
    const antes = arredondarXp(colaborador.pontuacao);
    const pontuacaoBase = mapaPontos.get(String(colaborador._id)) || 0;
    await avaliarConquistas(colaborador, { pontuacaoBase });
    await colaborador.save();

    resumo.colaboradores += 1;
    resumo.xpAntes = arredondarXp(resumo.xpAntes + antes);
    resumo.xpDepois = arredondarXp(
      resumo.xpDepois + Number(colaborador.pontuacao || 0),
    );
    if (antes !== arredondarXp(colaborador.pontuacao)) {
      resumo.alterados += 1;
    }
  }

  return {
    ...resumo,
    diferencaXp: arredondarXp(resumo.xpDepois - resumo.xpAntes),
  };
}

/**
 * Resolve as conquistas de um colaborador para exibição no portal,
 * mesclando definições mestre com o estado individual e calculando
 * progresso para o próximo tier.
 */
export async function resolverConquistasPortal(colab) {
  const definicoes = await carregarConquistasAtivas();
  const mapa = new Map();
  for (const c of colab.conquistas || []) mapa.set(c.codigo, c);

  return definicoes.map((def) => {
    const tiersOrdenados = [...(def.tiers || [])].sort(
      (a, b) => a.meta - b.meta,
    );
    const estado = mapa.get(def.codigo);
    const valor =
      estado?.progresso ??
      lerMetrica(colab, def.metricaBase, def.tipoAuditoria);
    const { alcancado, desbloqueados: desbloqueadosCalculados } = tierMaisAlto(
      tiersOrdenados,
      valor,
    );
    const tierAtualNivel = alcancado?.nivel || null;
    const desbloqueados = new Set(desbloqueadosCalculados);
    const historicoPorNivel = new Map(
      (estado?.historicoDesbloqueios || []).map((item) => [item.nivel, item]),
    );
    const historicoBase = tiersOrdenados
      .filter((tier) => desbloqueados.has(tier.nivel))
      .map((tier) => {
        const historico = historicoPorNivel.get(tier.nivel);
        return {
          nivel: tier.nivel,
          desbloqueadoEm: historico?.desbloqueadoEm || null,
          meta: historico?.meta ?? tier.meta,
          xpBonus: historico?.xpBonus ?? tier.xpBonus ?? 0,
          titulo: historico?.titulo || tier.titulo || "",
        };
      });

    const tierAtualDef = tierAtualNivel
      ? tiersOrdenados.find((t) => t.nivel === tierAtualNivel)
      : null;
    const proximoTierDef =
      tiersOrdenados.find((t) => !desbloqueados.has(t.nivel)) || null;

    const metaAtual = tierAtualDef?.meta || 0;
    const metaProx = proximoTierDef?.meta || metaAtual;
    const progressoPct = proximoTierDef
      ? Math.min(
          100,
          Math.max(
            0,
            metaProx === metaAtual
              ? 100
              : ((valor - metaAtual) / (metaProx - metaAtual)) * 100,
          ),
        )
      : 100;

    return {
      codigo: def.codigo,
      nome: def.nome,
      descricao: def.descricao,
      icone: def.icone,
      categoria: def.categoria,
      metricaBase: def.metricaBase,
      tipoAuditoria: def.tipoAuditoria || null,
      recorrente: def.recorrente,
      tiers: tiersOrdenados.map((t) => ({
        nivel: t.nivel,
        label: TIER_INFO[t.nivel]?.label || t.nivel,
        cor: TIER_INFO[t.nivel]?.cor,
        meta: t.meta,
        xpBonus: t.xpBonus || 0,
        titulo: t.titulo,
        imagemUrl: t.imagemUrl || "",
        desbloqueado: desbloqueados.has(t.nivel),
      })),
      tierAtual: tierAtualNivel,
      tierAtualLabel: tierAtualNivel ? TIER_INFO[tierAtualNivel]?.label : null,
      tierAtualCor: tierAtualNivel ? TIER_INFO[tierAtualNivel]?.cor : null,
      tierAtualImagem: tierAtualDef?.imagemUrl || "",
      proximoTier: proximoTierDef
        ? {
            nivel: proximoTierDef.nivel,
            label: TIER_INFO[proximoTierDef.nivel]?.label,
            cor: TIER_INFO[proximoTierDef.nivel]?.cor,
            meta: proximoTierDef.meta,
            titulo: proximoTierDef.titulo,
          }
        : null,
      progresso: Number(valor.toFixed ? valor.toFixed(2) : valor),
      progressoPct: Number(progressoPct.toFixed(1)),
      desbloqueada: !!tierAtualNivel,
      totalTiersDesbloqueados: desbloqueados.size,
      totalTiers: tiersOrdenados.length,
      historicoDesbloqueios: historicoBase
        .filter((item) => desbloqueados.has(item.nivel))
        .sort((a, b) => {
          const dataA = a.desbloqueadoEm
            ? new Date(a.desbloqueadoEm).getTime()
            : 0;
          const dataB = b.desbloqueadoEm
            ? new Date(b.desbloqueadoEm).getTime()
            : 0;
          if (dataA !== dataB) return dataB - dataA;
          return (
            (TIER_INFO[b.nivel]?.ordem || 0) - (TIER_INFO[a.nivel]?.ordem || 0)
          );
        })
        .map((item) => {
          const tierDef = tiersOrdenados.find((t) => t.nivel === item.nivel);
          return {
            nivel: item.nivel,
            label: TIER_INFO[item.nivel]?.label || item.nivel,
            cor: TIER_INFO[item.nivel]?.cor,
            meta: item.meta ?? tierDef?.meta ?? 0,
            xpBonus: item.xpBonus ?? tierDef?.xpBonus ?? 0,
            titulo: item.titulo || tierDef?.titulo || "",
            desbloqueadoEm:
              item.desbloqueadoEm ||
              estado?.desbloqueadaEm ||
              estado?.ultimaAtualizacao ||
              null,
          };
        }),
      desbloqueadaEm: estado?.desbloqueadaEm || null,
      ultimaAtualizacao: estado?.ultimaAtualizacao || null,
    };
  });
}
