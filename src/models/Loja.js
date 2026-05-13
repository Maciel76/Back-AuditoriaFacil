import mongoose from 'mongoose';

const LojaSchema = new mongoose.Schema(
  {
    nome: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    codigo: { type: String, trim: true, index: true }, // código interno opcional
    cidade: { type: String, trim: true },
    estado: { type: String, trim: true, uppercase: true, maxlength: 2 },
    endereco: { type: String, trim: true },
    cnpj: { type: String, trim: true },
    avatarUrl: { type: String, trim: true },
    ativa: { type: Boolean, default: true },
    metas: {
      conformidadeEtiqueta: { type: Number, default: 95 }, // %
      conformidadePresenca: { type: Number, default: 90 },
      conformidadeRuptura: { type: Number, default: 95 },
    },
    pontuacao: { type: Number, default: 0 },
    nivel: { type: Number, default: 1 },
  },
  { timestamps: true }
);

LojaSchema.index({ nome: 'text', slug: 'text', codigo: 'text' });

export const Loja = mongoose.model('Loja', LojaSchema);
