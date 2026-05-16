import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const HistoricoDesbloqueioSchema = new mongoose.Schema(
  {
    nivel: {
      type: String,
      enum: ["comum", "raro", "epico", "lendario", "diamante", "mitico"],
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
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario" },
    ativo: { type: Boolean, default: true },

    // Self-service portal
    senhaHash: { type: String, select: false }, // senha definida pelo próprio colaborador
    primeiroAcesso: { type: Boolean, default: true }, // true = nunca definiu senha ainda

    // Estatísticas agregadas (atualizadas a cada upload)
    pontuacao: { type: Number, default: 0 },
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
          enum: [
            "comum",
            "raro",
            "epico",
            "lendario",
            "diamante",
            "mitico",
            null,
          ],
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
