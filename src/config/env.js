import 'dotenv/config';

const required = (name, fallback) => {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Variável de ambiente ausente: ${name}`);
  return v;
};

export const env = {
  mongoUri: required('MONGO_URI', 'mongodb://127.0.0.1:27017/novaauditoria'),
  port: Number(required('PORT', 4000)),
  nodeEnv: required('NODE_ENV', 'development'),
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  jwtSecret: required('JWT_SECRET', 'dev-secret-change-me'),
  jwtExpires: required('JWT_EXPIRES', '7d'),
  uploadMaxMb: Number(required('UPLOAD_MAX_MB', 100)),
  // Reabrir no boot as sessões de WhatsApp já pareadas. Desligue numa segunda
  // instância que compartilhe a mesma pasta `sessions/`: dois sockets na mesma
  // sessão se derrubam em looping (erro 440).
  whatsappRestaurarSessoes:
    String(process.env.WHATSAPP_RESTAURAR_SESSOES ?? 'true').toLowerCase() !==
    'false',
  bootstrap: {
    email: process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@novaauditoria.local',
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD || 'admin123',
    name: process.env.BOOTSTRAP_ADMIN_NAME || 'Administrador',
  },
};
