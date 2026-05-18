import { Conquista } from "../models/Conquista.js";

/**
 * Conquistas padrão do sistema. São criadas no bootstrap se a coleção
 * estiver vazia. Após o primeiro arranque o SUPER_ADMIN gerencia tudo
 * pelo painel /admin/conquistas.
 */
const PADRAO = [
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
];

export async function semearConquistasSeNecessario() {
  const total = await Conquista.countDocuments();
  if (total > 0) return { criadas: 0, ignoradas: total };
  await Conquista.insertMany(PADRAO);
  console.log(`[bootstrap] ${PADRAO.length} conquistas padrão criadas`);
  return { criadas: PADRAO.length, ignoradas: 0 };
}
