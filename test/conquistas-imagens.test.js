import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import express from "express";
import router from "../src/routes/conquistas.routes.js";
import { Usuario } from "../src/models/Usuario.js";
import { assinarToken } from "../src/utils/jwt.js";
import { errorMiddleware } from "../src/utils/http.js";

// Two looping frames, with different palettes. Compare the entire file after
// upload so a future thumbnail/conversion cannot silently flatten animation.
const gif = Buffer.from("R0lGODlhQABAAIEAACLT7gAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAFAAAACwAAAAAQABAAAAIaQABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDihxJsqTJkyhTqlzJsqXLlzBjypxJs6bNmzhz6tzJs6fPn0CDCh1KtKjRo0iTKl3KtKnTp1CjSp1KtarVq1izagUQEAAh+QQBFAABACwAAAAAQABAAIF8XP8AAAAAAAAAAAAIaQABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDihxJsqTJkyhTqlzJsqXLlzBjypxJs6bNmzhz6tzJs6fPn0CDCh1KtKjRo0iTKl3KtKnTp1CjSp1KtarVq1izagUQEAA7", "base64");

test("upload de imagens e GIFs de conquistas", async (t) => {
  t.mock.method(Usuario, "findById", async () => ({ ativo: true, role: "SUPER_ADMIN" }));
  const app = express();
  app.use("/conquistas", router);
  app.use("/uploads", express.static(fileURLToPath(new URL("../uploads", import.meta.url))));
  app.use(errorMiddleware);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origem = `http://127.0.0.1:${server.address().port}`;
  const token = assinarToken({ sub: "507f1f77bcf86cd799439011" });
  const enviar = (bytes, nome = "animacao.GIF", tipo = "image/gif", nivel = "icone", authorization = `Bearer ${token}`) => {
    const body = new FormData();
    body.append("codigo", "TESTE_GIF");
    body.append("nivel", nivel);
    body.append("imagem", new Blob([bytes], { type: tipo }), nome);
    return fetch(`${origem}/conquistas/upload-imagem`, { method: "POST", headers: { authorization }, body });
  };
  const verificarArquivo = async (response, esperado, nivel) => {
    assert.equal(response.status, 200);
    const data = await response.json();
    const arquivo = new URL(`../uploads/conquistas/${data.filename}`, import.meta.url);
    t.after(() => unlink(arquivo));
    assert.match(data.filename, new RegExp(`^teste_gif-${nivel}-\\d+\\.gif$`));
    assert.equal(data.size, esperado.length);
    assert.deepEqual(await readFile(arquivo), esperado);
    const media = await fetch(`${origem}${data.url}`);
    assert.equal(media.status, 200);
    assert.match(media.headers.get("content-type"), /^image\/gif/);
    assert.deepEqual(Buffer.from(await media.arrayBuffer()), esperado);
  };

  await t.test("preserva os quadros e serve o ícone com Content-Type image/gif", async () => {
    await verificarArquivo(await enviar(gif), gif, "icone");
  });
  await t.test("aceita GIF de tier acima do antigo limite de 3 MB", async () => {
    // Valid GIF comment extensions before the trailer, to exceed 3 MB.
    const comentario = Buffer.concat([Buffer.from([0x21, 0xfe]), ...Array.from({ length: 255 }, () => Buffer.concat([Buffer.from([255]), Buffer.alloc(255, 32)])), Buffer.from([0])]);
    const grande = Buffer.concat([gif.subarray(0, -1), ...Array(50).fill(comentario), gif.subarray(-1)]);
    assert.ok(grande.length > 3 * 1024 * 1024);
    await verificarArquivo(await enviar(grande, "tier.gif", "image/gif", "raro"), grande, "raro");
  });
  await t.test("rejeita arquivos acima de 10 MB com mensagem clara", async () => {
    const response = await enviar(Buffer.alloc(10 * 1024 * 1024 + 1));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /10 MB/);
  });
  await t.test("rejeita formatos não suportados e exige autenticação", async () => {
    const response = await enviar(gif, "arquivo.txt", "text/plain");
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /GIF/);
    assert.equal((await enviar(gif, "animacao.gif", "image/gif", "icone", "")).status, 401);
  });
});
