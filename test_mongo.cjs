const mongoose = require('mongoose');

async function run() {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/novaauditoria');
    const db = mongoose.connection.db;
    const lojaCodigo = 347;

    console.log("--- MetricaDiaria (colaborador=null, tipos PRESENCA/RUPTURA) ---");
    // Tentando nomes comuns de coleções (metricadiarias ou metricadiaria)
    let collectionName = 'metricadiarias';
    let collections = await db.listCollections().toArray();
    if (!collections.find(c => c.name === 'metricadiarias') && collections.find(c => c.name === 'metricadiaria')) {
        collectionName = 'metricadiaria';
    }

    const metricas = await db.collection(collectionName).find({
        lojaCodigo: lojaCodigo,
        colaborador: null,
        tipo: { $in: ["PRESENCA", "RUPTURA"] }
    }).sort({ data: -1 }).limit(5).toArray();

    metricas.forEach(m => {
        console.log(`Data: ${m.data}, Tipo: ${m.tipo}, Itens Auditáveis: ${m.totalItensAuditaveis}, Lidos: ${m.totalLidos}, Conformes: ${m.totalConformes}, Não Conformes: ${m.totalNaoConformes}`);
        console.log(`Situacoes: ${JSON.stringify(m.situacoes)}`);
        console.log("---");
    });

    console.log("\n--- AuditItem (PRESENCA/RUPTURA contagem por data e situacao) ---");
    let auditCollectionName = 'audititems';
    if (!collections.find(c => c.name === 'audititems') && collections.find(c => c.name === 'audititem')) {
        auditCollectionName = 'audititem';
    }

    const auditItems = await db.collection(auditCollectionName).aggregate([
        { $match: { lojaCodigo: lojaCodigo, tipo: { $in: ["PRESENCA", "RUPTURA"] } } },
        { $group: {
            _id: { data: "$data", situacao: "$situacao" },
            count: { $sum: 1 }
        }},
        { $group: {
            _id: "$_id.data",
            situacoes: { $push: { situacao: "$_id.situacao", count: "$count" } },
            total: { $sum: "$count" }
        }},
        { $sort: { _id: -1 } },
        { $limit: 5 }
    ]).toArray();

    auditItems.forEach(item => {
        console.log(`Data: ${JSON.stringify(item._id)}`);
        item.situacoes.forEach(s => {
            console.log(`  Situacao: ${s.situacao}, Contagem: ${s.count}`);
        });
        console.log(`  Total: ${item.total}`);
        console.log("---");
    });

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
