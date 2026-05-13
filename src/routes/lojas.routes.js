import { Router } from 'express';
import { z } from 'zod';
import { Loja } from '../models/Loja.js';
import { Usuario, ROLES } from '../models/Usuario.js';
import { autenticar, exigirRole, escopoLoja, exigirEscopoLoja } from '../middlewares/auth.js';
import { asyncHandler, httpError } from '../utils/http.js';

const router = Router();
router.use(autenticar);

const slugify = (s) =>
  s.toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (req.usuario.role === ROLES.SUPER_ADMIN) {
      const items = await Loja.find().sort({ pontuacao: -1, nome: 1 }).lean();
      return res.json({ items });
    }
    if (!req.usuario.loja) return res.json({ items: [] });
    const loja = await Loja.findById(req.usuario.loja).lean();
    res.json({ items: loja ? [loja] : [] });
  })
);

router.get(
  '/me',
  escopoLoja,
  exigirEscopoLoja,
  asyncHandler(async (req, res) => {
    const loja = await Loja.findById(req.escopoLojaId).lean();
    if (!loja) throw httpError(404, 'Loja não encontrada');
    res.json(loja);
  })
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
  '/',
  exigirRole(ROLES.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    const data = lojaSchema.parse(req.body);
    const slug = slugify(data.slug || data.nome);
    if (await Loja.findOne({ slug })) throw httpError(409, 'Slug já em uso');
    const loja = await Loja.create({ ...data, slug });
    res.status(201).json(loja);
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    if (req.usuario.role !== ROLES.SUPER_ADMIN && String(req.usuario.loja) !== req.params.id)
      throw httpError(403, 'Sem permissão');
    const data = lojaSchema.partial().parse(req.body);
    if (data.slug) data.slug = slugify(data.slug);
    const loja = await Loja.findByIdAndUpdate(req.params.id, { $set: data }, { new: true });
    if (!loja) throw httpError(404, 'Loja não encontrada');
    res.json(loja);
  })
);

router.delete(
  '/:id',
  exigirRole(ROLES.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    const loja = await Loja.findByIdAndUpdate(req.params.id, { $set: { ativa: false } }, { new: true });
    if (!loja) throw httpError(404, 'Loja não encontrada');
    res.json({ ok: true });
  })
);

export default router;
