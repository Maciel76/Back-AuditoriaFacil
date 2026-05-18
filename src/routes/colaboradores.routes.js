import { Router } from "express";
import { z } from "zod";
import { Colaborador } from "../models/Colaborador.js";
import { Usuario, ROLES } from "../models/Usuario.js";
import {
  autenticar,
  escopoLoja,
  exigirEscopoLoja,
  exigirRole,
} from "../middlewares/auth.js";
import { autenticarColaborador } from "../middlewares/authColaborador.js";
import { uploadAvatar } from "../middlewares/upload.js";
import { asyncHandler, httpError } from "../utils/http.js";
import { verificarToken } from "../utils/jwt.js";
import fs from "node:fs";
import path from "node:path";

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

// ============ PORTAL SELF-SERVICE (autenticação via token de colaborador) ============

/** Perfil próprio do colaborador (sem lojaId, apenas com token de portal) */
router.get(
  "/portal/me",
  autenticarColaborador,
  asyncHandler(async (req, res) => {
    const colab = await Colaborador.findById(req.colaborador._id)
      .populate("loja", "nome slug codigo cidade estado avatarUrl")
      .lean();
    if (!colab) throw httpError(404, "Colaborador não encontrado");
    res.json(colab);
  }),
);

router.post(
  "/portal/password",
  autenticarColaborador,
  asyncHandler(async (req, res) => {
    const { senhaAtual, novaSenha } = z
      .object({
        senhaAtual: z.string().min(1),
        novaSenha: z.string().min(6),
      })
      .parse(req.body);

    const colab = await Colaborador.findById(req.colaborador._id).select(
      "+senhaHash",
    );
    if (!colab || !colab.ativo)
      throw httpError(404, "Colaborador não encontrado");
    if (!colab.senhaHash) throw httpError(400, "Senha ainda não configurada");

    const ok = await colab.checarSenha(senhaAtual);
    if (!ok) throw httpError(400, "Senha atual incorreta");

    colab.senhaHash = await Colaborador.hashSenha(novaSenha);
    colab.primeiroAcesso = false;
    await colab.save();

    res.json({ ok: true });
  }),
);

/** Upload de avatar (colaborador ou admin) */
router.post(
  "/:id/avatar",
  autenticarAdminOuColaborador,
  uploadAvatar.single("avatar"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw httpError(400, "Imagem obrigatória");
    const colab = await Colaborador.findById(req.params.id);
    if (!colab) throw httpError(404, "Colaborador não encontrado");

    if (req.colaborador && String(req.colaborador._id) !== String(colab._id)) {
      throw httpError(403, "Você só pode alterar sua própria foto");
    }

    if (req.usuario) {
      if (req.usuario.role === ROLES.COLABORADOR) {
        if (String(req.usuario.colaborador || "") !== String(colab._id)) {
          throw httpError(403, "Você só pode alterar sua própria foto");
        }
      } else if (![ROLES.SUPER_ADMIN, ROLES.STORE_ADMIN].includes(req.usuario.role)) {
        throw httpError(403, "Sem permissão para alterar esta foto");
      } else if (
        req.usuario.role === ROLES.STORE_ADMIN &&
        String(req.usuario.loja || "") !== String(colab.loja || "")
      ) {
        throw httpError(403, "Colaborador fora do escopo da sua loja");
      } else if (req.usuario.role === ROLES.SUPER_ADMIN) {
        const lojaEscopo = req.query.lojaId || req.body?.lojaId;
        if (lojaEscopo && String(lojaEscopo) !== String(colab.loja || "")) {
          throw httpError(403, "Colaborador fora do escopo informado");
        }
      }
    }

    if (colab.avatarUrl) {
      const old = path.resolve(
        "uploads",
        "avatares",
        path.basename(colab.avatarUrl),
      );
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }

    colab.avatarUrl = `/uploads/avatares/${req.file.filename}`;
    await colab.save();
    res.json({ avatarUrl: colab.avatarUrl });
  }),
);

router.use(autenticar);

router.get(
  "/",
  escopoLoja,
  asyncHandler(async (req, res) => {
    const { q, page = 1, limit = 50 } = req.query;
    const filtro = {};
    if (req.escopoLojaId) filtro.loja = req.escopoLojaId;
    if (q)
      filtro.$or = [
        { nome: new RegExp(q, "i") },
        { codigoExterno: new RegExp(q, "i") },
      ];
    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      Colaborador.find(filtro)
        .populate("loja", "nome codigo")
        .sort({ pontuacao: -1, nome: 1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Colaborador.countDocuments(filtro),
    ]);
    res.json({ items, total, page: Number(page), limit: Number(limit) });
  }),
);

const createSchema = z.object({
  nome: z.string().min(2),
  codigoExterno: z.string().min(1),
  cargo: z.string().optional(),
  setor: z.string().optional(),
});

const updateSchema = createSchema.partial();

router.post(
  "/",
  escopoLoja,
  exigirEscopoLoja,
  exigirRole(ROLES.SUPER_ADMIN, ROLES.STORE_ADMIN),
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const exists = await Colaborador.findOne({
      loja: req.escopoLojaId,
      codigoExterno: data.codigoExterno,
    });
    if (exists)
      throw httpError(409, "Já existe colaborador com esse código nesta loja");
    const c = await Colaborador.create({ ...data, loja: req.escopoLojaId });
    res.status(201).json(c);
  }),
);

router.put(
  "/:id",
  escopoLoja,
  exigirEscopoLoja,
  exigirRole(ROLES.SUPER_ADMIN, ROLES.STORE_ADMIN),
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const c = await Colaborador.findOneAndUpdate(
      { _id: req.params.id, loja: req.escopoLojaId },
      { $set: data },
      { new: true },
    );
    if (!c) throw httpError(404, "Colaborador não encontrado");
    res.json(c);
  }),
);

router.delete(
  "/:id",
  escopoLoja,
  exigirEscopoLoja,
  exigirRole(ROLES.SUPER_ADMIN, ROLES.STORE_ADMIN),
  asyncHandler(async (req, res) => {
    throw httpError(403, "Exclusão de colaboradores está desabilitada");
  }),
);

// Vincular conta de usuário a um colaborador
router.post(
  "/:id/usuario",
  escopoLoja,
  exigirEscopoLoja,
  exigirRole(ROLES.SUPER_ADMIN, ROLES.STORE_ADMIN),
  asyncHandler(async (req, res) => {
    const { email, senha, nome } = z
      .object({
        email: z.string().email(),
        senha: z.string().min(6),
        nome: z.string().min(2).optional(),
      })
      .parse(req.body);
    const colab = await Colaborador.findOne({
      _id: req.params.id,
      loja: req.escopoLojaId,
    });
    if (!colab) throw httpError(404, "Colaborador não encontrado");
    if (await Usuario.findOne({ email: email.toLowerCase() }))
      throw httpError(409, "E-mail já em uso");
    const senhaHash = await Usuario.hashSenha(senha);
    const usuario = await Usuario.create({
      nome: nome || colab.nome,
      email,
      senhaHash,
      role: ROLES.COLABORADOR,
      loja: colab.loja,
      colaborador: colab._id,
    });
    colab.usuario = usuario._id;
    await colab.save();
    res.status(201).json({ usuario, colaborador: colab });
  }),
);

export default router;
