import { Colaborador } from "../models/Colaborador.js";
import { httpError } from "../utils/http.js";

export const CATALOGO_LOJA_PORTAL = Object.freeze([
  { codigo: "mascote-gato", categoria: "mascote", nome: "Gatinho Companheiro", descricao: "Um gato animado no seu perfil: aparece por 5 segundos, descansa por 10 e volta para brincar.", tipo: "Mascote animado", preco: 30000, icone: "star", cor: "#f59e0b" },
  { codigo: "titulo-explorador", nome: "Explorador", descricao: "Para quem está sempre descobrindo novos caminhos.", tipo: "Título de perfil", preco: 10000, icone: "star", cor: "#22d3ee" },
  { codigo: "titulo-guardiao", nome: "Guardião da Loja", descricao: "Mostre o cuidado que você tem com a sua equipe.", tipo: "Título de perfil", preco: 25000, icone: "shield-halved", cor: "#a855f7" },
  { codigo: "titulo-lenda", nome: "Lenda da Equipe", descricao: "Um toque dourado para deixar sua marca no perfil.", tipo: "Título de perfil", preco: 50000, icone: "trophy", cor: "#f59e0b" },
  { codigo: "fundo-aurora", categoria: "fundo", nome: "Aurora Boreal", descricao: "Luzes verdes e azuis para iluminar seu cartão de perfil.", tipo: "Fundo de perfil", preco: 20000, icone: "star", cor: "#10b981" },
  { codigo: "fundo-nebulosa", categoria: "fundo", nome: "Nebulosa", descricao: "Tons de violeta e rosa em um fundo inspirado no espaço.", tipo: "Fundo de perfil", preco: 35000, icone: "moon", cor: "#a855f7" },
  { codigo: "fundo-dourado", categoria: "fundo", nome: "Sol Dourado", descricao: "Um brilho dourado para destacar suas conquistas.", tipo: "Fundo de perfil", preco: 50000, icone: "sun", cor: "#f59e0b" },
]);

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
  const saldo = Number(colaborador?.pontuacao || 0) - moedasGastas;
  const titulo = tituloLojaPerfil(colaborador);
  const fundo = fundoLojaPerfil(colaborador);
  const mascote = mascoteLojaPerfil(colaborador);
  return {
    saldoMoedas: Math.max(0, Math.round((saldo + Number.EPSILON) * 100) / 100),
    moedasGastas,
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
  const item = CATALOGO_LOJA_PORTAL.find((produto) => produto.codigo === codigo);
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
            { $ifNull: ["$pontuacao", 0] },
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
