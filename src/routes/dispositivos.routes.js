import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Dispositivo, TOTAL_BASES, normalizarStatus } from "../models/Dispositivo.js";
import { Loja } from "../models/Loja.js";
import { ROLES } from "../models/Usuario.js";
import { autenticar, escopoLoja, exigirEscopoLoja, exigirRole } from "../middlewares/auth.js";
import { asyncHandler, httpError } from "../utils/http.js";

const router = Router();
router.use(autenticar, escopoLoja, exigirEscopoLoja);
router.use(asyncHandler(async (req, _res, next) => {
  if (!mongoose.isObjectIdOrHexString(req.escopoLojaId)) throw httpError(400, "Loja inválida");
  if (!await Loja.exists({ _id: req.escopoLojaId })) throw httpError(404, "Loja não encontrada");
  next();
}));

// Every base starts free. Reading the board never creates records.
router.get("/", asyncHandler(async (req, res) => {
  const registros = await Dispositivo.find({ loja: req.escopoLojaId }).lean();
  const porBase = new Map(registros.map((item) => [item.base, { ...item, status: normalizarStatus(item.status) }]));
  res.json({ items: Array.from({ length: TOTAL_BASES }, (_, index) =>
    porBase.get(index + 1) || {
      base: index + 1, codigo: "", modelo: "", status: "LIVRE",
      responsavel: "", retiradoEm: null, observacao: "", statusAnteriorAviso: null, revision: 0,
    }), totalBases: TOTAL_BASES });
}));

const schema = z.object({ revision: z.number().int().min(0) }).strict();
const avisoSchema = schema.extend({
  ativo: z.boolean(),
  observacao: z.string().trim().max(1000).default(""),
});

async function carregarBase(req, validation) {
  const base = Number(req.params.base);
  if (!Number.isInteger(base) || base < 1 || base > TOTAL_BASES) throw httpError(400, "Base inválida");
  const dados = validation.safeParse(req.body);
  if (!dados.success) throw httpError(400, dados.error.issues[0]?.message || "Dados inválidos");
  const { revision } = dados.data;
  const filtro = { loja: req.escopoLojaId, base };
  const anterior = await Dispositivo.findOne(filtro).lean();
  if ((anterior?.revision || 0) !== revision) throw httpError(409, "Esta base foi alterada. Atualize o painel e tente novamente.");
  return { filtro, anterior, ...dados.data };
}

async function gravarBase(req, { filtro, anterior, revision }, campos) {
  try {
    const item = await Dispositivo.findOneAndUpdate({ ...filtro, revision }, {
      $set: { ...campos, atualizadoPor: req.usuario._id },
      $setOnInsert: { codigo: "", modelo: "", responsavel: "" },
      $inc: { revision: 1 },
    }, { new: true, upsert: !anterior, runValidators: true, setDefaultsOnInsert: false });
    if (!item) throw httpError(409, "Esta base foi alterada. Atualize o painel e tente novamente.");
    return item;
  } catch (error) {
    if (error.code === 11000) throw httpError(409, "Esta base foi alterada. Atualize o painel e tente novamente.");
    throw error;
  }
}

router.patch("/:base/status", exigirRole(ROLES.SUPER_ADMIN, ROLES.STORE_ADMIN), asyncHandler(async (req, res) => {
  const estado = await carregarBase(req, schema);
  const { anterior } = estado;
  const atual = normalizarStatus(anterior?.status);
  if (atual === "AVISO") throw httpError(409, "Remova o aviso pelo botão + antes de mudar o status.");
  const status = atual === "EM_USO" ? "LIVRE" : "EM_USO";
  res.json(await gravarBase(req, estado, {
    status, retiradoEm: status === "EM_USO" ? new Date() : null,
    observacao: "", statusAnteriorAviso: null,
  }));
}));

router.patch("/:base/aviso", exigirRole(ROLES.SUPER_ADMIN, ROLES.STORE_ADMIN), asyncHandler(async (req, res) => {
  const estado = await carregarBase(req, avisoSchema);
  const { anterior, ativo, observacao } = estado;
  const atual = normalizarStatus(anterior?.status);
  const statusAnterior = atual === "AVISO"
    ? (anterior?.statusAnteriorAviso === "EM_USO" ? "EM_USO" : "LIVRE")
    : atual;
  if (!ativo && atual !== "AVISO") throw httpError(409, "Esta base não tem um aviso ativo. Atualize o painel.");
  res.json(await gravarBase(req, estado, {
    status: ativo ? "AVISO" : statusAnterior,
    observacao: ativo ? observacao : "",
    statusAnteriorAviso: ativo ? statusAnterior : null,
    retiradoEm: statusAnterior === "EM_USO" ? anterior?.retiradoEm || new Date() : null,
  }));
}));

export default router;
