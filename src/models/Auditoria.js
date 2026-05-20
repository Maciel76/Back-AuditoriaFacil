import mongoose from "mongoose";

export const TIPOS_AUDITORIA = Object.freeze({
  ETIQUETA: "ETIQUETA",
  PRESENCA: "PRESENCA",
  RUPTURA: "RUPTURA",
});

/**
 * Auditoria = um upload de planilha. Agrupa N AuditItem.
 */
const AuditoriaSchema = new mongoose.Schema(
  {
    loja: { type: mongoose.Schema.Types.ObjectId, ref: "Loja", required: true },
    tipo: {
      type: String,
      enum: Object.values(TIPOS_AUDITORIA),
      required: true,
    },
    data: { type: Date, required: true }, // dia da auditoria (00:00 UTC do dia detectado)
    arquivoOriginal: String,
    enviadoPor: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario" },

    // Resumo
    totalItens: { type: Number, default: 0 },
    totalLidos: { type: Number, default: 0 },
    totalConformes: { type: Number, default: 0 },
    totalNaoConformes: { type: Number, default: 0 },
    taxaConformidade: { type: Number, default: 0 }, // 0..100
    pontuacao: { type: Number, default: 0 },
    custoRupturaTotal: { type: Number, default: 0 },

    // Distribuição por situação
    situacoes: { type: Map, of: Number, default: {} },
    // Top colaboradores deste upload (snapshot rápido)
    topColaboradores: [
      {
        colaborador: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Colaborador",
        },
        nome: String,
        codigoExterno: String,
        itens: Number,
        conformes: Number,
        pontuacao: Number,
      },
    ],
    status: {
      type: String,
      enum: ["PROCESSANDO", "CONCLUIDA", "ERRO", "CANCELADA"],
      default: "PROCESSANDO",
    },
    erro: String,
    canceladaEm: Date,
    canceladaPor: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario" },
    motivoCancelamento: { type: String, default: "" },
    excluida: { type: Boolean, default: false },
    excluidaEm: Date,
    excluidaPor: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario" },
  },
  { timestamps: true },
);

AuditoriaSchema.index({ loja: 1, tipo: 1, data: 1 }, { unique: true });

export const Auditoria = mongoose.model("Auditoria", AuditoriaSchema);
