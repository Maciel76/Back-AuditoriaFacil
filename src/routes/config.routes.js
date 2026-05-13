import { Router } from "express";
import { z } from "zod";
import { autenticar, exigirRole } from "../middlewares/auth.js";
import { ROLES } from "../models/Usuario.js";
import { asyncHandler } from "../utils/http.js";
import {
  carregarSystemConfig,
  projetarSystemConfig,
} from "../models/SystemConfig.js";

const router = Router();

router.use(autenticar);

// Qualquer usuário autenticado pode ler as configurações globais públicas
// (necessárias no frontend, ex.: limiar de meta usado nos rankings).
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const doc = await carregarSystemConfig();
    res.json(projetarSystemConfig(doc));
  }),
);

const atualizarSchema = z
  .object({
    metaPercentualRestante: z.number().min(0).max(100).optional(),
  })
  .strict();

// Apenas SUPER_ADMIN pode alterar configurações globais.
router.put(
  "/",
  exigirRole(ROLES.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    const payload = atualizarSchema.parse(req.body || {});
    const doc = await carregarSystemConfig();
    if (typeof payload.metaPercentualRestante === "number") {
      doc.metaPercentualRestante = payload.metaPercentualRestante;
    }
    await doc.save();
    res.json(projetarSystemConfig(doc));
  }),
);

export default router;
