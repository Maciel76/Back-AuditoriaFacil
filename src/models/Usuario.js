import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

export const ROLES = Object.freeze({
  SUPER_ADMIN: 'SUPER_ADMIN',
  STORE_ADMIN: 'STORE_ADMIN',
  COLABORADOR: 'COLABORADOR',
});

const UsuarioSchema = new mongoose.Schema(
  {
    nome: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    senhaHash: { type: String, required: true },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.COLABORADOR, index: true },
    loja: { type: mongoose.Schema.Types.ObjectId, ref: 'Loja', index: true },
    colaborador: { type: mongoose.Schema.Types.ObjectId, ref: 'Colaborador' },
    avatarUrl: String,
    ativo: { type: Boolean, default: true },
    ultimoLogin: Date,
  },
  { timestamps: true }
);

UsuarioSchema.methods.checarSenha = function (senha) {
  return bcrypt.compare(senha, this.senhaHash);
};

UsuarioSchema.statics.hashSenha = function (senha) {
  return bcrypt.hash(senha, 10);
};

UsuarioSchema.methods.toJSON = function () {
  const obj = this.toObject({ virtuals: true });
  delete obj.senhaHash;
  delete obj.__v;
  return obj;
};

export const Usuario = mongoose.model('Usuario', UsuarioSchema);
