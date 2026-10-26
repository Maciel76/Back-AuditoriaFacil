import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { classificar } from "./regras.js";
dayjs.extend(utc);

const pct = (n, d) => d > 0 ? (n / d) * 100 : null;
const round = (n) => n === null ? null : Number(n.toFixed(2));
export function faixaDesempenho(taxa, meta = 98) {
  return taxa === null ? "sem-base" : taxa >= meta ? "verde" : taxa >= Math.min(80, meta) ? "amarelo" : "vermelho";
}

// Cada linha é uma contagem por auditoria, loja, corredor, situação e participante.
// A base inclui itens sem colaborador: omiti-los inflaria o resultado do corredor.
export function resumirDesempenhoCorredores(linhas, referencias = [], meta = 98) {
  const bases = new Map();
  for (const linha of referencias) {
    const g = linha._id;
    const key = JSON.stringify([String(g.loja), dayjs.utc(g.data).format("YYYY-MM-DD"), g.local]);
    bases.set(key, (bases.get(key) || 0) + linha.total);
  }
  const corredores = new Map();
  for (const linha of linhas) {
    const g = linha._id;
    const key = JSON.stringify([String(g.auditoria), String(g.loja), g.local]);
    const corredor = corredores.get(key) || {
      id: key, auditoriaId: String(g.auditoria), lojaId: String(g.loja),
      local: g.local, data: g.data, tipo: g.tipo, totalItens: 0,
      totalLidos: 0, conformes: 0, restantesRuptura: 0, participantes: new Map(),
    };
    const cls = classificar(g.tipo, g.situacao);
    if (cls.conforme !== null) corredor.totalItens += linha.total;
    if (cls.conta) corredor.totalLidos += linha.total;
    if (cls.conta && cls.conforme === true) corredor.conformes += linha.total;
    if (g.situacao === "Sem Presença e Com Estoque") corredor.restantesRuptura += linha.total;
    // Só atribuir participação a quem tem leitura e identidade identificável.
    if (cls.conta && (g.colaborador || g.codigo || g.nome)) {
      const id = g.colaborador ? String(g.colaborador) : JSON.stringify([String(g.loja), g.codigo || g.nome]);
      const participante = corredor.participantes.get(id) || {
        id, colaboradorId: g.colaborador ? String(g.colaborador) : null,
        nome: g.nome || "Colaborador sem nome", codigoExterno: g.codigo || "", lojaId: String(g.loja), totalLidos: 0,
      };
      participante.totalLidos += linha.total;
      corredor.participantes.set(id, participante);
    }
    corredores.set(key, corredor);
  }
  const pessoas = new Map();
  for (const corredor of corredores.values()) {
    let base = corredor.tipo === "ETIQUETA" ? corredor.totalItens : corredor.totalLidos;
    let realizados = corredor.tipo === "ETIQUETA" ? corredor.totalLidos : corredor.conformes;
    let criterio = corredor.tipo === "ETIQUETA" ? "Leitura dos itens auditáveis" : "Conformidade dos itens lidos";
    if (corredor.tipo === "RUPTURA") {
      const dia = dayjs.utc(corredor.data);
      const anterior = dia.subtract(1, "day");
      const mesmaSemana = dia.day() !== 1; // a semana operacional começa na segunda
      const referencia = bases.get(JSON.stringify([corredor.lojaId, anterior.format("YYYY-MM-DD"), corredor.local]));
      base = mesmaSemana ? (referencia || 0) : 0;
      realizados = Math.max(base - corredor.restantesRuptura, 0);
      criterio = "Conclusão sobre a presença do dia anterior";
    }
    const taxa = pct(realizados, base);
    const faixa = faixaDesempenho(taxa, meta);
    for (const p of corredor.participantes.values()) {
      const pessoa = pessoas.get(p.id) || { ...p, totalLidos: 0, historico: [], verde: 0, amarelo: 0, vermelho: 0, "sem-base": 0, base: 0, realizados: 0 };
      pessoa.totalLidos += p.totalLidos;
      pessoa[faixa]++;
      pessoa.base += base;
      pessoa.realizados += realizados;
      pessoa.historico.push({
        id: corredor.id, auditoriaId: corredor.auditoriaId, lojaId: corredor.lojaId,
        local: corredor.local, data: corredor.data, tipo: corredor.tipo,
        taxa: round(taxa), faixa, metaBatida: faixa === "verde", criterio,
        base, realizados, totalItens: corredor.totalItens, totalLidos: corredor.totalLidos,
        minhaLeitura: p.totalLidos, participantes: corredor.participantes.size,
        participacao: round(pct(p.totalLidos, corredor.totalLidos)),
      });
      pessoas.set(p.id, pessoa);
    }
  }
  return Array.from(pessoas.values()).map((p) => {
    const avaliados = p.verde + p.amarelo + p.vermelho;
    return { ...p, taxa: round(pct(p.realizados, p.base)), percentualMeta: round(pct(p.verde, avaliados)),
      totalParticipacoes: p.historico.length, avaliados,
      totalAuditorias: new Set(p.historico.map((h) => h.auditoriaId)).size,
      totalCorredores: new Set(p.historico.map((h) => JSON.stringify([h.lojaId, h.local]))).size,
      historico: p.historico.sort((a, b) => new Date(b.data) - new Date(a.data) || a.local.localeCompare(b.local, "pt-BR")),
    };
  }).sort((a, b) => (b.percentualMeta ?? -1) - (a.percentualMeta ?? -1) || (b.taxa ?? -1) - (a.taxa ?? -1) || b.totalLidos - a.totalLidos || a.nome.localeCompare(b.nome, "pt-BR"))
    .map((p, i) => ({ ...p, posicao: i + 1 }));
}
