import mongoose from "mongoose";

/**
 * Configurações globais do sistema (singleton). Sempre lemos/gravamos o
 * documento com chave fixa "global" e expomos getters utilitários para os
 * campos suportados, mantendo defaults consistentes mesmo antes do primeiro
 * salvamento.
 */
const SystemConfigSchema = new mongoose.Schema(
  {
    chave: {
      type: String,
      required: true,
      unique: true,
      default: "global",
      index: true,
    },
    // Limiar (em %) de itens restantes para considerar a meta de auditoria
    // batida. Padrão: 2% — quando o percentual restante para concluir a
    // auditoria fica abaixo desse valor, considera-se meta atingida.
    metaPercentualRestante: { type: Number, default: 2, min: 0, max: 100 },
    precosLojaPortal: { type: Map, of: { type: Number, min: 0, max: 1000000000 }, default: () => ({}) },
  },
  { timestamps: true },
);

export const SystemConfig = mongoose.model("SystemConfig", SystemConfigSchema);

export const CONFIG_DEFAULTS = Object.freeze({
  metaPercentualRestante: 2,
});

export async function carregarSystemConfig() {
  let doc = await SystemConfig.findOne({ chave: "global" });
  if (!doc) {
    doc = await SystemConfig.create({ chave: "global", ...CONFIG_DEFAULTS });
  }
  return doc;
}

export function projetarSystemConfig(doc) {
  if (!doc) return { ...CONFIG_DEFAULTS };
  return {
    metaPercentualRestante:
      typeof doc.metaPercentualRestante === "number"
        ? doc.metaPercentualRestante
        : CONFIG_DEFAULTS.metaPercentualRestante,
  };
}
