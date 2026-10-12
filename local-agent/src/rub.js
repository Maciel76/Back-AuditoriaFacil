import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { targetAddress, template } from './config.js';

export async function baixarPlanilha(config, job, log, signal) {
  const r = job.rotina;
  const target = targetAddress(config.rub, r.caminho);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flashub-'));
  let browser;
  const close = () => { void browser?.close().catch(() => {}); };
  signal?.addEventListener('abort', close);
  try {
    browser = await chromium.launch({ headless: true, channel: config.channel });
    if (signal?.aborted) throw new Error('Execução interrompida.');
    const context = await browser.newContext({ acceptDownloads: true });
    // A VPS não pode mandar o agente navegar para outros sistemas locais.
    // Uma instalação com SSO externo precisa de uma adaptação explícita da lista permitida.
    await context.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.origin !== config.rub.origin) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(60000);
    log('Abrindo o RUB.');
    await page.goto(config.rub.href, { waitUntil: 'domcontentloaded' });
    const login = page.locator(r.senhaSeletor).first();
    await Promise.any([
      login.waitFor({ state: 'visible' }),
      page.locator(r.prontoSeletor).first().waitFor({ state: 'visible' }),
    ]);
    if (await login.isVisible()) {
      if (new URL(page.url()).origin !== config.rub.origin) throw new Error('Login fora do RUB configurado.');
      log('Autenticando no RUB.');
      await page.locator(r.usuarioSeletor).first().fill(config.user);
      await login.fill(config.pass);
      await page.locator(r.entrarSeletor).first().click();
      await login.waitFor({ state: 'hidden', timeout: 60000 });
    }
    await page.goto(target, { waitUntil: 'domcontentloaded' });
    await page.locator(r.prontoSeletor).first().waitFor({ state: 'visible' });
    for (const [index, passo] of r.passos.entries()) {
      if (signal?.aborted) throw new Error('Execução interrompida.');
      log(`Aplicando etapa ${index + 1} de ${r.passos.length}.`);
      const el = page.locator(passo.seletor).first();
      const value = template(passo.valor, job.dataAlvo);
      switch (passo.acao) {
        case 'clicar': await el.click(); break;
        case 'preencher': await el.fill(value); break;
        case 'selecionar': await el.selectOption(value); break;
        case 'aguardar': await el.waitFor({ state: 'visible' }); break;
        case 'marcar': await el.check(); break;
        case 'desmarcar': await el.uncheck(); break;
        default: throw new Error('Ação de filtro não suportada.');
      }
    }
    log('Baixando a planilha.');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 120000 }),
      page.locator(r.downloadSeletor).first().click(),
    ]);
    const filename = path.basename(download.suggestedFilename());
    if (!/\.(xlsx|xlsm|xlsb|xls|csv|ods)$/i.test(filename)) throw new Error('O RUB não exportou uma planilha. Configure o botão Excel/CSV.');
    const file = path.join(dir, filename);
    await download.saveAs(file);
    const stat = await fs.stat(file);
    if (!stat.size || stat.size > 100 * 1024 * 1024) throw new Error('Planilha vazia ou acima de 100 MB.');
    return { buffer: await fs.readFile(file), filename };
  } finally {
    signal?.removeEventListener('abort', close);
    await browser?.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  }
}
