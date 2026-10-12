import { Router } from "express";
import { z } from "zod";
import { autenticar, exigirRole } from "../middlewares/auth.js";
import { ROLES } from "../models/Usuario.js";
import { SystemConfig } from "../models/SystemConfig.js";
import { Colaborador } from "../models/Colaborador.js";
import { estadoLojaPortal } from "../services/lojaPortalService.js";
import { CATALOGO_LOJA_PORTAL, carregarCatalogoLojaPortal } from "../services/lojaPortalService.js";
import { asyncHandler, httpError } from "../utils/http.js";

const router = Router();
router.use(autenticar, exigirRole(ROLES.SUPER_ADMIN));

router.get("/colaboradores", asyncHandler(async (req, res) => {
  const consulta = z.object({ q: z.string().max(100).default(""), page: z.coerce.number().int().min(1).max(100000).default(1) }).safeParse(req.query);
  if (!consulta.success) throw httpError(400, "Busca inválida");
  const { q, page } = consulta.data;
  const filtro = { ativo: true };
  if (q.trim()) {
    const busca = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filtro.$or = [{ nome: busca }, { codigoExterno: busca }];
  }
  const [items, total] = await Promise.all([
    Colaborador.find(filtro).select("nome codigoExterno loja pontuacao moedasBonus moedasGastas")
      .populate("loja", "nome codigo").sort({ nome: 1, _id: 1 }).skip((page - 1) * 20).limit(20).lean(),
    Colaborador.countDocuments(filtro),
  ]);
  res.json({ items: items.map((item) => ({ ...item, saldoMoedas: estadoLojaPortal(item).saldoMoedas })), total, page, limit: 20 });
}));

const creditoSchema = z.object({
  colaboradores: z.array(z.string().regex(/^[a-fA-F0-9]{24}$/)).min(1).max(100),
  quantidade: z.number().int().min(1).max(1000000000),
  motivo: z.string().trim().min(3).max(200),
  operacao: z.string().uuid(),
}).strict();

router.post("/moedas", asyncHandler(async (req, res) => {
  const dados = creditoSchema.safeParse(req.body);
  if (!dados.success) throw httpError(400, "Selecione até 100 colaboradores, informe moedas inteiras positivas e um motivo (3 a 200 caracteres)");
  const { quantidade, motivo, operacao } = dados.data;
  const ids = [...new Set(dados.data.colaboradores)];
  const filtro = { _id: { $in: ids }, ativo: true };
  if (await Colaborador.countDocuments(filtro) !== ids.length) {
    throw httpError(400, "Um dos colaboradores não existe ou está inativo. Revise a seleção.");
  }
  // Crédito e histórico são atômicos por carteira; repetir uma solicitação
  // após falha de conexão não credita novamente os mesmos colaboradores.
  await Colaborador.updateMany(
    { ...filtro, "creditosMoedas.operacao": { $ne: operacao } },
    { $inc: { moedasBonus: quantidade }, $push: { creditosMoedas: { operacao, quantidade, motivo, admin: req.usuario._id, criadoEm: new Date() } } },
    { runValidators: true },
  );
  const creditados = await Colaborador.countDocuments({ _id: { $in: ids }, "creditosMoedas.operacao": operacao });
  res.json({ creditados, quantidade, totalMoedas: creditados * quantidade });
}));

router.get("/", asyncHandler(async (_req, res) => {
  res.json({ catalogo: await carregarCatalogoLojaPortal() });
}));

const schema = z.object({
  itens: z.array(z.object({
    codigo: z.enum(CATALOGO_LOJA_PORTAL.map((item) => item.codigo)),
    preco: z.number().int().min(0).max(1000000000),
  }).strict()).min(1).max(CATALOGO_LOJA_PORTAL.length),
}).strict();

router.put("/", asyncHandler(async (req, res) => {
  const dados = schema.safeParse(req.body);
  if (!dados.success) throw httpError(400, "Informe itens válidos e preços inteiros entre 0 e 1.000.000.000 moedas");
  if (new Set(dados.data.itens.map((item) => item.codigo)).size !== dados.data.itens.length) {
    throw httpError(400, "Não repita itens na atualização de preços");
  }
  const precos = Object.fromEntries(dados.data.itens.map((item) => [`precosLojaPortal.${item.codigo}`, item.preco]));
  await SystemConfig.findOneAndUpdate(
    { chave: "global" },
    { $set: precos },
    { upsert: true, runValidators: true },
  );
  res.json({ catalogo: await carregarCatalogoLojaPortal() });
}));

export default router;
