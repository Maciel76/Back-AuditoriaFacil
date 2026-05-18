import { Conquista, TIER_INFO } from "../models/Conquista.js";

let cacheConquistas = null;
let cacheCarregadoEm = 0;
const CACHE_TTL_MS = 30_000;

async function carregarConquistasAtivas() {
  const agora = Date.now();
  if (cacheConquistas && agora - cacheCarregadoEm < CACHE_TTL_MS)
    return cacheConquistas;
  cacheConquistas = await Conquista.find({ ativa: true }).sort({ ordem: 1 }).lean();
  cacheCarregadoEm = agora;
  return cacheConquistas;
}

export function invalidarCacheConquistas() {
  cacheConquistas = null;
  cacheCarregadoEm = 0;
}

function lerMetrica(colab, nome) {
  switch (nome) {
    case "totalItensLidos":
      return colab.totalItensLidos || 0;
    case "totalItensConformes":
      return colab.totalItensConformes || 0;
    case "totalAuditorias":
      return colab.totalAuditorias || 0;
    case "taxaConformidadeAcumulada": {
      const lidos = colab.totalItensLidos || 0;
      const conformes = colab.totalItensConformes || 0;
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

/**
 * Avalia todas as conquistas ativas para um colaborador, atualizando
 * `colab.conquistas` in place. Retorna um array de eventos com as
 * conquistas/tiers recém-desbloqueados (para exibir notificações ou
 * conceder XP bônus). Não chama `colab.save()`.
 */
export async function avaliarConquistas(colab) {
  const definicoes = await carregarConquistasAtivas();
  if (!definicoes.length) return [];

  const eventos = [];
  const mapaAtual = new Map();
  for (const c of colab.conquistas || []) mapaAtual.set(c.codigo, c);

  const novaLista = [];
  let bonusXp = 0;
  for (const def of definicoes) {
    const tiersOrdenados = [...(def.tiers || [])].sort((a, b) => a.meta - b.meta);
    if (!tiersOrdenados.length) continue;

    const valor = lerMetrica(colab, def.metricaBase);
    const { alcancado, desbloqueados } = tierMaisAlto(tiersOrdenados, valor);

    const atual = mapaAtual.get(def.codigo);
    const tiersAntes = new Set(atual?.tiersDesbloqueados || []);
    const novosTiers = desbloqueados.filter((n) => !tiersAntes.has(n));

    for (const nivel of novosTiers) {
      const tierDef = tiersOrdenados.find((t) => t.nivel === nivel);
      if (!tierDef) continue;
      bonusXp += tierDef.xpBonus || 0;
      eventos.push({
        codigo: def.codigo,
        nome: def.nome,
        icone: def.icone,
        tier: nivel,
        tierLabel: TIER_INFO[nivel]?.label || nivel,
        titulo: tierDef.titulo || def.nome,
        meta: tierDef.meta,
        xpBonus: tierDef.xpBonus || 0,
      });
    }

    novaLista.push({
      codigo: def.codigo,
      tierAtual: alcancado?.nivel || null,
      tiersDesbloqueados: desbloqueados,
      progresso: Number(valor.toFixed ? valor.toFixed(2) : valor),
      desbloqueadaEm:
        atual?.desbloqueadaEm ||
        (alcancado ? new Date() : undefined),
      ultimaAtualizacao: new Date(),
    });
  }

  colab.conquistas = novaLista;

  if (bonusXp > 0) {
    colab.pontuacao = Number(((colab.pontuacao || 0) + bonusXp).toFixed(2));
  }

  return eventos;
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
    const tiersOrdenados = [...(def.tiers || [])].sort((a, b) => a.meta - b.meta);
    const estado = mapa.get(def.codigo);
    const valor = estado?.progresso ?? lerMetrica(colab, def.metricaBase);
    const tierAtualNivel = estado?.tierAtual || null;
    const desbloqueados = new Set(estado?.tiersDesbloqueados || []);

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
      recorrente: def.recorrente,
      tiers: tiersOrdenados.map((t) => ({
        nivel: t.nivel,
        label: TIER_INFO[t.nivel]?.label || t.nivel,
        cor: TIER_INFO[t.nivel]?.cor,
        meta: t.meta,
        xpBonus: t.xpBonus || 0,
        titulo: t.titulo,
        desbloqueado: desbloqueados.has(t.nivel),
      })),
      tierAtual: tierAtualNivel,
      tierAtualLabel: tierAtualNivel
        ? TIER_INFO[tierAtualNivel]?.label
        : null,
      tierAtualCor: tierAtualNivel ? TIER_INFO[tierAtualNivel]?.cor : null,
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
      desbloqueadaEm: estado?.desbloqueadaEm || null,
      ultimaAtualizacao: estado?.ultimaAtualizacao || null,
    };
  });
}
