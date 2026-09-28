import mongoose from "mongoose";

/**
 * Grupo de WhatsApp em que o número conectado da loja participa.
 *
 * Só existe para a tela poder mostrar NOME de grupo em vez do jid cru
 * ("120363...@g.us") na hora de escolher o destino do compartilhamento
 * automático. É recarregado a cada sincronização, nunca editado à mão.
 */
const WhatsappGrupoSchema = new mongoose.Schema(
  {
    loja: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Loja",
      required: true,
      index: true,
    },
    jid: { type: String, required: true, trim: true },
    nome: { type: String, default: "", trim: true },
    participantes: { type: Number, default: 0 },
    // Só grupos em que o número conectado pode escrever servem de destino.
    somenteAdmins: { type: Boolean, default: false },
    souAdmin: { type: Boolean, default: false },
    sincronizadoEm: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

WhatsappGrupoSchema.index({ loja: 1, jid: 1 }, { unique: true });

export const WhatsappGrupo = mongoose.model(
  "WhatsappGrupo",
  WhatsappGrupoSchema,
);
