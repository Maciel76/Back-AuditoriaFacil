import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('processo local recebe tarefa, baixa e envia sem expor credenciais', { timeout: 20000 }, async () => {
  let submitted = false;
  let claimed = false;
  const messages = [];
  const key = 'flh_' + '1'.repeat(64);
  const agentId = '00000000-0000-0000-0000-000000000001';
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    if (req.url.startsWith('/api/')) {
      assert.equal(req.headers.authorization, 'Bearer ' + key);
      assert.equal(req.headers['x-agente-id'], agentId);
      res.setHeader('Content-Type', 'application/json');
      if (req.url.endsWith('/poll')) {
        const job = claimed ? null : { id: 'job-teste', token: 'token-teste', dataAlvo: '2026-10-10', rotina: {
          caminho: '/rub', usuarioSeletor: '#user', senhaSeletor: '#pass', entrarSeletor: '#login', prontoSeletor: '#ready', downloadSeletor: '#export', passos: [],
        } };
        claimed = true;
        return res.end(JSON.stringify({ job }));
      }
      if (req.url.endsWith('/arquivo')) {
        assert.equal(req.headers['x-execucao-token'], 'token-teste');
        assert.match(body, /filename="auditoria.csv"/);
        assert.match(body, /00123,Arroz/);
        submitted = true; res.statusCode = 202; return res.end('{"ok":true}');
      }
      return res.end('{"status":"importando"}');
    }
    if (req.url === '/login') { res.writeHead(302, { Location: '/rub', 'Set-Cookie': 'auth=ok; Path=/' }); return res.end(); }
    if (!req.headers.cookie) {
      res.setHeader('Content-Type', 'text/html');
      return res.end('<form action="/login" method="POST"><input id="user"><input id="pass" type="password"><button id="login">Entrar</button></form>');
    }
    if (req.url === '/export') {
      res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="auditoria.csv"' });
      return res.end('SKU,Produto,Situacao,Auditado em\n00123,Arroz,Atualizado,10/10/2026\n');
    }
    res.setHeader('Content-Type', 'text/html'); res.end('<main id="ready"><a id="export" href="/export">Exportar</a></main>');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const child = spawn(process.execPath, [path.join(root, 'src/agent.js')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: {
    ...process.env, FLASHUB_API: url + '/api', FLASHUB_KEY: key, FLASHUB_AGENT_ID: agentId,
    RUB_URL: url + '/rub', RUB_USER: 'usuario-secreto-teste', RUB_PASS: 'senha-secreta-teste', FLASHUB_BROWSER: 'msedge',
  } });
  const exited = once(child, 'exit');
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Agente não terminou o envio')), 15000);
      child.on('exit', () => { clearTimeout(timeout); reject(new Error('Agente encerrou antes do envio')); });
      child.stdout.on('data', chunk => {
        messages.push(chunk.toString());
        if (messages.join('').includes('Arquivo recebido')) { clearTimeout(timeout); resolve(); }
      });
      child.stderr.on('data', chunk => messages.push(chunk.toString()));
    });
    assert.equal(submitted, true);
    assert.ok(!messages.join('').includes(key));
    assert.ok(!messages.join('').includes('senha-secreta-teste'));
    child.stdin.write('stop\n');
    const [exit] = await exited;
    assert.equal(exit, 0);
  } finally { if (child.exitCode === null) child.kill(); await new Promise(r => server.close(r)); }
});
