import mongoose from 'mongoose';

const connectionSchema = new mongoose.Schema({
  loja: { type: mongoose.Schema.Types.ObjectId, ref: 'Loja', required: true, unique: true },
  criadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  chaveHash: { type: String, select: false },
  chaveFinal: String,
  agenteId: String,
  nomeMaquina: String,
  vistoEm: Date,
  versao: String,
  habilitada: { type: Boolean, default: false },
  rotina: { type: mongoose.Schema.Types.Mixed, default: null },
  proximaExecucao: Date,
}, { timestamps: true });
export const Automacao = mongoose.model('Automacao', connectionSchema);

const jobSchema = new mongoose.Schema({
  loja: { type: mongoose.Schema.Types.ObjectId, required: true },
  usuario: { type: mongoose.Schema.Types.ObjectId, required: true },
  status: { type: String, enum: ['aguardando', 'executando', 'importando', 'concluida', 'erro', 'cancelada'], default: 'aguardando' },
  ativa: { type: Boolean, default: true },
  origem: { type: String, enum: ['manual', 'agendamento'] },
  rotina: mongoose.Schema.Types.Mixed,
  dataAlvo: String,
  agenteId: String,
  tokenHash: { type: String, select: false },
  expiraEm: Date,
  iniciadaEm: Date,
  concluidaEm: Date,
  mensagem: String,
  resultado: mongoose.Schema.Types.Mixed,
}, { timestamps: true });
// A fila e o bloqueio sobrevivem a reinicializações e são compartilhados por todas as instâncias.
jobSchema.index({ loja: 1 }, { unique: true, partialFilterExpression: { ativa: true } });
jobSchema.index({ loja: 1, createdAt: -1 });
export const AutomacaoJob = mongoose.model('AutomacaoJob', jobSchema);

// Compartilhado com uploads manuais. Sem expiração automática: uma importação interrompida
// precisa ser revisada antes de liberar outra escrita sobre os mesmos acumulados.
const lockSchema = new mongoose.Schema({
  _id: { type: String },
  criadoEm: { type: Date, default: Date.now },
});
export const ImportacaoLock = mongoose.model('ImportacaoLock', lockSchema);
