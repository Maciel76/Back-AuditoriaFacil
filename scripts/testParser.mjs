import { lerPlanilha } from '../src/services/planilhaParser.js';
import { classificar } from '../src/services/regras.js';
import fs from 'node:fs';

const arquivos = ['Etiqueta 08-04.xlsx', 'Presença 08-05.xlsx', 'Ruptura 08-06.xlsx'];
for (const f of arquivos) {
  try {
  const buf = fs.readFileSync('../' + f);
  const r = lerPlanilha(buf, { filename: f });
  let lidos = 0, conf = 0, nconf = 0, pts = 0, custo = 0;
  const sit = {};
  for (const l of r.linhas) {
    const c = classificar(r.tipo, l.situacao);
    sit[l.situacao] = (sit[l.situacao] || 0) + 1;
    if (c.conta) {
      lidos++;
      if (c.conforme === true) conf++;
      else if (c.conforme === false) nconf++;
      pts += c.pontos;
    }
    if (typeof l.custoRuptura === 'number' && c.conforme === false) custo += l.custoRuptura;
  }
  console.log('==', f);
  console.log('  tipo:', r.tipo, '| data:', r.dataAuditoria.toISOString().slice(0, 10), '| linhas:', r.linhas.length);
  console.log('  lidos:', lidos, '| conf:', conf, '| nconf:', nconf, '| pts:', pts.toFixed(1));
  console.log('  custo ruptura: R$', custo.toFixed(2));
  console.log('  conformidade:', lidos ? ((conf / lidos) * 100).toFixed(2) + '%' : '-');
  console.log('  situacoes:', sit);
  console.log('  amostra colab:', r.linhas.find((x) => x.colaboradorCodigo)?.colaboradorNome);
  } catch (e) { console.error('ERRO em', f, ':', e.message); }
}
