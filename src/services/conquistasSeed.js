import { Conquista } from "../models/Conquista.js";

function clonarTier(tier) {
  return {
    nivel: tier.nivel,
    meta: Number(tier.meta || 0),
    xpBonus: Number(tier.xpBonus || 0),
    titulo: tier.titulo || "",
  };
}

function interpolarNumero(valorA, valorB, fallback = 0) {
  const a = Number(valorA);
  const b = Number(valorB);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return Number(fallback || 0);
  }
  if (a === b) return Math.round(a);
  return Math.round((a + b) / 2);
}

function criarTierDiamante(tiers, fallback = {}) {
  const lendario = (tiers || []).find((tier) => tier.nivel === "lendario");
  const mitico = (tiers || []).find((tier) => tier.nivel === "mitico");

  if (!lendario || !mitico) {
    return clonarTier({ nivel: "diamante", ...fallback });
  }

  return {
    nivel: "diamante",
    meta: interpolarNumero(lendario.meta, mitico.meta, fallback.meta),
    xpBonus: interpolarNumero(
      lendario.xpBonus || 0,
      mitico.xpBonus || 0,
      fallback.xpBonus,
    ),
    titulo: fallback.titulo || "",
  };
}

function comTierDiamante(tiers, fallback = {}) {
  const base = (tiers || []).map(clonarTier);
  if (base.some((tier) => tier.nivel === "diamante")) return base;

  const diamante = criarTierDiamante(base, fallback);
  const indiceMitico = base.findIndex((tier) => tier.nivel === "mitico");

  if (indiceMitico === -1) {
    return [...base, diamante].sort((a, b) => a.meta - b.meta);
  }

  base.splice(indiceMitico, 0, diamante);
  return base;
}

function mesclarTiersPadrao(tiersAtuais, tiersPadrao) {
  const base = (tiersAtuais || []).map(clonarTier);
  const niveisAtuais = new Set(base.map((tier) => tier.nivel));
  let mudou = false;

  for (const tierPadrao of tiersPadrao || []) {
    if (niveisAtuais.has(tierPadrao.nivel)) continue;

    base.push(
      tierPadrao.nivel === "diamante"
        ? criarTierDiamante(base, tierPadrao)
        : clonarTier(tierPadrao),
    );
    niveisAtuais.add(tierPadrao.nivel);
    mudou = true;
  }

  return {
    tiers: base.sort((a, b) => a.meta - b.meta),
    mudou,
  };
}

/**
 * Conquistas padrão do sistema. São criadas no bootstrap se a coleção
 * estiver vazia. Após o primeiro arranque o SUPER_ADMIN gerencia tudo
 * pelo painel /admin/conquistas.
 */
export const CONQUISTAS_PADRAO = [
  {
    codigo: "ITENS_LIDOS",
    nome: "Caçador de Itens",
    descricao:
      "Acumule itens lidos em auditorias. Cada marco evolui o tier da conquista.",
    icone: "🎯",
    categoria: "ITENS",
    metricaBase: "totalItensLidos",
    recorrente: true,
    ordem: 1,
    tiers: [
      { nivel: "comum", meta: 100, xpBonus: 25, titulo: "Centena" },
      { nivel: "raro", meta: 500, xpBonus: 75, titulo: "Meta Batida" },
      { nivel: "epico", meta: 1000, xpBonus: 150, titulo: "Maratona" },
      { nivel: "lendario", meta: 10000, xpBonus: 500, titulo: "Lenda Viva" },
      { nivel: "mitico", meta: 50000, xpBonus: 1500, titulo: "Mestre Auditor" },
    ],
  },
  {
    codigo: "AUDITORIAS",
    nome: "Auditorias Realizadas",
    descricao:
      "Participe de cada vez mais auditorias e suba de tier conforme acumula experiência.",
    icone: "📋",
    categoria: "AUDITORIAS",
    metricaBase: "totalAuditorias",
    recorrente: true,
    ordem: 2,
    tiers: [
      { nivel: "comum", meta: 1, xpBonus: 10, titulo: "Primeira Auditoria" },
      { nivel: "raro", meta: 10, xpBonus: 50, titulo: "Entusiasta" },
      { nivel: "epico", meta: 50, xpBonus: 150, titulo: "Mestre" },
      { nivel: "lendario", meta: 150, xpBonus: 400, titulo: "Veterano" },
      { nivel: "mitico", meta: 500, xpBonus: 1200, titulo: "Imortal" },
    ],
  },
  {
    codigo: "CONFORMIDADE",
    nome: "Mestre da Conformidade",
    descricao:
      "Mantenha alta taxa de conformidade nos itens auditados (precisa ter ao menos 200 itens lidos).",
    icone: "🛡️",
    categoria: "CONFORMIDADE",
    metricaBase: "taxaConformidadeAcumulada",
    recorrente: true,
    ordem: 3,
    tiers: [
      { nivel: "comum", meta: 75, xpBonus: 25, titulo: "Consistência" },
      { nivel: "raro", meta: 85, xpBonus: 75, titulo: "Confiável" },
      { nivel: "epico", meta: 90, xpBonus: 150, titulo: "Precisão" },
      { nivel: "lendario", meta: 95, xpBonus: 300, titulo: "Mestre" },
      { nivel: "mitico", meta: 99, xpBonus: 800, titulo: "Perfeição" },
    ],
  },
  {
    codigo: "PONTUACAO",
    nome: "Coletor de XP",
    descricao: "Acumule pontuação total em auditorias.",
    icone: "⚡",
    categoria: "PONTUACAO",
    metricaBase: "pontuacao",
    recorrente: true,
    ordem: 4,
    tiers: [
      { nivel: "comum", meta: 500, xpBonus: 0, titulo: "Iniciante" },
      { nivel: "raro", meta: 2000, xpBonus: 0, titulo: "Aprendiz" },
      { nivel: "epico", meta: 5000, xpBonus: 0, titulo: "Especialista" },
      { nivel: "lendario", meta: 15000, xpBonus: 0, titulo: "Lendário" },
      { nivel: "mitico", meta: 50000, xpBonus: 0, titulo: "Imortal" },
    ],
  },
  {
    codigo: "NIVEL",
    nome: "Auditor Veterano",
    descricao: "Suba de nível alcançando marcos crescentes.",
    icone: "🎖️",
    categoria: "NIVEL",
    metricaBase: "nivel",
    recorrente: true,
    ordem: 5,
    tiers: [
      { nivel: "comum", meta: 2, xpBonus: 0, titulo: "Bronze" },
      { nivel: "raro", meta: 5, xpBonus: 0, titulo: "Prata" },
      { nivel: "epico", meta: 10, xpBonus: 0, titulo: "Ouro" },
      { nivel: "lendario", meta: 25, xpBonus: 0, titulo: "Diamante" },
      { nivel: "mitico", meta: 50, xpBonus: 0, titulo: "Mestre Eterno" },
    ],
  },
  {
    codigo: "ITENS_CONFORMES",
    nome: "Guardião da Qualidade",
    descricao: "Acumule itens classificados como conformes.",
    icone: "✅",
    categoria: "CONFORMIDADE",
    metricaBase: "totalItensConformes",
    recorrente: true,
    ordem: 6,
    tiers: [
      { nivel: "comum", meta: 100, xpBonus: 25, titulo: "Atento" },
      { nivel: "raro", meta: 500, xpBonus: 75, titulo: "Cuidadoso" },
      { nivel: "epico", meta: 2500, xpBonus: 200, titulo: "Defensor" },
      { nivel: "lendario", meta: 10000, xpBonus: 600, titulo: "Guardião" },
      { nivel: "mitico", meta: 30000, xpBonus: 1500, titulo: "Sentinela" },
    ],
  },
  {
    codigo: "ETIQUETA_ITENS",
    nome: "Radar da Etiqueta",
    descricao:
      "Leia itens nas auditorias de ETIQUETA e evolua seus marcos nesse tipo específico.",
    icone: "🏷️",
    categoria: "ITENS",
    metricaBase: "totalItensLidos",
    tipoAuditoria: "ETIQUETA",
    recorrente: true,
    ordem: 7,
    tiers: [
      { nivel: "comum", meta: 50, xpBonus: 15, titulo: "Primeiras Etiquetas" },
      { nivel: "raro", meta: 250, xpBonus: 45, titulo: "Leitura Fina" },
      { nivel: "epico", meta: 1000, xpBonus: 120, titulo: "Scanner Afiado" },
      {
        nivel: "lendario",
        meta: 5000,
        xpBonus: 320,
        titulo: "Mestre da Gôndola",
      },
      {
        nivel: "mitico",
        meta: 20000,
        xpBonus: 900,
        titulo: "Lenda da Etiqueta",
      },
    ],
  },
  {
    codigo: "ETIQUETA_AUDITORIAS",
    nome: "Ritmo da Etiqueta",
    descricao:
      "Acumule auditorias do tipo ETIQUETA e avance nos tiers desse circuito.",
    icone: "🧾",
    categoria: "AUDITORIAS",
    metricaBase: "totalAuditorias",
    tipoAuditoria: "ETIQUETA",
    recorrente: true,
    ordem: 8,
    tiers: [
      { nivel: "comum", meta: 1, xpBonus: 10, titulo: "Primeira Etiqueta" },
      { nivel: "raro", meta: 8, xpBonus: 35, titulo: "Compasso Firme" },
      { nivel: "epico", meta: 25, xpBonus: 100, titulo: "Batida Constante" },
      {
        nivel: "lendario",
        meta: 80,
        xpBonus: 260,
        titulo: "Veterano de Etiqueta",
      },
      { nivel: "mitico", meta: 200, xpBonus: 700, titulo: "Mito da Etiqueta" },
    ],
  },
  {
    codigo: "PRESENCA_ITENS",
    nome: "Guardião da Presença",
    descricao:
      "Leia itens nas auditorias de PRESENCA e evolua seu domínio nesse fluxo.",
    icone: "👀",
    categoria: "ITENS",
    metricaBase: "totalItensLidos",
    tipoAuditoria: "PRESENCA",
    recorrente: true,
    ordem: 9,
    tiers: [
      { nivel: "comum", meta: 50, xpBonus: 15, titulo: "Olhar Atento" },
      { nivel: "raro", meta: 300, xpBonus: 50, titulo: "Presença Marcada" },
      { nivel: "epico", meta: 1200, xpBonus: 130, titulo: "Cobertura Viva" },
      {
        nivel: "lendario",
        meta: 6000,
        xpBonus: 340,
        titulo: "Sentinela do Salão",
      },
      {
        nivel: "mitico",
        meta: 25000,
        xpBonus: 950,
        titulo: "Lenda da Presença",
      },
    ],
  },
  {
    codigo: "PRESENCA_AUDITORIAS",
    nome: "Cadência da Presença",
    descricao:
      "Acumule auditorias do tipo PRESENCA e consolide experiência nesse tipo específico.",
    icone: "📍",
    categoria: "AUDITORIAS",
    metricaBase: "totalAuditorias",
    tipoAuditoria: "PRESENCA",
    recorrente: true,
    ordem: 10,
    tiers: [
      { nivel: "comum", meta: 1, xpBonus: 10, titulo: "Primeira Presença" },
      { nivel: "raro", meta: 6, xpBonus: 35, titulo: "Pulso Operacional" },
      { nivel: "epico", meta: 20, xpBonus: 95, titulo: "Compromisso Total" },
      {
        nivel: "lendario",
        meta: 60,
        xpBonus: 240,
        titulo: "Veterano da Presença",
      },
      { nivel: "mitico", meta: 160, xpBonus: 650, titulo: "Mito da Presença" },
    ],
  },
  {
    codigo: "RUPTURA_ITENS",
    nome: "Caçador de Rupturas",
    descricao:
      "Leia itens nas auditorias de RUPTURA e suba de tier enfrentando os cenários mais críticos.",
    icone: "🚨",
    categoria: "ITENS",
    metricaBase: "totalItensLidos",
    tipoAuditoria: "RUPTURA",
    recorrente: true,
    ordem: 11,
    tiers: [
      { nivel: "comum", meta: 40, xpBonus: 20, titulo: "Primeiros Alertas" },
      { nivel: "raro", meta: 180, xpBonus: 55, titulo: "Foco Crítico" },
      { nivel: "epico", meta: 800, xpBonus: 140, titulo: "Linha Vermelha" },
      {
        nivel: "lendario",
        meta: 4000,
        xpBonus: 360,
        titulo: "Guardião da Ruptura",
      },
      {
        nivel: "mitico",
        meta: 15000,
        xpBonus: 1000,
        titulo: "Lenda da Ruptura",
      },
    ],
  },
  {
    codigo: "RUPTURA_AUDITORIAS",
    nome: "Pulso da Ruptura",
    descricao:
      "Acumule auditorias do tipo RUPTURA e prove consistência nas leituras mais sensíveis.",
    icone: "⛑️",
    categoria: "AUDITORIAS",
    metricaBase: "totalAuditorias",
    tipoAuditoria: "RUPTURA",
    recorrente: true,
    ordem: 12,
    tiers: [
      { nivel: "comum", meta: 1, xpBonus: 10, titulo: "Primeira Ruptura" },
      { nivel: "raro", meta: 5, xpBonus: 30, titulo: "Resposta Rápida" },
      { nivel: "epico", meta: 16, xpBonus: 90, titulo: "Operação Sensível" },
      {
        nivel: "lendario",
        meta: 45,
        xpBonus: 230,
        titulo: "Veterano da Ruptura",
      },
      { nivel: "mitico", meta: 120, xpBonus: 620, titulo: "Mito da Ruptura" },
    ],
  },
  {
    codigo: "PARTICIPACAO_LOJA",
    nome: "Força-Tarefa da Loja",
    descricao:
      "Evolua conforme participa de auditorias e soma os itens lidos da loja apenas nos dias e tipos em que você realmente esteve presente.",
    icone: "🤝",
    categoria: "ESPECIAL",
    metricaBase: "totalItensParticipacaoLoja",
    recorrente: true,
    ordem: 13,
    tiers: [
      { nivel: "comum", meta: 10000, xpBonus: 20, titulo: "Participação 10k" },
      { nivel: "raro", meta: 50000, xpBonus: 60, titulo: "Participação 50k" },
      {
        nivel: "epico",
        meta: 100000,
        xpBonus: 160,
        titulo: "Participação 100k",
      },
      {
        nivel: "lendario",
        meta: 250000,
        xpBonus: 420,
        titulo: "Participação 250k",
      },
      {
        nivel: "mitico",
        meta: 1000000,
        xpBonus: 1200,
        titulo: "Participação 1M",
      },
    ],
  },
];

for (const conquista of CONQUISTAS_PADRAO) {
  if (conquista.codigo === "NIVEL") {
    const tierLendario = conquista.tiers.find(
      (tier) => tier.nivel === "lendario",
    );
    if (tierLendario?.titulo === "Diamante") {
      tierLendario.titulo = "Platina";
    }
  }

  conquista.tiers = comTierDiamante(conquista.tiers, {
    titulo: conquista.codigo === "NIVEL" ? "Diamante" : "",
  });
}

export async function semearConquistasSeNecessario() {
  const total = await Conquista.countDocuments();
  if (total > 0) return { criadas: 0, ignoradas: total };
  await Conquista.insertMany(CONQUISTAS_PADRAO);
  console.log(
    `[bootstrap] ${CONQUISTAS_PADRAO.length} conquistas padrão criadas`,
  );
  return { criadas: CONQUISTAS_PADRAO.length, ignoradas: 0 };
}

export async function sincronizarConquistasPadrao() {
  const existentes = await Conquista.find({}, { codigo: 1, tiers: 1 }).lean();
  const mapaExistentes = new Map(
    existentes.map((item) => [item.codigo, item]),
  );
  const faltantes = [];
  const atualizacoes = [];

  for (const padrao of CONQUISTAS_PADRAO) {
    const existente = mapaExistentes.get(padrao.codigo);
    if (!existente) {
      faltantes.push(padrao);
      continue;
    }

    const { tiers, mudou } = mesclarTiersPadrao(existente.tiers, padrao.tiers);
    if (!mudou) continue;

    atualizacoes.push({ codigo: padrao.codigo, tiers });
  }

  if (!faltantes.length && !atualizacoes.length) {
    return {
      criadas: 0,
      atualizadas: 0,
      ignoradas: CONQUISTAS_PADRAO.length,
      codigosCriados: [],
      codigosAtualizados: [],
    };
  }

  if (faltantes.length) {
    await Conquista.insertMany(faltantes);
  }

  if (atualizacoes.length) {
    await Promise.all(
      atualizacoes.map((item) =>
        Conquista.updateOne(
          { codigo: item.codigo },
          { $set: { tiers: item.tiers } },
        ),
      ),
    );
  }

  return {
    criadas: faltantes.length,
    atualizadas: atualizacoes.length,
    ignoradas:
      CONQUISTAS_PADRAO.length - faltantes.length - atualizacoes.length,
    codigosCriados: faltantes.map((item) => item.codigo),
    codigosAtualizados: atualizacoes.map((item) => item.codigo),
  };
}
