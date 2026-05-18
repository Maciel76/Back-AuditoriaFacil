import { Router } from "express";
import { z } from "zod";
import dayjs from "dayjs";
import { fileURLToPath } from "node:url";
import { Loja } from "../models/Loja.js";
import { Auditoria, TIPOS_AUDITORIA } from "../models/Auditoria.js";
import { MetricaDiaria } from "../models/MetricaDiaria.js";
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

async function intervaloPeriodoCatalogo(periodo = "1d", opts = {}) {
  const ultimoRegistro = await MetricaDiaria.findOne(opts.match || {})
    .sort({ data: -1 })
    .select({ data: 1 })
    .lean();
  const agora = ultimoRegistro?.data ? dayjs(ultimoRegistro.data) : dayjs();
  let inicio;
  let fim;

  switch (periodo) {
    case "1d":
    case "hoje":
      inicio = agora.startOf("day");
      fim = agora.endOf("day");
      break;
    case "semana":
    case "7d":
      inicio = agora.subtract(6, "day").startOf("day");
      fim = agora.endOf("day");
      break;
    case "mes":
    case "30d":
      inicio = agora.startOf("month");
      fim = agora.endOf("month");
      break;
    case "90d":
      inicio = agora.subtract(89, "day").startOf("day");
      fim = agora.endOf("day");
      break;
    case "ano":
      inicio = agora.startOf("year");
      fim = agora.endOf("year");
      break;
    case "tudo":
      return {
        inicio: new Date("2020-01-01"),
        fim: agora.endOf("day").toDate(),
      };
    case "custom":
      if (opts.dataInicio && opts.dataFim) {
        return {
          inicio: dayjs(opts.dataInicio).startOf("day").toDate(),
          fim: dayjs(opts.dataFim).endOf("day").toDate(),
        };
      }
      inicio = agora.startOf("month");
      fim = agora.endOf("month");
      break;
    default:
      inicio = agora.startOf("month");
      fim = agora.endOf("month");
  }

  return { inicio: inicio.toDate(), fim: fim.toDate() };
}

function resumoTipoVazio() {
  return {
    totalAuditorias: 0,
    totalItens: 0,
    totalItensAuditaveis: 0,
    totalLidos: 0,
    totalConformes: 0,
    totalNaoConformes: 0,
    pontuacao: 0,
    custoRuptura: 0,
    taxaConformidade: 0,
  };
}

function resumoPeriodoVazio() {
  return {
    totalAuditorias: 0,
    tiposComAuditoria: 0,
    totalItens: 0,
    totalItensAuditaveis: 0,
    totalLidos: 0,
    totalConformes: 0,
    totalNaoConformes: 0,
    pontuacao: 0,
    custoRuptura: 0,
    taxaConformidade: 0,
    ultimaAuditoriaEm: null,
    porTipo: Object.fromEntries(
      Object.values(TIPOS_AUDITORIA).map((tipo) => [tipo, resumoTipoVazio()]),
    ),
  };
}

function arredondar(valor, casas = 2) {
  return Number(Number(valor || 0).toFixed(casas));
}

function calcularTaxaTipo(tipo, resumo) {
  if (tipo === TIPOS_AUDITORIA.ETIQUETA) {
    return resumo.totalItensAuditaveis > 0
      ? arredondar((resumo.totalLidos / resumo.totalItensAuditaveis) * 100)
      : 0;
  }

  return resumo.totalLidos > 0
    ? arredondar((resumo.totalConformes / resumo.totalLidos) * 100)
    : 0;
}

function finalizarResumoPeriodo(resumo) {
  for (const tipo of Object.values(TIPOS_AUDITORIA)) {
    resumo.porTipo[tipo].pontuacao = arredondar(resumo.porTipo[tipo].pontuacao);
    resumo.porTipo[tipo].custoRuptura = arredondar(resumo.porTipo[tipo].custoRuptura);
    resumo.porTipo[tipo].taxaConformidade = calcularTaxaTipo(tipo, resumo.porTipo[tipo]);
  }

  const etiqueta = resumo.porTipo[TIPOS_AUDITORIA.ETIQUETA];
  let numerador = etiqueta.totalLidos;
  let denominador = etiqueta.totalItensAuditaveis;

  for (const tipo of [TIPOS_AUDITORIA.PRESENCA, TIPOS_AUDITORIA.RUPTURA]) {
    const atual = resumo.porTipo[tipo];
    numerador += atual.totalConformes;
    denominador += atual.totalLidos;
  }

  resumo.tiposComAuditoria = Object.values(resumo.porTipo).filter(
    (tipoResumo) => tipoResumo.totalAuditorias > 0,
  ).length;
  resumo.pontuacao = arredondar(resumo.pontuacao);
  resumo.custoRuptura = arredondar(resumo.custoRuptura);
  resumo.taxaConformidade = denominador > 0
    ? arredondar((numerador / denominador) * 100)
    : 0;

  return resumo;
}

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
  asyncHandler(async (req, res) => {
    const lojas = await Loja.find({ ativa: true })
      .select(
        "_id nome slug codigo cidade estado avatarUrl ativa nivel pontuacao",
      )
      .sort({ nome: 1 })
      .lean();

    const lojaIds = lojas.map((loja) => loja._id);
    const matchPeriodoBase = { colaborador: null };
    if (lojaIds.length) matchPeriodoBase.loja = { $in: lojaIds };

    const periodo = req.query.periodo || "1d";
    const { inicio, fim } = await intervaloPeriodoCatalogo(periodo, {
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
      match: matchPeriodoBase,
    });

    const [metricasPorTipo, auditoriasPorTipo] = await Promise.all([
      MetricaDiaria.aggregate([
        {
          $match: {
            ...matchPeriodoBase,
            data: { $gte: inicio, $lte: fim },
          },
        },
        {
          $group: {
            _id: { loja: "$loja", tipo: "$tipo" },
            totalItens: { $sum: "$totalItens" },
            totalItensAuditaveis: { $sum: "$totalItensAuditaveis" },
            totalLidos: { $sum: "$totalLidos" },
            totalConformes: { $sum: "$totalConformes" },
            totalNaoConformes: { $sum: "$totalNaoConformes" },
            pontuacao: { $sum: "$pontuacao" },
            custoRuptura: { $sum: "$custoRuptura" },
          },
        },
      ]),
      Auditoria.aggregate([
        {
          $match: {
            loja: { $in: lojaIds },
            data: { $gte: inicio, $lte: fim },
          },
        },
        {
          $group: {
            _id: { loja: "$loja", tipo: "$tipo" },
            totalAuditorias: { $sum: 1 },
            ultimaAuditoriaEm: { $max: "$data" },
          },
        },
      ]),
    ]);

    const resumosPorLoja = new Map(
      lojas.map((loja) => [String(loja._id), resumoPeriodoVazio()]),
    );

    for (const linha of metricasPorTipo) {
      const lojaId = String(linha._id.loja);
      const tipo = linha._id.tipo;
      const resumo = resumosPorLoja.get(lojaId);
      if (!resumo || !resumo.porTipo[tipo]) continue;

      const tipoResumo = resumo.porTipo[tipo];
      tipoResumo.totalItens += Number(linha.totalItens || 0);
      tipoResumo.totalItensAuditaveis += Number(linha.totalItensAuditaveis || 0);
      tipoResumo.totalLidos += Number(linha.totalLidos || 0);
      tipoResumo.totalConformes += Number(linha.totalConformes || 0);
      tipoResumo.totalNaoConformes += Number(linha.totalNaoConformes || 0);
      tipoResumo.pontuacao += Number(linha.pontuacao || 0);
      tipoResumo.custoRuptura += Number(linha.custoRuptura || 0);

      resumo.totalItens += Number(linha.totalItens || 0);
      resumo.totalItensAuditaveis += Number(linha.totalItensAuditaveis || 0);
      resumo.totalLidos += Number(linha.totalLidos || 0);
      resumo.totalConformes += Number(linha.totalConformes || 0);
      resumo.totalNaoConformes += Number(linha.totalNaoConformes || 0);
      resumo.pontuacao += Number(linha.pontuacao || 0);
      resumo.custoRuptura += Number(linha.custoRuptura || 0);
    }

    for (const linha of auditoriasPorTipo) {
      const lojaId = String(linha._id.loja);
      const tipo = linha._id.tipo;
      const resumo = resumosPorLoja.get(lojaId);
      if (!resumo || !resumo.porTipo[tipo]) continue;

      const totalAuditorias = Number(linha.totalAuditorias || 0);
      resumo.porTipo[tipo].totalAuditorias += totalAuditorias;
      resumo.totalAuditorias += totalAuditorias;

      if (
        linha.ultimaAuditoriaEm &&
        (!resumo.ultimaAuditoriaEm || linha.ultimaAuditoriaEm > resumo.ultimaAuditoriaEm)
      ) {
        resumo.ultimaAuditoriaEm = linha.ultimaAuditoriaEm;
      }
    }

    const items = lojas.map((loja) => ({
      ...loja,
      resumoPeriodo: finalizarResumoPeriodo(
        resumosPorLoja.get(String(loja._id)) || resumoPeriodoVazio(),
      ),
    }));

    res.json({ periodo: { inicio, fim, label: periodo }, items });
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
