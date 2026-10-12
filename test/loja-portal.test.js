import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { Colaborador } from "../src/models/Colaborador.js";
import router from "../src/routes/colaboradores.routes.js";
import { estadoLojaPortal, tituloLojaPerfil } from "../src/services/lojaPortalService.js";
import { assinarToken } from "../src/utils/jwt.js";
import { errorMiddleware } from "../src/utils/http.js";

test("loja do portal: saldo, compras e títulos", async (t) => {
  const id = "507f1f77bcf86cd799439011";
  let colaborador;
  const reset = (pontuacao = 5799.3) => {
    colaborador = new Colaborador({ _id: id, loja: "507f1f77bcf86cd799439012", codigoExterno: "123", nome: "Teste", nivel: 12, pontuacao, moedasGastas: 0, itensLoja: [], tituloPerfilCodigo: "" });
  };
  reset();
  t.mock.method(Colaborador, "findById", (valor) => {
    assert.equal(String(valor), id);
    return {
      then(resolve, reject) { return Promise.resolve(colaborador).then(resolve, reject); },
      populate() { return this; },
      lean() { return Promise.resolve(colaborador.toObject()); },
    };
  });
  t.mock.method(Colaborador, "findOneAndUpdate", async (filtro, update, options) => {
    assert.equal(String(filtro._id), id);
    assert.equal(filtro.ativo, true);
    assert.equal(options.new, true);
    const propriedade = filtro["itensLoja.codigo"];
    if (typeof propriedade === "string" && !colaborador.itensLoja.some((i) => i.codigo === propriedade)) return null;
    if (propriedade?.$ne && colaborador.itensLoja.some((i) => i.codigo === propriedade.$ne)) return null;
    if (filtro.$expr) {
      assert.deepEqual(filtro.$expr.$gte[0], {
        $round: [{ $subtract: [{ $ifNull: ["$pontuacao", 0] }, { $ifNull: ["$moedasGastas", 0] }] }, 2],
      });
      assert.equal(filtro.$expr.$gte[1], update.$inc.moedasGastas);
      if (estadoLojaPortal(colaborador).saldoMoedas < filtro.$expr.$gte[1]) return null;
    }
    // Simula a atualização atômica de um documento sem acessar banco real.
    if (update.$inc) colaborador.moedasGastas += update.$inc.moedasGastas;
    if (update.$push) colaborador.itensLoja.push(update.$push.itensLoja);
    colaborador.set(update.$set);
    return colaborador;
  });
  const app = express();
  app.use(express.json());
  app.use("/colaboradores", router);
  app.use(errorMiddleware);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/colaboradores/portal/me`;
  const token = assinarToken({ sub: id, tipo: "colaborador" });
  const request = (path, method = "GET", body, authorization = `Bearer ${token}`) => fetch(base + path, {
    method, headers: { authorization, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  await t.test("conta antiga recebe moedas da pontuação e catálogo com preços", async () => {
    assert.equal(estadoLojaPortal({ pontuacao: 5799.3 }).saldoMoedas, 5799.3);
    const res = await request("/loja");
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.saldoMoedas, 5799.3);
    assert.equal(data.catalogo.length, 7);
    assert.equal(data.catalogo.filter((item) => item.categoria === "fundo").length, 3);
    assert.equal(data.fundoPerfil, null);
    assert.deepEqual(data.itensComprados, []);
  });

  await t.test("atualizar pontuação de conta antiga não apaga compras concorrentes", () => {
    const antigo = Colaborador.hydrate({ _id: id, nome: "Teste", pontuacao: 500 });
    antigo.pontuacao = 510;
    const alteracoes = antigo.getChanges().$set;
    for (const campo of ["moedasGastas", "itensLoja", "tituloPerfilCodigo", "fundoPerfilCodigo", "mascotePerfilCodigo"]) {
      assert.equal(Object.hasOwn(alteracoes, campo), false);
    }
  });

  await t.test("preço vem do catálogo, saldo desconta e XP permanece", async () => {
    const res = await request("/loja/compras", "POST", { codigo: "titulo-explorador", preco: 1, colaboradorId: "outro" });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.saldoMoedas, 5699.3);
    assert.equal(data.tituloPerfil.nome, "Explorador");
    assert.equal(colaborador.pontuacao, 5799.3);
    assert.equal(colaborador.nivel, 12);
    assert.equal(colaborador.itensLoja[0].preco, 100);
    assert.ok(colaborador.itensLoja[0].compradoEm instanceof Date);
    assert.equal((await (await request("")).json()).saldoMoedas, 5699.3);
    assert.equal(tituloLojaPerfil(colaborador).nome, "Explorador");
  });

  await t.test("compras repetidas não descontam de novo", async () => {
    const res = await request("/loja/compras", "POST", { codigo: "titulo-explorador" });
    assert.equal(res.status, 409);
    assert.equal(colaborador.moedasGastas, 100);
    assert.equal(colaborador.itensLoja.length, 1);
  });

  await t.test("equipar e remover são gratuitos; item não comprado é recusado", async () => {
    assert.equal((await request("/loja/titulo", "PATCH", { codigo: "titulo-lenda" })).status, 400);
    const removido = await request("/loja/titulo", "PATCH", { codigo: "" });
    assert.equal((await removido.json()).tituloPerfil, null);
    assert.equal((await request("/loja/titulo", "PATCH", { codigo: "titulo-explorador" })).status, 200);
    assert.equal(colaborador.moedasGastas, 100);
  });

  await t.test("saldo insuficiente e item inexistente não alteram a carteira", async () => {
    reset(99.99);
    assert.equal((await request("/loja/compras", "POST", { codigo: "titulo-explorador" })).status, 400);
    assert.equal((await request("/loja/compras", "POST", { codigo: "inventado" })).status, 404);
    assert.equal((await request("/loja/compras", "POST", {})).status, 400);
    assert.equal(colaborador.moedasGastas, 0);
  });

  await t.test("duas compras concorrentes não podem gastar o mesmo saldo", async () => {
    reset(300);
    const respostas = await Promise.all([
      request("/loja/compras", "POST", { codigo: "titulo-explorador" }),
      request("/loja/compras", "POST", { codigo: "titulo-guardiao" }),
    ]);
    assert.deepEqual(respostas.map((r) => r.status).sort(), [200, 400]);
    assert.equal(colaborador.itensLoja.length, 1);
    assert.ok(estadoLojaPortal(colaborador).saldoMoedas >= 0);
    reset(1000);
    const repetidas = await Promise.all([
      request("/loja/compras", "POST", { codigo: "titulo-explorador" }),
      request("/loja/compras", "POST", { codigo: "titulo-explorador" }),
    ]);
    assert.deepEqual(repetidas.map((r) => r.status).sort(), [200, 409]);
    assert.equal(colaborador.moedasGastas, 100);
  });

  await t.test("saldo acompanha novas auditorias e não fica negativo após recálculo", () => {
    colaborador.pontuacao = 1100.55;
    assert.equal(estadoLojaPortal(colaborador).saldoMoedas, 1000.55);
    colaborador.pontuacao = 50;
    assert.equal(estadoLojaPortal(colaborador).saldoMoedas, 0);
  });

  await t.test("fundos são comprados, aplicados e trocados sem alterar o título", async () => {
    reset(5000);
    await request("/loja/compras", "POST", { codigo: "titulo-explorador" });
    const compra = await request("/loja/compras", "POST", { codigo: "fundo-aurora", preco: 0 });
    assert.equal(compra.status, 200);
    const data = await compra.json();
    assert.equal(data.saldoMoedas, 4700);
    assert.equal(data.fundoPerfil.codigo, "fundo-aurora");
    assert.equal(data.tituloPerfilCodigo, "titulo-explorador");
    assert.equal(colaborador.pontuacao, 5000);
    assert.equal((await (await request("")).json()).fundoPerfil.codigo, "fundo-aurora");
    assert.equal((await request("/loja/compras", "POST", { codigo: "fundo-aurora" })).status, 409);
    assert.equal((await request("/loja/fundo", "PATCH", { codigo: "fundo-nebulosa" })).status, 400);
    assert.equal((await request("/loja/fundo", "PATCH", { codigo: "titulo-explorador" })).status, 404);
    assert.equal((await request("/loja/titulo", "PATCH", { codigo: "fundo-aurora" })).status, 404);
    const padrao = await request("/loja/fundo", "PATCH", { codigo: "" });
    assert.equal((await padrao.json()).fundoPerfil, null);
    assert.equal((await request("/loja/fundo", "PATCH", { codigo: "fundo-aurora" })).status, 200);
    assert.equal(colaborador.moedasGastas, 300);
    await request("/loja/compras", "POST", { codigo: "fundo-nebulosa" });
    assert.equal(colaborador.fundoPerfilCodigo, "fundo-nebulosa");
    await request("/loja/fundo", "PATCH", { codigo: "fundo-aurora" });
    assert.equal(colaborador.moedasGastas, 650);
    assert.equal(colaborador.fundoPerfilCodigo, "fundo-aurora");
    assert.equal(colaborador.tituloPerfilCodigo, "titulo-explorador");
  });

  await t.test("rotas exigem token de colaborador", async () => {
    assert.equal((await request("/loja/mascote", "PATCH", { codigo: "" }, "")).status, 401);
    assert.equal((await request("/loja/fundo", "PATCH", { codigo: "" }, "")).status, 401);
    assert.equal((await request("/loja", "GET", undefined, "")).status, 401);
    assert.equal((await request("/loja/compras", "POST", { codigo: "titulo-lenda" }, "")).status, 401);
    const admin = assinarToken({ sub: id, role: "SUPER_ADMIN" });
    assert.equal((await request("/loja/titulo", "PATCH", { codigo: "" }, `Bearer ${admin}`)).status, 403);
  });
  await t.test("mascote é comprado uma vez, equipado e removido sem alterar fundo e título", async () => {
    reset(1000);
    assert.equal((await request("/loja/mascote", "PATCH", { codigo: "mascote-gato" })).status, 400);
    await request("/loja/compras", "POST", { codigo: "titulo-explorador" });
    await request("/loja/compras", "POST", { codigo: "fundo-aurora" });
    const compra = await request("/loja/compras", "POST", { codigo: "mascote-gato", preco: 0 });
    assert.equal(compra.status, 200);
    const data = await compra.json();
    assert.equal(data.saldoMoedas, 400);
    assert.equal(data.mascotePerfil.codigo, "mascote-gato");
    assert.equal(data.tituloPerfilCodigo, "titulo-explorador");
    assert.equal(data.fundoPerfilCodigo, "fundo-aurora");
    assert.equal(colaborador.pontuacao, 1000);
    assert.equal((await (await request("")).json()).mascotePerfil.codigo, "mascote-gato");
    assert.equal((await request("/loja/compras", "POST", { codigo: "mascote-gato" })).status, 409);
    for (const categoria of ["titulo", "fundo"]) {
      assert.equal((await request(`/loja/${categoria}`, "PATCH", { codigo: "mascote-gato" })).status, 404);
    }
    assert.equal((await request("/loja/mascote", "PATCH", { codigo: "titulo-explorador" })).status, 404);
    assert.equal((await (await request("/loja/mascote", "PATCH", { codigo: "" })).json()).mascotePerfil, null);
    assert.equal((await request("/loja/mascote", "PATCH", { codigo: "mascote-gato" })).status, 200);
    assert.equal(colaborador.moedasGastas, 600);
  });
});
