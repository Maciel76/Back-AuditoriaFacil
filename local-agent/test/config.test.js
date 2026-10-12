import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiAddress, rubAddress, targetAddress, template } from '../src/config.js';
import { rotinaSchema, diaBrasil, validarDataAlvo } from '../../src/services/automacaoConfig.js';

test('não envia a chave por HTTP público ou URLs com credenciais', () => {
  assert.equal(apiAddress('https://flashub.example/api/'), 'https://flashub.example/api');
  assert.equal(apiAddress('http://localhost:4000/api'), 'http://localhost:4000/api');
  for (const url of ['http://flashub.example/api', 'https://user:pass@host/api', 'https://host/api?token=x']) assert.throws(() => apiAddress(url));
});
test('tarefas remotas não podem trocar o destino local permitido', () => {
  const base = rubAddress('http://10.0.0.20/vue/#/inicio');
  assert.equal(targetAddress(base, '/vue/#/auditoria'), 'http://10.0.0.20/vue/#/auditoria');
  for (const p of ['//10.0.0.1/admin', 'http://other/', '/\\other/path', 'file:///C:/']) assert.throws(() => targetAddress(base, p));
});
test('datas de São Paulo e substituições dos filtros', () => {
  assert.equal(diaBrasil(new Date('2026-10-10T01:00:00Z')), '2026-10-09');
  assert.equal(template('{{data}} / {{dataBR}}', '2026-10-10'), '2026-10-10 / 10/10/2026');
  assert.equal(validarDataAlvo('2026-02-30'), false);
  assert.equal(validarDataAlvo('2026-10-10'), true);
});
test('rotinas não aceitam scripts remotos ou caminhos externos', () => {
  const base = { nome: 'Teste', caminho: '/auditoria', tipo: 'ETIQUETA', intervaloMinutos: 60, usuarioSeletor: '#user', senhaSeletor: '#pass', entrarSeletor: '#login', prontoSeletor: '#ready', downloadSeletor: '#export', passos: [] };
  assert.equal(rotinaSchema.safeParse(base).success, true);
  assert.equal(rotinaSchema.safeParse({ ...base, passos: [{ acao: 'eval', seletor: 'body', valor: 'process.exit()' }] }).success, false);
  assert.equal(rotinaSchema.safeParse({ ...base, caminho: '//other' }).success, false);
});
