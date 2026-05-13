/**
 * Regras de classificação e pontuação por tipo de auditoria.
 * Pontuação positiva premia conformidade; negativa penaliza não-conformidade crítica;
 * 0 = neutro (não conta para conformidade nem penaliza).
 */

export const REGRAS = {
  ETIQUETA: {
    label: 'Etiqueta',
    situacoes: {
      'Atualizado': { conforme: true, pontos: 1, conta: true },
      'Desatualizado': { conforme: false, pontos: -1, conta: true },
      'Lido sem estoque': { conforme: true, pontos: 0.2, conta: true },
      'Lido não pertence': { conforme: false, pontos: -0.2, conta: true },
      'Não lidos com estoque': { conforme: false, pontos: 0, conta: false },
      'Sem Estoque': { conforme: null, pontos: 0, conta: false },
    },
  },
  PRESENCA: {
    label: 'Presença',
    situacoes: {
      'Com Presença e com Estoque': { conforme: true, pontos: 1, conta: true },
      'Sem Presença e Com Estoque': { conforme: false, pontos: -1, conta: true },
      'Com Presença e sem Estoque': { conforme: true, pontos: 0.3, conta: true },
      'Sem Presença e Sem Estoque': { conforme: null, pontos: 0, conta: false },
      'Lido não pertence': { conforme: false, pontos: -0.2, conta: true },
    },
  },
  RUPTURA: {
    label: 'Ruptura',
    situacoes: {
      'Sem Presença e Com Estoque': { conforme: false, pontos: -2, conta: true }, // ruptura crítica
      'Com Presença e com Estoque': { conforme: true, pontos: 1, conta: true },
      'Com Presença e sem Estoque': { conforme: true, pontos: 0.3, conta: true },
      'Sem Presença e Sem Estoque': { conforme: null, pontos: 0, conta: false },
      'Lido não pertence': { conforme: false, pontos: -0.2, conta: true },
    },
  },
};

export function classificar(tipo, situacao) {
  const regra = REGRAS[tipo]?.situacoes?.[situacao];
  if (!regra) return { conforme: null, pontos: 0, conta: false };
  return regra;
}
