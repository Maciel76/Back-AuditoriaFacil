import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { lerPlanilha } from './src/services/planilhaParser.js';

// Setup Mongoose schemas (simplified based on typical usage)
const auditItemSchema = new mongoose.Schema({
  lojaCodigo: Number,
  tipo: String,
  situacao: String,
  custoRuptura: Number,
  auditadoEm: Date,
}, { collection: 'audititems' });

const metricaDiariaSchema = new mongoose.Schema({
  lojaCodigo: Number,
  tipo: String,
  data: Date,
  custoRuptura: Number,
}, { collection: 'metricadiarias' });

const AuditItem = mongoose.model('AuditItem', auditItemSchema);
const MetricaDiaria = mongoose.model('MetricaDiaria', metricaDiariaSchema);

async function run() {
  try {
    // 1. Planilha
    const filePath = '../frontend/Ruptura 08-06.xlsx';
    const buffer = fs.readFileSync(filePath);
    const result = lerPlanilha(buffer, { filename: 'Ruptura 08-06.xlsx' });
    const targetSituacao = 'Sem Presença e Com Estoque';
    const planilhaCusto = result.linhas
      .filter(l => l.situacao === targetSituacao)
      .reduce((acc, curr) => acc + (curr.custoRuptura || 0), 0);
    
    console.log('--- Planilha ---');
    console.log(`Custo Ruptura ('${targetSituacao}'): ${planilhaCusto}`);

    // 2. Banco de Dados
    await mongoose.connect('mongodb://localhost:27017/novaauditoria'); // Adjust DB name if needed
    
    const lojaCodigo = 347;
    const lastAudit = await AuditItem.findOne({ lojaCodigo, tipo: 'RUPTURA' })
      .sort({ auditadoEm: -1 });
    
    if (!lastAudit) {
      console.log('Nenhum dado de auditoria encontrado no banco para a loja 347.');
    } else {
      const dataFim = new Date(lastAudit.auditadoEm);
      dataFim.setHours(23, 59, 59, 999);
      const dataInicio = new Date(lastAudit.auditadoEm);
      dataInicio.setHours(0, 0, 0, 0);

      const dbItems = await AuditItem.find({
        lojaCodigo,
        tipo: 'RUPTURA',
        auditadoEm: { $gte: dataInicio, $lte: dataFim },
        situacao: targetSituacao
      });

      const dbCustoItems = dbItems.reduce((acc, curr) => acc + (curr.custoRuptura || 0), 0);
      console.log('\n--- Banco (AuditItem) ---');
      console.log(`Última data encontrada: ${dataInicio.toISOString().split('T')[0]}`);
      console.log(`Custo Ruptura para '${targetSituacao}': ${dbCustoItems}`);

      // 3. MetricaDiaria
      const metrica = await MetricaDiaria.findOne({
        lojaCodigo,
        tipo: 'RUPTURA',
        data: dataInicio
      });
      console.log('\n--- MetricaDiaria ---');
      console.log(`Custo Ruptura consolidado: ${metrica ? metrica.custoRuptura : 'Não encontrado'}`);
      
      if (metrica) {
        const d_item = dbCustoItems.toFixed(2);
        const d_metrica = metrica.custoRuptura.toFixed(2);
        if (d_item === d_metrica) {
           console.log('\nResultado: O custo consolidado da métrica CONCORDA com o custo operacional.');
        } else {
           console.log(`\nResultado: O custo consolidado da métrica DIVERGE do custo operacional (${d_metrica} vs ${d_item}).`);
        }
      }
    }

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
