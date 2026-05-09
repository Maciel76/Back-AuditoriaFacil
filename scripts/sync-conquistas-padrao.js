import "dotenv/config";
import mongoose from "mongoose";

import { connectDB } from "../src/config/db.js";
import { sincronizarConquistasPadrao } from "../src/services/conquistasSeed.js";

async function main() {
  await connectDB();
  const resultado = await sincronizarConquistasPadrao();

  if (!resultado.criadas) {
    console.log(
      "[sync-conquistas] nenhuma conquista padrão nova precisava ser criada",
    );
    return;
  }

  console.log(
    `[sync-conquistas] ${resultado.criadas} conquista(s) criada(s): ${resultado.codigosCriados.join(", ")}`,
  );
}

main()
  .catch((error) => {
    console.error(
      "[sync-conquistas] falha ao sincronizar conquistas padrão",
      error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
