import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import mongoose from "mongoose";
import { resumirMetasLojas, carregarMetasLojas } from "../src/services/metasLojas.js";
import { MetricaDiaria } from "../src/models/MetricaDiaria.js";
import { Auditoria } from "../src/models/Auditoria.js";
import { AuditItem } from "../src/models/AuditItem.js";
import { Colaborador } from "../src/models/Colaborador.js";
import { Loja } from "../src/models/Loja.js";
import { Usuario } from "../src/models/Usuario.js";
import { SystemConfig } from "../src/models/SystemConfig.js";
import router from "../src/routes/metricas.routes.js";
import { assinarToken } from "../src/utils/jwt.js";
import { errorMiddleware } from "../src/utils/http.js";

const lojaId = "507f1f77bcf86cd799439011";
const outraLoja = "507f1f77bcf86cd799439012";
const data = (dia) => new Date(`${dia}T00:00:00.000Z`);
const periodo = { inicio: data("2026-11-01"), fim: new Date("2026-11-30T23:59:59.999Z") };
const linha = (dia, totalLidos, base = 100, extra = {}) => ({
  loja: lojaId, tipo: "ETIQUETA", data: data(dia), totalLidos, totalItensAuditaveis: base, ...extra,
});
const presenca = (dia, presentes, restantes, extra = {}) => linha(dia, presentes + restantes, 100, {
  tipo: "PRESENCA",
  situacoes: { "Com Presença e com Estoque": presentes, "Sem Presença e Com Estoque": restantes },
  ...extra,
});
const ruptura = (dia, restantes, extra = {}) => linha(dia, 1, 1, {
  tipo: "RUPTURA", situacoes: { "Sem Presença e Com Estoque": restantes }, ...extra,
});
const resumo = (linhas, opcoes = {}) => resumirMetasLojas(linhas, { ...periodo, ...opcoes }).get(lojaId);
const query = (valor) => ({ sort() { return this; }, select() { return this; }, limit() { return this; }, async lean() { return valor; } });

test("conta cada auditoria, sem usar a média do período nem duplicar um reenvio", () => {
  const auditoria = linha("2026-11-02", 99);
  const resultado = resumo([auditoria, { ...auditoria }, linha("2026-11-03", 0, 10000)]);
  assert.equal(resultado.batidas, 1);
  assert.equal(resultado.avaliadas, 2);
  assert.deepEqual(resultado.porTipo.ETIQUETA, { batidas: 1, avaliadas: 2, semBase: 0 });
});

test("limite é estrito e aplicado antes do arredondamento", () => {
  const resultado = resumo([
    linha("2026-11-02", 100), linha("2026-11-03", 99), linha("2026-11-04", 98),
    linha("2026-11-05", 97999, 100000), linha("2026-11-06", 98001, 100000),
  ]);
  assert.equal(resultado.batidas, 3);
  assert.equal(resultado.avaliadas, 5);
  assert.equal(resultado.limiteConclusao, 98);
  assert.equal(resumo([linha("2026-11-02", 96)], { limiteRestante: 5 }).batidas, 1);
  assert.equal(resumo([linha("2026-11-02", 98)], { limiteRestante: 0 }).batidas, 0);
});

test("presença usa somente os produtos com estoque; leitura de 100% não implica meta batida", () => {
  const a = presenca("2026-11-03", 80, 20);
  a.situacoes["Com Presença e sem Estoque"] = 10000;
  const resultado = resumo([a, presenca("2026-11-10", 99, 1)]);
  assert.equal(resultado.avaliadas, 2);
  assert.equal(resultado.batidas, 1);
  assert.equal(resultado.porTipo.PRESENCA.batidas, 1);
});

test("ruptura consulta presença anterior da mesma loja, mesmo fora do período selecionado", () => {
  const resultado = resumo([
    presenca("2026-11-03", 90, 10), ruptura("2026-11-04", 1),
    presenca("2026-11-03", 10000, 0, { loja: outraLoja }),
  ], { inicio: data("2026-11-04"), fim: data("2026-11-04"), tipo: "RUPTURA" });
  assert.equal(resultado.avaliadas, 1);
  assert.equal(resultado.batidas, 1);
  assert.equal(resultado.porTipo.PRESENCA.avaliadas, 0);
});

test("ruptura sem referência, com referência cancelada ou de outra semana não ganha meta", () => {
  const resultado = resumo([
    presenca("2026-11-01", 100, 0), ruptura("2026-11-02", 0),
    presenca("2026-11-03", 100, 0, { cancelada: true }), ruptura("2026-11-04", 0),
    presenca("2026-11-10", 100, 0, { loja: outraLoja }), ruptura("2026-11-11", 0),
  ], { tipo: "RUPTURA", lojaIds: [lojaId] });
  assert.equal(resultado.avaliadas, 0);
  assert.equal(resultado.semBase, 3);
  assert.equal(resultado.batidas, 0);
});

test("ignora canceladas, excluídas, erros, outros filtros; base vazia não atinge meta", () => {
  const resultado = resumo([
    linha("2026-11-02", 100, 100, { cancelada: true }),
    linha("2026-11-03", 100, 100, { excluida: true }),
    linha("2026-11-04", 100, 100, { status: "ERRO" }),
    linha("2026-11-05", 100, 100, { status: "PROCESSANDO" }),
    linha("2026-11-06", 0, 0),
    linha("2026-10-31", 100), linha("2026-11-07", 100, 100, { loja: outraLoja }),
    presenca("2026-11-10", 100, 0),
  ], { tipo: "ETIQUETA", lojaIds: [lojaId] });
  assert.equal(resultado.avaliadas, 0);
  assert.equal(resultado.semBase, 1);
  assert.equal(resultado.batidas, 0);
  assert.equal(resumirMetasLojas([], { ...periodo, lojaIds: [lojaId] }).get(lojaId).batidas, 0);
});

test("consulta restringe lojas e métricas globais e exige auditoria concluída não excluída", async (t) => {
  const pipelines = [];
  t.mock.method(MetricaDiaria, "aggregate", async (pipeline) => { pipelines.push(pipeline); return [linha("2026-11-02", 96)]; });
  t.mock.method(SystemConfig, "findOne", () => query({ metaPercentualRestante: 5 }));
  const ids = [new mongoose.Types.ObjectId(lojaId)];
  const resultado = await carregarMetasLojas({ lojaIds: ids, ...periodo, tipo: "ETIQUETA" });
  assert.equal(resultado.get(lojaId).batidas, 1);
  const match = pipelines[0][0].$match;
  assert.deepEqual(match.loja.$in, ids);
  assert.equal(match.colaborador, null);
  assert.equal(match.tipo, "ETIQUETA");
  assert.deepEqual(match.cancelada, { $ne: true });
  const lookup = pipelines[0].find((p) => p.$lookup).$lookup;
  assert.equal(lookup.pipeline[0].$match.status, "CONCLUIDA");
  assert.deepEqual(lookup.pipeline[0].$match.excluida, { $ne: true });
  await carregarMetasLojas({ lojaIds: ids, ...periodo, tipo: "RUPTURA" });
  const referencia = pipelines[1][0].$match.$or[1];
  assert.equal(referencia.tipo, "PRESENCA");
  assert.equal(referencia.data.$gte.toISOString(), "2026-10-31T00:00:00.000Z");
  assert.equal((await carregarMetasLojas({ lojaIds: [], ...periodo })).size, 0);
});

test("API fornece contagem no ranking geral, por tipo, ruptura continuada e perfil", async (t) => {
  const lojas = [{ _id: lojaId, nome: "Centro", nivel: 1 }, { _id: outraLoja, nome: "Norte", nivel: 1 }];
  const metricas = [linha("2026-11-02", 99), linha("2026-11-05", 98), presenca("2026-11-03", 99, 1), ruptura("2026-11-04", 1)];
  const consultasMetas = [];
  t.mock.method(Usuario, "findById", async () => ({ ativo: true, role: "SUPER_ADMIN" }));
  t.mock.method(MetricaDiaria, "findOne", () => query({ data: data("2026-11-05") }));
  t.mock.method(MetricaDiaria, "aggregate", async (pipeline) => {
    if (pipeline.some((p) => p.$lookup?.as === "auditoria")) { consultasMetas.push(pipeline); return metricas; }
    if (pipeline.some((p) => p.$lookup?.as === "loja")) return lojas.map((loja) => ({ ...loja, pontuacao: 1 }));
    if (pipeline[0].$match.tipo === "RUPTURA") return [{ _id: { loja: lojaId, dia: "2026-11-04" }, totalLidos: 1, totalItensAuditaveis: 1, semPresencaComEstoque: 1 }];
    if (pipeline[0].$match.tipo === "PRESENCA") return [{ _id: { loja: lojaId, dia: "2026-11-03" }, presencaComEstoque: 99, semPresencaComEstoque: 1 }];
    return [];
  });
  t.mock.method(SystemConfig, "findOne", () => query(null));
  t.mock.method(AuditItem, "findOne", () => query({ data: data("2026-11-05") }));
  t.mock.method(AuditItem, "aggregate", async () => []);
  t.mock.method(Loja, "findById", () => query(lojas[0]));
  t.mock.method(Loja, "find", () => query(lojas));
  t.mock.method(Colaborador, "countDocuments", async () => 0);
  t.mock.method(Auditoria, "countDocuments", async () => 0);
  t.mock.method(Auditoria, "find", () => query([]));
  const app = express(); app.use("/metricas", router); app.use(errorMiddleware);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/metricas`;
  assert.equal((await fetch(`${url}/ranking/lojas`)).status, 401);
  const headers = { authorization: `Bearer ${assinarToken({ sub: "admin" })}` };
  const filtro = "periodo=custom&dataInicio=2026-11-01&dataFim=2026-11-30";
  for (const [tipo, esperado] of [["", 3], ["ETIQUETA", 1], ["RUPTURA", 1]]) {
    const res = await fetch(`${url}/ranking/lojas?${filtro}&tipo=${tipo}`, { headers });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.items.find((item) => item._id === lojaId).metas.batidas, esperado);
    if (!tipo) assert.equal(body.items.find((item) => item._id === outraLoja).metas.batidas, 0);
  }
  const perfil = await fetch(`${url}/lojas/${lojaId}/perfil?${filtro}`, { headers });
  assert.equal(perfil.status, 200);
  const body = await perfil.json();
  assert.equal(body.metas.batidas, 3);
  assert.equal(body.metas.avaliadas, 4);
  assert.equal(body.metas.porTipo.RUPTURA.batidas, 1);
  assert.equal(consultasMetas.length, 4);
});
