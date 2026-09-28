import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { env } from "./config/env.js";
import { connectDB } from "./config/db.js";
import { errorMiddleware } from "./utils/http.js";
import { Usuario, ROLES } from "./models/Usuario.js";

import authRoutes from "./routes/auth.routes.js";
import lojasRoutes from "./routes/lojas.routes.js";
import usuariosRoutes from "./routes/usuarios.routes.js";
import colaboradoresRoutes from "./routes/colaboradores.routes.js";
import auditoriasRoutes from "./routes/auditorias.routes.js";
import metricasRoutes from "./routes/metricas.routes.js";
import conquistasRoutes from "./routes/conquistas.routes.js";
import configRoutes from "./routes/config.routes.js";
import whatsappRoutes from "./routes/whatsapp.routes.js";
import {
  semearConquistasSeNecessario,
  sincronizarConquistasPadrao,
} from "./services/conquistasSeed.js";
import { restaurarSessoes } from "./services/whatsappManager.js";

async function bootstrap() {
  await connectDB();

  const existeAdmin = await Usuario.findOne({ role: ROLES.SUPER_ADMIN });
  if (!existeAdmin) {
    const senhaHash = await Usuario.hashSenha(env.bootstrap.password);
    await Usuario.create({
      nome: env.bootstrap.name,
      email: env.bootstrap.email,
      senhaHash,
      role: ROLES.SUPER_ADMIN,
    });
    console.log(
      `[bootstrap] super admin criado: ${env.bootstrap.email} / ${env.bootstrap.password}`,
    );
  }

  await semearConquistasSeNecessario();
  await sincronizarConquistasPadrao();

  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (env.corsOrigin.includes("*") || env.corsOrigin.includes(origin))
          return cb(null, true);
        cb(new Error("CORS bloqueado"));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));

  const limiter = rateLimit({
    windowMs: 60_000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use("/api/", limiter);

  app.get("/api/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

  // Serve arquivos de upload (avatares)
  const uploadsDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "uploads",
  );
  app.use("/uploads", express.static(uploadsDir));

  app.use("/api/auth", authRoutes);
  app.use("/api/lojas", lojasRoutes);
  app.use("/api/usuarios", usuariosRoutes);
  app.use("/api/colaboradores", colaboradoresRoutes);
  app.use("/api/auditorias", auditoriasRoutes);
  app.use("/api/metricas", metricasRoutes);
  app.use("/api/conquistas", conquistasRoutes);
  app.use("/api/config", configRoutes);
  app.use("/api/whatsapp", whatsappRoutes);

  app.use((req, res) =>
    res.status(404).json({ error: "Rota não encontrada", path: req.path }),
  );
  app.use(errorMiddleware);

  app.listen(env.port, () => {
    console.log(`[server] API ouvindo em http://localhost:${env.port}`);
  });

  // Reabre as sessões de WhatsApp já pareadas. Depois do listen, de propósito:
  // uma loja com sessão ruim não pode atrasar a subida da API.
  restaurarSessoes().catch((e) =>
    console.warn("[WA] falha ao restaurar sessões:", e.message),
  );
}

bootstrap().catch((e) => {
  console.error("[fatal]", e);
  process.exit(1);
});
