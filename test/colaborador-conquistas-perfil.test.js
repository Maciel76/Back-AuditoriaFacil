import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { Colaborador } from "../src/models/Colaborador.js";
import { Conquista } from "../src/models/Conquista.js";
import router from "../src/routes/colaboradores.routes.js";
import { invalidarCacheConquistas } from "../src/services/conquistasService.js";
import { assinarToken } from "../src/utils/jwt.js";
import { errorMiddleware } from "../src/utils/http.js";

test("seleção de conquistas do perfil", async (t) => {
  const colaborador = new Colaborador({
    _id: "507f1f77bcf86cd799439011",
    loja: "507f1f77bcf86cd799439012",
    nome: "Colaborador de teste",
    codigoExterno: "123",
    totalItensLidos: 1500,
  });
  let atualizacoes = 0;
  t.mock.method(Colaborador, "findById", (id) => {
    assert.equal(String(id), String(colaborador._id));
    return {
      then(resolve, reject) {
        return Promise.resolve(colaborador).then(resolve, reject);
      },
      populate() { return this; },
      lean() { return Promise.resolve(colaborador.toObject({ flattenMaps: true })); },
    };
  });
  t.mock.method(Colaborador, "updateOne", async (filtro, atualizacao) => {
    assert.equal(String(filtro._id), String(colaborador._id));
    colaborador.set(atualizacao.$set);
    atualizacoes += 1;
    return { matchedCount: 1, modifiedCount: 1 };
  });
  t.mock.method(Conquista, "find", () => ({
    sort() { return this; },
    lean: async () => [
      { codigo: "OBTIDA", metricaBase: "totalItensLidos", tiers: [
        { nivel: "comum", meta: 100 },
        { nivel: "raro", meta: 500 },
        { nivel: "epico", meta: 1000 },
        { nivel: "lendario", meta: 5000 },
      ] },
      { codigo: "BLOQUEADA", metricaBase: "totalItensLidos", tiers: [{ nivel: "raro", meta: 5000 }] },
    ],
  }));
  invalidarCacheConquistas();
  const app = express();
  app.use(express.json());
  app.use("/colaboradores", router);
  app.use(errorMiddleware);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
    invalidarCacheConquistas();
  });
  const origem = `http://127.0.0.1:${server.address().port}/colaboradores/portal/me`;
  const token = assinarToken({ sub: String(colaborador._id), tipo: "colaborador" });
  const salvar = (body, authorization = `Bearer ${token}`) => fetch(`${origem}/conquistas-exibidas`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", authorization },
    body: JSON.stringify(body),
  });

  await t.test("salva somente no próprio perfil, remove duplicatas e devolve na leitura", async () => {
    assert.equal(colaborador.conquistasExibidas, undefined);
    const response = await salvar({ codigos: ["OBTIDA", "OBTIDA"], colaboradorId: "outro" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      conquistasExibidas: ["OBTIDA"],
      tiersConquistasExibidas: { OBTIDA: "epico" },
    });
    const perfil = await fetch(origem, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(perfil.status, 200);
    assert.deepEqual((await perfil.json()).conquistasExibidas, ["OBTIDA"]);
    assert.equal(atualizacoes, 1);
  });

  await t.test("salva um tier anterior desbloqueado e mantém a escolha na leitura", async () => {
    const response = await salvar({ codigos: ["OBTIDA"], tiers: { OBTIDA: "comum" } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      conquistasExibidas: ["OBTIDA"],
      tiersConquistasExibidas: { OBTIDA: "comum" },
    });
    const perfil = await fetch(origem, { headers: { authorization: `Bearer ${token}` } });
    assert.deepEqual((await perfil.json()).tiersConquistasExibidas, { OBTIDA: "comum" });
    assert.equal(colaborador.tiersConquistasExibidas.get("OBTIDA"), "comum");
    assert.equal(atualizacoes, 2);
  });

  await t.test("recusa tiers bloqueados ou inválidos sem alterar a preferência salva", async () => {
    for (const tier of ["lendario", "inexistente"]) {
      assert.equal((await salvar({ codigos: ["OBTIDA"], tiers: { OBTIDA: tier } })).status, 400);
    }
    assert.equal(atualizacoes, 2);
    assert.equal(colaborador.tiersConquistasExibidas.get("OBTIDA"), "comum");
  });

  await t.test("recusa conquistas bloqueadas e inexistentes", async () => {
    for (const codigo of ["BLOQUEADA", "INEXISTENTE"]) {
      assert.equal((await salvar({ codigos: [codigo] })).status, 400);
    }
    assert.equal(atualizacoes, 2);
  });

  await t.test("valida o formato antes de salvar", async () => {
    for (const body of [{}, { codigos: "OBTIDA" }, { codigos: [""] }, { codigos: Array(101).fill("OBTIDA") }]) {
      assert.equal((await salvar(body)).status, 400);
    }
    assert.equal(atualizacoes, 2);
  });

  await t.test("exige um token de colaborador", async () => {
    assert.equal((await salvar({ codigos: [] }, "")).status, 401);
    const tokenAdmin = assinarToken({ sub: String(colaborador._id), role: "SUPER_ADMIN" });
    assert.equal((await salvar({ codigos: [] }, `Bearer ${tokenAdmin}`)).status, 403);
    assert.equal(atualizacoes, 2);
  });

  await t.test("permite ocultar todas as miniaturas", async () => {
    const response = await salvar({ codigos: [] });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { conquistasExibidas: [], tiersConquistasExibidas: {} });
    assert.equal(colaborador.tiersConquistasExibidas.size, 0);
    assert.deepEqual(colaborador.toObject().conquistasExibidas, []);
  });
});
