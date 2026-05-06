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

export const uploadAvatar = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, avatarDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) return cb(null, true);
    cb(new Error("Apenas imagens são aceitas"));
  },
});
