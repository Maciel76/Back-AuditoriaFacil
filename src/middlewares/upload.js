import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { env } from "../config/env.js";

// ============ Upload de planilhas (memoryStorage) ============
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.uploadMaxMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      /\.(xlsx|xlsm|xlsb|xls|csv|ods)$/i.test(file.originalname) ||
      /spreadsheet|excel|csv|officedocument/.test(file.mimetype || "");
    if (!ok) return cb(new Error("Formato de arquivo não suportado"));
    cb(null, true);
  },
});

// ============ Upload de avatares (diskStorage) ============
const avatarDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "uploads",
  "avatares",
);
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);
const AVATAR_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);

export const uploadAvatar = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, avatarDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const mimeType = (file.mimetype || "").toLowerCase();
    const ext = path.extname(file.originalname || "").toLowerCase();
    const mimeValido = AVATAR_MIME_TYPES.has(mimeType);
    const extensaoValida = AVATAR_EXTENSIONS.has(ext);

    if (mimeValido && extensaoValida) return cb(null, true);
    cb(new Error("Apenas imagens JPG, PNG, WEBP, GIF ou AVIF até 5 MB são aceitas"));
  },
});

// ============ Upload de imagens de conquistas (diskStorage) ============
const conquistaDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "uploads",
  "conquistas",
);
if (!fs.existsSync(conquistaDir)) fs.mkdirSync(conquistaDir, { recursive: true });

const CONQUISTA_MAX_BYTES = 3 * 1024 * 1024;

export const uploadConquistaImagem = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, conquistaDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".png";
      const codigo = String(req.body?.codigo || "conq")
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .slice(0, 40);
      const nivel = String(req.body?.nivel || "tier")
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .slice(0, 20);
      cb(null, `${codigo}-${nivel}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: CONQUISTA_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const mimeType = (file.mimetype || "").toLowerCase();
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (AVATAR_MIME_TYPES.has(mimeType) && AVATAR_EXTENSIONS.has(ext)) return cb(null, true);
    cb(new Error("Apenas imagens JPG, PNG, WEBP, GIF ou AVIF até 3 MB são aceitas"));
  },
});
