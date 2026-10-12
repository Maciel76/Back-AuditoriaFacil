import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import router from "../src/routes/lojaPortal.routes.js";
import { Colaborador } from "../src/models/Colaborador.js";
import { Usuario } from "../src/models/Usuario.js";
import { estadoLojaPortal } from "../src/services/lojaPortalService.js";
import { assinarToken } from "../src/utils/jwt.js";
import { errorMiddleware } from "../src/utils/http.js";

test("créditos administrativos de moedas", async (t) => {
  const ids = ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439012"];
  const admin = "507f1f77bcf86cd799439013";
  const pessoas = ids.map((_id) => ({ _id, ativo: true, pontuacao: 100, nivel: 2, moedasGastas: 30, creditosMoedas: [] }));
  const filtrar = (f) => pessoas.filter((p) => f._id.$in.includes(p._id) && (f.ativo === undefined || p.ativo === f.ativo) && (!f["creditosMoedas.operacao"] || p.creditosMoedas.some((c) => c.operacao === f["creditosMoedas.operacao"])));
  t.mock.method(Usuario, "findById", async (id) => ({ _id: id, ativo: true, role: id === admin ? "SUPER_ADMIN" : "STORE_ADMIN" }));
  t.mock.method(Colaborador, "countDocuments", async (f) => filtrar(f).length);
  t.mock.method(Colaborador, "updateMany", async (f, u) => {
    assert.deepEqual(Object.keys(u.$inc), ["moedasBonus"]);
    assert.equal(u.$push.creditosMoedas.admin, admin);
    for (const p of pessoas.filter((p) => f._id.$in.includes(p._id) && p.ativo && !p.creditosMoedas.some((c) => c.operacao === f["creditosMoedas.operacao"].$ne))) {
      p.moedasBonus = (p.moedasBonus || 0) + u.$inc.moedasBonus;
      p.creditosMoedas.push(u.$push.creditosMoedas);
    }
  });
  const app = express();
  app.use(express.json()); app.use(router); app.use(errorMiddleware);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const payload = { colaboradores: ids, quantidade: 500, motivo: "Reconhecimento da equipe", operacao: "123e4567-e89b-42d3-a456-426614174000" };
  const request = (body = payload, usuario = admin) => fetch(`http://127.0.0.1:${server.address().port}/moedas`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(usuario ? { authorization: `Bearer ${assinarToken({ sub: usuario })}` } : {}) }, body: JSON.stringify(body),
  });
  await t.test("exige superadmin e valida valor, seleção e motivo", async () => {
    assert.equal((await request(payload, "")).status, 401);
    assert.equal((await request(payload, ids[0])).status, 403);
    for (const patch of [{ quantidade: 0 }, { quantidade: -5 }, { quantidade: 1.5 }, { quantidade: "500" }, { colaboradores: [] }, { colaboradores: ["invalido"] }, { motivo: " " }, { operacao: "invalida" }]) {
      assert.equal((await request({ ...payload, ...patch })).status, 400);
    }
    assert.ok(pessoas.every((p) => !p.moedasBonus));
  });
  await t.test("não grava se um destinatário não existe ou está inativo", async () => {
    assert.equal((await request({ ...payload, colaboradores: [...ids, admin] })).status, 400);
    pessoas[1].ativo = false;
    assert.equal((await request()).status, 400);
    pessoas[1].ativo = true;
    assert.ok(pessoas.every((p) => !p.moedasBonus));
  });
  await t.test("credita os selecionados uma única vez e registra autor e motivo", async () => {
    const resposta = await request({ ...payload, colaboradores: [...ids, ids[0]] });
    assert.equal(resposta.status, 200);
    assert.deepEqual(await resposta.json(), { creditados: 2, quantidade: 500, totalMoedas: 1000 });
    assert.equal((await request()).status, 200);
    for (const p of pessoas) {
      assert.equal(estadoLojaPortal(p).saldoMoedas, 570);
      assert.equal(p.pontuacao, 100); assert.equal(p.nivel, 2);
      assert.equal(p.creditosMoedas.length, 1);
      assert.equal(p.creditosMoedas[0].motivo, payload.motivo);
      assert.ok(p.creditosMoedas[0].criadoEm instanceof Date);
    }
  });
  await t.test("novo crédito pode beneficiar apenas uma pessoa", async () => {
    assert.equal((await request({ ...payload, colaboradores: [ids[0]], quantidade: 10, operacao: "123e4567-e89b-42d3-a456-426614174001" })).status, 200);
    assert.equal(pessoas[0].moedasBonus, 510);
    assert.equal(pessoas[1].moedasBonus, 500);
  });
});
