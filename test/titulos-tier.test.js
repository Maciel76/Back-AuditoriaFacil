import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOGO_LOJA_PORTAL, TIERS_TITULOS, podeComprarTitulo, maiorTierTitulo } from '../src/services/lojaPortalService.js';

test('exatamente dois títulos por tier, com códigos únicos', () => {
  const titulos = CATALOGO_LOJA_PORTAL.filter(i => (i.categoria || 'titulo') === 'titulo');
  assert.equal(titulos.length, 16);
  assert.equal(new Set(CATALOGO_LOJA_PORTAL.map(i => i.codigo)).size, CATALOGO_LOJA_PORTAL.length);
  for (const tier of TIERS_TITULOS) assert.equal(titulos.filter(i => i.tier === tier).length, 2);
});

test('cada tier libera somente títulos do próprio tier e inferiores', () => {
  for (let nivel = -1; nivel < TIERS_TITULOS.length; nivel++) {
    const colaborador = { conquistas: nivel < 0 ? [] : [{ tierAtual: TIERS_TITULOS[nivel] }] };
    for (let alvo = 0; alvo < TIERS_TITULOS.length; alvo++) {
      assert.equal(podeComprarTitulo(colaborador, { tier: TIERS_TITULOS[alvo] }), alvo <= nivel);
    }
    assert.equal(podeComprarTitulo(colaborador, { categoria: 'mascote' }), true);
  }
});

test('considera conquistas de qualquer categoria e histórico desbloqueado', () => {
  assert.equal(maiorTierTitulo({ conquistas: [
    { tierAtual: 'comum' }, { tiersDesbloqueados: ['lendario'] },
    { historicoDesbloqueios: [{ nivel: 'mitico' }] },
  ] }), 5);
  assert.equal(maiorTierTitulo({ conquistas: [{ tierAtual: 'invalido' }] }), -1);
});
