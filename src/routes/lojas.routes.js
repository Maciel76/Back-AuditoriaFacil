import { Router } from "express";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { Loja } from "../models/Loja.js";
import { Usuario, ROLES } from "../models/Usuario.js";
import {
  autenticar,
  exigirRole,
  escopoLoja,
  exigirEscopoLoja,
} from "../middlewares/auth.js";
import { uploadAvatar } from "../middlewares/upload.js";
import { asyncHandler, httpError } from "../utils/http.js";
import fs from "node:fs";
import path from "node:path";

const uploadsBase = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "uploads",
);

const router = Router();
router.use(autenticar);

const slugify = (s) =>
  s
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

router.get(
  "/",
  asyncHandler(async (req, res) => {
    if (req.usuario.role === ROLES.SUPER_ADMIN) {
      const items = await Loja.find().sort({ pontuacao: -1, nome: 1 }).lean();
      return res.json({ items });
    }
    if (!req.usuario.loja) return res.json({ items: [] });
    const loja = await Loja.findById(req.usuario.loja).lean();
    res.json({ items: loja ? [loja] : [] });
  }),
);

router.get(
  "/me",
  escopoLoja,
  exigirEscopoLoja,
  asyncHandler(async (req, res) => {
    const loja = await Loja.findById(req.escopoLojaId).lean();
    if (!loja) throw httpError(404, "Loja não encontrada");
    res.json(loja);
  }),
);

router.get(
  "/catalogo",
  asyncHandler(async (_req, res) => {
    const items = await Loja.find({ ativa: true })
      .select(
        "_id nome slug codigo cidade estado avatarUrl ativa nivel pontuacao metas",
      )
      .sort({ nome: 1 })
      .lean();
    res.json({ items });
  }),
);

router.post(
  "/:id/avatar",
  uploadAvatar.single("avatar"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw httpError(400, "Imagem obrigatória");

    if (
      req.usuario.role !== ROLES.SUPER_ADMIN &&
      String(req.usuario.loja || "") !== req.params.id
    ) {
      throw httpError(403, "Sem permissão");
    }

    const loja = await Loja.findById(req.params.id);
    if (!loja) throw httpError(404, "Loja não encontrada");

    if (loja.avatarUrl) {
      const antigo = path.join(
        uploadsBase,
        "avatares",
        path.basename(loja.avatarUrl),
      );
      if (fs.existsSync(antigo)) fs.unlinkSync(antigo);
    }

    loja.avatarUrl = `/uploads/avatares/${req.file.filename}`;
    await loja.save();

    res.json({ avatarUrl: loja.avatarUrl, loja });
  }),
);

// Retorna o STORE_ADMIN de uma loja (apenas SUPER_ADMIN)
router.get(
  "/:id/admin",
  exigirRole(ROLES.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    const admin = await Usuario.findOne({
      loja: req.params.id,
      role: ROLES.STORE_ADMIN,
    })
      .select("-senhaHash -__v")
      .lean();
    res.json(admin || null);
  }),
);

const lojaSchema = z.object({
  nome: z.string().min(2),
  slug: z.string().optional(),
  codigo: z.string().optional(),
  cidade: z.string().optional(),
  estado: z.string().length(2).optional(),
  endereco: z.string().optional(),
  cnpj: z.string().optional(),
  metas: z
    .object({
      conformidadeEtiqueta: z.number().min(0).max(100).optional(),
      conformidadePresenca: z.number().min(0).max(100).optional(),
      conformidadeRuptura: z.number().min(0).max(100).optional(),
    })
    .optional(),
  ativa: z.boolean().optional(),
});

router.post(
  "/",
  exigirRole(ROLES.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    const data = lojaSchema.parse(req.body);
    const slug = slugify(data.slug || data.nome);
    if (await Loja.findOne({ slug })) throw httpError(409, "Slug já em uso");
    const loja = await Loja.create({ ...data, slug });
    res.status(201).json(loja);
  }),
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    if (
      req.usuario.role !== ROLES.SUPER_ADMIN &&
      String(req.usuario.loja) !== req.params.id
    )
      throw httpError(403, "Sem permissão");
    const data = lojaSchema.partial().parse(req.body);
    if (data.slug) data.slug = slugify(data.slug);
    const loja = await Loja.findByIdAndUpdate(
      req.params.id,
      { $set: data },
      { new: true },
    );
    if (!loja) throw httpError(404, "Loja não encontrada");
    res.json(loja);
  }),
);

router.delete(
  "/:id",
  exigirRole(ROLES.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    const loja = await Loja.findByIdAndUpdate(
      req.params.id,
      { $set: { ativa: false } },
      { new: true },
    );
    if (!loja) throw httpError(404, "Loja não encontrada");
    res.json({ ok: true });
  }),
);

export default router;
