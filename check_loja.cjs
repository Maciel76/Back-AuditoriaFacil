const mongoose = require('mongoose');
async function run() {
  await mongoose.connect('mongodb://127.0.0.1:27017/novaauditoria');
  const countMetricas = await mongoose.connection.db.collection('metricadiarias').countDocuments({ lojaCodigo: 347 });
  const countAudit = await mongoose.connection.db.collection('audititems').countDocuments({ lojaCodigo: 347 });
  console.log(`Loja 347 - Metricas: ${countMetricas}, AuditItems: ${countAudit}`);
  
  const sampleMetrica = await mongoose.connection.db.collection('metricadiarias').findOne({ lojaCodigo: 347 });
  console.log("Exemplo Metrica:", JSON.stringify(sampleMetrica, null, 2));

  const sampleAudit = await mongoose.connection.db.collection('audititems').findOne({ lojaCodigo: 347 });
  console.log("Exemplo AuditItem:", JSON.stringify(sampleAudit, null, 2));

  await mongoose.disconnect();
}
run();
