import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { errorMiddleware } from './utils/http.js';
import { Usuario, ROLES } from './models/Usuario.js';

import authRoutes from './routes/auth.routes.js';
import lojasRoutes from './routes/lojas.routes.js';
import usuariosRoutes from './routes/usuarios.routes.js';
import colaboradoresRoutes from './routes/colaboradores.routes.js';
import auditoriasRoutes from './routes/auditorias.routes.js';
import metricasRoutes from './routes/metricas.routes.js';

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
    console.log(`[bootstrap] super admin criado: ${env.bootstrap.email} / ${env.bootstrap.password}`);
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (env.corsOrigin.includes('*') || env.corsOrigin.includes(origin)) return cb(null, true);
        cb(new Error('CORS bloqueado'));
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

  const limiter = rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false });
  app.use('/api/', limiter);

  app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

  // Serve arquivos de upload (avatares)
  const uploadsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'uploads');
  app.use('/uploads', express.static(uploadsDir));

  app.use('/api/auth', authRoutes);
  app.use('/api/lojas', lojasRoutes);
  app.use('/api/usuarios', usuariosRoutes);
  app.use('/api/colaboradores', colaboradoresRoutes);
  app.use('/api/auditorias', auditoriasRoutes);
  app.use('/api/metricas', metricasRoutes);

  app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada', path: req.path }));
  app.use(errorMiddleware);

  app.listen(env.port, () => {
    console.log(`[server] API ouvindo em http://localhost:${env.port}`);
  });
}

bootstrap().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});
