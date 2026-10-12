// Verificação do frontend com API inteiramente simulada; não acessa a VPS.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import path from 'node:path';
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const usuario = { _id: '000000000000000000000001', nome: 'Admin de teste', role: 'STORE_ADMIN' };
const loja = { _id: '000000000000000000000002', nome: 'Loja de teste' };
let config = null;
try {
  await context.addInitScript(({ usuario, loja }) => {
    localStorage.setItem('na_token', 'token-de-teste'); localStorage.setItem('na_usuario', JSON.stringify(usuario)); localStorage.setItem('na_loja', JSON.stringify(loja));
  }, { usuario, loja });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/api/')) {
      let data = {};
      if (url.pathname.endsWith('/auth/me')) data = { usuario, loja };
      else if (url.pathname.endsWith('/automacao/chave')) {
        config = { chaveFinal: 'aaaaaa', habilitada: false };
        data = { chave: 'flh_' + 'a'.repeat(64) };
      } else if (url.pathname.endsWith('/automacao')) data = { config, historico: [], online: false, pacoteDisponivel: true };
      else if (url.pathname.includes('/lojas/me')) data = loja;
      await route.fulfill({ json: data }); return;
    }
    if (url.hostname !== '127.0.0.1') return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:4176/automacao');
  await page.getByRole('heading', { name: 'Automação', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Gerar chave de conexão' }).click();
  await page.getByRole('button', { name: 'Copiar chave' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Atualizar agora', exact: true }).isEnabled(), false);
  await page.getByRole('button', { name: 'Ocultar', exact: true }).click();
  await page.screenshot({ path: path.resolve('test/automacao-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Configurar rotina' }).click();
  await page.getByLabel('Nome da rotina').fill('Rotina teste');
  await page.getByRole('button', { name: 'Adicionar etapa' }).click();
  await page.getByRole('button', { name: 'Remover etapa' }).waitFor();
  await page.getByRole('button', { name: 'Recolher' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole('button', { name: 'Configurar rotina' }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('heading', { name: 'Agente da loja' }).waitFor();
  await page.screenshot({ path: path.resolve('test/automacao-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('UI: conexão pendente, geração/ocultação de chave, editor de filtros e layout móvel verificados.');
} finally { await browser.close(); }
