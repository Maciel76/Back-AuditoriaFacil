import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { ehResidual, classeExcluidaResidual, montarResiduais } from "../src/services/residuais.js";
import router from "../src/routes/residuais.routes.js";
import { Auditoria } from "../src/models/Auditoria.js";
import { AuditItem } from "../src/models/AuditItem.js";
import { Loja } from "../src/models/Loja.js";
import { Usuario } from "../src/models/Usuario.js";
import { assinarToken } from "../src/utils/jwt.js";
import { errorMiddleware } from "../src/utils/http.js";

const produto = (extra = {}) => ({ codigo: "000123", produto: "Arroz 1 kg", estoqueAtual: 9, diasSemVenda: 11, classeRaiz: "Mercearia", classe: "Alimentos", local: "G02", ...extra });

test("residuais: limites estritos e dados ausentes não se tornam estoque ou dias válidos", () => {
  assert.equal(ehResidual(produto()), true);
  assert.equal(ehResidual(produto({ estoqueAtual: 0.5, diasSemVenda: 10.5 })), true);
  for (const estoqueAtual of [0, -1, 10, 11, null, undefined, NaN, Infinity, "9", ""]) {
    assert.equal(ehResidual(produto({ estoqueAtual })), false, `estoque ${estoqueAtual}`);
  }
  for (const diasSemVenda of [0, 9, 10, -1, null, undefined, NaN, Infinity, "11", ""]) {
    assert.equal(ehResidual(produto({ diasSemVenda })), false, `dias ${diasSemVenda}`);
  }
  for (const codigo of [null, undefined, "", "  "]) assert.equal(ehResidual(produto({ codigo })), false);
  // Última compra não é última venda e não pode substituir o histórico ausente.
  assert.equal(ehResidual(produto({ diasSemVenda: null, ultimaCompraEm: new Date("2020-01-01") })), false);
});

test("residuais: exclui classes nos dois níveis, com variações de escrita", () => {
  for (const classe of ["BAZAR", "Bazares", "Cigarro", "Cigarros", "Whisky", "Whiskey", "Whiskies", "Wisker", "Wisky", "Vinho", "Vinhos", "BEBIDAS / VINHOS / TINTOS", "03 - CIGARROS NACIONAIS"]) {
    assert.equal(classeExcluidaResidual(produto({ classe })), true, classe);
    assert.equal(ehResidual(produto({ classeRaiz: classe })), false, classe);
  }
  assert.equal(ehResidual(produto({ classeRaiz: "MERCEARIA", classe: "Vinagre", produto: "Vinagre de vinho" })), true);
  assert.equal(ehResidual(produto({ classe: "Açúcar e café" })), true);
});

test("residuais: uma etiqueta por código preserva zeros e usa o registro mais recente antes do filtro", () => {
  const result = montarResiduais([
    produto({ codigo: "000001", estoqueAtual: 0 }),
    produto({ codigo: "000001", estoqueAtual: 4 }),
    produto({ codigo: "000123", estoqueAtual: 2.5, local: "G10" }),
    produto({ codigo: "000123", estoqueAtual: 8 }),
    produto({ codigo: " 000002 ", estoqueAtual: 3, local: "G2" }),
    produto({ codigo: "000003", cancelada: true }),
    produto({ codigo: "000004", diasSemVenda: null }),
    produto({ codigo: "000005", classe: "Vinhos" }),
  ]);
  assert.deepEqual(result.items.map((item) => item.codigo), ["000002", "000123"]);
  assert.equal(result.items[1].estoqueAtual, 2.5);
  assert.equal(result.resumo.totalAnalisados, 5);
  assert.equal(result.resumo.totalProdutos, 2);
  assert.equal(result.resumo.quantidadeEstoque, 5.5);
  assert.equal(result.resumo.semDados, 1);
  assert.deepEqual(montarResiduais([]).items, []);
});

test("API de residuais: autenticação, isolamento de loja e referência de auditoria", async (t) => {
  const loja = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const outraLoja = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const atualId = "cccccccccccccccccccccccc";
  const antigaId = "dddddddddddddddddddddddd";
  const inexistenteId = "eeeeeeeeeeeeeeeeeeeeeeee";
  let disponiveis = [{ _id: atualId, data: "2026-11-16T00:00:00Z", tipo: "ETIQUETA", arquivoOriginal: "Etiqueta.csv" }];
  const filtros = [];
  const consultasItens = [];
  const consultasDisponibilidade = [];
  const query = (valor) => ({ select() { return this; }, sort() { return this; }, limit() { return this; }, async lean() { return valor; } });
  t.mock.method(Usuario, "findById", async (id) => ({ ativo: true, loja, role: id === "super" ? "SUPER_ADMIN" : "STORE_ADMIN" }));
  t.mock.method(Loja, "findById", (id) => query([loja, outraLoja].includes(id) ? { _id: id, nome: "Loja Centro" } : null));
  t.mock.method(Auditoria, "find", (filtro) => {
    filtros.push(filtro);
    return query(filtro.loja === loja ? disponiveis : []);
  });
  t.mock.method(Auditoria, "findOne", (filtro) => {
    filtros.push(filtro);
    return query(filtro.loja === loja && filtro._id === antigaId ? { _id: antigaId, data: "2026-10-01T00:00:00Z", tipo: "PRESENCA" } : null);
  });
  t.mock.method(AuditItem, "find", (filtro) => {
    consultasItens.push(filtro);
    return query([produto(), produto({ codigo: "000124", estoqueAtual: 10 })]);
  });
  t.mock.method(AuditItem, "aggregate", async (pipeline) => {
    consultasDisponibilidade.push(pipeline);
    return [{ _id: atualId }];
  });
  const app = express();
  app.use("/residuais", router);
  app.use(errorMiddleware);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const request = (query = "", user = "admin") => fetch(`http://127.0.0.1:${server.address().port}/residuais${query}`, {
    headers: user ? { authorization: `Bearer ${assinarToken({ sub: user })}` } : {},
  });

  await t.test("exige login e valida os identificadores", async () => {
    assert.equal((await request("", "")).status, 401);
    assert.equal((await request("", "super")).status, 400);
    assert.equal((await request("?lojaId=invalida", "super")).status, 400);
    assert.equal((await request(`?lojaId=${inexistenteId}`, "super")).status, 404);
    for (const query of ["?auditoriaId=invalida", "?auditoriaId=", "?auditoriaId=abc&auditoriaId=def"]) assert.equal((await request(query)).status, 400);
  });
  await t.test("admin de loja não troca o escopo pela URL e recebe somente os elegíveis", async () => {
    const res = await request(`?lojaId=${outraLoja}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.auditoria._id, atualId);
    assert.deepEqual(body.items.map((item) => item.codigo), ["000123"]);
    assert.equal(body.resumo.quantidadeEstoque, 9);
    assert.equal(filtros.at(-1).loja, loja);
    assert.equal(filtros.at(-1).status, "CONCLUIDA");
    assert.deepEqual(filtros.at(-1).excluida, { $ne: true });
    assert.equal(consultasItens.at(-1).loja, loja);
    assert.equal(consultasItens.at(-1).auditoria, atualId);
    assert.deepEqual(consultasItens.at(-1).cancelada, { $ne: true });
    assert.equal(String(consultasDisponibilidade.at(-1)[0].$match.loja), loja);
    assert.deepEqual(consultasDisponibilidade.at(-1)[0].$match.estoqueAtual, { $type: "number" });
    assert.deepEqual(consultasDisponibilidade.at(-1)[0].$match.diasSemVenda, { $type: "number" });
  });
  await t.test("referência automática ignora planilha mais recente sem os campos necessários", async () => {
    const anterior = disponiveis;
    disponiveis = [{ _id: inexistenteId, data: "2026-11-17T00:00:00Z", tipo: "ETIQUETA" }, ...anterior];
    const body = await (await request()).json();
    assert.equal(body.auditoria._id, atualId);
    assert.equal(body.auditorias[0].temDadosResiduais, false);
    assert.equal(body.auditorias[1].temDadosResiduais, true);
    // A escolha manual continua possível, e não reaproveita os itens de outra auditoria.
    const manual = await (await request(`?auditoriaId=${inexistenteId}`)).json();
    assert.equal(manual.auditoria._id, inexistenteId);
    assert.equal(consultasItens.at(-1).auditoria, inexistenteId);
    disponiveis = anterior;
  });
  await t.test("aceita uma referência antiga e recusa auditoria de outra loja ou não concluída", async () => {
    const res = await request(`?auditoriaId=${antigaId}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.auditoria._id, antigaId);
    assert.equal(body.auditorias.at(-1)._id, antigaId);
    assert.equal(consultasItens.at(-1).auditoria, antigaId);
    assert.equal((await request(`?auditoriaId=${inexistenteId}`)).status, 404);
    assert.equal((await request(`?lojaId=${outraLoja}&auditoriaId=${antigaId}`, "super")).status, 404);
  });
  await t.test("sem auditoria concluída retorna lista vazia sem consultar itens históricos", async () => {
    disponiveis = [];
    const antes = consultasItens.length;
    const res = await request();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.auditoria, null);
    assert.deepEqual(body.items, []);
    assert.equal(body.resumo.totalProdutos, 0);
    assert.equal(consultasItens.length, antes);
  });
});
