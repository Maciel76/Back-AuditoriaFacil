import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import router from "../src/routes/dispositivos.routes.js";
import { Dispositivo } from "../src/models/Dispositivo.js";
import { Loja } from "../src/models/Loja.js";
import { Usuario } from "../src/models/Usuario.js";
import { assinarToken } from "../src/utils/jwt.js";
import { errorMiddleware } from "../src/utils/http.js";

const loja = "aaaaaaaaaaaaaaaaaaaaaaaa";
const outraLoja = "bbbbbbbbbbbbbbbbbbbbbbbb";

test("painel de dispositivos: isolamento, validação e movimentações", async (t) => {
  let registros = [];
  let corrida = false;
  let escrita = 0;
  t.mock.method(Usuario, "findById", async (id) => ({ _id: "cccccccccccccccccccccccc", ativo: true, loja, role: { admin: "STORE_ADMIN", super: "SUPER_ADMIN", colaborador: "COLABORADOR" }[id] }));
  t.mock.method(Loja, "exists", async ({ _id }) => [loja, outraLoja].includes(_id));
  t.mock.method(Dispositivo, "find", (filter) => ({ lean: async () => registros.filter((item) => item.loja === filter.loja) }));
  t.mock.method(Dispositivo, "findOne", (filter) => ({ lean: async () => registros.find((item) => item.loja === filter.loja && item.base === filter.base) || null }));
  t.mock.method(Dispositivo, "findOneAndUpdate", async (filter, update, options) => {
    escrita++;
    assert.equal(options.runValidators, true);
    const anterior = registros.find((item) => item.loja === filter.loja && item.base === filter.base);
    if (corrida) {
      const duplicate = corrida === "duplicate";
      corrida = false;
      if (duplicate) throw Object.assign(new Error("duplicate"), { code: 11000 });
      return null;
    }
    assert.equal(options.upsert, !anterior);
    assert.equal(anterior?.revision || 0, filter.revision);
    const item = { ...(anterior || update.$setOnInsert), ...filter, ...update.$set, revision: filter.revision + update.$inc.revision };
    registros = registros.filter((entry) => entry !== anterior).concat(item);
    return item;
  });
  const app = express();
  app.use(express.json());
  app.use("/dispositivos", router);
  app.use(errorMiddleware);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const request = (path = "", body, user = "admin", query = "") => fetch(`http://127.0.0.1:${server.address().port}/dispositivos${path}${query}`, {
    method: body ? "PATCH" : "GET",
    headers: { "Content-Type": "application/json", ...(user ? { Authorization: `Bearer ${assinarToken({ sub: user })}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const clicar = (base, revision, user = "admin", query = "") => request(`/${base}/status`, { revision }, user, query);

  await t.test("exige autenticação, escopo válido e permissão de escrita", async () => {
    assert.equal((await request("", null, "")).status, 401);
    assert.equal((await request("", null, "super")).status, 400);
    assert.equal((await request("", null, "super", "?lojaId=invalida")).status, 400);
    assert.equal((await request("", null, "super", "?lojaId=dddddddddddddddddddddddd")).status, 404);
    assert.equal((await clicar(1, 0, "colaborador")).status, 403);
    assert.equal(escrita, 0);
  });
  await t.test("leitura retorna 35 bases livres sem criar registros", async () => {
    const response = await request();
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.items.length, 35);
    assert.deepEqual(data.items.map((item) => item.base), Array.from({ length: 35 }, (_, i) => i + 1));
    assert.ok(data.items.every((item) => item.status === "LIVRE" && item.revision === 0));
    assert.equal(escrita, 0);
  });
  await t.test("estados antigos são lidos sem perder os dados existentes", async () => {
    registros.push({ loja, base: 34, status: "VAZIO", revision: 2, codigo: "", modelo: "" });
    registros.push({ loja, base: 35, status: "OCUPADO", revision: 2, codigo: "DISP-35", modelo: "Zebra", responsavel: "Ana" });
    const { items } = await (await request()).json();
    assert.equal(items[33].status, "LIVRE");
    assert.equal(items[34].status, "EM_USO");
    assert.equal(registros[1].status, "OCUPADO");
    assert.equal(escrita, 0);
  });
  await t.test("recusa base e revisão inválidas e campos não permitidos", async () => {
    for (const base of [0, 36, 1.5, "abc"]) assert.equal((await clicar(base, 0)).status, 400);
    for (const revision of [-1, 0.5, "0", null]) assert.equal((await clicar(1, revision)).status, 400);
    for (const body of [{}, { revision: 0, status: "EM_USO" }, { revision: 0, codigo: "DISP-01" }]) {
      assert.equal((await request("/1/status", body)).status, 400);
    }
    assert.equal(escrita, 0);
  });
  await t.test("um clique muda para em uso sem exigir cadastro ou responsável", async () => {
    const response = await clicar(1, 0, "admin", `?lojaId=${outraLoja}`);
    assert.equal(response.status, 200);
    const item = await response.json();
    assert.equal(item.status, "EM_USO");
    assert.equal(item.loja, loja);
    assert.equal(item.codigo, "");
    assert.equal(item.responsavel, "");
    assert.equal(item.revision, 1);
    assert.ok(Number.isFinite(Date.parse(item.retiradoEm)));
    const { items } = await (await request("", null, "super", `?lojaId=${outraLoja}`)).json();
    assert.ok(items.every((entry) => entry.status === "LIVRE"));
  });
  await t.test("cliques alternam apenas livre e em uso e persistem o estado", async () => {
    for (const [revision, status] of [[1, "LIVRE"], [2, "EM_USO"], [3, "LIVRE"]]) {
      const response = await clicar(1, revision);
      assert.equal(response.status, 200);
      const item = await response.json();
      assert.equal(item.status, status);
      assert.equal(item.revision, revision + 1);
      assert.equal(item.retiradoEm !== null, status === "EM_USO");
    }
    const { items } = await (await request()).json();
    assert.equal(items[0].status, "LIVRE");
    assert.equal(items[0].revision, 4);
  });
  await t.test("revisão antiga e escritas simultâneas não sobrescrevem outra operação", async () => {
    const before = escrita;
    assert.equal((await clicar(1, 0)).status, 409);
    assert.equal(escrita, before);
    corrida = true;
    assert.equal((await clicar(1, 4)).status, 409);
    corrida = "duplicate";
    assert.equal((await clicar(2, 0)).status, 409);
    assert.equal(registros.find((item) => item.base === 1).status, "LIVRE");
  });
  await t.test("bases antigas seguem o ciclo novo preservando seu cadastro", async () => {
    const response = await clicar(35, 2);
    assert.equal(response.status, 200);
    const item = await response.json();
    assert.equal(item.status, "LIVRE");
    assert.equal(item.codigo, "DISP-35");
    assert.equal(item.modelo, "Zebra");
    assert.equal(item.responsavel, "Ana");
    const free = await (await clicar(34, 2)).json();
    assert.equal(free.status, "EM_USO");
    const other = await (await clicar(1, 0, "super", `?lojaId=${outraLoja}`)).json();
    assert.equal(other.loja, outraLoja);
    assert.equal(other.revision, 1);
  });

  const aviso = (base, revision, observacao = "", ativo = true, user = "admin", query = "") => request(`/${base}/aviso`, { revision, observacao, ativo }, user, query);
  await t.test("aviso valida permissão, tamanho, revisão e tipo da observação", async () => {
    const before = escrita;
    assert.equal((await aviso(2, 0, "teste", true, "colaborador")).status, 403);
    for (const base of [0, 36, "abc"]) assert.equal((await aviso(base, 0)).status, 400);
    for (const body of [{ revision: 0 }, { revision: "0", ativo: true }, { revision: 0, ativo: true, observacao: {} }, { revision: 0, ativo: true, observacao: "a".repeat(1001) }, { revision: 0, ativo: "true" }]) {
      assert.equal((await request("/2/aviso", body)).status, 400);
    }
    assert.equal(escrita, before);
  });
  await t.test("adiciona aviso com observação em base sem cadastro e isola a loja", async () => {
    const response = await aviso(2, 0, "  Tela danificada\nEnviar para manutenção.  ", true, "admin", `?lojaId=${outraLoja}`);
    assert.equal(response.status, 200);
    const item = await response.json();
    assert.equal(item.loja, loja);
    assert.equal(item.status, "AVISO");
    assert.equal(item.observacao, "Tela danificada\nEnviar para manutenção.");
    assert.equal(item.statusAnteriorAviso, "LIVRE");
    const { items } = await (await request()).json();
    assert.equal(items[1].observacao, item.observacao);
    const { items: otherItems } = await (await request("", null, "super", `?lojaId=${outraLoja}`)).json();
    assert.equal(otherItems[1].status, "LIVRE");
  });
  await t.test("clique comum não apaga aviso; edição preserva o status anterior", async () => {
    const before = escrita;
    assert.equal((await clicar(2, 1)).status, 409);
    assert.equal((await aviso(2, 0, "desatualizado")).status, 409);
    assert.equal(escrita, before);
    const response = await aviso(2, 1, "Aguardando peça");
    assert.equal(response.status, 200);
    const item = await response.json();
    assert.equal(item.observacao, "Aguardando peça");
    assert.equal(item.statusAnteriorAviso, "LIVRE");
    const removed = await (await aviso(2, 2, "", false)).json();
    assert.equal(removed.status, "LIVRE");
    assert.equal(removed.observacao, "");
    assert.equal(removed.statusAnteriorAviso, null);
    assert.equal((await aviso(2, 3, "", false)).status, 409);
  });
  await t.test("remover aviso de uma base em uso restaura uso e horário original", async () => {
    const original = await (await clicar(3, 0)).json();
    const response = await aviso(3, 1, "Bateria precisa ser verificada");
    assert.equal(response.status, 200);
    const warning = await response.json();
    assert.equal(warning.statusAnteriorAviso, "EM_USO");
    assert.equal(warning.retiradoEm, original.retiradoEm);
    await aviso(3, 2, "Verificação pendente");
    const removed = await (await aviso(3, 3, "", false)).json();
    assert.equal(removed.status, "EM_USO");
    assert.equal(removed.retiradoEm, original.retiradoEm);
  });
  await t.test("observação é opcional e avisos antigos podem ser removidos", async () => {
    const response = await aviso(4, 0);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).observacao, "");
    registros.push({ loja, base: 5, status: "AVISO", revision: 1 });
    const removed = await (await aviso(5, 1, "", false)).json();
    assert.equal(removed.status, "LIVRE");
  });
});
