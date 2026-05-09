import mongoose from "mongoose";
import { TIPOS_AUDITORIA } from "./Auditoria.js";

/**
 * Definição mestre de uma conquista do sistema de gamificação.
 * Cada conquista pode ter múltiplos tiers (raro, épico, lendário, etc)
 * que são desbloqueados conforme o colaborador atinge marcos crescentes
 * de uma métrica base. Conquistas marcadas como `recorrente: true`
 * representam progressão (ex.: 100/500/1000 itens lidos), enquanto
 * conquistas não-recorrentes representam marcos únicos.
 */

export const TIERS = ["comum", "raro", "epico", "lendario", "mitico"];

export const TIER_INFO = {
  comum: { ordem: 1, label: "Comum", cor: "#94a3b8" },
  raro: { ordem: 2, label: "Raro", cor: "#3b82f6" },
  epico: { ordem: 3, label: "Épico", cor: "#a855f7" },
  lendario: { ordem: 4, label: "Lendário", cor: "#f59e0b" },
  mitico: { ordem: 5, label: "Mítico", cor: "#ef4444" },
};

export const METRICAS_SUPORTADAS = [
  "totalItensLidos",
  "totalItensConformes",
  "totalAuditorias",
  "totalItensParticipacaoLoja",
  "taxaConformidadeAcumulada",
  "pontuacao",
  "nivel",
];

export const CATEGORIAS = [
  "ITENS",
  "AUDITORIAS",
  "CONFORMIDADE",
  "PONTUACAO",
  "NIVEL",
  "ESPECIAL",
];

export const TIPOS_AUDITORIA_CONQUISTA = Object.values(TIPOS_AUDITORIA);

const TierSchema = new mongoose.Schema(
  {
    nivel: { type: String, enum: TIERS, required: true },
    meta: { type: Number, required: true },
    xpBonus: { type: Number, default: 0 },
    titulo: { type: String, default: "" },
  },
  { _id: false },
);

const ConquistaSchema = new mongoose.Schema(
  {
    codigo: { type: String, required: true, unique: true, trim: true },
    nome: { type: String, required: true, trim: true },
    descricao: { type: String, default: "" },
    icone: { type: String, default: "🏆" },
    cor: { type: String, default: "" },
    categoria: { type: String, enum: CATEGORIAS, default: "ESPECIAL" },
    metricaBase: { type: String, enum: METRICAS_SUPORTADAS, required: true },
    tipoAuditoria: {
      type: String,
      enum: TIPOS_AUDITORIA_CONQUISTA,
      default: null,
    },
    operador: { type: String, enum: ["gte"], default: "gte" },
    recorrente: { type: Boolean, default: false },
    tiers: { type: [TierSchema], default: [] },
    ativa: { type: Boolean, default: true },
    ordem: { type: Number, default: 100 },
    criadoPor: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario" },
    atualizadoPor: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario" },
  },
  { timestamps: true },
);

ConquistaSchema.index({ ativa: 1, ordem: 1 });

ConquistaSchema.pre("save", function (next) {
  if (this.tiers?.length) {
    this.tiers.sort((a, b) => a.meta - b.meta);
  }
  next();
});

export const Conquista = mongoose.model("Conquista", ConquistaSchema);
