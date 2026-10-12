import { Colaborador } from "../models/Colaborador.js";
import { SystemConfig } from "../models/SystemConfig.js";
import { httpError } from "../utils/http.js";

export const CATALOGO_LOJA_PORTAL = Object.freeze([
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
  { codigo: "titulo-explorador", nome: "Explorador", descricao: "Para quem está sempre descobrindo novos caminhos.", tipo: "Título de perfil", preco: 1000, icone: "star", cor: "#22d3ee" },
  { codigo: "titulo-guardiao", nome: "Guardião da Loja", descricao: "Mostre o cuidado que você tem com a sua equipe.", tipo: "Título de perfil", preco: 2500, icone: "shield-halved", cor: "#a855f7" },
  { codigo: "titulo-lenda", nome: "Lenda da Equipe", descricao: "Um toque dourado para deixar sua marca no perfil.", tipo: "Título de perfil", preco: 5000, icone: "trophy", cor: "#f59e0b" },
  { codigo: "fundo-aurora", categoria: "fundo", nome: "Aurora Boreal", descricao: "Faixas de luz verde e azul dançam pelo seu cartão de perfil.", tipo: "Fundo animado", preco: 2000, icone: "star", cor: "#10b981" },
  { codigo: "fundo-nebulosa", categoria: "fundo", nome: "Nebulosa", descricao: "Nuvens de luz violeta e rosa se movem como uma nebulosa espacial.", tipo: "Fundo animado", preco: 3500, icone: "moon", cor: "#a855f7" },
  { codigo: "fundo-dourado", categoria: "fundo", nome: "Sol Dourado", descricao: "Um feixe dourado atravessa o cartão entre partículas flutuantes.", tipo: "Fundo animado", preco: 5000, icone: "sun", cor: "#f59e0b" },
]);

export async function carregarCatalogoLojaPortal() {
  const config = await SystemConfig.findOne({ chave: "global" }).lean();
  const precos = config?.precosLojaPortal || {};
  return CATALOGO_LOJA_PORTAL.map((item) => ({
    ...item,
    categoria: item.categoria || "titulo",
    preco: precos[item.codigo] ?? item.preco,
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
  return { fundo: "fundoPerfilCodigo", mascote: "mascotePerfilCodigo", titulo: "tituloPerfilCodigo" }[categoria || "titulo"];
}

export function fundoLojaPerfil(colaborador) {
  const codigo = colaborador?.fundoPerfilCodigo;
  if (!colaborador?.itensLoja?.some((item) => item.codigo === codigo)) return null;
  const item = CATALOGO_LOJA_PORTAL.find((item) => item.codigo === codigo && item.categoria === "fundo");
  return item ? { codigo: item.codigo, nome: item.nome, cor: item.cor, icone: item.icone } : null;
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
  };
}

export async function comprarItemPortal(colaboradorId, codigo) {
  const catalogo = await carregarCatalogoLojaPortal();
  const item = catalogo.find((produto) => produto.codigo === codigo);
  if (!item) throw httpError(404, "Item não encontrado na loja");

  // Saldo, inventário e título mudam juntos no mesmo documento. O filtro
  // impede débito duplicado ou saldo insuficiente mesmo em compras simultâneas.
  const colaborador = await Colaborador.findOneAndUpdate(
    {
      _id: colaboradorId,
      ativo: true,
      "itensLoja.codigo": { $ne: codigo },
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
