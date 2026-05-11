import { verificarToken } from "../utils/jwt.js";
import { Colaborador } from "../models/Colaborador.js";
import { httpError } from "../utils/http.js";

/**
 * Middleware para autenticar tokens emitidos para o portal do colaborador.
 * O payload JWT tem { sub, tipo: 'colaborador', loja }.
 */
export async function autenticarColaborador(req, _res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) throw httpError(401, "Token ausente");
    const payload = verificarToken(token);
    if (payload.tipo !== "colaborador")
      throw httpError(403, "Token não é de colaborador");
    const colab = await Colaborador.findById(payload.sub);
    if (!colab || !colab.ativo) throw httpError(401, "Colaborador inativo");
    req.colaborador = colab;
    req.escopoLojaId = colab.loja?.toString();
    next();
  } catch (e) {
    next(e.status ? e : httpError(401, "Token inválido"));
  }
}
