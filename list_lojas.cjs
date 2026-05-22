const mongoose = require('mongoose');
async function run() {
  await mongoose.connect('mongodb://127.0.0.1:27017/novaauditoria');
  const lojas = await mongoose.connection.db.collection('lojas').find().toArray();
  console.log("Lojas:", lojas.map(l => ({ codigo: l.codigo, nome: l.nome, _id: l._id })));
  
  const mLoja = await mongoose.connection.db.collection('metricadiarias').findOne();
  if (mLoja) console.log("Exemplo Codigo Metrica:", mLoja.lojaCodigo, typeof mLoja.lojaCodigo);
  
  await mongoose.disconnect();
}
run();
