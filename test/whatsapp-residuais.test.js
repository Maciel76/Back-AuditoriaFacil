import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import router from "../src/routes/whatsapp.routes.js";
import { WhatsappConexao } from "../src/models/WhatsappConexao.js";
import { WhatsappGrupo } from "../src/models/WhatsappGrupo.js";
import { Loja } from "../src/models/Loja.js";
import { Usuario } from "../src/models/Usuario.js";
import { WhatsappLojaService } from "../src/services/whatsappService.js";
import { garantirSessao } from "../src/services/whatsappManager.js";
import { compartilharPaineis } from "../src/services/whatsappCompartilhamento.js";
import { assinarToken } from "../src/utils/jwt.js";
import { errorMiddleware } from "../src/utils/http.js";

test("WhatsApp: configuração, PDF de residuais, compatibilidade com imagens e falhas por grupo", async (t) => {
  const loja = "1234567890abcdef12345678";
  const grupo = { jid: "120000000000001@g.us", nome: "Grupo de teste" };
  const pdf = Buffer.from("%PDF-1.4\nDocumento de teste de transporte\n%%EOF");
  const enviados = [];
  const gravacoes = [];
  const filtros = [];
  let recusarDocumento = false;
  const conexao = new WhatsappConexao({ loja, compartilhamentoAuto: { ativo: true, grupos: [grupo], incluirDashboard: true, incluirRanking: false } });
  conexao.save = async () => conexao;
  t.mock.method(WhatsappConexao, "findOne", (filtro) => {
    filtros.push(filtro);
    const promise = Promise.resolve(conexao);
    promise.lean = async () => conexao.toObject();
    return promise;
  });
  t.mock.method(WhatsappConexao, "updateOne", async (_filtro, update) => { gravacoes.push(update); });
  t.mock.method(Usuario, "findById", async (id) => ({ ativo: true, role: id === "colaborador" ? "COLABORADOR" : "STORE_ADMIN", loja }));
  const query = (valor) => ({ select() { return this; }, lean: async () => valor });
  t.mock.method(Loja, "findById", () => query({ nome: "Loja de teste" }));
  t.mock.method(WhatsappGrupo, "find", () => query([grupo]));
  // Sessão de teste sem rede, credenciais ou grupos reais.
  t.mock.method(WhatsappLojaService.prototype, "initialize", async () => {});
  const sessao = await garantirSessao(loja);
  sessao.conectado = true;
  sessao.socket = { sendMessage: async (jid, mensagem) => {
    if (recusarDocumento && mensagem.document && jid === grupo.jid) throw new Error("Grupo recusou o PDF");
    enviados.push({ jid, mensagem });
  } };
  t.after(() => { sessao.conectado = false; sessao.socket = null; });
  const app = express(); app.use(express.json()); app.use("/whatsapp", router); app.use(errorMiddleware);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/whatsapp`;
  async function request(path, body, user = "admin") {
    return fetch(base + path, {
      method: body instanceof FormData ? "POST" : body ? "PUT" : "GET",
      headers: { authorization: `Bearer ${assinarToken({ sub: user })}`, ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
    });
  }
  function form(chave = "residuais", tipo = "application/pdf", buffer = pdf, nome = "residuais.pdf") {
    const fd = new FormData(); fd.append(chave, new Blob([buffer], { type: tipo }), nome);
    fd.append("contexto", JSON.stringify({ auditoriaId: "aaaaaaaaaaaaaaaaaaaaaaaa", residuaisAuditoriaId: "aaaaaaaaaaaaaaaaaaaaaaaa", data: "2026-11-16", tipo: "PRESENCA" }));
    return fd;
  }

  await t.test("opção começa desligada e pode ser salva isoladamente na própria loja", async () => {
    assert.equal(conexao.compartilhamentoAuto.incluirResiduais, false);
    const original = await (await request("/conexao")).json();
    assert.equal(original.compartilhamentoAuto.incluirResiduais, false);
    assert.equal((await request("/compartilhamento", { incluirResiduais: true }, "colaborador")).status, 403);
    const res = await request("/compartilhamento?lojaId=bbbbbbbbbbbbbbbbbbbbbbbb", { incluirResiduais: true });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).compartilhamentoAuto.incluirResiduais, true);
    assert.equal(conexao.compartilhamentoAuto.incluirDashboard, true);
    assert.equal(filtros.at(-1).loja, loja);
  });
  await t.test("envia somente PDF, com MIME de documento, nome e referência para reenvio", async () => {
    enviados.length = 0;
    const res = await request("/compartilhar", form());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.enviado, true); assert.equal(body.totalEnviados, 1);
    assert.equal(body.resultados[0].painel, "residuais");
    assert.equal(enviados[0].mensagem.mimetype, "application/pdf");
    assert.equal(enviados[0].mensagem.fileName, "residuais.pdf");
    assert.deepEqual(enviados[0].mensagem.document, pdf);
    assert.equal(enviados[0].mensagem.image, undefined);
    const ultimo = gravacoes.at(-1).$set.ultimoEnvio;
    assert.equal(ultimo.paineis[0].chave, "residuais");
    assert.equal(ultimo.contexto.residuaisAuditoriaId, "aaaaaaaaaaaaaaaaaaaaaaaa");
  });
  await t.test("recusa arquivo com MIME, extensão ou assinatura incorretos", async () => {
    for (const fd of [
      form("residuais", "image/png", pdf, "residuais.png"),
      form("residuais", "application/pdf", pdf, "residuais.exe"),
      form("residuais", "application/pdf", Buffer.from("arquivo falso")),
    ]) assert.equal((await request("/compartilhar", fd)).status, 400);
    assert.equal((await request("/compartilhar", new FormData())).status, 400);
  });
  await t.test("desligar PDF mantém o envio antigo de imagem", async () => {
    conexao.compartilhamentoAuto.incluirResiduais = false;
    enviados.length = 0;
    const result = await compartilharPaineis({ lojaId: loja, imagens: [
      { chave: "dashboard", buffer: Buffer.from("imagem simulada") },
      { chave: "residuais", buffer: pdf },
    ] });
    assert.equal(result.totalEnviados, 1);
    assert.ok(enviados[0].mensagem.image);
    assert.equal(enviados[0].mensagem.document, undefined);
  });
  await t.test("falha de um PDF não impede imagens nem entregas nos demais grupos", async () => {
    conexao.compartilhamentoAuto.incluirResiduais = true;
    conexao.compartilhamentoAuto.grupos.push({ jid: "120000000000002@g.us", nome: "Segundo grupo" });
    enviados.length = 0; recusarDocumento = true;
    const result = await compartilharPaineis({ lojaId: loja, imagens: [
      { chave: "residuais", buffer: pdf, nomeArquivo: "residuais-teste.pdf" },
      { chave: "dashboard", buffer: Buffer.from("imagem simulada") },
    ] });
    assert.equal(result.totalEnviados, 3); assert.equal(result.totalFalhas, 1);
    assert.equal(enviados.filter((item) => item.mensagem.image).length, 2);
    assert.equal(enviados.filter((item) => item.mensagem.document).length, 1);
    assert.equal(result.resultados.find((item) => !item.ok).painel, "residuais");
    recusarDocumento = false;
    conexao.compartilhamentoAuto.grupos.splice(1);
  });
  await t.test("teste manual permite PDF mesmo com automático desligado", async () => {
    conexao.compartilhamentoAuto.ativo = false;
    const fd = form(); fd.append("teste", "true");
    const result = await (await request("/compartilhar", fd)).json();
    assert.equal(result.enviado, true); assert.equal(result.totalEnviados, 1);
  });
  await t.test("documentos só podem ir para grupos e precisam de assinatura PDF", async () => {
    await assert.rejects(sessao.enviarDocumentoParaGrupo("5511999999999@s.whatsapp.net", pdf), /grupo/);
    await assert.rejects(sessao.enviarDocumentoParaGrupo(grupo.jid, Buffer.from("imagem")), /PDF inválido/);
    sessao.conectado = false;
    await assert.rejects(sessao.enviarDocumentoParaGrupo(grupo.jid, pdf), /não está conectado/);
    sessao.conectado = true;
  });
});
