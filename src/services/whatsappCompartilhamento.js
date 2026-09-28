import dayjs from "dayjs";

import { WhatsappConexao } from "../models/WhatsappConexao.js";
import { Loja } from "../models/Loja.js";
import { obterSessaoConectada } from "./whatsappManager.js";

/**
 * Painéis que a loja pode mandar para o grupo, na ordem em que saem.
 *
 * A chave é o que o frontend manda junto de cada imagem; `flag` é o campo da
 * configuração que liga/desliga aquele painel.
 */
export const PAINEIS = Object.freeze([
  {
    chave: "dashboard",
    titulo: "Dashboard",
    flag: "incluirDashboard",
  },
  {
    chave: "ranking",
    titulo: "Ranking de colaboradores",
    flag: "incluirRanking",
  },
  {
    chave: "relatorio-corredor",
    titulo: "Relatório por corredor",
    flag: "incluirRelatorioCorredor",
  },
  {
    chave: "relatorio-classe",
    titulo: "Relatório por classe",
    flag: "incluirRelatorioClasse",
  },
]);

export const CHAVES_PAINEL = PAINEIS.map((p) => p.chave);

const LABEL_TIPO = {
  ETIQUETA: "Etiqueta",
  PRESENCA: "Presença",
  RUPTURA: "Ruptura",
};

const ROTULO_PERIODO = {
  hoje: "Hoje",
  semana: "Últimos 7 dias",
  mes: "Últimos 30 dias",
};

const LEGENDA_PADRAO =
  "*{loja}* — Auditoria de {tipo}\n" +
  "🗓️ {data}\n" +
  "✅ Conformidade: {taxa}\n" +
  "📦 Itens lidos: {itens}";

function formatarContexto(contexto = {}, nomeLoja = "") {
  const taxa =
    typeof contexto.taxaConformidade === "number"
      ? `${contexto.taxaConformidade.toFixed(1).replace(".", ",")}%`
      : "—";

  // Num recorte de semana/mes a data de uma auditoria so confundiria: o que
  // vale no cabecalho e o periodo que as imagens realmente mostram.
  const data = ROTULO_PERIODO[contexto.periodoCaptura]
    || (contexto.data
      ? dayjs(contexto.data).format("DD/MM/YYYY")
      : dayjs().format("DD/MM/YYYY"));

  return {
    loja: nomeLoja || "Loja",
    tipo: LABEL_TIPO[contexto.tipo] || contexto.tipo || "—",
    data,
    taxa,
    itens:
      typeof contexto.totalLidos === "number"
        ? contexto.totalLidos.toLocaleString("pt-BR")
        : "—",
  };
}

export function montarLegenda(template, contexto, nomeLoja) {
  const valores = formatarContexto(contexto, nomeLoja);
  const base = (template || "").trim() || LEGENDA_PADRAO;
  return base.replace(/\{(loja|tipo|data|taxa|itens)\}/g, (_, chave) =>
    String(valores[chave] ?? ""),
  );
}

/**
 * Manda as imagens da auditoria para os grupos configurados da loja.
 *
 * Não lança quando um grupo recusa a mensagem: um grupo que virou
 * "só admins" não pode impedir os outros de receberem, e o upload da planilha
 * já terminou — o relatório de falhas volta para a tela apenas como aviso.
 */
export async function compartilharPaineis({
  lojaId,
  imagens = [],
  contexto = {},
  gruposForcados = null,
  ignorarFlags = false,
}) {
  const conexao = await WhatsappConexao.findOne({ loja: lojaId }).lean();
  if (!conexao) {
    return { enviado: false, motivo: "WhatsApp não configurado para esta loja" };
  }

  const config = conexao.compartilhamentoAuto || {};
  if (!ignorarFlags && !config.ativo) {
    return { enviado: false, motivo: "Compartilhamento automático desligado" };
  }

  const grupos = (gruposForcados || config.grupos || []).filter((g) => g?.jid);
  if (!grupos.length) {
    return { enviado: false, motivo: "Nenhum grupo escolhido" };
  }

  const sessao = obterSessaoConectada(lojaId);
  if (!sessao) {
    return { enviado: false, motivo: "WhatsApp desta loja não está conectado" };
  }

  // Mantém a ordem de PAINEIS e descarta painel desligado ou desconhecido.
  const ordenadas = PAINEIS.flatMap((painel) => {
    if (!ignorarFlags && config[painel.flag] === false) return [];
    const imagem = imagens.find((img) => img.chave === painel.chave);
    if (!imagem?.buffer?.length) return [];
    return [{ ...painel, buffer: imagem.buffer }];
  });

  if (!ordenadas.length) {
    return { enviado: false, motivo: "Nenhuma imagem para enviar" };
  }

  const loja = await Loja.findById(lojaId).select("nome").lean();
  const legenda = montarLegenda(config.legenda, contexto, loja?.nome);

  const resultados = [];
  for (const grupo of grupos) {
    for (const [indice, painel] of ordenadas.entries()) {
      // Só a primeira imagem leva o cabeçalho completo; as seguintes levam o
      // nome do painel para o grupo saber o que está olhando.
      const textoImagem = indice === 0 ? legenda : `*${painel.titulo}*`;
      try {
        await sessao.enviarImagemParaGrupo(
          grupo.jid,
          painel.buffer,
          textoImagem,
        );
        resultados.push({
          grupo: grupo.nome || grupo.jid,
          painel: painel.chave,
          ok: true,
        });
      } catch (err) {
        console.warn(
          `[WA ${lojaId}] falha ao enviar "${painel.chave}" para ${grupo.jid}: ${err.message}`,
        );
        resultados.push({
          grupo: grupo.nome || grupo.jid,
          painel: painel.chave,
          ok: false,
          erro: err.message,
        });
      }
      // Rajada de imagens no mesmo grupo costuma ser barrada; um respiro curto
      // entre os envios mantém a sequência inteira chegando.
      await new Promise((r) => setTimeout(r, 900));
    }
  }

  const enviados = resultados.filter((r) => r.ok).length;

  // Anota o que foi mandado, para o botão de reenvio saber qual auditoria
  // refazer. Só metadado: nenhuma imagem fica no servidor. Falha aqui não
  // invalida um envio que já chegou ao grupo.
  if (enviados > 0) {
    await WhatsappConexao.updateOne(
      { loja: lojaId },
      {
        $set: {
          ultimoEnvio: {
            em: new Date(),
            contexto,
            paineis: ordenadas.map(({ chave, titulo }) => ({ chave, titulo })),
            grupos,
            totalEnviados: enviados,
          },
        },
      },
    ).catch((err) =>
      console.warn(
        `[WA ${lojaId}] não foi possível anotar o último envio: ${err.message}`,
      ),
    );
  }

  return {
    enviado: enviados > 0,
    totalEnviados: enviados,
    totalFalhas: resultados.length - enviados,
    resultados,
  };
}
