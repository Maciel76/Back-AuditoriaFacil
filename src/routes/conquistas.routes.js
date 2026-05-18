import { Router } from "express";
import { z } from "zod";
import {
  Conquista,
  TIERS,
  TIER_INFO,
  METRICAS_SUPORTADAS,
  CATEGORIAS,
} from "../models/Conquista.js";
import { Colaborador } from "../models/Colaborador.js";
import { autenticar, exigirRole } from "../middlewares/auth.js";
import { autenticarColaborador } from "../middlewares/authColaborador.js";
import { ROLES } from "../models/Usuario.js";
import { asyncHandler, httpError } from "../utils/http.js";
import { verificarToken } from "../utils/jwt.js";
import {
  invalidarCacheConquistas,
  resolverConquistasPortal,
} from "../services/conquistasService.js";

const router = Router();

function autenticarAdminOuColaborador(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next(httpError(401, "Token ausente"));
  try {
    const payload = verificarToken(token);
    if (payload.tipo === "colaborador")
      return autenticarColaborador(req, res, next);
    return autenticar(req, res, next);
  } catch {
    return next(httpError(401, "Token inválido"));
  }
}

// ============ Metadados públicos do sistema ============
router.get(
  "/meta",
  autenticarAdminOuColaborador,
  asyncHandler(async (_req, res) => {
    res.json({
      tiers: TIERS.map((nivel) => ({ nivel, ...TIER_INFO[nivel] })),
      categorias: CATEGORIAS,
      metricas: METRICAS_SUPORTADAS,
    });
  }),
);

// ============ Portal: minhas conquistas ============
router.get(
  "/portal/me",
  autenticarColaborador,
  asyncHandler(async (req, res) => {
    const colab = await Colaborador.findById(req.colaborador._id).lean();
    if (!colab) throw httpError(404, "Colaborador não encontrado");
    const conquistas = await resolverConquistasPortal(colab);
    res.json({ conquistas });
  }),
);

// ============ Listagem para todos os autenticados ============
router.get(
  "/",
  autenticar,
  asyncHandler(async (req, res) => {
    const filtro = {};
    if (req.query.ativa === "true") filtro.ativa = true;
    if (req.query.ativa === "false") filtro.ativa = false;
    if (req.query.categoria) filtro.categoria = req.query.categoria;
    const items = await Conquista.find(filtro).sort({ ordem: 1, nome: 1 }).lean();
    res.json({ items, tiers: TIERS, tiersInfo: TIER_INFO });
  }),
);

// ============ CRUD restrito a SUPER_ADMIN ============
router.use(autenticar);
router.use(exigirRole(ROLES.SUPER_ADMIN));

const tierSchema = z.object({
  nivel: z.enum(TIERS),
  meta: z.number().nonnegative(),
  xpBonus: z.number().nonnegative().optional().default(0),
  titulo: z.string().optional().default(""),
});

const baseSchema = z.object({
  codigo: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[A-Z0-9_]+$/, "Use apenas A-Z, 0-9 e _"),
  nome: z.string().min(2).max(120),
  descricao: z.string().max(400).optional().default(""),
  icone: z.string().max(8).optional().default("🏆"),
  cor: z.string().max(32).optional().default(""),
  categoria: z.enum(CATEGORIAS),
  metricaBase: z.enum(METRICAS_SUPORTADAS),
  recorrente: z.boolean().optional().default(false),
  tiers: z.array(tierSchema).min(1),
  ativa: z.boolean().optional().default(true),
  ordem: z.number().int().optional().default(100),
});

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = baseSchema.parse(req.body);
    const exists = await Conquista.findOne({ codigo: data.codigo });
    if (exists) throw httpError(409, "Já existe conquista com esse código");
    const c = await Conquista.create({
      ...data,
      criadoPor: req.usuario._id,
      atualizadoPor: req.usuario._id,
    });
    invalidarCacheConquistas();
    res.status(201).json(c);
  }),
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = baseSchema.partial().parse(req.body);
    if (data.codigo) {
      const dup = await Conquista.findOne({
        codigo: data.codigo,
        _id: { $ne: req.params.id },
      });
      if (dup) throw httpError(409, "Já existe conquista com esse código");
    }
    const c = await Conquista.findByIdAndUpdate(
      req.params.id,
      { $set: { ...data, atualizadoPor: req.usuario._id } },
      { new: true },
    );
    if (!c) throw httpError(404, "Conquista não encontrada");
    if (data.tiers) {
      c.tiers = data.tiers;
      await c.save();
    }
    invalidarCacheConquistas();
    res.json(c);
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const c = await Conquista.findByIdAndDelete(req.params.id);
    if (!c) throw httpError(404, "Conquista não encontrada");
    invalidarCacheConquistas();
    res.json({ ok: true });
  }),
);

router.post(
  "/:id/recalcular",
  asyncHandler(async (_req, res) => {
    invalidarCacheConquistas();
    res.json({ ok: true });
  }),
);

export default router;
