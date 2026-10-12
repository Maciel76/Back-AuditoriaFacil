import { test } from 'node:test';
import assert from 'node:assert/strict';
import XLSX from '../../node_modules/xlsx/xlsx.js';
import { lerPlanilha } from '../../src/services/planilhaParser.js';

test('planilhas Excel preservam código, datas e valores após ajuste de CSV', () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ Código: '00123', Produto: 'Arroz', Situação: 'Atualizado', 'Auditado em': '10/10/2026', 'Estoque atual': 20 }]), 'Etiqueta');
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  const parsed = lerPlanilha(buffer, { filename: 'auditoria.xlsx', tipoForcado: 'ETIQUETA' });
  assert.equal(parsed.linhas[0].codigo, '00123');
  assert.equal(parsed.linhas[0].estoqueAtual, 20);
  assert.equal(parsed.dataAuditoria.getDate(), 10);
});
