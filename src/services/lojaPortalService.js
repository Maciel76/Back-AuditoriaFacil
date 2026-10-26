import { Colaborador } from "../models/Colaborador.js";
import { SystemConfig } from "../models/SystemConfig.js";
import { httpError } from "../utils/http.js";

export const CATALOGO_LOJA_PORTAL = Object.freeze([
  { codigo: "moldura-neon-amarela", categoria: "moldura", nome: "Moldura Neon Amarela", descricao: "Moldura futurista amarela e preta para personalizar seu perfil.", tipo: "Moldura de perfil", preco: 3000, icone: "bolt", cor: "#eab308", imagemUrl: "/images/molduras/neon-amarela.png" },
  { codigo: "moldura-neon-rosa", categoria: "moldura", nome: "Moldura Neon Rosa", descricao: "Moldura futurista rosa e preta para personalizar seu perfil.", tipo: "Moldura de perfil", preco: 3000, icone: "bolt", cor: "#ff006e", imagemUrl: "/images/molduras/neon-rosa.png" },
  { codigo: "moldura-neon-imperial", categoria: "moldura", nome: "Moldura Neon Imperial", descricao: "Moldura roxa e ciano com coroa e estrela para destacar seu perfil.", tipo: "Moldura de perfil", preco: 3000, icone: "crown", cor: "#a855f7", imagemUrl: "/images/molduras/neon-imperial.png" },
  { codigo: "moldura-neon-orbital", categoria: "moldura", nome: "Moldura Neon Orbital", descricao: "Luzes roxas e ciano percorrem as bordas do seu perfil em uma animação contínua.", tipo: "Moldura animada", preco: 4000, icone: "bolt", cor: "#22d3ee" },
  { codigo: "moldura-itens-lidos", categoria: "moldura", conquistaCodigo: "ITENS_LIDOS", nome: "Moldura Caçador de Itens", descricao: "Moldura em SVG inspirada na conquista Caçador de Itens, com detalhes e símbolos exclusivos.", tipo: "Moldura de conquista", preco: 2000, icone: "bullseye", cor: "#fb7185", imagemUrl: "/images/molduras/conquista-itens-lidos.svg" },
  { codigo: "moldura-auditorias", categoria: "moldura", conquistaCodigo: "AUDITORIAS", nome: "Moldura Auditorias Realizadas", descricao: "Moldura em SVG inspirada na conquista Auditorias Realizadas, com detalhes e símbolos exclusivos.", tipo: "Moldura de conquista", preco: 2500, icone: "clipboard-check", cor: "#94a3b8", imagemUrl: "/images/molduras/conquista-auditorias.svg" },
  { codigo: "moldura-conformidade", categoria: "moldura", conquistaCodigo: "CONFORMIDADE", nome: "Moldura Mestre da Conformidade", descricao: "Moldura em SVG inspirada na conquista Mestre da Conformidade, com detalhes e símbolos exclusivos.", tipo: "Moldura de conquista", preco: 3000, icone: "shield-halved", cor: "#fbbf24", imagemUrl: "/images/molduras/conquista-conformidade.svg" },
  { codigo: "moldura-pontuacao", categoria: "moldura", conquistaCodigo: "PONTUACAO", nome: "Moldura Coletor de XP", descricao: "Moldura em SVG inspirada na conquista Coletor de XP, com detalhes e símbolos exclusivos.", tipo: "Moldura de conquista", preco: 3500, icone: "bolt", cor: "#a855f7", imagemUrl: "/images/molduras/conquista-pontuacao.svg" },
  { codigo: "moldura-nivel", categoria: "moldura", conquistaCodigo: "NIVEL", nome: "Moldura Auditor Veterano", descricao: "Moldura em SVG inspirada na conquista Auditor Veterano, com detalhes e símbolos exclusivos.", tipo: "Moldura de conquista", preco: 2000, icone: "medal", cor: "#3b82f6", imagemUrl: "/images/molduras/conquista-nivel.svg" },
  { codigo: "moldura-itens-conformes", categoria: "moldura", conquistaCodigo: "ITENS_CONFORMES", nome: "Moldura Guardião da Qualidade", descricao: "Moldura em SVG inspirada na conquista Guardião da Qualidade, com detalhes e símbolos exclusivos.", tipo: "Moldura de conquista", preco: 2500, icone: "check", cor: "#10b981", imagemUrl: "/images/molduras/conquista-itens-conformes.svg" },
  { codigo: "moldura-etiqueta-itens", categoria: "moldura", conquistaCodigo: "ETIQUETA_ITENS", nome: "Moldura Radar da Etiqueta", descricao: "Moldura em SVG inspirada na conquista Radar da Etiqueta, com detalhes e símbolos exclusivos.", tipo: "Moldura de conquista", preco: 3000, icone: "tag", cor: "#c084fc", imagemUrl: "/images/molduras/conquista-etiqueta-itens.svg" },
  { codigo: "moldura-etiqueta-auditorias", categoria: "moldura", conquistaCodigo: "ETIQUETA_AUDITORIAS", nome: "Moldura Ritmo da Etiqueta", descricao: "Moldura em SVG inspirada na conquista Ritmo da Etiqueta, com detalhes e símbolos exclusivos.", tipo: "Moldura de conquista", preco: 3500, icone: "receipt", cor: "#8b5cf6", imagemUrl: "/images/molduras/conquista-etiqueta-auditorias.svg" },
  { codigo: "moldura-presenca-itens", categoria: "moldura", conquistaCodigo: "PRESENCA_ITENS", nome: "Moldura Guardião da Presença", descricao: "Moldura em SVG inspirada na conquista Guardião da Presença, com detalhes e símbolos exclusivos.", tipo: "Moldura de conquista", preco: 2000, icone: "eye", cor: "#22d3ee", imagemUrl: "/images/molduras/conquista-presenca-itens.svg" },
  { codigo: "moldura-presenca-auditorias", categoria: "moldura", conquistaCodigo: "PRESENCA_AUDITORIAS", nome: "Moldura Cadência da Presença", descricao: "Moldura em SVG inspirada na conquista Cadência da Presença, com detalhes e símbolos exclusivos.", tipo: "Moldura de conquista", preco: 2500, icone: "location-dot", cor: "#14b8a6", imagemUrl: "/images/molduras/conquista-presenca-auditorias.svg" },
  { codigo: "moldura-ruptura-itens", categoria: "moldura", conquistaCodigo: "RUPTURA_ITENS", nome: "Moldura Caçador de Rupturas", descricao: "Moldura em SVG inspirada na conquista Caçador de Rupturas, com detalhes e símbolos exclusivos.", tipo: "Moldura de conquista", preco: 3000, icone: "bell", cor: "#ef4444", imagemUrl: "/images/molduras/conquista-ruptura-itens.svg" },
  { codigo: "moldura-ruptura-auditorias", categoria: "moldura", conquistaCodigo: "RUPTURA_AUDITORIAS", nome: "Moldura Pulso da Ruptura", descricao: "Moldura em SVG inspirada na conquista Pulso da Ruptura, com detalhes e símbolos exclusivos.", tipo: "Moldura de conquista", preco: 3500, icone: "helmet-safety", cor: "#f97316", imagemUrl: "/images/molduras/conquista-ruptura-auditorias.svg" },
  { codigo: "moldura-participacao-loja", categoria: "moldura", conquistaCodigo: "PARTICIPACAO_LOJA", nome: "Moldura Força-Tarefa da Loja", descricao: "Moldura em SVG inspirada na conquista Força-Tarefa da Loja, com detalhes e símbolos exclusivos.", tipo: "Moldura de conquista", preco: 2000, icone: "users", cor: "#06b6d4", imagemUrl: "/images/molduras/conquista-participacao-loja.svg" },
  { codigo: "moldura-lider-podium", categoria: "moldura", conquistaCodigo: "LIDER_PODIUM", nome: "Moldura Líder do Pódio", descricao: "Moldura em SVG inspirada na conquista Líder do Pódio, com detalhes e símbolos exclusivos.", tipo: "Moldura de conquista", preco: 2500, icone: "trophy", cor: "#fbbf24", imagemUrl: "/images/molduras/conquista-lider-podium.svg" },
  { codigo: "moldura-neon-roxo-ciano", categoria: "moldura", imagemUrl: "/images/molduras/neon-roxo-ciano.svg", nome: "Moldura Neon Roxo e Ciano", descricao: "Uma moldura futurista para destacar seu perfil com luzes roxas e ciano.", tipo: "Moldura de perfil", preco: 3000, icone: "star", cor: "#a855f7" },
  { codigo: "mascote-fogo", categoria: "mascote", nome: "Foguinho", descricao: "Uma chama animada para aquecer seu perfil: aparece por 7 segundos e retorna após 10 segundos de pausa.", tipo: "Mascote animado", preco: 3000, icone: "fire", cor: "#f97316" },
  { codigo: "mascote-gato-chorando", categoria: "mascote", nome: "Gatinho Chorão", descricao: "Um gatinho emotivo para acompanhar seu perfil: aparece por 7 segundos e retorna após 10 segundos de pausa.", tipo: "Mascote animado", preco: 3000, icone: "star", cor: "#f59e0b" },
  { codigo: "mascote-foguete", categoria: "mascote", nome: "Foguete Explorador", descricao: "Um foguete animado para acompanhar sua evolução: aparece por 7 segundos e retorna após 10 segundos de pausa.", tipo: "Mascote animado", preco: 3000, icone: "star", cor: "#f97316" },
  { codigo: "fundo-natal", categoria: "fundo", nome: "Capa Sinos de Natal", descricao: "Uma decoração natalina animada para seu perfil e cartões da equipe.", tipo: "Capa animada", preco: 3000, icone: "star", cor: "#dc2626" },
  { codigo: "fundo-copa-2026", categoria: "fundo", nome: "Capa Copa 2026", descricao: "Uma capa animada de futebol para seu perfil e cartões da equipe.", tipo: "Capa animada", preco: 3000, icone: "trophy", cor: "#16a34a" },
  { codigo: "mascote-panda", categoria: "mascote", nome: "Panda Brincalhão", descricao: "Um panda animado para acompanhar suas conquistas. Aparece por 7 segundos e retorna após 10 segundos de pausa.", tipo: "Mascote animado", preco: 3000, icone: "star", cor: "#64748b" },
  { codigo: "mascote-coelho", categoria: "mascote", nome: "Coelhinho Flutuante", descricao: "Um coelhinho com movimentos suaves para seu perfil. Aparece por 7 segundos e retorna após 10 segundos de pausa.", tipo: "Mascote animado", preco: 3000, icone: "star", cor: "#ec4899" },
  { codigo: "mascote-dragao", categoria: "mascote", nome: "Dragãozinho Caminhante", descricao: "Um pequeno dragão passeando pelo seu perfil. Aparece por 7 segundos e retorna após 10 segundos de pausa.", tipo: "Mascote animado", preco: 3000, icone: "star", cor: "#22c55e" },
  { codigo: "mascote-capivara", categoria: "mascote", nome: "Capivara Zen", descricao: "Uma capivara com uma laranja na cabeça para alegrar seu perfil. Aparece por 7 segundos e retorna após 10 segundos de pausa.", tipo: "Mascote animado", preco: 3000, icone: "star", cor: "#d97706" },
  { codigo: "fundo-estrelas", categoria: "fundo", nome: "Chuva de Estrelas", descricao: "Estrelas cintilantes e um meteoro cruzando o seu perfil.", tipo: "Fundo animado", preco: 3500, icone: "star", cor: "#60a5fa" },
  { codigo: "fundo-oceano", categoria: "fundo", nome: "Oceano Vivo", descricao: "Ondas azuis em movimento com bolhas subindo suavemente.", tipo: "Fundo animado", preco: 3000, icone: "star", cor: "#06b6d4" },
  { codigo: "fundo-matrix", categoria: "fundo", nome: "Matrix Neon", descricao: "Uma chuva de rastros verdes para um perfil com energia digital.", tipo: "Fundo animado", preco: 4000, icone: "bolt", cor: "#22c55e" },
  { codigo: "fundo-crepusculo", categoria: "fundo", nome: "Pôr do Sol", descricao: "Um sol flutuante entre tons de rosa, laranja e violeta.", tipo: "Fundo animado", preco: 3500, icone: "sun", cor: "#fb7185" },
  { codigo: "fundo-chamas", categoria: "fundo", nome: "Chamas da Vitória", descricao: "Luzes de fogo dançando e pequenas brasas que sobem pelo cartão.", tipo: "Fundo animado", preco: 4500, icone: "fire", cor: "#f97316" },
  { codigo: "fundo-prisma", categoria: "fundo", nome: "Prisma Infinito", descricao: "Um espectro de cores que gira e transforma o fundo sem parar.", tipo: "Fundo animado", preco: 5000, icone: "star", cor: "#c084fc" },
  { codigo: "mascote-totoro", categoria: "mascote", nome: "Totoro Caminhante", descricao: "Totoro passeia pelo seu perfil: aparece por 7 segundos e retorna após 10 segundos de pausa.", tipo: "Mascote animado", preco: 3000, icone: "star", cor: "#64748b" },
  { codigo: "mascote-cachorro", categoria: "mascote", nome: "Cachorrinho Feliz", descricao: "Um cachorro animado para alegrar seu perfil: aparece por 7 segundos e retorna após 10 segundos de pausa.", tipo: "Mascote animado", preco: 3000, icone: "star", cor: "#f97316" },
  { codigo: "mascote-robo", categoria: "mascote", nome: "Robozinho Faísca", descricao: "Pequeno no tamanho, gigante na energia! Um robô feliz para comemorar cada conquista ao seu lado.", tipo: "Mascote animado", preco: 3500, icone: "bolt", cor: "#22d3ee" },
  { codigo: "mascote-raposa", categoria: "mascote", nome: "Raposa Astuta", descricao: "Olhar atento e charme de sobra: a companheira perfeita de quem não deixa nenhum detalhe escapar.", tipo: "Mascote animado", preco: 4000, icone: "fire", cor: "#f97316" },
  { codigo: "mascote-pinguim", categoria: "mascote", nome: "Pinguim Geladinho", descricao: "Um companheiro tranquilo e cheio de personalidade para manter a cabeça fria e o perfil divertido.", tipo: "Mascote animado", preco: 3500, icone: "star", cor: "#38bdf8" },
  { codigo: "mascote-astronauta", categoria: "mascote", nome: "Astro, o Explorador", descricao: "Seu próximo nível está nas estrelas! Um astronauta flutuante para acompanhar conquistas de outro planeta.", tipo: "Mascote animado", preco: 5000, icone: "moon", cor: "#a78bfa" },
  { codigo: "mascote-saltitante", categoria: "mascote", nome: "Mascote Saltitante", descricao: "Um companheiro animado que pula no seu perfil: aparece por 7 segundos e retorna após 10 segundos de pausa.", tipo: "Mascote animado", preco: 3000, icone: "star", cor: "#ec4899" },
  { codigo: "mascote-gato", categoria: "mascote", nome: "Gatinho Companheiro", descricao: "Um gato animado no seu perfil: aparece por 7 segundos, descansa por 10 e volta para brincar.", tipo: "Mascote animado", preco: 3000, icone: "star", cor: "#f59e0b" },
  { codigo: "titulo-explorador", categoria: "titulo", tier: "comum", nome: "Explorador", descricao: "Para quem está sempre descobrindo novos caminhos.", tipo: "Título de perfil", preco: 1000, icone: "star", cor: "#22d3ee" },
  { codigo: "titulo-guardiao", categoria: "titulo", tier: "raro", nome: "Guardião da Loja", descricao: "Mostre o cuidado que você tem com a sua equipe.", tipo: "Título de perfil", preco: 2500, icone: "shield-halved", cor: "#a855f7" },
  { codigo: "titulo-lenda", categoria: "titulo", tier: "lendario", nome: "Lenda da Equipe", descricao: "Um toque dourado para deixar sua marca no perfil.", tipo: "Título de perfil", preco: 5000, icone: "trophy", cor: "#f59e0b" },
  { codigo: "fundo-aurora", categoria: "fundo", nome: "Aurora Boreal", descricao: "Faixas de luz verde e azul dançam pelo seu cartão de perfil.", tipo: "Fundo animado", preco: 2000, icone: "star", cor: "#10b981" },
  { codigo: "fundo-nebulosa", categoria: "fundo", nome: "Nebulosa", descricao: "Nuvens de luz violeta e rosa se movem como uma nebulosa espacial.", tipo: "Fundo animado", preco: 3500, icone: "moon", cor: "#a855f7" },
  { codigo: "fundo-dourado", categoria: "fundo", nome: "Sol Dourado", descricao: "Um feixe dourado atravessa o cartão entre partículas flutuantes.", tipo: "Fundo animado", preco: 5000, icone: "sun", cor: "#f59e0b" },
  { codigo: "titulo-aprendiz", categoria: "titulo", tier: "comum", nome: "Aprendiz da Loja", descricao: "Um título comum para celebrar suas conquistas na equipe.", tipo: "Título de perfil", preco: 1000, icone: "clipboard-check", cor: "#94a3b8" },
  { codigo: "titulo-sentinela", categoria: "titulo", tier: "raro", nome: "Sentinela dos Corredores", descricao: "Um título raro para celebrar suas conquistas na equipe.", tipo: "Título de perfil", preco: 2500, icone: "shield-halved", cor: "#3b82f6" },
  { codigo: "titulo-especialista", categoria: "titulo", tier: "epico", nome: "Especialista da Auditoria", descricao: "Um título épico para celebrar suas conquistas na equipe.", tipo: "Título de perfil", preco: 4000, icone: "bullseye", cor: "#a855f7" },
  { codigo: "titulo-estrategista", categoria: "titulo", tier: "epico", nome: "Estrategista da Equipe", descricao: "Um título épico para celebrar suas conquistas na equipe.", tipo: "Título de perfil", preco: 4000, icone: "bolt", cor: "#a855f7" },
  { codigo: "titulo-mestre", categoria: "titulo", tier: "lendario", nome: "Mestre dos Corredores", descricao: "Um título lendário para celebrar suas conquistas na equipe.", tipo: "Título de perfil", preco: 5000, icone: "trophy", cor: "#f59e0b" },
  { codigo: "titulo-diamante", categoria: "titulo", tier: "diamante", nome: "Diamante da Loja", descricao: "Um título diamante para celebrar suas conquistas na equipe.", tipo: "Título de perfil", preco: 7000, icone: "gem", cor: "#06b6d4" },
  { codigo: "titulo-excelencia", categoria: "titulo", tier: "diamante", nome: "Símbolo de Excelência", descricao: "Um título diamante para celebrar suas conquistas na equipe.", tipo: "Título de perfil", preco: 7000, icone: "star", cor: "#06b6d4" },
  { codigo: "titulo-fenix", categoria: "titulo", tier: "mitico", nome: "Fênix da Equipe", descricao: "Um título mítico para celebrar suas conquistas na equipe.", tipo: "Título de perfil", preco: 9000, icone: "fire", cor: "#ef4444" },
  { codigo: "titulo-heroi", categoria: "titulo", tier: "mitico", nome: "Herói da Auditoria", descricao: "Um título mítico para celebrar suas conquistas na equipe.", tipo: "Título de perfil", preco: 9000, icone: "shield-halved", cor: "#ef4444" },
  { codigo: "titulo-soberano", categoria: "titulo", tier: "suprema", nome: "Soberano da Loja", descricao: "Um título supremo para celebrar suas conquistas na equipe.", tipo: "Título de perfil", preco: 12000, icone: "crown", cor: "#fbbf24" },
  { codigo: "titulo-campeao", categoria: "titulo", tier: "suprema", nome: "Campeão Supremo", descricao: "Um título supremo para celebrar suas conquistas na equipe.", tipo: "Título de perfil", preco: 12000, icone: "trophy", cor: "#fbbf24" },
  { codigo: "titulo-estrela", categoria: "titulo", tier: "transcendente", nome: "Estrela Infinita", descricao: "Um título transcendente para celebrar suas conquistas na equipe.", tipo: "Título de perfil", preco: 15000, icone: "star", cor: "#ec4899" },
  { codigo: "titulo-eterno", categoria: "titulo", tier: "transcendente", nome: "Guardião Eterno", descricao: "Um título transcendente para celebrar suas conquistas na equipe.", tipo: "Título de perfil", preco: 15000, icone: "gem", cor: "#ec4899" },
]);

export const TIERS_TITULOS = ["comum", "raro", "epico", "lendario", "diamante", "mitico", "suprema", "transcendente"];
export const LABELS_TIERS_TITULOS = ["Comum", "Raro", "Épico", "Lendário", "Diamante", "Mítico", "Supremo", "Transcendente"];

export function maiorTierTitulo(colaborador) {
  return Math.max(-1, ...(colaborador?.conquistas || []).flatMap((conquista) =>
    [conquista.tierAtual, ...(conquista.tiersDesbloqueados || []),
      ...(conquista.historicoDesbloqueios || []).map((registro) => registro.nivel)]
      .map((tier) => TIERS_TITULOS.indexOf(tier)),
  ));
}

export function podeComprarTitulo(colaborador, item) {
  return !item.tier || maiorTierTitulo(colaborador) >= TIERS_TITULOS.indexOf(item.tier);
}

export async function carregarCatalogoLojaPortal(colaborador) {
  const config = await SystemConfig.findOne({ chave: "global" }).lean();
  const precos = config?.precosLojaPortal || {};
  return CATALOGO_LOJA_PORTAL.map((item) => ({
    ...item,
    categoria: item.categoria || "titulo",
    preco: precos[item.codigo] ?? item.preco,
    ...(item.tier ? { tierLabel: LABELS_TIERS_TITULOS[TIERS_TITULOS.indexOf(item.tier)] } : {}),
    ...(colaborador ? { desbloqueado: podeComprarTitulo(colaborador, item) } : {}),
  }));
}

export function tituloLojaPerfil(colaborador) {
  const codigo = colaborador?.tituloPerfilCodigo;
  if (!colaborador?.itensLoja?.some((item) => item.codigo === codigo)) return null;
  return CATALOGO_LOJA_PORTAL.find((item) => item.codigo === codigo && (item.categoria || "titulo") === "titulo") || null;
}

export function mascoteLojaPerfil(colaborador) {
  const codigo = colaborador?.mascotePerfilCodigo;
  if (!colaborador?.itensLoja?.some((item) => item.codigo === codigo)) return null;
  const item = CATALOGO_LOJA_PORTAL.find((item) => item.codigo === codigo && item.categoria === "mascote");
  return item ? { codigo: item.codigo, nome: item.nome } : null;
}

function campoPersonalizacao(categoria) {
  return { fundo: "fundoPerfilCodigo", mascote: "mascotePerfilCodigo", titulo: "tituloPerfilCodigo", moldura: "molduraPerfilCodigo" }[categoria || "titulo"];
}

export function fundoLojaPerfil(colaborador) {
  const codigo = colaborador?.fundoPerfilCodigo;
  if (!colaborador?.itensLoja?.some((item) => item.codigo === codigo)) return null;
  const item = CATALOGO_LOJA_PORTAL.find((item) => item.codigo === codigo && item.categoria === "fundo");
  return item ? { codigo: item.codigo, nome: item.nome, cor: item.cor, icone: item.icone } : null;
}

export function molduraLojaPerfil(colaborador) {
  const codigo = colaborador?.molduraPerfilCodigo;
  if (!colaborador?.itensLoja?.some((item) => item.codigo === codigo)) return null;
  const item = CATALOGO_LOJA_PORTAL.find((item) => item.codigo === codigo && item.categoria === "moldura");
  return item ? { codigo: item.codigo, nome: item.nome, imagemUrl: item.imagemUrl } : null;
}

export async function equiparMolduraPortal(colaboradorId, codigo) {
  return equiparPersonalizacaoPortal(colaboradorId, codigo, "moldura");
}

export function estadoLojaPortal(colaborador) {
  const moedasGastas = Number(colaborador?.moedasGastas || 0);
  const moedasBonus = Number(colaborador?.moedasBonus || 0);
  const saldo = Number(colaborador?.pontuacao || 0) + moedasBonus - moedasGastas;
  const titulo = tituloLojaPerfil(colaborador);
  const fundo = fundoLojaPerfil(colaborador);
  const mascote = mascoteLojaPerfil(colaborador);
  return {
    saldoMoedas: Math.max(0, Math.round((saldo + Number.EPSILON) * 100) / 100),
    moedasGastas,
    moedasBonus,
    itensComprados: (colaborador?.itensLoja || []).map((item) => item.codigo),
    tituloPerfilCodigo: titulo?.codigo || "",
    tituloPerfil: titulo ? { nome: titulo.nome, cor: titulo.cor, icone: titulo.icone } : null,
    fundoPerfilCodigo: fundo?.codigo || "",
    fundoPerfil: fundo,
    mascotePerfilCodigo: mascote?.codigo || "",
    mascotePerfil: mascote,
    molduraPerfilCodigo: molduraLojaPerfil(colaborador)?.codigo || "",
    molduraPerfil: molduraLojaPerfil(colaborador),
  };
}

export async function comprarItemPortal(colaboradorId, codigo) {
  const catalogo = await carregarCatalogoLojaPortal();
  const item = catalogo.find((produto) => produto.codigo === codigo);
  if (!item) throw httpError(404, "Item não encontrado na loja");

  const tiersPermitidos = item.tier ? TIERS_TITULOS.slice(TIERS_TITULOS.indexOf(item.tier)) : null;
  const filtroTier = tiersPermitidos ? { $or: [
    { "conquistas.tierAtual": { $in: tiersPermitidos } },
    { "conquistas.tiersDesbloqueados": { $in: tiersPermitidos } },
    { "conquistas.historicoDesbloqueios.nivel": { $in: tiersPermitidos } },
  ] } : {};

  // Saldo, inventário e título mudam juntos no mesmo documento. O filtro
  // impede débito duplicado ou saldo insuficiente mesmo em compras simultâneas.
  const colaborador = await Colaborador.findOneAndUpdate(
    {
      _id: colaboradorId,
      ativo: true,
      "itensLoja.codigo": { $ne: codigo },
      ...filtroTier,
      $expr: {
        $gte: [
          { $round: [{ $subtract: [
            { $add: [{ $ifNull: ["$pontuacao", 0] }, { $ifNull: ["$moedasBonus", 0] }] },
            { $ifNull: ["$moedasGastas", 0] },
          ] }, 2] },
          item.preco,
        ],
      },
    },
    {
      $inc: { moedasGastas: item.preco },
      $push: { itensLoja: { codigo, preco: item.preco, compradoEm: new Date() } },
      $set: { [campoPersonalizacao(item.categoria)]: codigo },
    },
    { new: true },
  );
  if (!colaborador) {
    const atual = await Colaborador.findById(colaboradorId);
    if (atual?.itensLoja?.some((compra) => compra.codigo === codigo)) {
      throw httpError(409, "Você já possui esse item");
    }
    if (atual && !podeComprarTitulo(atual, item)) {
      const label = LABELS_TIERS_TITULOS[TIERS_TITULOS.indexOf(item.tier)];
      throw httpError(403, `Desbloqueie uma conquista ${label} ou superior para comprar este título`);
    }
    throw httpError(400, "Moedas insuficientes para esta compra");
  }
  return estadoLojaPortal(colaborador);
}

export async function equiparTituloPortal(colaboradorId, codigo) {
  return equiparPersonalizacaoPortal(colaboradorId, codigo, "titulo");
}

export async function equiparFundoPortal(colaboradorId, codigo) {
  return equiparPersonalizacaoPortal(colaboradorId, codigo, "fundo");
}

export async function equiparMascotePortal(colaboradorId, codigo) {
  return equiparPersonalizacaoPortal(colaboradorId, codigo, "mascote");
}

async function equiparPersonalizacaoPortal(colaboradorId, codigo, categoria) {
  if (codigo && !CATALOGO_LOJA_PORTAL.some((item) => item.codigo === codigo && (item.categoria || "titulo") === categoria)) {
    throw httpError(404, "Item não encontrado nesta categoria");
  }
  const colaborador = await Colaborador.findOneAndUpdate(
    { _id: colaboradorId, ativo: true, ...(codigo ? { "itensLoja.codigo": codigo } : {}) },
    { $set: { [campoPersonalizacao(categoria)]: codigo } },
    { new: true },
  );
  if (!colaborador) throw httpError(400, "Você precisa comprar este item antes de usar");
  return estadoLojaPortal(colaborador);
}
