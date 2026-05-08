import mongoose from "mongoose";

const AuditItemSchema = new mongoose.Schema(
  {
    auditoria: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Auditoria",
      required: true,
      index: true,
    },
    loja: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Loja",
      required: true,
      index: true,
    },
    tipo: { type: String, required: true, index: true },
    data: { type: Date, required: true, index: true },

    codigo: { type: String, index: true },
    produto: String,
    classeRaiz: String,
    classe: String,
    setor: String,
    local: String,

    colaborador: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Colaborador",
      index: true,
    },
    colaboradorCodigo: String,
    colaboradorNome: String,

    situacao: { type: String, index: true },
    situacaoAuditoria: String,
    auditadoEm: Date,
    presencaConfirmadaEm: Date,
    ultimaCompraEm: Date,

    estoqueAtual: Number,
    estoqueLeitura: Number,
    diasSemVenda: Number,
    custoRuptura: Number,
    residuo: Boolean,
    fornecedor: String,

    // Resultado da regra
    conforme: { type: Boolean, index: true },
    pontos: { type: Number, default: 0 },
    cancelada: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

AuditItemSchema.index({ loja: 1, tipo: 1, data: -1 });
AuditItemSchema.index({ loja: 1, colaborador: 1, data: -1 });

export const AuditItem = mongoose.model("AuditItem", AuditItemSchema);
