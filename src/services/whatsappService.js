import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidGroup,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import QRCode from "qrcode";
import pino from "pino";

import { WhatsappConexao, STATUS_CONEXAO } from "../models/WhatsappConexao.js";
import { WhatsappGrupo } from "../models/WhatsappGrupo.js";

const logger = pino({ level: "silent" });

/**
 * Código que o WhatsApp devolve quando outro socket assume a mesma sessão.
 *
 * Não é queda: é disputa. Reconectar na hora só faz os dois se derrubarem em
 * looping, então este caso tem espera própria, bem mais longa.
 */
const CONEXAO_TROCADA = 440;
const ESPERA_PATRULHA_MS = 2 * 60 * 1000;
const MAX_TROCAS = 10;

const BACKEND_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export const SESSOES_DIR = path.join(BACKEND_ROOT, "sessions");

/**
 * Conexão de WhatsApp de UMA loja, só para envio.
 *
 * É uma versão enxuta do serviço do painel de automação: aqui não existe
 * recebimento, bot nem histórico de conversa — o FlashHub só precisa parear o
 * número, listar os grupos e mandar imagem. Emite "qr", "status" e "grupos"
 * para a tela acompanhar por SSE.
 */
export class WhatsappLojaService extends EventEmitter {
  constructor(lojaId) {
    super();
    this.lojaId = String(lojaId);
    this.socket = null;
    this.qrCode = null;
    this.conectado = false;
    this.sessionPath = path.join(SESSOES_DIR, this.lojaId);
    this._inicializando = false;
    this._tentativas = 0;
    this._maxTentativas = 5;
    this._reconnectTimer = null;
    this._encerrandoDeProposito = false;
    // 440 = "connection replaced": outro socket assumiu esta mesma sessão
    // (segunda instância do backend, WhatsApp Web aberto no PC...). Tratado
    // à parte do erro comum, com patrulha lenta — ver `_tratarConexaoTrocada`.
    this._patrolTimer = null;
    this._trocas = 0;
  }

  get temSessaoSalva() {
    return fs.existsSync(path.join(this.sessionPath, "creds.json"));
  }

  async _salvarFicha(patch) {
    await WhatsappConexao.updateOne(
      { loja: this.lojaId },
      { $set: patch },
      { upsert: true },
    ).catch((err) =>
      console.warn(
        `[WA ${this.lojaId}] não foi possível gravar a ficha: ${err.message}`,
      ),
    );
  }

  async initialize() {
    if (this._inicializando) return true;
    this._inicializando = true;
    this._encerrandoDeProposito = false;

    try {
      fs.mkdirSync(this.sessionPath, { recursive: true });

      const { state, saveCreds } = await useMultiFileAuthState(
        this.sessionPath,
      );
      const { version } = await fetchLatestBaileysVersion();

      // Socket antigo precisa morrer por completo antes do novo subir, senão o
      // WhatsApp derruba os dois (erro 440, "connection replaced").
      if (this.socket) {
        try {
          this.socket.ev.removeAllListeners();
          this.socket.end();
        } catch {
          /* socket já estava morto */
        }
        this.socket = null;
        this.conectado = false;
        await new Promise((r) => setTimeout(r, 2000));
      }

      this.socket = makeWASocket({
        version,
        auth: state,
        logger,
        browser: ["FlashHub", "Chrome", "1.0.0"],
        defaultQueryTimeoutMs: 60_000,
        connectTimeoutMs: 60_000,
        qrTimeout: 60_000,
        syncFullHistory: false,
        markOnlineOnConnect: false,
        getMessage: async () => ({ conversation: "" }),
      });

      this.socket.ev.on("creds.update", saveCreds);

      this.socket.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            this.qrCode = await QRCode.toDataURL(qr);
            this.emit("qr", this.qrCode);
            // QR na mão significa que a tentativa está saudável: o erro da
            // tentativa anterior não pode continuar aparecendo na tela.
            await this._salvarFicha({
              status: STATUS_CONEXAO.CONECTANDO,
              qrCode: this.qrCode,
              ultimoErro: "",
            });
          } catch (err) {
            console.error(
              `[WA ${this.lojaId}] falha ao gerar QR: ${err.message}`,
            );
          }
        }

        if (connection === "open") {
          this.conectado = true;
          this.qrCode = null;
          this._inicializando = false;
          this._tentativas = 0;
          this._trocas = 0;
          this._pararPatrulha();

          const waJid = this.socket?.user?.id || "";
          const phoneNumber = waJid ? waJid.split(":")[0].split("@")[0] : "";

          console.log(
            `[WA ${this.lojaId}] conectado (${phoneNumber || "número desconhecido"})`,
          );

          await this._salvarFicha({
            status: STATUS_CONEXAO.CONECTADO,
            qrCode: null,
            phoneNumber,
            ultimaConexaoEm: new Date(),
            ultimoErro: "",
          });
          this.emit("status", STATUS_CONEXAO.CONECTADO);

          // A lista de grupos é o que a tela precisa logo depois do pareamento.
          this.sincronizarGrupos()
            .then((total) => this.emit("grupos", total))
            .catch(() => {});
        }

        if (connection === "close") {
          this.conectado = false;
          this._inicializando = false;

          const statusCode = new Boom(lastDisconnect?.error)?.output
            ?.statusCode;
          const deslogado = statusCode === DisconnectReason.loggedOut;

          if (this._encerrandoDeProposito) return;

          if (deslogado) {
            console.log(`[WA ${this.lojaId}] número deslogou`);
            this.limparSessaoLocal();
            await this._salvarFicha({
              status: STATUS_CONEXAO.DESCONECTADO,
              qrCode: null,
              phoneNumber: "",
            });
            await WhatsappGrupo.deleteMany({ loja: this.lojaId }).catch(
              () => {},
            );
            this.emit("status", STATUS_CONEXAO.DESCONECTADO);
            return;
          }

          if (statusCode === CONEXAO_TROCADA) {
            await this._tratarConexaoTrocada();
            return;
          }

          if (this._tentativas < this._maxTentativas) {
            this._tentativas++;
            const espera = Math.min(3000 * this._tentativas, 30_000);
            console.log(
              `[WA ${this.lojaId}] conexão caiu (${statusCode}). Nova tentativa em ${espera}ms (${this._tentativas}/${this._maxTentativas})`,
            );
            await this._salvarFicha({ status: STATUS_CONEXAO.CONECTANDO });
            this.emit("status", STATUS_CONEXAO.CONECTANDO);

            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = setTimeout(() => {
              this._reconnectTimer = null;
              this.initialize().catch((err) =>
                console.error(
                  `[WA ${this.lojaId}] falha ao reconectar: ${err.message}`,
                ),
              );
            }, espera);
            return;
          }

          console.log(`[WA ${this.lojaId}] desistindo de reconectar`);
          await this._salvarFicha({
            status: STATUS_CONEXAO.DESCONECTADO,
            qrCode: null,
            ultimoErro: `Conexão encerrada (código ${statusCode ?? "?"})`,
          });
          this.emit("status", STATUS_CONEXAO.DESCONECTADO);
        }
      });

      // Renomear grupo no celular precisa refletir na lista de destinos.
      this.socket.ev.on("groups.update", async (updates) => {
        for (const meta of updates || []) {
          if (!meta?.id || !meta.subject) continue;
          await WhatsappGrupo.updateOne(
            { loja: this.lojaId, jid: meta.id },
            { $set: { nome: String(meta.subject) } },
          ).catch(() => {});
        }
      });

      return true;
    } catch (err) {
      this._inicializando = false;
      console.error(`[WA ${this.lojaId}] erro ao inicializar: ${err.message}`);
      await this._salvarFicha({
        status: STATUS_CONEXAO.DESCONECTADO,
        qrCode: null,
        ultimoErro: err.message,
      });
      throw err;
    }
  }

  /**
   * Reage ao 440 sem entrar em cabo de guerra com o outro socket.
   *
   * O pareamento continua válido, então o status fica em "connecting" (e não
   * "disconnected", que faria a tela pedir um QR desnecessário) e a volta é
   * tentada de dois em dois minutos. Se nem assim voltar, é porque a outra
   * ponta veio para ficar — aí desiste e avisa.
   */
  async _tratarConexaoTrocada() {
    this._trocas++;

    if (this._trocas > MAX_TROCAS) {
      console.warn(
        `[WA ${this.lojaId}] outro aparelho/servidor assumiu esta sessão de vez. Desistindo.`,
      );
      this._pararPatrulha();
      await this._salvarFicha({
        status: STATUS_CONEXAO.DESCONECTADO,
        qrCode: null,
        ultimoErro:
          "Outro aparelho ou servidor assumiu esta sessão do WhatsApp. Conecte de novo.",
      });
      this.emit("status", STATUS_CONEXAO.DESCONECTADO);
      return;
    }

    console.log(
      `[WA ${this.lojaId}] sessão assumida por outro socket (${this._trocas}/${MAX_TROCAS}). Nova tentativa em ${ESPERA_PATRULHA_MS / 1000}s.`,
    );
    await this._salvarFicha({ status: STATUS_CONEXAO.CONECTANDO });
    this.emit("status", STATUS_CONEXAO.CONECTANDO);

    this._pararPatrulha();
    this._patrolTimer = setTimeout(() => {
      this._patrolTimer = null;
      this.initialize().catch((err) =>
        console.error(`[WA ${this.lojaId}] patrulha falhou: ${err.message}`),
      );
    }, ESPERA_PATRULHA_MS);
    this._patrolTimer.unref?.();
  }

  _pararPatrulha() {
    if (this._patrolTimer) clearTimeout(this._patrolTimer);
    this._patrolTimer = null;
  }

  /**
   * Relê no WhatsApp os grupos em que o número participa e regrava a lista.
   *
   * Grupos que sumiram do celular precisam sumir da tela também, então a lista
   * é substituída (e não só acrescentada) a cada sincronização.
   */
  async sincronizarGrupos() {
    if (!this.socket || !this.conectado) return 0;

    const todos = await Promise.race([
      this.socket.groupFetchAllParticipating(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("tempo esgotado")), 15_000),
      ),
    ]);

    // O Baileys pode identificar o próprio número por telefone OU por LID,
    // dependendo da versão do app pareado — vale comparar com os dois.
    const meusIds = [this.socket?.user?.id, this.socket?.user?.lid]
      .filter(Boolean)
      .map((id) => String(id).split(":")[0].split("@")[0]);
    const lista = Object.values(todos || {}).filter((meta) => meta?.id);

    if (lista.length) {
      await WhatsappGrupo.bulkWrite(
        lista.map((meta) => {
          const eu = (meta.participants || []).find((p) => {
            const id = String(p?.id || "").split("@")[0];
            return meusIds.some((meu) => id === meu || id.startsWith(meu));
          });
          return {
            updateOne: {
              filter: { loja: this.lojaId, jid: meta.id },
              update: {
                $set: {
                  nome: String(meta.subject || "Grupo sem nome"),
                  participantes: Array.isArray(meta.participants)
                    ? meta.participants.length
                    : 0,
                  somenteAdmins: !!meta.announce,
                  souAdmin: !!eu?.admin,
                  sincronizadoEm: new Date(),
                },
              },
              upsert: true,
            },
          };
        }),
        { ordered: false },
      );
    }

    const jids = lista.map((meta) => meta.id);
    await WhatsappGrupo.deleteMany({
      loja: this.lojaId,
      jid: { $nin: jids },
    }).catch(() => {});

    console.log(`[WA ${this.lojaId}] ${lista.length} grupo(s) sincronizado(s)`);
    return lista.length;
  }

  /**
   * Manda uma imagem (buffer PNG/JPEG) para um grupo.
   *
   * Aceita só jid de grupo — o compartilhamento automático nunca dispara para
   * número pessoal, e deixar isso explícito evita mandar relatório da loja
   * para um cliente por engano de configuração.
   */
  async enviarImagemParaGrupo(jid, buffer, legenda = "") {
    if (!this.socket || !this.conectado) {
      throw new Error("WhatsApp desta loja não está conectado");
    }
    if (!isJidGroup(jid)) {
      throw new Error(`"${jid}" não é um grupo do WhatsApp`);
    }
    if (!Buffer.isBuffer(buffer) || !buffer.length) {
      throw new Error("Imagem vazia");
    }

    await this.socket.sendMessage(jid, {
      image: buffer,
      caption: legenda || undefined,
    });
  }

  async enviarTextoParaGrupo(jid, texto) {
    if (!this.socket || !this.conectado) {
      throw new Error("WhatsApp desta loja não está conectado");
    }
    if (!isJidGroup(jid)) {
      throw new Error(`"${jid}" não é um grupo do WhatsApp`);
    }
    await this.socket.sendMessage(jid, { text: String(texto || "") });
  }

  limparSessaoLocal() {
    if (fs.existsSync(this.sessionPath)) {
      fs.rmSync(this.sessionPath, { recursive: true, force: true });
    }
  }

  /** Fecha o socket sem derrubar o pareamento (dá para reconectar sem QR). */
  async disconnect() {
    this._encerrandoDeProposito = true;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
    this._pararPatrulha();
    try {
      this.socket?.ev?.removeAllListeners();
      this.socket?.end();
    } catch {
      /* já estava fechado */
    }
    this.socket = null;
    this.conectado = false;
    this.qrCode = null;
    await this._salvarFicha({
      status: STATUS_CONEXAO.DESCONECTADO,
      qrCode: null,
    });
    this.emit("status", STATUS_CONEXAO.DESCONECTADO);
  }

  /** Desfaz o pareamento no celular e apaga a sessão — exige QR de novo. */
  async logout() {
    this._encerrandoDeProposito = true;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
    this._pararPatrulha();
    try {
      await this.socket?.logout();
    } catch {
      /* o aparelho pode já ter removido o dispositivo */
    }
    try {
      this.socket?.ev?.removeAllListeners();
      this.socket?.end();
    } catch {
      /* já estava fechado */
    }
    this.socket = null;
    this.conectado = false;
    this.qrCode = null;
    this.limparSessaoLocal();
    await this._salvarFicha({
      status: STATUS_CONEXAO.DESCONECTADO,
      qrCode: null,
      phoneNumber: "",
    });
    await WhatsappGrupo.deleteMany({ loja: this.lojaId }).catch(() => {});
    this.emit("status", STATUS_CONEXAO.DESCONECTADO);
  }

  getStatus() {
    return {
      lojaId: this.lojaId,
      status: this.conectado
        ? STATUS_CONEXAO.CONECTADO
        : this._inicializando || this.qrCode
          ? STATUS_CONEXAO.CONECTANDO
          : STATUS_CONEXAO.DESCONECTADO,
      qrCode: this.qrCode,
      phoneNumber: this.socket?.user?.id?.split(":")[0]?.split("@")[0] || "",
    };
  }
}
