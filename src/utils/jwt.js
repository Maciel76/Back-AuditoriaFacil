import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function assinarToken(payload) {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpires });
}

export function verificarToken(token) {
  return jwt.verify(token, env.jwtSecret);
}
