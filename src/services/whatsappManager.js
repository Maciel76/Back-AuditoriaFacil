import fs from "node:fs";
import path from "node:path";

import {
  WhatsappLojaService,
  SESSOES_DIR,
} from "./whatsappService.js";
import { WhatsappConexao, STATUS_CONEXAO } from "../models/WhatsappConexao.js";

/**
 * Sessões vivas em memória, uma por loja (chave = lojaId em string).
 *
 * O socket do Baileys não sobrevive a um restart do processo, mas as
 * credenciais em `backend/sessions/<lojaId>` sim — por isso o boot reabre
 * sozinho tudo que já estava pareado, senão a loja teria que ler o QR de novo
 * a cada deploy.
 */
const sessoes = new Map();

export function obterSessao(lojaId) {
  return sessoes.get(String(lojaId)) || null;
}

export function obterSessaoConectada(lojaId) {
  const sessao = obterSessao(lojaId);
  return sessao?.conectado ? sessao : null;
}

/**
 * Devolve a sessão da loja, criando (e inicializando) se ainda não existir.
 * `forcarNovoQr` derruba a sessão atual e começa um pareamento do zero.
 */
export async function garantirSessao(lojaId, { forcarNovoQr = false } = {}) {
  const chave = String(lojaId);
  let sessao = sessoes.get(chave);

  if (sessao && forcarNovoQr) {
    await sessao.disconnect().catch(() => {});
    sessao.limparSessaoLocal();
    sessoes.delete(chave);
    sessao = null;
  }

  if (!sessao) {
    sessao = new WhatsappLojaService(chave);
    sessoes.set(chave, sessao);
    await sessao.initialize();
    return sessao;
  }

  // Sessão existe mas o socket morreu (queda, restart parcial): reabre.
  if (!sessao.conectado && !sessao.socket) {
    await sessao.initialize();
  }

  return sessao;
}

export async function desconectarSessao(lojaId) {
  const chave = String(lojaId);
  const sessao = sessoes.get(chave);
  if (!sessao) {
    await WhatsappConexao.updateOne(
      { loja: chave },
      { $set: { status: STATUS_CONEXAO.DESCONECTADO, qrCode: null } },
    ).catch(() => {});
    return;
  }
  await sessao.disconnect();
  sessoes.delete(chave);
}

export async function encerrarSessao(lojaId) {
  const chave = String(lojaId);
  const sessao = sessoes.get(chave);
  if (sessao) {
    await sessao.logout();
    sessoes.delete(chave);
    return;
  }

  // Sem sessão viva ainda dá para limpar o que ficou em disco e no banco.
  const dir = path.join(SESSOES_DIR, chave);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  await WhatsappConexao.updateOne(
    { loja: chave },
    {
      $set: {
        status: STATUS_CONEXAO.DESCONECTADO,
        qrCode: null,
        phoneNumber: "",
      },
    },
  ).catch(() => {});
}

/**
 * Reabre no boot as sessões que já tinham credenciais salvas.
 *
 * Nunca lança: uma loja com sessão corrompida não pode impedir a API de subir.
 */
export async function restaurarSessoes() {
  if (!fs.existsSync(SESSOES_DIR)) return 0;

  const pastas = fs
    .readdirSync(SESSOES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((nome) =>
      fs.existsSync(path.join(SESSOES_DIR, nome, "creds.json")),
    );

  let restauradas = 0;
  for (const lojaId of pastas) {
    try {
      const sessao = new WhatsappLojaService(lojaId);
      sessoes.set(lojaId, sessao);
      await sessao.initialize();
      restauradas++;
    } catch (err) {
      console.warn(
        `[WA] não foi possível restaurar a sessão da loja ${lojaId}: ${err.message}`,
      );
    }
  }

  if (restauradas) {
    console.log(`[WA] ${restauradas} sessão(ões) restaurada(s) no boot`);
  }
  return restauradas;
}

export function statusEmMemoria(lojaId) {
  return obterSessao(lojaId)?.getStatus() || null;
}
