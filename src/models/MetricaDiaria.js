import mongoose from 'mongoose';

/**
 * Métrica diária consolidada por loja+tipo (e opcionalmente por colaborador).
 * Permite consultas rápidas para dashboards históricos sem varrer AuditItem.
 */
const MetricaDiariaSchema = new mongoose.Schema(
  {
    loja: { type: mongoose.Schema.Types.ObjectId, ref: 'Loja', required: true, index: true },
    colaborador: { type: mongoose.Schema.Types.ObjectId, ref: 'Colaborador', index: true, default: null },
    tipo: { type: String, required: true, index: true },
    data: { type: Date, required: true, index: true }, // 00:00 UTC do dia

    totalItens: { type: Number, default: 0 },
    totalItensAuditaveis: { type: Number, default: 0 }, // conforme !== null: totalLidos + "Nao lidos com estoque" p/ ETIQUETA
    totalLidos: { type: Number, default: 0 },
    totalConformes: { type: Number, default: 0 },
    totalNaoConformes: { type: Number, default: 0 },
    taxaConformidade: { type: Number, default: 0 },
    pontuacao: { type: Number, default: 0 },
    custoRuptura: { type: Number, default: 0 },
    situacoes: { type: Map, of: Number, default: {} },
  },
  { timestamps: true }
);

MetricaDiariaSchema.index({ loja: 1, tipo: 1, data: 1, colaborador: 1 }, { unique: true });

export const MetricaDiaria = mongoose.model('MetricaDiaria', MetricaDiariaSchema);
