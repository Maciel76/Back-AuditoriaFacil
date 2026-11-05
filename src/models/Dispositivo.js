import mongoose from "mongoose";

export const TOTAL_BASES = 35;
export const STATUS_DISPOSITIVO = ["LIVRE", "EM_USO", "AVISO"];

// Keep existing records readable without a destructive database migration.
export function normalizarStatus(status) {
  if (status === "OCUPADO") return "EM_USO";
  return STATUS_DISPOSITIVO.includes(status) ? status : "LIVRE";
}

const dispositivoSchema = new mongoose.Schema({
  loja: { type: mongoose.Schema.Types.ObjectId, ref: "Loja", required: true },
  base: { type: Number, required: true, min: 1, max: TOTAL_BASES },
  codigo: { type: String, trim: true, default: "", maxlength: 32 },
  modelo: { type: String, trim: true, default: "", maxlength: 80 },
  status: { type: String, enum: [...STATUS_DISPOSITIVO, "VAZIO", "OCUPADO"], default: "LIVRE" },
  observacao: { type: String, trim: true, default: "", maxlength: 1000 },
  statusAnteriorAviso: { type: String, enum: ["LIVRE", "EM_USO", null], default: null },
  responsavel: { type: String, trim: true, default: "", maxlength: 100 },
  retiradoEm: { type: Date, default: null },
  revision: { type: Number, default: 0, min: 0 },
  atualizadoPor: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario" },
}, { timestamps: true });

dispositivoSchema.index({ loja: 1, base: 1 }, { unique: true });
dispositivoSchema.index({ loja: 1, codigo: 1 }, {
  unique: true,
  partialFilterExpression: { codigo: { $gt: "" } },
});

export const Dispositivo = mongoose.model("Dispositivo", dispositivoSchema);
