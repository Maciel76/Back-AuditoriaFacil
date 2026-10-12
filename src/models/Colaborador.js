import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { TIERS } from "./Conquista.js";

const HistoricoDesbloqueioSchema = new mongoose.Schema(
  {
    nivel: {
      type: String,
      enum: TIERS,
      required: true,
    },
    desbloqueadoEm: { type: Date, required: true },
    meta: { type: Number, default: 0 },
    xpBonus: { type: Number, default: 0 },
    titulo: { type: String, default: "" },
  },
  { _id: false },
);

const MetricaTipoSchema = new mongoose.Schema(
  {
    totalAuditorias: { type: Number, default: 0 },
    totalItensLidos: { type: Number, default: 0 },
    totalItensConformes: { type: Number, default: 0 },
  },
  { _id: false },
);

/**
 * Colaborador é a entidade que aparece nas planilhas (campo "Usuário" formato "ID (NOME)")
 * — pode ou não ter conta de login. Identificado de forma única por (loja, codigoExterno).
 * Para o portal self-service, o colaborador faz login pela matrícula (codigoExterno) + senha.
 */
const ColaboradorSchema = new mongoose.Schema(
  {
    loja: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Loja",
      required: true,
      index: true,
    },
    codigoExterno: { type: String, required: true, trim: true, index: true }, // ex.: "2692473"
    nome: { type: String, required: true, trim: true },
    cargo: { type: String, trim: true },
    setor: { type: String, trim: true },
    avatarUrl: String,
    // Ausente mantém a exibição automática; [] oculta todas as miniaturas.
    conquistasExibidas: { type: [String], default: undefined },
    tiersConquistasExibidas: {
      type: Map,
      of: { type: String, enum: TIERS },
      default: undefined,
    },
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario" },
    ativo: { type: Boolean, default: true },

    // Self-service portal
    senhaHash: { type: String, select: false }, // senha definida pelo próprio colaborador
    primeiroAcesso: { type: Boolean, default: true }, // true = nunca definiu senha ainda

    // Estatísticas agregadas (atualizadas a cada upload)
    pontuacao: { type: Number, default: 0 },
    // Sem defaults persistidos: salvar uma auditoria em uma conta antiga não
    // pode sobrescrever uma compra concorrente com uma carteira vazia.
    moedasGastas: { type: Number, default: undefined, min: 0 },
    itensLoja: {
      type: [new mongoose.Schema({
        codigo: { type: String, required: true },
        preco: { type: Number, required: true, min: 0 },
        compradoEm: { type: Date, required: true },
      }, { _id: false })],
      default: undefined,
    },
    tituloPerfilCodigo: { type: String, default: undefined },
    fundoPerfilCodigo: { type: String, default: undefined },
    mascotePerfilCodigo: { type: String, default: undefined },
    // Separação explícita para que bônus de conquistas possam ser recalculados
    // sem alterar os pontos originados pelas auditorias.
    pontuacaoAuditorias: { type: Number },
    xpConquistas: { type: Number, default: 0 },
    nivel: { type: Number, default: 1 },
    totalAuditorias: { type: Number, default: 0 },
    totalItensLidos: { type: Number, default: 0 },
    totalItensConformes: { type: Number, default: 0 },
    totalItensParticipacaoLoja: { type: Number, default: 0 },
    totalLiderPodium: { type: Number, default: 0 },
    metricasPorTipo: {
      ETIQUETA: { type: MetricaTipoSchema, default: () => ({}) },
      PRESENCA: { type: MetricaTipoSchema, default: () => ({}) },
      RUPTURA: { type: MetricaTipoSchema, default: () => ({}) },
    },

    /**
     * Conquistas do colaborador no sistema de gamificação.
     * Cada item referencia uma definição em Conquista (codigo) e mantém
     * o tier mais alto desbloqueado, todos os tiers desbloqueados, o valor
     * atual da métrica (progresso), histórico por tier e timestamps de evolução.
     */
    conquistas: [
      {
        codigo: { type: String, required: true },
        tierAtual: {
          type: String,
          enum: [...TIERS, null],
          default: null,
        },
        tiersDesbloqueados: { type: [String], default: [] },
        historicoDesbloqueios: {
          type: [HistoricoDesbloqueioSchema],
          default: [],
        },
        progresso: { type: Number, default: 0 },
        desbloqueadaEm: Date,
        ultimaAtualizacao: Date,
      },
    ],
  },
  { timestamps: true },
);

ColaboradorSchema.index({ loja: 1, codigoExterno: 1 }, { unique: true });
ColaboradorSchema.index({ loja: 1, nome: "text" });

ColaboradorSchema.methods.checarSenha = function (senha) {
  return bcrypt.compare(senha, this.senhaHash || "");
};

ColaboradorSchema.statics.hashSenha = function (senha) {
  return bcrypt.hash(senha, 10);
};

export const Colaborador = mongoose.model("Colaborador", ColaboradorSchema);
