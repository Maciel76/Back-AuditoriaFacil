import { verificarToken } from '../utils/jwt.js';
import { Usuario, ROLES } from '../models/Usuario.js';
import { httpError } from '../utils/http.js';

export async function autenticar(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw httpError(401, 'Token ausente');
    const payload = verificarToken(token);
    const usuario = await Usuario.findById(payload.sub);
    if (!usuario || !usuario.ativo) throw httpError(401, 'Usuário inválido');
    req.usuario = usuario;
    req.lojaId = usuario.role === ROLES.SUPER_ADMIN ? null : usuario.loja?.toString() || null;
    next();
  } catch (e) {
    next(e.status ? e : httpError(401, 'Token inválido'));
  }
}

export const exigirRole = (...roles) => (req, _res, next) => {
  if (!req.usuario) return next(httpError(401, 'Não autenticado'));
  if (!roles.includes(req.usuario.role)) return next(httpError(403, 'Acesso negado'));
  next();
};

/**
 * Garante isolamento multi-tenant: super admin pode passar ?lojaId para escolher uma loja,
 * demais sempre operam na própria loja.
 */
export function escopoLoja(req, _res, next) {
  if (req.usuario.role === ROLES.SUPER_ADMIN) {
    req.escopoLojaId = req.query.lojaId || req.body?.lojaId || null;
  } else {
    req.escopoLojaId = req.usuario.loja?.toString() || null;
    if (!req.escopoLojaId) return next(httpError(403, 'Usuário sem loja vinculada'));
  }
  next();
}

export function exigirEscopoLoja(req, _res, next) {
  if (!req.escopoLojaId) return next(httpError(400, 'Loja não informada'));
  next();
}
