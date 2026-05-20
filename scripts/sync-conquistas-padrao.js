import "dotenv/config";
import mongoose from "mongoose";

import { connectDB } from "../src/config/db.js";
import { sincronizarConquistasPadrao } from "../src/services/conquistasSeed.js";

async function main() {
  await connectDB();
  const resultado = await sincronizarConquistasPadrao();

  if (!resultado.criadas && !resultado.atualizadas) {
    console.log(
      "[sync-conquistas] nenhuma conquista padrão precisava ser criada ou atualizada",
    );
    return;
  }

  if (resultado.criadas) {
    console.log(
      `[sync-conquistas] ${resultado.criadas} conquista(s) criada(s): ${resultado.codigosCriados.join(", ")}`,
    );
  }

  if (resultado.atualizadas) {
    console.log(
      `[sync-conquistas] ${resultado.atualizadas} conquista(s) atualizada(s): ${resultado.codigosAtualizados.join(", ")}`,
    );
    console.log(
      "[sync-conquistas] rode node --env-file=.env scripts/recompute-acumulados.js para reavaliar as conquistas ja persistidas dos colaboradores.",
    );
  }
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
