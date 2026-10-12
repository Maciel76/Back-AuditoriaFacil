import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import router from "../src/routes/lojaPortal.routes.js";
import { SystemConfig } from "../src/models/SystemConfig.js";
import { Usuario } from "../src/models/Usuario.js";
import { carregarCatalogoLojaPortal, CATALOGO_LOJA_PORTAL } from "../src/services/lojaPortalService.js";
import { assinarToken } from "../src/utils/jwt.js";
import { errorMiddleware } from "../src/utils/http.js";

test("superadmin gerencia preços globais da loja", async (t) => {
  let config = null;
  let gravacoes = 0;
  t.mock.method(SystemConfig, "findOne", () => ({ lean: async () => config }));
  t.mock.method(SystemConfig, "findOneAndUpdate", async (filtro, update, options) => {
    assert.deepEqual(filtro, { chave: "global" });
    assert.equal(options.upsert, true);
    assert.equal(options.runValidators, true);
    config ||= { metaPercentualRestante: 2, precosLojaPortal: {} };
    for (const [campo, preco] of Object.entries(update.$set)) {
      assert.ok(campo.startsWith("precosLojaPortal."));
      config.precosLojaPortal[campo.slice("precosLojaPortal.".length)] = preco;
    }
    gravacoes++;
  });
  t.mock.method(Usuario, "findById", async (id) => ({ _id: id, ativo: true, role: id === "super" ? "SUPER_ADMIN" : "STORE_ADMIN" }));
  const app = express();
  app.use(express.json());
  app.use("/loja", router);
  app.use(errorMiddleware);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const request = (method = "GET", body, usuario = "super") => fetch(`http://127.0.0.1:${server.address().port}/loja`, {
    method,
    headers: { "Content-Type": "application/json", ...(usuario ? { authorization: `Bearer ${assinarToken({ sub: usuario })}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  await t.test("catálogo mantém valores padrão antes da configuração", async () => {
    const res = await request();
    assert.equal(res.status, 200);
    const { catalogo } = await res.json();
    assert.deepEqual(catalogo.map((i) => i.preco), CATALOGO_LOJA_PORTAL.map((i) => i.preco));
    assert.ok(catalogo.every((i) => i.categoria));
  });
  await t.test("leitura e escrita exigem superadmin", async () => {
    for (const method of ["GET", "PUT"]) {
      assert.equal((await request(method, undefined, "")).status, 401);
      assert.equal((await request(method, undefined, "gerente")).status, 403);
    }
    assert.equal(gravacoes, 0);
  });
  await t.test("valida todo o lote antes de gravar", async () => {
    for (const itens of [[], [{ codigo: "inventado", preco: 10 }], ...[-1, 1.5, "10", null, 1000000001].map((preco) => [{ codigo: "fundo-aurora", preco }]), [{ codigo: "fundo-aurora", preco: 10 }, { codigo: "fundo-aurora", preco: 20 }]]) {
      assert.equal((await request("PUT", { itens })).status, 400);
    }
    assert.equal(gravacoes, 0);
  });
  await t.test("preços salvos são lidos pelo portal e zero é preservado", async () => {
    const res = await request("PUT", { itens: [{ codigo: "titulo-explorador", preco: 75 }, { codigo: "fundo-aurora", preco: 0 }] });
    assert.equal(res.status, 200);
    const { catalogo } = await res.json();
    assert.equal(catalogo.find((i) => i.codigo === "titulo-explorador").preco, 75);
    assert.equal(catalogo.find((i) => i.codigo === "fundo-aurora").preco, 0);
    assert.deepEqual(await carregarCatalogoLojaPortal(), catalogo);
    assert.equal(config.metaPercentualRestante, 2);
    await request("PUT", { itens: [{ codigo: "titulo-guardiao", preco: 150 }] });
    assert.equal((await carregarCatalogoLojaPortal()).find((i) => i.codigo === "titulo-explorador").preco, 75);
    assert.equal(CATALOGO_LOJA_PORTAL.find((i) => i.codigo === "titulo-explorador").preco, 1000);
  });
});
