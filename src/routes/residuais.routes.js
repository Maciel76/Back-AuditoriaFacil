import { Router } from "express";
import mongoose from "mongoose";
import { Auditoria } from "../models/Auditoria.js";
import { AuditItem } from "../models/AuditItem.js";
import { Loja } from "../models/Loja.js";
import { autenticar, escopoLoja, exigirEscopoLoja } from "../middlewares/auth.js";
import { montarResiduais, REGRAS_RESIDUAIS } from "../services/residuais.js";
import { asyncHandler, httpError } from "../utils/http.js";

const router = Router();
router.use(autenticar, escopoLoja, exigirEscopoLoja);

router.get("/", asyncHandler(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.escopoLojaId)) throw httpError(400, "Loja inválida");
  const auditoriaId = req.query.auditoriaId;
  if (auditoriaId !== undefined && !mongoose.isObjectIdOrHexString(auditoriaId)) {
    throw httpError(400, "Auditoria inválida");
  }

  const loja = await Loja.findById(req.escopoLojaId).select("nome").lean();
  if (!loja) throw httpError(404, "Loja não encontrada");

  const filtro = { loja: req.escopoLojaId, status: "CONCLUIDA", excluida: { $ne: true } };
  const camposAuditoria = "data tipo arquivoOriginal updatedAt";
  const auditorias = await Auditoria.find(filtro)
    .select(camposAuditoria).sort({ data: -1, updatedAt: -1, _id: -1 }).limit(60).lean();
  // Algumas exportações de Etiqueta não contêm estoque ou dias sem venda.
  // A referência automática precisa ter os dois campos, mesmo sem produtos elegíveis.
  const comDados = auditorias.length ? await AuditItem.aggregate([
    { $match: {
      loja: new mongoose.Types.ObjectId(req.escopoLojaId),
      auditoria: { $in: auditorias.map((item) => item._id) },
      cancelada: { $ne: true },
      estoqueAtual: { $type: "number" },
      diasSemVenda: { $type: "number" },
    } },
    { $group: { _id: "$auditoria" } },
  ]) : [];
  const idsComDados = new Set(comDados.map((item) => String(item._id)));
  for (const item of auditorias) item.temDadosResiduais = idsComDados.has(String(item._id));
  let auditoria = auditorias.find((item) => item.temDadosResiduais) || auditorias[0] || null;
  if (auditoriaId) {
    auditoria = auditorias.find((item) => String(item._id) === auditoriaId) ||
      await Auditoria.findOne({ ...filtro, _id: auditoriaId }).select(camposAuditoria).lean();
    if (!auditoria) throw httpError(404, "Auditoria concluída não encontrada nesta loja");
    if (!auditorias.some((item) => String(item._id) === auditoriaId)) auditorias.push(auditoria);
  }

  const registros = auditoria ? await AuditItem.find({
    loja: req.escopoLojaId,
    auditoria: auditoria._id,
    cancelada: { $ne: true },
  }).select("codigo produto classeRaiz classe local estoqueAtual diasSemVenda")
    .sort({ updatedAt: -1, auditadoEm: -1, _id: -1 }).lean() : [];

  res.json({ loja, auditoria, auditorias, regras: REGRAS_RESIDUAIS, ...montarResiduais(registros) });
}));

export default router;
