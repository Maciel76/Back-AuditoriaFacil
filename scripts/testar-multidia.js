/**
 * Teste estendido: valida que aggregations sobre semana/mes/historico
 * refletem APENAS a ultima planilha de cada dia, mesmo apos varios uploads.
 *
 * Cenario:
 *   Dia A (3 dias atras): 3 uploads -> deve contar so o ultimo
 *   Dia B (1 dia atras):  2 uploads -> deve contar so o ultimo
 *   Dia C (hoje):         4 uploads -> deve contar so o ultimo
 *
 * Verificacoes:
 *   - MetricaDiaria por dia tem 1 doc por (loja,tipo,colab,data)
 *   - Soma de week aggregation = ultimo upload de A + ultimo de B + ultimo de C
 *   - Colaborador.totalItensLidos = soma das MetricaDiaria do colaborador
 *   - Loja.pontuacao = soma das MetricaDiaria da loja consolidada
 *
 * Execucao:
 *   node --env-file=.env scripts/testar-multidia.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';

import { connectDB } from '../src/config/db.js';
import { processarPlanilha } from '../src/services/auditoriaProcessor.js';
import { Loja } from '../src/models/Loja.js';
import { Colaborador } from '../src/models/Colaborador.js';
import { MetricaDiaria } from '../src/models/MetricaDiaria.js';
import { Auditoria } from '../src/models/Auditoria.js';
import { AuditItem } from '../src/models/AuditItem.js';

const LOJA_CODIGO = 'TEST-MULTIDIA';
let erros = 0;

const ok = (l) => console.log(`  \u2713  ${l}`);
const fail = (l, e, r) => {
  console.error(`  \u2717  ${l}`);
  console.error(`     esperado: ${JSON.stringify(e)}`);
  console.error(`     recebido: ${JSON.stringify(r)}`);
  erros++;
};
const checar = (l, e, r) => {
  if (Math.abs(Number(e) - Number(r || 0)) < 0.01) ok(l);
  else fail(l, e, r);
};

function montarPlanilha(linhas) {
  const dados = linhas.map((l) => ({
    'Código': l.codigo,
    'Produto': l.produto || 'PRODUTO',
    'Classe de Produto': l.classe || 'CLASSE A',
    'Setor': 'S01',
    'Local': 'G01A',
    'Usuário': l.usuario,
    'Situação': l.situacao,
    'Auditado Em': l.auditadoEm,
  }));
  const ws = XLSX.utils.json_to_sheet(dados);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Itens da Auditoria de Etiqueta');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function limpar(lojaId) {
  if (!lojaId) return;
  await AuditItem.deleteMany({ loja: lojaId });
  await Auditoria.deleteMany({ loja: lojaId });
  await MetricaDiaria.deleteMany({ loja: lojaId });
  await Colaborador.deleteMany({ loja: lojaId });
  await Loja.deleteOne({ _id: lojaId });
}

/** Gera linhas simples: (qtdAtualizado, qtdDesatualizado) para um colaborador num dia */
function gerarLinhas(colabId, colabNome, qtdAtualizado, qtdDesatualizado, diaStr, prefixo) {
  const linhas = [];
  for (let i = 0; i < qtdAtualizado; i += 1)
    linhas.push({ codigo: `${prefixo}-A-${i}`, usuario: `${colabId} (${colabNome})`, situacao: 'Atualizado', auditadoEm: diaStr });
  for (let i = 0; i < qtdDesatualizado; i += 1)
    linhas.push({ codigo: `${prefixo}-D-${i}`, usuario: `${colabId} (${colabNome})`, situacao: 'Desatualizado', auditadoEm: diaStr });
  return linhas;
}

async function processar(filename, lojaId, linhas) {
  return processarPlanilha({
    buffer: montarPlanilha(linhas),
    filename,
    lojaId,
    usuarioId: null,
    tipoForcado: 'ETIQUETA',
  });
}

async function main() {
  await connectDB();
  console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  console.log('  TESTE: agregacao multi-dia com varios uploads por dia');
  console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');

  const lojaAntiga = await Loja.findOne({ codigo: LOJA_CODIGO });
  if (lojaAntiga) await limpar(lojaAntiga._id);

  const loja = await Loja.create({
    nome: 'Loja Teste MultiDia',
    slug: 'loja-teste-multidia',
    codigo: LOJA_CODIGO,
  });

  // ----- Datas dos dias do teste -----
  const diaA = dayjs().subtract(3, 'day').format('DD/MM/YYYY');
  const diaB = dayjs().subtract(1, 'day').format('DD/MM/YYYY');
  const diaC = dayjs().format('DD/MM/YYYY');

  // ============================================================
  // DIA A: 3 uploads — somente o ultimo deve valer
  // ============================================================
  console.log(`-> DIA A (${diaA}) - 3 uploads`);

  // Upload A.1: Colab1 leu 5 (4 ok)
  await processar('A1.xlsx', loja._id, gerarLinhas('1111', 'COLAB UM', 4, 1, diaA, 'A1'));
  // Upload A.2: Colab1 leu 7 (5 ok), Colab2 entrou com 3 (3 ok)
  await processar('A2.xlsx', loja._id,
    [...gerarLinhas('1111', 'COLAB UM', 5, 2, diaA, 'A2'),
     ...gerarLinhas('2222', 'COLAB DOIS', 3, 0, diaA, 'A2C')]);
  // Upload A.3 (FINAL DO DIA A): Colab1 leu 10 (9 ok); Colab2 nao aparece
  await processar('A3.xlsx', loja._id, gerarLinhas('1111', 'COLAB UM', 9, 1, diaA, 'A3'));

  // ============================================================
  // DIA B: 2 uploads — somente o ultimo deve valer
  // ============================================================
  console.log(`-> DIA B (${diaB}) - 2 uploads`);

  // Upload B.1: Colab1 leu 6, Colab3 leu 2
  await processar('B1.xlsx', loja._id,
    [...gerarLinhas('1111', 'COLAB UM', 5, 1, diaB, 'B1'),
     ...gerarLinhas('3333', 'COLAB TRES', 2, 0, diaB, 'B1C')]);
  // Upload B.2 (FINAL DO DIA B): Colab1 leu 4, Colab3 leu 1
  await processar('B2.xlsx', loja._id,
    [...gerarLinhas('1111', 'COLAB UM', 3, 1, diaB, 'B2'),
     ...gerarLinhas('3333', 'COLAB TRES', 1, 0, diaB, 'B2C')]);

  // ============================================================
  // DIA C (HOJE): 4 uploads — somente o ultimo deve valer
  // ============================================================
  console.log(`-> DIA C (${diaC}) - 4 uploads`);

  await processar('C1.xlsx', loja._id, gerarLinhas('1111', 'COLAB UM', 100, 0, diaC, 'C1'));
  await processar('C2.xlsx', loja._id, gerarLinhas('1111', 'COLAB UM', 50, 50, diaC, 'C2'));
  await processar('C3.xlsx', loja._id, gerarLinhas('1111', 'COLAB UM', 1, 1, diaC, 'C3'));
  // Upload C.4 (FINAL DO DIA C): Colab1 leu 8 (6 ok), Colab2 leu 2 (2 ok)
  await processar('C4.xlsx', loja._id,
    [...gerarLinhas('1111', 'COLAB UM', 6, 2, diaC, 'C4'),
     ...gerarLinhas('2222', 'COLAB DOIS', 2, 0, diaC, 'C4C')]);

  // ============================================================
  // VERIFICACOES
  // ============================================================
  console.log('\n\u2550\u2550\u2550 VERIFICACOES \u2550\u2550\u2550\n');

  // 1) Apenas 1 Auditoria por (loja, tipo, dia)
  const totalAuditorias = await Auditoria.countDocuments({ loja: loja._id });
  checar('Total de Auditorias = 3 (1 por dia)', 3, totalAuditorias);

  // 2) Apenas 1 MetricaDiaria consolidada por dia
  const md_loja = await MetricaDiaria.find({ loja: loja._id, colaborador: null }).sort({ data: 1 }).lean();
  checar('MetricaDiaria consolidada loja: 3 docs (1 por dia)', 3, md_loja.length);

  // 3) Valores por dia (deve refletir o ultimo upload do dia)
  // Dia A.3: 9 ok + 1 desv = 10 lidos, 9 conformes
  // Dia B.2: 3+1+1+0 = 5 lidos (4 ok), 4 conformes
  // Dia C.4: 6+2+2+0 = 10 lidos (8 ok), 8 conformes
  checar('Dia A loja: totalLidos = 10 (so A.3)', 10, md_loja[0]?.totalLidos);
  checar('Dia A loja: totalConformes = 9 (so A.3)', 9, md_loja[0]?.totalConformes);
  checar('Dia B loja: totalLidos = 5 (so B.2)', 5, md_loja[1]?.totalLidos);
  checar('Dia B loja: totalConformes = 4 (so B.2)', 4, md_loja[1]?.totalConformes);
  checar('Dia C loja: totalLidos = 10 (so C.4)', 10, md_loja[2]?.totalLidos);
  checar('Dia C loja: totalConformes = 8 (so C.4)', 8, md_loja[2]?.totalConformes);

  // 4) Agregacao "tudo" via aggregate(MetricaDiaria) deve somar so os 3 dias finais
  const agregadoTotal = await MetricaDiaria.aggregate([
    { $match: { loja: loja._id, colaborador: null } },
    { $group: { _id: null, lidos: { $sum: '$totalLidos' }, conf: { $sum: '$totalConformes' } } },
  ]);
  checar('AGG TUDO: lidos = 25 (10+5+10)', 25, agregadoTotal[0]?.lidos);
  checar('AGG TUDO: conformes = 21 (9+4+8)', 21, agregadoTotal[0]?.conf);

  // 5) Agregacao via AuditItem (usado nos relatorios) tambem deve refletir so o ultimo upload de cada dia
  const aggItems = await AuditItem.aggregate([
    { $match: { loja: loja._id } },
    { $group: { _id: null, total: { $sum: 1 }, conformes: { $sum: { $cond: [{ $eq: ['$conforme', true] }, 1, 0] } } } },
  ]);
  checar('AGG AuditItem TUDO: total = 25', 25, aggItems[0]?.total);
  checar('AGG AuditItem TUDO: conformes = 21', 21, aggItems[0]?.conformes);

  // 6) Colaborador 1 (1111): A.3=10 + B.2=4 + C.4=8 = 22 lidos, 9+3+6=18 conformes, 3 dias = 3 auditorias
  const colab1 = await Colaborador.findOne({ loja: loja._id, codigoExterno: '1111' });
  checar('Colab UM: totalItensLidos = 22 (10+4+8)', 22, colab1?.totalItensLidos);
  checar('Colab UM: totalItensConformes = 18 (9+3+6)', 18, colab1?.totalItensConformes);
  checar('Colab UM: totalAuditorias = 3 (3 dias)', 3, colab1?.totalAuditorias);

  // 7) Colaborador 2 (2222): apareceu em A (mas nao no A.3 final) + C.4 final = so 2 lidos, 2 conformes, 1 auditoria
  const colab2 = await Colaborador.findOne({ loja: loja._id, codigoExterno: '2222' });
  checar('Colab DOIS: totalItensLidos = 2 (so dia C.4)', 2, colab2?.totalItensLidos);
  checar('Colab DOIS: totalItensConformes = 2', 2, colab2?.totalItensConformes);
  checar('Colab DOIS: totalAuditorias = 1', 1, colab2?.totalAuditorias);

  // 8) Colaborador 3 (3333): so dia B.2 final = 1 lido, 1 conforme, 1 auditoria
  const colab3 = await Colaborador.findOne({ loja: loja._id, codigoExterno: '3333' });
  checar('Colab TRES: totalItensLidos = 1 (so B.2)', 1, colab3?.totalItensLidos);
  checar('Colab TRES: totalItensConformes = 1', 1, colab3?.totalItensConformes);
  checar('Colab TRES: totalAuditorias = 1', 1, colab3?.totalAuditorias);

  // 9) Colaborador.totalItensLidos == sum(MetricaDiaria do colab) (consistencia)
  for (const c of [colab1, colab2, colab3]) {
    if (!c) continue;
    const agg = await MetricaDiaria.aggregate([
      { $match: { loja: loja._id, colaborador: c._id } },
      { $group: { _id: null, lidos: { $sum: '$totalLidos' }, conf: { $sum: '$totalConformes' } } },
    ]);
    const aggLidos = agg[0]?.lidos || 0;
    const aggConf = agg[0]?.conf || 0;
    checar(`Colab ${c.codigoExterno}: acumulado bate com soma MetricaDiaria (lidos)`, c.totalItensLidos, aggLidos);
    checar(`Colab ${c.codigoExterno}: acumulado bate com soma MetricaDiaria (conformes)`, c.totalItensConformes, aggConf);
  }

  // Limpeza
  await limpar(loja._id);

  console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  if (erros === 0) console.log('  RESULTADO: TODOS OS TESTES PASSARAM \u2713');
  else console.log(`  RESULTADO: ${erros} TESTE(S) FALHARAM \u2717`);
  console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');
  await mongoose.disconnect();
  process.exit(erros > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Erro inesperado:', e);
  process.exit(1);
});
