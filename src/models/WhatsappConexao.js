import mongoose from "mongoose";

export const STATUS_CONEXAO = Object.freeze({
  DESCONECTADO: "disconnected",
  CONECTANDO: "connecting",
  CONECTADO: "connected",
});

/**
 * Uma conexão de WhatsApp por loja.
 *
 * A loja pareia o número dela pelo QR Code e escolhe em quais grupos as
 * imagens (dashboard, ranking e relatórios) devem cair automaticamente a cada
 * planilha nova. A sessão do Baileys em si mora em `backend/sessions/<lojaId>`;
 * aqui fica só a ficha que a tela consulta e a configuração do disparo.
 */
const GrupoDestinoSchema = new mongoose.Schema(
  {
    jid: { type: String, required: true, trim: true },
    nome: { type: String, default: "", trim: true },
  },
  { _id: false },
);

/**
 * Recorte de tempo usado nas imagens do compartilhamento automatico.
 *
 * O padrao continua sendo o dia da planilha que acabou de entrar, mas loja que
 * envia a planilha com atraso (ou que quer o acumulado) precisa escolher outro.
 */
export const PERIODOS_CAPTURA = Object.freeze({
  AUDITORIA: "auditoria",
  HOJE: "hoje",
  SEMANA: "semana",
  MES: "mes",
});

const WhatsappConexaoSchema = new mongoose.Schema(
  {
    loja: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Loja",
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(STATUS_CONEXAO),
      default: STATUS_CONEXAO.DESCONECTADO,
    },
    // Número (com DDI) da linha pareada nesta sessão. Preenchido quando a
    // conexão abre e limpo no logout.
    phoneNumber: { type: String, default: "", trim: true, maxlength: 32 },
    // Data URL do QR corrente — só vale enquanto o status é "connecting".
    qrCode: { type: String, default: null },
    ultimaConexaoEm: Date,
    ultimoErro: { type: String, default: "" },

    compartilhamentoAuto: {
      ativo: { type: Boolean, default: false },
      // Mais de um grupo é comum: o da loja e o da regional, por exemplo.
      grupos: { type: [GrupoDestinoSchema], default: [] },
      periodoCaptura: {
        type: String,
        enum: Object.values(PERIODOS_CAPTURA),
        default: PERIODOS_CAPTURA.AUDITORIA,
      },
      incluirDashboard: { type: Boolean, default: true },
      incluirRanking: { type: Boolean, default: true },
      incluirRelatorioCorredor: { type: Boolean, default: false },
      incluirRelatorioClasse: { type: Boolean, default: false },
      // Legenda da primeira imagem. Placeholders: {loja} {data} {tipo}
      // {taxa} {itens}. Vazio = usa o texto padrão do serviço.
      legenda: { type: String, default: "", maxlength: 600 },
    },

    /**
     * Ficha do último envio, para o botão de reenvio.
     *
     * Só metadado: que auditoria era, quais painéis saíram e para onde. As
     * imagens NÃO ficam no servidor — o reenvio manda o navegador gerá-las de
     * novo, do mesmo jeito que o envio automático faz.
     */
    ultimoEnvio: {
      em: Date,
      contexto: { type: mongoose.Schema.Types.Mixed, default: {} },
      paineis: {
        type: [{ _id: false, chave: String, titulo: String }],
        default: [],
      },
      grupos: { type: [GrupoDestinoSchema], default: [] },
      totalEnviados: { type: Number, default: 0 },
    },

    criadoPor: { type: mongoose.Schema.Types.ObjectId, ref: "Usuario" },
  },
  { timestamps: true },
);

export const WhatsappConexao = mongoose.model(
  "WhatsappConexao",
  WhatsappConexaoSchema,
);
