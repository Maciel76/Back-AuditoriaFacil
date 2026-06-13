import { Router } from "express";
import { z } from "zod";
import { Usuario, ROLES } from "../models/Usuario.js";
import { Loja } from "../models/Loja.js";
import { Colaborador } from "../models/Colaborador.js";
import { assinarToken } from "../utils/jwt.js";
import { asyncHandler, httpError } from "../utils/http.js";
import { autenticar } from "../middlewares/auth.js";

const router = Router();

const slugify = (s) =>
  s
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const registerSchema = z.object({
  loja: z.object({
    nome: z.string().min(2),
    slug: z.string().min(2).optional(),
    codigo: z.string().optional(),
    cidade: z.string().optional(),
    estado: z.string().length(2).optional(),
  }),
  admin: z.object({
    nome: z.string().min(2),
    email: z.string().email(),
    senha: z.string().min(6),
  }),
});

router.post(
  "/register-loja",
  asyncHandler(async (req, res) => {
    const data = registerSchema.parse(req.body);
    const slug = slugify(data.loja.slug || data.loja.nome);
    if (await Loja.findOne({ slug }))
      throw httpError(409, "Já existe uma loja com esse identificador");
    if (await Usuario.findOne({ email: data.admin.email.toLowerCase() }))
      throw httpError(409, "E-mail já cadastrado");

    const loja = await Loja.create({ ...data.loja, slug });
    const senhaHash = await Usuario.hashSenha(data.admin.senha);
    const usuario = await Usuario.create({
      nome: data.admin.nome,
      email: data.admin.email,
      senhaHash,
      role: ROLES.STORE_ADMIN,
      loja: loja._id,
    });
    const token = assinarToken({
      sub: usuario.id,
      role: usuario.role,
      loja: loja.id,
    });
    res.status(201).json({ token, usuario, loja });
  }),
);

const loginSchema = z.object({
  email: z.string().email(),
  senha: z.string().min(1),
});

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, senha } = loginSchema.parse(req.body);
    const usuario = await Usuario.findOne({
      email: email.toLowerCase(),
    }).populate("loja");
    if (!usuario || !usuario.ativo)
      throw httpError(401, "Credenciais inválidas");
    const ok = await usuario.checarSenha(senha);
    if (!ok) throw httpError(401, "Credenciais inválidas");
    usuario.ultimoLogin = new Date();
    await usuario.save();
    const token = assinarToken({
      sub: usuario.id,
      role: usuario.role,
      loja: usuario.loja?.id || null,
    });
    res.json({ token, usuario, loja: usuario.loja });
  }),
);

router.get(
  "/me",
  autenticar,
  asyncHandler(async (req, res) => {
    const usuario = await Usuario.findById(req.usuario.id).populate("loja");
    res.json({ usuario, loja: usuario.loja });
  }),
);

// ============ PORTAL DO COLABORADOR ============

/**
 * Verifica lojas disponíveis para uma matrícula no portal do colaborador.
 * Se lojaSlug for informado, mantém o comportamento antigo e valida a matrícula
 * dentro de uma loja específica.
 */
router.get(
  "/portal/verificar",
  asyncHandler(async (req, res) => {
    const { matricula, lojaSlug } = req.query;
    const matriculaNormalizada = String(matricula || "").trim();
    const lojaSlugNormalizada = String(lojaSlug || "").trim();

    if (!matriculaNormalizada) throw httpError(400, "matricula é obrigatória");

    if (lojaSlugNormalizada) {
      const loja = await Loja.findOne({ slug: lojaSlugNormalizada });
      if (!loja) throw httpError(404, "Loja não encontrada");
      const colab = await Colaborador.findOne({
        loja: loja._id,
        codigoExterno: matriculaNormalizada,
        ativo: true,
      });
      if (!colab) throw httpError(404, "Matrícula não encontrada");
      return res.json({
        encontrado: true,
        primeiroAcesso: colab.primeiroAcesso,
        nome: colab.nome.split(" ")[0],
        lojas: [
          {
            slug: loja.slug,
            nomeLoja: loja.nome,
            cidade: loja.cidade,
            estado: loja.estado,
            avatarUrl: loja.avatarUrl,
            primeiroAcesso: colab.primeiroAcesso,
            nome: colab.nome,
            primeiroNome: colab.nome.split(" ")[0],
          },
        ],
      });
    }

    const colaboradores = await Colaborador.find({
      codigoExterno: matriculaNormalizada,
      ativo: true,
    })
      .populate({
        path: "loja",
        match: { ativa: true },
        select: "nome slug cidade estado avatarUrl",
      })
      .lean();

    const lojas = colaboradores
      .filter((colab) => colab.loja)
      .sort((a, b) => a.loja.nome.localeCompare(b.loja.nome, "pt-BR"))
      .map((colab) => ({
        slug: colab.loja.slug,
        nomeLoja: colab.loja.nome,
        cidade: colab.loja.cidade,
        estado: colab.loja.estado,
        avatarUrl: colab.loja.avatarUrl,
        primeiroAcesso: colab.primeiroAcesso,
        nome: colab.nome,
        primeiroNome: colab.nome.split(" ")[0],
      }));

    if (!lojas.length)
      throw httpError(404, "Nenhuma loja encontrada para esta matrícula");

    res.json({
      encontrado: true,
      nome: lojas[0].primeiroNome,
      lojas,
    });
  }),
);

/**
 * Primeiro acesso: define a senha do colaborador.
 */
router.post(
  "/portal/setup",
  asyncHandler(async (req, res) => {
    const { matricula, lojaSlug, senha } = z
      .object({
        matricula: z.string().min(1),
        lojaSlug: z.string().min(1),
        senha: z.string().min(6),
      })
      .parse(req.body);
    const loja = await Loja.findOne({ slug: lojaSlug });
    if (!loja) throw httpError(404, "Loja não encontrada");
    const colab = await Colaborador.findOne({
      loja: loja._id,
      codigoExterno: matricula,
      ativo: true,
    }).select("+senhaHash");
    if (!colab) throw httpError(404, "Matrícula não encontrada");
    if (!colab.primeiroAcesso)
      throw httpError(400, "Senha já configurada. Use o login.");
    colab.senhaHash = await Colaborador.hashSenha(senha);
    colab.primeiroAcesso = false;
    await colab.save();
    const token = assinarToken({
      sub: colab.id,
      tipo: "colaborador",
      loja: loja.id,
    });
    res.json({ token, colaborador: colab, loja });
  }),
);

/**
 * Login do colaborador pelo portal (matrícula + senha).
 */
router.post(
  "/portal/login",
  asyncHandler(async (req, res) => {
    const { matricula, lojaSlug, senha } = z
      .object({
        matricula: z.string().min(1),
        lojaSlug: z.string().min(1),
        senha: z.string().min(1),
      })
      .parse(req.body);
    const loja = await Loja.findOne({ slug: lojaSlug });
    if (!loja) throw httpError(401, "Credenciais inválidas");
    const colab = await Colaborador.findOne({
      loja: loja._id,
      codigoExterno: matricula,
      ativo: true,
    }).select("+senhaHash");
    if (!colab) throw httpError(401, "Credenciais inválidas");
    if (colab.primeiroAcesso || !colab.senhaHash)
      throw httpError(400, "Configure sua senha primeiro");
    const ok = await colab.checarSenha(senha);
    if (!ok) throw httpError(401, "Credenciais inválidas");
    const token = assinarToken({
      sub: colab.id,
      tipo: "colaborador",
      loja: loja.id,
    });
    res.json({ token, colaborador: colab, loja });
  }),
);

/**
 * Reset de senha do colaborador no portal (após 3 tentativas erradas).
 * O colaborador confirma a matrícula e define uma nova senha.
 */
router.post(
  "/portal/reset-senha",
  asyncHandler(async (req, res) => {
    const { matricula, lojaSlug, novaSenha } = z
      .object({
        matricula: z.string().min(1),
        lojaSlug: z.string().min(1),
        novaSenha: z.string().min(6),
      })
      .parse(req.body);
    const loja = await Loja.findOne({ slug: lojaSlug });
    if (!loja) throw httpError(404, "Loja não encontrada");
    const colab = await Colaborador.findOne({
      loja: loja._id,
      codigoExterno: matricula,
      ativo: true,
    }).select("+senhaHash");
    if (!colab) throw httpError(404, "Matrícula não encontrada");
    if (colab.primeiroAcesso || !colab.senhaHash)
      throw httpError(400, "Esta conta ainda não possui senha. Use a opção de primeiro acesso.");
    colab.senhaHash = await Colaborador.hashSenha(novaSenha);
    await colab.save();
    const token = assinarToken({
      sub: colab.id,
      tipo: "colaborador",
      loja: loja.id,
    });
    res.json({ token, colaborador: colab, loja });
  }),
);

export default router;
