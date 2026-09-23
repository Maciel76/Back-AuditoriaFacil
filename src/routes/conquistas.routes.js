import { Router } from "express";
import { z } from "zod";
import {
  Conquista,
  TIERS,
  TIER_INFO,
  METRICAS_SUPORTADAS,
  CATEGORIAS,
  TIPOS_AUDITORIA_CONQUISTA,
} from "../models/Conquista.js";
import { Colaborador } from "../models/Colaborador.js";
import { autenticar, exigirRole } from "../middlewares/auth.js";
import { autenticarColaborador } from "../middlewares/authColaborador.js";
import { uploadConquistaImagem } from "../middlewares/upload.js";
import { ROLES } from "../models/Usuario.js";
import { asyncHandler, httpError } from "../utils/http.js";
import { verificarToken } from "../utils/jwt.js";
import {
  invalidarCacheConquistas,
  recalcularConquistasColaboradores,
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
      tiposAuditoria: TIPOS_AUDITORIA_CONQUISTA,
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
    if (req.query.tipoAuditoria) filtro.tipoAuditoria = req.query.tipoAuditoria;
    const items = await Conquista.find(filtro)
      .sort({ ordem: 1, nome: 1 })
      .lean();
    res.json({ items, tiers: TIERS, tiersInfo: TIER_INFO });
  }),
);

// ============ CRUD restrito a SUPER_ADMIN ============
router.use(autenticar);
router.use(exigirRole(ROLES.SUPER_ADMIN));

// Upload de imagem de tier (multipart/form-data)
router.post(
  "/upload-imagem",
  uploadConquistaImagem.single("imagem"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw httpError(400, "Arquivo de imagem ausente");
    const url = `/uploads/conquistas/${req.file.filename}`;
    res.json({ url, filename: req.file.filename, size: req.file.size });
  }),
);

const tierSchema = z.object({
  nivel: z.enum(TIERS),
  meta: z.number().nonnegative(),
  xpBonus: z.number().nonnegative().optional().default(0),
  titulo: z.string().optional().default(""),
  imagemUrl: z.string().trim().max(500).optional().default(""),
});

const tiersSchema = z
  .array(tierSchema)
  .min(1)
  .superRefine((tiers, ctx) => {
    const usados = new Set();
    tiers.forEach((tier, index) => {
      if (usados.has(tier.nivel)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "nivel"],
          message: `O tier ${tier.nivel} está duplicado`,
        });
      }
      usados.add(tier.nivel);
    });
  });

const baseSchema = z.object({
  codigo: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[A-Z0-9_]+$/, "Use apenas A-Z, 0-9 e _"),
  nome: z.string().min(2).max(120),
  descricao: z.string().max(400).optional().default(""),
  icone: z.string().max(500).optional().default("🏆"),
  cor: z.string().max(32).optional().default(""),
  categoria: z.enum(CATEGORIAS),
  metricaBase: z.enum(METRICAS_SUPORTADAS),
  tipoAuditoria: z.enum(TIPOS_AUDITORIA_CONQUISTA).nullable().optional(),
  recorrente: z.boolean().optional().default(false),
  tiers: tiersSchema,
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
  "/recalcular",
  asyncHandler(async (_req, res) => {
    const resumo = await recalcularConquistasColaboradores();
    res.json({ ok: true, resumo });
  }),
);

router.post(
  "/:id/recalcular",
  asyncHandler(async (_req, res) => {
    const resumo = await recalcularConquistasColaboradores();
    res.json({ ok: true, resumo });
  }),
);

export default router;
