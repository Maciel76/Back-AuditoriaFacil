import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { baixarPlanilha } from '../src/rub.js';

test('agente faz login, aplica filtro, exporta CSV e fecha o navegador', async () => {
  let filtered = '';
  const server = http.createServer((req, res) => {
    if (req.url === '/login' && req.method === 'POST') {
      res.writeHead(302, { Location: '/auditoria', 'Set-Cookie': 'auth=ok; Path=/' }); return res.end();
    }
    if (!req.headers.cookie?.includes('auth=ok')) {
      res.setHeader('Content-Type', 'text/html');
      return res.end('<form action="/login" method="POST"><input id="user" name="user"><input id="pass" type="password" name="pass"><button id="login">Entrar</button></form>');
    }
    if (req.url.startsWith('/export')) {
      filtered = new URL(req.url, 'http://localhost').searchParams.get('data');
      res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="auditoria.csv"' });
      return res.end('SKU,Produto,Situação,Auditado em\n00123,Arroz,Atualizado,10/10/2026\n');
    }
    res.setHeader('Content-Type', 'text/html');
    res.end('<main id="ready"><input id="data"><a id="export" href="/export">Exportar</a></main><script>document.querySelector("#data").addEventListener("input",e=>document.querySelector("#export").href="/export?data="+encodeURIComponent(e.target.value));</script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const log = [];
  try {
    const result = await baixarPlanilha({ rub: new URL(`http://127.0.0.1:${server.address().port}`), user: 'usuario-teste', pass: 'senha-teste', channel: 'msedge' }, {
      dataAlvo: '2026-10-10', rotina: { caminho: '/auditoria', usuarioSeletor: '#user', senhaSeletor: '#pass', entrarSeletor: '#login', prontoSeletor: '#ready', downloadSeletor: '#export', passos: [{ acao: 'preencher', seletor: '#data', valor: '{{dataBR}}' }] },
    }, line => log.push(line), new AbortController().signal);
    assert.equal(result.filename, 'auditoria.csv');
    assert.match(result.buffer.toString(), /00123/);
    assert.equal(filtered, '10/10/2026');
    assert.ok(!log.join().includes('senha-teste'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
