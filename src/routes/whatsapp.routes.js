import { Router } from "express";
import { z } from "zod";

import {
  autenticar,
  escopoLoja,
  exigirEscopoLoja,
  exigirRole,
} from "../middlewares/auth.js";
import { uploadPaineis } from "../middlewares/upload.js";
import { ROLES } from "../models/Usuario.js";
import { Loja } from "../models/Loja.js";
import {
  WhatsappConexao,
  STATUS_CONEXAO,
  PERIODOS_CAPTURA,
} from "../models/WhatsappConexao.js";
import { WhatsappGrupo } from "../models/WhatsappGrupo.js";
import { asyncHandler, httpError } from "../utils/http.js";
import {
  garantirSessao,
  obterSessao,
  desconectarSessao,
  encerrarSessao,
} from "../services/whatsappManager.js";
import {
  compartilharPaineis,
  CHAVES_PAINEL,
} from "../services/whatsappCompartilhamento.js";

const router = Router();

router.use(autenticar);
// Conectar o WhatsApp da loja e escolher o grupo é decisão de administração;
// colaborador não mexe nisso.
router.use(exigirRole(ROLES.SUPER_ADMIN, ROLES.STORE_ADMIN));
router.use(escopoLoja);
router.use(exigirEscopoLoja);

async function fichaDaLoja(lojaId) {
  let conexao = await WhatsappConexao.findOne({ loja: lojaId });
  if (!conexao) {
    conexao = await WhatsappConexao.create({ loja: lojaId });
  }
  return conexao;
}

/**
 * O banco guarda o último status conhecido, mas quem sabe a verdade é o socket
 * vivo: depois de um restart a ficha ainda diz "connected" enquanto nenhuma
 * sessão subiu. Na dúvida, vale a memória.
 */
function projetarConexao(conexao, sessao) {
  const emMemoria = sessao?.getStatus() || null;
  const status = emMemoria ? emMemoria.status : STATUS_CONEXAO.DESCONECTADO;

  return {
    status,
    qrCode: status === STATUS_CONEXAO.CONECTANDO ? emMemoria?.qrCode || null : null,
    phoneNumber: emMemoria?.phoneNumber || conexao.phoneNumber || "",
    ultimaConexaoEm: conexao.ultimaConexaoEm || null,
    ultimoErro: conexao.ultimoErro || "",
    temSessaoSalva: !!sessao?.temSessaoSalva,
    compartilhamentoAuto: {
      ativo: !!conexao.compartilhamentoAuto?.ativo,
      grupos: conexao.compartilhamentoAuto?.grupos || [],
      periodoCaptura:
        conexao.compartilhamentoAuto?.periodoCaptura ||
        PERIODOS_CAPTURA.AUDITORIA,
      incluirDashboard: conexao.compartilhamentoAuto?.incluirDashboard !== false,
      incluirRanking: conexao.compartilhamentoAuto?.incluirRanking !== false,
      incluirRelatorioCorredor:
        !!conexao.compartilhamentoAuto?.incluirRelatorioCorredor,
      incluirRelatorioClasse:
        !!conexao.compartilhamentoAuto?.incluirRelatorioClasse,
      legenda: conexao.compartilhamentoAuto?.legenda || "",
    },
  };
}

// Situação atual da conexão da loja. A tela chama em laço curto enquanto o QR
// está na tela, então é de propósito uma consulta barata.
router.get(
  "/conexao",
  asyncHandler(async (req, res) => {
    const loja = await Loja.findById(req.escopoLojaId).select("nome").lean();
    if (!loja) throw httpError(404, "Loja não encontrada");

    const conexao = await fichaDaLoja(req.escopoLojaId);
    const sessao = obterSessao(req.escopoLojaId);

    res.json({
      loja: { _id: loja._id, nome: loja.nome },
      ...projetarConexao(conexao, sessao),
    });
  }),
);

router.post(
  "/conexao/conectar",
  asyncHandler(async (req, res) => {
    const loja = await Loja.findById(req.escopoLojaId).select("nome").lean();
    if (!loja) throw httpError(404, "Loja não encontrada");

    await fichaDaLoja(req.escopoLojaId);
    const forcarNovoQr = req.body?.novoPareamento === true;

    const sessao = await garantirSessao(req.escopoLojaId, { forcarNovoQr });

    res.json({
      mensagem:
        "Conexão iniciada. Leia o QR Code no WhatsApp do celular da loja.",
      ...sessao.getStatus(),
    });
  }),
);

router.post(
  "/conexao/desconectar",
  asyncHandler(async (req, res) => {
    await desconectarSessao(req.escopoLojaId);
    res.json({ ok: true, status: STATUS_CONEXAO.DESCONECTADO });
  }),
);

// Desvincular: derruba o pareamento no celular e apaga a sessão do disco.
router.post(
  "/conexao/desvincular",
  asyncHandler(async (req, res) => {
    await encerrarSessao(req.escopoLojaId);
    await WhatsappConexao.updateOne(
      { loja: req.escopoLojaId },
      { $set: { "compartilhamentoAuto.grupos": [] } },
    );
    res.json({ ok: true, status: STATUS_CONEXAO.DESCONECTADO });
  }),
);

router.get(
  "/grupos",
  asyncHandler(async (req, res) => {
    const items = await WhatsappGrupo.find({ loja: req.escopoLojaId })
      .sort({ nome: 1 })
      .lean();
    res.json({ items });
  }),
);

router.post(
  "/grupos/sincronizar",
  asyncHandler(async (req, res) => {
    const sessao = obterSessao(req.escopoLojaId);
    if (!sessao?.conectado) {
      throw httpError(409, "Conecte o WhatsApp da loja antes de listar grupos");
    }

    const total = await sessao.sincronizarGrupos();
    const items = await WhatsappGrupo.find({ loja: req.escopoLojaId })
      .sort({ nome: 1 })
      .lean();

    res.json({ total, items });
  }),
);

const configSchema = z
  .object({
    ativo: z.boolean().optional(),
    grupos: z
      .array(
        z.object({
          jid: z.string().min(1),
          nome: z.string().default(""),
        }),
      )
      .max(10)
      .optional(),
    periodoCaptura: z.enum(Object.values(PERIODOS_CAPTURA)).optional(),
    incluirDashboard: z.boolean().optional(),
    incluirRanking: z.boolean().optional(),
    incluirRelatorioCorredor: z.boolean().optional(),
    incluirRelatorioClasse: z.boolean().optional(),
    legenda: z.string().max(600).optional(),
  })
  .strict();

router.put(
  "/compartilhamento",
  asyncHandler(async (req, res) => {
    const payload = configSchema.parse(req.body || {});
    const conexao = await fichaDaLoja(req.escopoLojaId);

    if (payload.grupos) {
      // Só entra como destino um grupo que a sincronização realmente viu neste
      // número — assim ninguém digita um jid arbitrário e manda relatório da
      // loja para um grupo de fora.
      const conhecidos = await WhatsappGrupo.find({
        loja: req.escopoLojaId,
        jid: { $in: payload.grupos.map((g) => g.jid) },
      })
        .select("jid nome")
        .lean();

      const porJid = new Map(conhecidos.map((g) => [g.jid, g.nome]));
      const invalidos = payload.grupos.filter((g) => !porJid.has(g.jid));
      if (invalidos.length) {
        throw httpError(
          400,
          "Grupo desconhecido para este número. Sincronize a lista de grupos e escolha de novo.",
        );
      }

      conexao.compartilhamentoAuto.grupos = payload.grupos.map((g) => ({
        jid: g.jid,
        nome: porJid.get(g.jid) || g.nome || "",
      }));
    }

    for (const campo of [
      "ativo",
      "incluirDashboard",
      "incluirRanking",
      "incluirRelatorioCorredor",
      "incluirRelatorioClasse",
    ]) {
      if (typeof payload[campo] === "boolean") {
        conexao.compartilhamentoAuto[campo] = payload[campo];
      }
    }
    if (typeof payload.legenda === "string") {
      conexao.compartilhamentoAuto.legenda = payload.legenda;
    }
    if (payload.periodoCaptura) {
      conexao.compartilhamentoAuto.periodoCaptura = payload.periodoCaptura;
    }

    if (
      conexao.compartilhamentoAuto.ativo &&
      !conexao.compartilhamentoAuto.grupos.length
    ) {
      throw httpError(
        400,
        "Escolha ao menos um grupo para ligar o compartilhamento automático",
      );
    }

    await conexao.save();

    const sessao = obterSessao(req.escopoLojaId);
    res.json(projetarConexao(conexao, sessao));
  }),
);

const contextoSchema = z
  .object({
    tipo: z.string().optional(),
    data: z.string().optional(),
    taxaConformidade: z.coerce.number().optional(),
    totalLidos: z.coerce.number().optional(),
    auditoriaId: z.string().optional(),
    periodoCaptura: z.string().optional(),
  })
  .partial();

/**
 * Recebe os painéis já renderizados pelo navegador e manda para os grupos.
 *
 * Cada arquivo vem no campo com o nome do painel ("dashboard", "ranking",
 * "relatorio-corredor", "relatorio-classe"). Com `teste=true` o envio ignora o
 * liga/desliga do automático — é o botão "enviar agora" da tela de conexão.
 */
router.post(
  "/compartilhar",
  uploadPaineis.fields(CHAVES_PAINEL.map((name) => ({ name, maxCount: 1 }))),
  asyncHandler(async (req, res) => {
    const arquivos = req.files || {};
    const imagens = CHAVES_PAINEL.flatMap((chave) => {
      const arquivo = arquivos[chave]?.[0];
      return arquivo?.buffer?.length
        ? [{ chave, buffer: arquivo.buffer }]
        : [];
    });

    if (!imagens.length) throw httpError(400, "Nenhuma imagem recebida");

    let contexto = {};
    if (req.body?.contexto) {
      try {
        contexto = contextoSchema.parse(JSON.parse(req.body.contexto));
      } catch {
        throw httpError(400, "Contexto da auditoria inválido");
      }
    }

    const teste = req.body?.teste === "true" || req.body?.teste === true;

    const resultado = await compartilharPaineis({
      lojaId: req.escopoLojaId,
      imagens,
      contexto,
      ignorarFlags: teste,
    });

    res.json(resultado);
  }),
);

export default router;
