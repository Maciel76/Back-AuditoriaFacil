import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';

import { connectDB } from '../src/config/db.js';
import { Loja } from '../src/models/Loja.js';
import { processarPlanilha } from '../src/services/auditoriaProcessor.js';

function lerArg(nome) {
  const prefixo = `--${nome}=`;
  const valorInline = process.argv.find((arg) => arg.startsWith(prefixo));
  if (valorInline) return valorInline.slice(prefixo.length).trim();

  const indice = process.argv.indexOf(`--${nome}`);
  if (indice === -1) return '';

  return String(process.argv[indice + 1] || '').trim();
}

function escaparRegex(valor) {
  return valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function resolverLoja(referencia) {
  if (!referencia) throw new Error('Informe --loja com id, codigo, slug ou parte do nome.');

  if (mongoose.Types.ObjectId.isValid(referencia)) {
    const lojaPorId = await Loja.findById(referencia);
    if (lojaPorId) return lojaPorId;
  }

  const regex = new RegExp(escaparRegex(referencia), 'i');
  const lojas = await Loja.find({
    $or: [
      { codigo: referencia },
      { slug: referencia.toLowerCase() },
      { nome: regex },
      { codigo: regex },
      { slug: regex },
    ],
  })
    .sort({ nome: 1 })
    .limit(5);

  if (lojas.length === 0) {
    throw new Error(`Nenhuma loja encontrada para "${referencia}".`);
  }

  if (lojas.length > 1) {
    const opcoes = lojas.map((loja) => `${loja._id} | ${loja.codigo || '-'} | ${loja.nome}`).join('\n');
    throw new Error(`Mais de uma loja encontrada para "${referencia}". Refine o argumento:\n${opcoes}`);
  }

  return lojas[0];
}

async function main() {
  const arquivo = lerArg('file');
  const referenciaLoja = lerArg('loja');
  const tipoForcado = lerArg('tipo') || undefined;

  if (!arquivo) {
    throw new Error('Informe --file com o caminho da planilha a reprocessar.');
  }

  const caminhoAbsoluto = path.resolve(process.cwd(), arquivo);
  if (!fs.existsSync(caminhoAbsoluto)) {
    throw new Error(`Arquivo não encontrado: ${caminhoAbsoluto}`);
  }

  await connectDB();
  const loja = await resolverLoja(referenciaLoja);
  const buffer = fs.readFileSync(caminhoAbsoluto);

  console.log(`→ Reprocessando ${path.basename(caminhoAbsoluto)} para ${loja.codigo || '-'} - ${loja.nome}`);
  const resultado = await processarPlanilha({
    buffer,
    filename: path.basename(caminhoAbsoluto),
    lojaId: loja._id,
    usuarioId: null,
    tipoForcado,
    onProgress: ({ progress, stage }) => {
      if (progress === 100 || progress % 20 === 0) {
        console.log(`   ${String(progress).padStart(3, ' ')}% ${stage}`);
      }
    },
  });

  console.log('\nResumo:');
  console.log(JSON.stringify({
    loja: { id: loja._id, codigo: loja.codigo, nome: loja.nome },
    arquivo: path.basename(caminhoAbsoluto),
    ...resultado,
  }, null, 2));

  await mongoose.disconnect();
}

main().catch(async (erro) => {
  console.error(`Erro: ${erro.message}`);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});