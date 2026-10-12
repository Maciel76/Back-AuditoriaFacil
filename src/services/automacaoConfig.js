import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';

export const hashChave = (value) => createHash('sha256').update(value).digest('hex');
export const novaChave = () => 'flh_' + randomBytes(32).toString('hex');
export const diaBrasil = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

const seletor = z.string().trim().min(1).max(500);
export const rotinaSchema = z.object({
  nome: z.string().trim().min(1).max(80),
  caminho: z.string().trim().min(1).max(1000).refine(v => v.startsWith('/') && !v.startsWith('//') && !v.includes('\\'), 'Use um caminho dentro do RUB, começando por /'),
  tipo: z.enum(['ETIQUETA', 'PRESENCA', 'RUPTURA']),
  intervaloMinutos: z.number().int().min(5).max(10080),
  usuarioSeletor: seletor,
  senhaSeletor: seletor,
  entrarSeletor: seletor,
  prontoSeletor: seletor,
  downloadSeletor: seletor,
  passos: z.array(z.object({
    acao: z.enum(['clicar', 'preencher', 'selecionar', 'aguardar', 'marcar', 'desmarcar']),
    seletor,
    valor: z.string().max(1000).default(''),
  }).strict()).max(40),
}).strict();

export function validarDataAlvo(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(value + 'T12:00:00Z');
  return !Number.isNaN(+date) && date.toISOString().slice(0, 10) === value;
}
