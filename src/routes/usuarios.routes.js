import { Router } from 'express';
import { z } from 'zod';
import { Usuario, ROLES } from '../models/Usuario.js';
import { autenticar, exigirRole, escopoLoja, exigirEscopoLoja } from '../middlewares/auth.js';
import { asyncHandler, httpError } from '../utils/http.js';

const router = Router();
router.use(autenticar);

router.get(
  '/',
  escopoLoja,
  asyncHandler(async (req, res) => {
    const filtro = {};
    if (req.usuario.role !== ROLES.SUPER_ADMIN) filtro.loja = req.usuario.loja;
    else if (req.escopoLojaId) filtro.loja = req.escopoLojaId;
    const items = await Usuario.find(filtro).populate('loja', 'nome slug').sort({ createdAt: -1 }).lean();
    res.json({ items });
  })
);

const upSchema = z.object({
  nome: z.string().min(2),
  email: z.string().email(),
  senha: z.string().min(6),
  role: z.nativeEnum(ROLES).default(ROLES.COLABORADOR),
  lojaId: z.string().optional(),
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = upSchema.parse(req.body);
    if (req.usuario.role !== ROLES.SUPER_ADMIN) {
      if (data.role === ROLES.SUPER_ADMIN) throw httpError(403, 'Sem permissão para criar super admin');
      data.lojaId = String(req.usuario.loja);
    }
    if (await Usuario.findOne({ email: data.email.toLowerCase() })) throw httpError(409, 'E-mail já em uso');
    const senhaHash = await Usuario.hashSenha(data.senha);
    const u = await Usuario.create({
      nome: data.nome,
      email: data.email,
      senhaHash,
      role: data.role,
      loja: data.role === ROLES.SUPER_ADMIN ? null : data.lojaId,
    });
    res.status(201).json(u);
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const u = await Usuario.findById(req.params.id);
    if (!u) throw httpError(404, 'Usuário não encontrado');
    if (req.usuario.role !== ROLES.SUPER_ADMIN && String(u.loja) !== String(req.usuario.loja))
      throw httpError(403, 'Sem permissão');
    const data = z
      .object({
        nome: z.string().min(2).optional(),
        senha: z.string().min(6).optional(),
        ativo: z.boolean().optional(),
        role: z.nativeEnum(ROLES).optional(),
      })
      .parse(req.body);
    if (data.senha) u.senhaHash = await Usuario.hashSenha(data.senha);
    if (data.nome) u.nome = data.nome;
    if (data.ativo !== undefined) u.ativo = data.ativo;
    if (data.role && req.usuario.role === ROLES.SUPER_ADMIN) u.role = data.role;
    await u.save();
    res.json(u);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const u = await Usuario.findById(req.params.id);
    if (!u) throw httpError(404, 'Usuário não encontrado');
    if (req.usuario.role !== ROLES.SUPER_ADMIN && String(u.loja) !== String(req.usuario.loja))
      throw httpError(403, 'Sem permissão');
    u.ativo = false;
    await u.save();
    res.json({ ok: true });
  })
);

export default router;
