export const REGRAS_RESIDUAIS = Object.freeze({
  diasSemVendaMaiorQue: 10,
  estoqueMaiorQue: 0,
  estoqueMenorQue: 10,
  classesExcluidas: ["Bazar", "Cigarro", "Whisky", "Vinho"],
});

function normalizarClasse(valor) {
  return String(valor || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function classeExcluidaResidual(item) {
  // Verifica os dois níveis da classificação, sem usar a descrição do produto.
  const excluida = /\b(?:bazar(?:es)?|cigarros?|whisk(?:y|ey|ies|eys)|wisk(?:y|ey|er)|vinhos?)\b/;
  return [item.classeRaiz, item.classe].some((classe) => excluida.test(normalizarClasse(classe)));
}

export function ehResidual(item) {
  return Boolean(String(item.codigo ?? "").trim()) &&
    Number.isFinite(item.estoqueAtual) &&
    item.estoqueAtual > REGRAS_RESIDUAIS.estoqueMaiorQue &&
    item.estoqueAtual < REGRAS_RESIDUAIS.estoqueMenorQue &&
    Number.isFinite(item.diasSemVenda) &&
    item.diasSemVenda > REGRAS_RESIDUAIS.diasSemVendaMaiorQue &&
    !classeExcluidaResidual(item);
}

// Recebe somente itens de uma auditoria, ordenados do registro mais recente ao mais antigo.
export function montarResiduais(registros) {
  const porCodigo = new Map();
  for (const item of registros) {
    const codigo = String(item.codigo ?? "").trim();
    if (item.cancelada === true || !codigo || porCodigo.has(codigo)) continue;
    // Deduplica antes do filtro para não recuperar estoque antigo de um código repetido.
    porCodigo.set(codigo, { ...item, codigo });
  }

  const produtos = [...porCodigo.values()];
  const items = produtos.filter(ehResidual).map((item) => ({
    codigo: item.codigo,
    produto: item.produto || "Produto sem descrição",
    classeRaiz: item.classeRaiz || "",
    classe: item.classe || "",
    local: item.local || "",
    estoqueAtual: item.estoqueAtual,
    diasSemVenda: item.diasSemVenda,
  }));
  const comparador = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
  items.sort((a, b) => comparador.compare(a.local, b.local) || comparador.compare(a.codigo, b.codigo));

  return {
    items,
    resumo: {
      totalAnalisados: produtos.length,
      totalProdutos: items.length,
      quantidadeEstoque: items.reduce((total, item) => total + item.estoqueAtual, 0),
      semDados: produtos.filter((item) => !Number.isFinite(item.estoqueAtual) || !Number.isFinite(item.diasSemVenda)).length,
    },
  };
}
