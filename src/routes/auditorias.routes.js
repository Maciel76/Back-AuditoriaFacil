import { Router } from "express";
import { randomUUID } from "node:crypto";
import { Auditoria, TIPOS_AUDITORIA } from "../models/Auditoria.js";
import { AuditItem } from "../models/AuditItem.js";
import { Colaborador } from "../models/Colaborador.js";
import { upload } from "../middlewares/upload.js";
import {
  autenticar,
  escopoLoja,
  exigirEscopoLoja,
  exigirRole,
} from "../middlewares/auth.js";
import { ROLES } from "../models/Usuario.js";
import { asyncHandler, httpError } from "../utils/http.js";
import { processarPlanilha } from "../services/auditoriaProcessor.js";
import {
  cancelarAuditoria,
  cancelarAuditoriaDoDia,
} from "../services/auditoriaCancelamento.js";
import { reclassificarAuditoria } from "../services/auditoriaReclassificacao.js";
import { REGRAS } from "../services/regras.js";

const router = Router();
router.use(autenticar);

const AUDITORIA_ID_REGEX = /^[0-9a-fA-F]{24}$/;

const uploadJobs = new Map();
const JOB_TTL_MS = 30 * 60 * 1000;

function atualizarJob(jobId, patch) {
  const job = uploadJobs.get(jobId);
  if (!job) return;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
}

function agendarLimpezaJob(jobId) {
  const timer = setTimeout(() => uploadJobs.delete(jobId), JOB_TTL_MS);
  timer.unref?.();
}

function normalizarDataDia(valor) {
  const dataTexto = String(valor || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataTexto)) {
    throw httpError(400, "Data da auditoria inválida");
  }

  const [ano, mes, dia] = dataTexto.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (
    Number.isNaN(data.valueOf()) ||
    data.getUTCFullYear() !== ano ||
    data.getUTCMonth() !== mes - 1 ||
    data.getUTCDate() !== dia
  ) {
    throw httpError(400, "Data da auditoria inválida");
  }

  return data;
}

function normalizarAuditoriaId(valor) {
  const auditoriaId = String(valor || "").trim();
  if (!AUDITORIA_ID_REGEX.test(auditoriaId)) {
    throw httpError(404, "Auditoria não encontrada");
  }
  return auditoriaId;
}

router.get("/regras", (_req, res) => res.json(REGRAS));

router.get(
  "/upload/:jobId/status",
  asyncHandler(async (req, res) => {
    const job = uploadJobs.get(req.params.jobId);
    if (!job) throw httpError(404, "Processamento não encontrado");
    if (job.usuarioId !== String(req.usuario.id))
      throw httpError(403, "Sem permissão para consultar este processamento");

    res.json({
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      stage: job.stage,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      result: job.status === "done" ? job.result : null,
      error: job.status === "error" ? job.error : null,
    });
  }),
);

router.post(
  "/upload",
  escopoLoja,
  exigirEscopoLoja,
  exigirRole(ROLES.SUPER_ADMIN, ROLES.STORE_ADMIN),
  upload.single("arquivo"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw httpError(400, "Arquivo obrigatório");
    const tipoForcado =
      req.body.tipo && Object.values(TIPOS_AUDITORIA).includes(req.body.tipo)
        ? req.body.tipo
        : null;

    const jobId = randomUUID();
    uploadJobs.set(jobId, {
      id: jobId,
      usuarioId: String(req.usuario.id),
      lojaId: String(req.escopoLojaId),
      status: "processing",
      progress: 0,
      stage: "Aguardando processamento",
      result: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    agendarLimpezaJob(jobId);

    res.status(202).json({ jobId });

    void processarPlanilha({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      lojaId: req.escopoLojaId,
      usuarioId: req.usuario.id,
      tipoForcado,
      onProgress: ({ progress, stage }) => {
        atualizarJob(jobId, {
          status: "processing",
          progress,
          stage,
        });
      },
    })
      .then((resultado) => {
        atualizarJob(jobId, {
          status: "done",
          progress: 100,
          stage: resultado?.cancelada ? "Auditoria cancelada" : "Concluído",
          result: resultado,
          error: null,
        });
      })
      .catch((error) => {
        atualizarJob(jobId, {
          status: "error",
          progress: 100,
          stage: "Falha no processamento",
          result: null,
          error: error?.message || "Falha no processamento da planilha",
        });
      });
  }),
);

router.get(
  "/",
  escopoLoja,
  exigirEscopoLoja,
  asyncHandler(async (req, res) => {
    const {
      tipo,
      dataInicio,
      dataFim,
      page = 1,
      limit = 30,
      includeExcluidas,
    } = req.query;
    const q = { loja: req.escopoLojaId };
    if (String(includeExcluidas || "").toLowerCase() !== "true") {
      q.excluida = { $ne: true };
    }
    if (tipo) q.tipo = tipo;
    if (dataInicio || dataFim) {
      q.data = {};
      if (dataInicio) q.data.$gte = new Date(dataInicio);
      if (dataFim) q.data.$lte = new Date(dataFim);
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      Auditoria.find(q)
        .sort({ data: -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Auditoria.countDocuments(q),
    ]);
    res.json({ items, total, page: Number(page), limit: Number(limit) });
  }),
);

router.post(
  "/cancelar-dia",
  escopoLoja,
  exigirEscopoLoja,
  exigirRole(ROLES.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    const tipo = String(req.body?.tipo || "")
      .toUpperCase()
      .trim();
    if (!Object.values(TIPOS_AUDITORIA).includes(tipo)) {
      throw httpError(400, "Tipo de auditoria inválido");
    }

    const { auditoria, criada } = await cancelarAuditoriaDoDia({
      lojaId: req.escopoLojaId,
      usuarioId: req.usuario.id,
      tipo,
      data: normalizarDataDia(req.body?.data),
      motivo: String(req.body?.motivo || "").trim(),
    });

    res.json({
      ok: true,
      criada,
      auditoria: auditoria.toObject ? auditoria.toObject() : auditoria,
      mensagem: criada
        ? "Auditoria do dia cancelada sem planilha enviada."
        : "Auditoria do dia cancelada. As métricas foram zeradas.",
    });
  }),
);

router.get(
  "/calendario",
  escopoLoja,
  exigirEscopoLoja,
  asyncHandler(async (_req, _res) => {
    throw httpError(
      404,
      "Endpoint inexistente. Use a rota de frontend /auditorias/calendario.",
    );
  }),
);

router.get(
  "/:id",
  escopoLoja,
  exigirEscopoLoja,
  asyncHandler(async (req, res) => {
    const auditoriaId = normalizarAuditoriaId(req.params.id);
    const auditoria = await Auditoria.findOne({
      _id: auditoriaId,
      loja: req.escopoLojaId,
    }).lean();
    if (!auditoria) throw httpError(404, "Auditoria não encontrada");

    if (auditoria.topColaboradores?.length) {
      const colaboradorIds = auditoria.topColaboradores
        .map((item) => item.colaborador)
        .filter(Boolean);

      if (colaboradorIds.length) {
        const colaboradores = await Colaborador.find({
          _id: { $in: colaboradorIds },
        })
          .select("_id avatarUrl")
          .lean();

        const avatarPorColaborador = new Map(
          colaboradores.map((colaborador) => [
            String(colaborador._id),
            colaborador.avatarUrl || "",
          ]),
        );

        auditoria.topColaboradores = auditoria.topColaboradores.map((item) => ({
          ...item,
          avatarUrl:
            avatarPorColaborador.get(String(item.colaborador || "")) || "",
        }));
      }
    }

    res.json(auditoria);
  }),
);

router.get(
  "/:id/itens",
  escopoLoja,
  exigirEscopoLoja,
  asyncHandler(async (req, res) => {
    const auditoriaId = normalizarAuditoriaId(req.params.id);
    const { situacao, conforme, page = 1, limit = 100, q } = req.query;
    const auditoria = await Auditoria.findOne({
      _id: auditoriaId,
      loja: req.escopoLojaId,
    }).lean();
    if (!auditoria) throw httpError(404, "Auditoria não encontrada");
    const filtro = { auditoria: auditoria._id };
    if (situacao) filtro.situacao = situacao;
    if (conforme === "true") filtro.conforme = true;
    if (conforme === "false") filtro.conforme = false;
    if (q)
      filtro.$or = [
        { codigo: new RegExp(q, "i") },
        { produto: new RegExp(q, "i") },
        { colaboradorNome: new RegExp(q, "i") },
      ];
    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      AuditItem.find(filtro).skip(skip).limit(Number(limit)).lean(),
      AuditItem.countDocuments(filtro),
    ]);
    res.json({ items, total, page: Number(page), limit: Number(limit) });
  }),
);

router.post(
  "/:id/cancelar",
  escopoLoja,
  exigirEscopoLoja,
  exigirRole(ROLES.SUPER_ADMIN, ROLES.STORE_ADMIN),
  asyncHandler(async (req, res) => {
    const auditoriaId = normalizarAuditoriaId(req.params.id);
    const auditoria = await cancelarAuditoria({
      auditoriaId,
      lojaId: req.escopoLojaId,
      usuarioId: req.usuario.id,
      motivo: String(req.body?.motivo || "").trim(),
    });
    if (!auditoria) throw httpError(404, "Auditoria não encontrada");
    res.json({
      ok: true,
      auditoria: auditoria.toObject ? auditoria.toObject() : auditoria,
      mensagem:
        "Auditoria cancelada. As métricas desse dia foram zeradas e não entram nos cálculos.",
    });
  }),
);

router.patch(
  "/:id/reclassificar",
  escopoLoja,
  exigirEscopoLoja,
  exigirRole(ROLES.SUPER_ADMIN, ROLES.STORE_ADMIN),
  asyncHandler(async (req, res) => {
    const auditoriaId = normalizarAuditoriaId(req.params.id);
    const novoTipo = String(req.body?.tipo || "")
      .toUpperCase()
      .trim();
    if (!Object.values(TIPOS_AUDITORIA).includes(novoTipo)) {
      throw httpError(400, "Tipo de auditoria inválido");
    }
    try {
      const auditoria = await reclassificarAuditoria({
        auditoriaId,
        lojaId: req.escopoLojaId,
        novoTipo,
        usuarioId: req.usuario.id,
      });
      if (!auditoria) throw httpError(404, "Auditoria não encontrada");
      res.json({
        ok: true,
        auditoria: auditoria.toObject ? auditoria.toObject() : auditoria,
        mensagem: `Auditoria reclassificada para ${REGRAS[novoTipo].label}. Métricas e ranking foram recalculados.`,
      });
    } catch (error) {
      if (error?.status) throw httpError(error.status, error.message);
      throw error;
    }
  }),
);

router.delete(
  "/:id",
  escopoLoja,
  exigirEscopoLoja,
  exigirRole(ROLES.SUPER_ADMIN, ROLES.STORE_ADMIN),
  asyncHandler(async (req, res) => {
    const auditoriaId = normalizarAuditoriaId(req.params.id);
    const auditoria = await Auditoria.findOne({
      _id: auditoriaId,
      loja: req.escopoLojaId,
    });
    if (!auditoria) throw httpError(404, "Auditoria não encontrada");
    auditoria.excluida = true;
    auditoria.excluidaEm = new Date();
    auditoria.excluidaPor = req.usuario.id;
    await auditoria.save();
    res.json({ ok: true, mensagem: "Auditoria removida do histórico" });
  }),
);

export default router;
