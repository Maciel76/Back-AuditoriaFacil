import test from "node:test";
import assert from "node:assert/strict";
import { faixaDesempenho, resumirDesempenhoCorredores } from "../src/services/desempenhoCorredores.js";
import express from "express";
import { once } from "node:events";
import router from "../src/routes/metricas.routes.js";
import { Usuario } from "../src/models/Usuario.js";
import { AuditItem } from "../src/models/AuditItem.js";
import { Colaborador } from "../src/models/Colaborador.js";
import { Loja } from "../src/models/Loja.js";
import { SystemConfig } from "../src/models/SystemConfig.js";
import { assinarToken } from "../src/utils/jwt.js";
import { errorMiddleware } from "../src/utils/http.js";

const linha = (situacao, total, extra = {}) => ({ _id: { auditoria: "a1", loja: "l1", data: "2026-10-26T00:00:00Z", tipo: "ETIQUETA", local: "G01", colaborador: "p1", nome: "Ana", codigo: "1", situacao, ...extra }, total });
test("inclui itens sem colaborador na base e compartilha o resultado, sem misturar auditorias ou lojas", () => {
  const items = resumirDesempenhoCorredores([
    linha("Atualizado", 49), linha("Atualizado", 49, { colaborador: "p2", nome: "Bia" }),
    linha("Não lidos com estoque", 2, { colaborador: null, nome: "", codigo: "" }),
    linha("Atualizado", 50, { auditoria: "a2", data: "2026-10-27T00:00:00Z" }),
    linha("Não lidos com estoque", 50, { auditoria: "a2", colaborador: null, nome: "", codigo: "" }),
    linha("Atualizado", 1, { auditoria: "a3", loja: "l2", colaborador: "p3", nome: "Caio" }),
  ]);
  const ana = items.find((p) => p.id === "p1");
  assert.equal(ana.verde, 1); assert.equal(ana.vermelho, 1);
  assert.equal(ana.percentualMeta, 50); assert.equal(ana.taxa, 74);
  assert.equal(ana.totalAuditorias, 2); assert.equal(ana.totalCorredores, 1);
  const compartilhado = ana.historico.find((h) => h.auditoriaId === "a1");
  assert.equal(compartilhado.taxa, 98); assert.equal(compartilhado.minhaLeitura, 49);
  assert.equal(compartilhado.participacao, 50); assert.equal(compartilhado.participantes, 2);
  assert.equal(items.find((p) => p.id === "p2").percentualMeta, 100);
  assert.equal(items.length, 3);
});
test("presença usa conformes sobre lidos; não confunde cobertura com conformidade", () => {
  const [p] = resumirDesempenhoCorredores([linha("Com Presença e com Estoque", 80, { tipo: "PRESENCA" }), linha("Sem Presença e Com Estoque", 20, { tipo: "PRESENCA" }), linha("Sem Presença e Sem Estoque", 100, { tipo: "PRESENCA" })]);
  assert.equal(p.taxa, 80); assert.equal(p.amarelo, 1); assert.equal(p.totalLidos, 100);
});
test("ruptura usa a presença anterior da mesma loja e corredor, sem base não entra na avaliação", () => {
  const ref = [{ _id: { loja: "l1", local: "G01", data: "2026-10-27T00:00:00Z" }, total: 100 }, { _id: { loja: "l2", local: "G01", data: "2026-10-27T00:00:00Z" }, total: 1000 }];
  const [p] = resumirDesempenhoCorredores([
    linha("Sem Presença e Com Estoque", 2, { tipo: "RUPTURA", data: "2026-10-28T00:00:00Z" }),
    linha("Sem Presença e Com Estoque", 3, { tipo: "RUPTURA", auditoria: "a2", data: "2026-10-29T00:00:00Z" }),
  ], ref);
  assert.equal(p.verde, 1); assert.equal(p["sem-base"], 1);
  assert.equal(p.taxa, 98); assert.equal(p.percentualMeta, 100); assert.equal(p.avaliados, 1);
  const [segunda] = resumirDesempenhoCorredores([linha("Sem Presença e Com Estoque", 1, { tipo: "RUPTURA" })], [{ _id: { loja: "l1", local: "G01", data: "2026-10-25T00:00:00Z" }, total: 100 }]);
  assert.equal(segunda.taxa, null); assert.equal(segunda.percentualMeta, null);
});
test("limites respeitam meta configurada e não arredondam um resultado abaixo da meta para verde", () => {
  assert.equal(faixaDesempenho(98), "verde"); assert.equal(faixaDesempenho(97.999), "amarelo");
  assert.equal(faixaDesempenho(80), "amarelo"); assert.equal(faixaDesempenho(79.99), "vermelho");
  assert.equal(faixaDesempenho(null), "sem-base"); assert.equal(faixaDesempenho(95, 95), "verde");
  assert.deepEqual(resumirDesempenhoCorredores([]), []);
});
test("identidade sem cadastro usa matrícula e loja; não cria participante para itens sem identidade", () => {
  const items = resumirDesempenhoCorredores([
    linha("Atualizado", 5, { colaborador: null }),
    linha("Atualizado", 5, { colaborador: null, loja: "l2", auditoria: "a2" }),
    linha("Atualizado", 5, { colaborador: null, nome: "", codigo: "" }),
  ]);
  assert.equal(items.length, 2); assert.notEqual(items[0].id, items[1].id);
});

test("endpoint exige autenticação, aplica a loja do administrador e exclui auditorias não concluídas", async (t) => {
  const lojaId = "507f1f77bcf86cd799439011";
  const outraLoja = "507f1f77bcf86cd799439012";
  const pipelines = [];
  const query = (valor) => ({ sort() { return this; }, select() { return this; }, async lean() { return valor; } });
  t.mock.method(Usuario, "findById", async () => ({ ativo: true, role: "STORE_ADMIN", loja: lojaId }));
  t.mock.method(AuditItem, "findOne", () => query({ data: "2026-10-26T00:00:00Z" }));
  t.mock.method(AuditItem, "aggregate", async (pipeline) => { pipelines.push(pipeline); return [linha("Atualizado", 100, { loja: lojaId })]; });
  t.mock.method(Colaborador, "find", () => query([]));
  t.mock.method(Loja, "find", () => query([{ _id: lojaId, nome: "Loja Centro" }]));
  t.mock.method(SystemConfig, "findOne", () => query({ metaPercentualRestante: 5 }));
  const app = express(); app.use("/metricas", router); app.use(errorMiddleware);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/metricas/relatorios/desempenho-colaboradores`;
  assert.equal((await fetch(url)).status, 401);
  const headers = { authorization: `Bearer ${assinarToken({ sub: "admin" })}` };
  const res = await fetch(`${url}?tipo=ETIQUETA&lojaId=${outraLoja}`, { headers });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.meta, 95); assert.equal(body.items[0].lojaNome, "Loja Centro");
  assert.equal(String(pipelines[0][0].$match.loja), lojaId);
  assert.deepEqual(pipelines[0][0].$match.cancelada, { $ne: true });
  assert.ok(pipelines[0].some((p) => p.$match?.["auditoria.status"] === "CONCLUIDA" && p.$match["auditoria.excluida"].$ne === true));
  assert.equal((await fetch(`${url}?tipo=INVALIDO`, { headers })).status, 400);
  assert.equal((await fetch(`${url}?periodo=custom&dataInicio=2026-10-30&dataFim=2026-10-01`, { headers })).status, 400);
});
