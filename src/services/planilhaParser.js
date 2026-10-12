import * as XLSX from "xlsx";
import { isUtf8 } from "node:buffer";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
dayjs.extend(customParseFormat);

import { TIPOS_AUDITORIA } from "../models/Auditoria.js";

const FORMATOS_DATA = [
  "DD/MM/YYYY",
  "D/M/YYYY",
  "M/D/YY",
  "M/D/YYYY",
  "YYYY-MM-DD",
  "YYYY/MM/DD",
];

function parseData(v) {
  if (!v && v !== 0) return null;
  if (v instanceof Date) return dayjs(v).isValid() ? v : null;
  const s = String(v).trim();
  for (const f of FORMATOS_DATA) {
    const d = dayjs(s, f, true);
    if (d.isValid()) return d.toDate();
  }
  const d = dayjs(s);
  return d.isValid() ? d.toDate() : null;
}

function parseDataHora(data, hora) {
  const d = parseData(data);
  if (!d) return null;
  if (!hora) return d;
  const m = String(hora).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return d;
  d.setHours(Number(m[1]), Number(m[2]), Number(m[3] || 0), 0);
  return d;
}

function parseNumero(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).trim().replace(/\s+/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  let normalized = s;
  if (lastComma > -1 && lastDot > -1) {
    normalized =
      lastComma > lastDot
        ? s.replace(/\./g, "").replace(",", ".")
        : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    const decimalDigits = s.length - lastComma - 1;
    normalized =
      decimalDigits === 3
        ? s.replace(/,/g, "")
        : s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > -1) {
    const decimalDigits = s.length - lastDot - 1;
    normalized = decimalDigits === 3 ? s.replace(/\./g, "") : s;
  }

  const n = Number(normalized.replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseBool(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (["sim", "yes", "true", "1", "s"].includes(s)) return true;
  if (["não", "nao", "no", "false", "0", "n"].includes(s)) return false;
  return null;
}

/** "2692473 (NEILTON PEREIRA LIMA)" → { codigo, nome } */
function parseUsuario(v) {
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/^(\S+?)\s*\((.+)\)\s*$/);
  if (m) return { codigo: m[1].trim(), nome: m[2].trim() };
  return { codigo: s, nome: s };
}

function tipoProgramadoPorData(dataAuditoria) {
  if (!dataAuditoria) return null;
  const data = dayjs(dataAuditoria);
  if (!data.isValid()) return null;

  const diaSemana = data.day();
  if (diaSemana === 1 || diaSemana === 4) return TIPOS_AUDITORIA.ETIQUETA;
  if (diaSemana === 2) return TIPOS_AUDITORIA.PRESENCA;
  if (diaSemana === 3) return TIPOS_AUDITORIA.RUPTURA;
  return null;
}

/**
 * Detecta o tipo primeiro pela data oficial da planilha e, se ela nao cair na agenda
 * operacional esperada, faz fallback para o nome da sheet, nome do arquivo e situacoes.
 */
export function detectarTipo({
  sheetName,
  filename,
  situacoes,
  dataAuditoria,
}) {
  const tipoPorAgenda = tipoProgramadoPorData(dataAuditoria);
  if (tipoPorAgenda) return tipoPorAgenda;

  const sN = (sheetName || "").toLowerCase();
  const fN = (filename || "").toLowerCase();
  if (sN.includes("etiqueta") || fN.includes("etiqueta"))
    return TIPOS_AUDITORIA.ETIQUETA;
  if (fN.includes("ruptura")) return TIPOS_AUDITORIA.RUPTURA;
  if (sN.includes("presen")) return TIPOS_AUDITORIA.PRESENCA;

  // fallback baseado em situações
  const set = new Set(Object.keys(situacoes || {}));
  if ([...set].some((s) => /atualizado|desatualizado/i.test(s)))
    return TIPOS_AUDITORIA.ETIQUETA;
  if ([...set].some((s) => /presença/i.test(s)))
    return TIPOS_AUDITORIA.PRESENCA;
  return null;
}

/** Map "header normalizado" → chave canônica */
const ALIASES = {
  codigo: ["código", "codigo", "cod", "sku"],
  produto: ["produto", "descrição", "descricao"],
  classeRaiz: ["classe de produto raiz", "classe raiz"],
  classe: ["classe de produto", "classe"],
  setor: ["setor"],
  local: ["local", "localização"],
  usuario: ["usuário", "usuario", "colaborador"],
  situacao: ["situação", "situacao", "status"],
  situacaoAuditoria: [
    "situação atual da auditoria",
    "situacao atual da auditoria",
  ],
  auditadoEm: ["auditado em"],
  auditadoEmHora: ["auditado em_1", "hora auditado"],
  estoqueAtual: ["estoque atual"],
  presencaConfirmada: ["presença confirmada", "presenca confirmada"],
  presencaConfirmadaHora: ["presença confirmada_1", "presenca confirmada_1"],
  estoqueLeitura: ["estoque leitura"],
  diasSemVenda: ["dias sem venda"],
  custoRuptura: ["custo ruptura"],
  residuo: ["resíduo", "residuo"],
  fornecedor: ["fornecedor"],
  ultimaCompra: ["última compra", "ultima compra"],
  ultimaCompraHora: ["última compra_1", "ultima compra_1"],
};

function normalizar(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function mapearColunas(linha0) {
  const headers = Object.keys(linha0);
  const map = {};
  for (const [chave, alts] of Object.entries(ALIASES)) {
    const altsN = alts.map(normalizar);
    const found = headers.find((h) => altsN.includes(normalizar(h)));
    if (found) map[chave] = found;
  }
  return map;
}

/**
 * Lê um buffer de planilha e devolve { tipo, dataAuditoria, linhas: [...] }.
 * Cada linha tem todos os campos canônicos prontos para persistência.
 */
export function lerPlanilha(buffer, { filename, tipoForcado } = {}) {
  // CSV UTF-8 vindo do agente pode não ter BOM. Preserve também zeros iniciais dos SKUs.
  const csvUtf8 = /\.csv$/i.test(filename || '') && isUtf8(buffer);
  const wb = XLSX.read(csvUtf8 ? buffer.toString('utf8') : buffer, {
    type: csvUtf8 ? 'string' : 'buffer', cellDates: false, raw: true,
  });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error("Planilha vazia");
  const linhas = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });
  if (!linhas.length) throw new Error("Planilha sem linhas");

  const colunas = mapearColunas(linhas[0]);
  const obrig = ["codigo", "situacao", "auditadoEm"];
  const ausentes = obrig.filter((c) => !colunas[c]);
  if (ausentes.length) {
    throw new Error(
      `Colunas obrigatórias ausentes: ${ausentes.join(", ")}. Verifique se a planilha foi exportada do coletor.`,
    );
  }

  // distribuição de situações para auto-detect
  const situacoes = {};
  const parsed = linhas.map((row) => {
    const get = (k) => (colunas[k] ? row[colunas[k]] : null);
    const sit = get("situacao");
    if (sit) situacoes[sit] = (situacoes[sit] || 0) + 1;
    const auditadoEm = parseDataHora(get("auditadoEm"), get("auditadoEmHora"));
    const usuario = parseUsuario(get("usuario"));
    return {
      codigo: get("codigo") ? String(get("codigo")).trim() : null,
      produto: get("produto"),
      classeRaiz: get("classeRaiz"),
      classe: get("classe"),
      setor: get("setor"),
      local: get("local"),
      colaboradorCodigo: usuario?.codigo || null,
      colaboradorNome: usuario?.nome || null,
      situacao: sit,
      situacaoAuditoria: get("situacaoAuditoria"),
      auditadoEm,
      presencaConfirmadaEm: parseDataHora(
        get("presencaConfirmada"),
        get("presencaConfirmadaHora"),
      ),
      ultimaCompraEm: parseDataHora(
        get("ultimaCompra"),
        get("ultimaCompraHora"),
      ),
      estoqueAtual: parseNumero(get("estoqueAtual")),
      estoqueLeitura: parseNumero(get("estoqueLeitura")),
      diasSemVenda: parseNumero(get("diasSemVenda")),
      custoRuptura: parseNumero(get("custoRuptura")),
      residuo: parseBool(get("residuo")),
      fornecedor: get("fornecedor"),
    };
  });

  // Data oficial da auditoria = dia mais frequente em "auditadoEm"
  const contagemDias = new Map();
  parsed.forEach((p) => {
    if (!p.auditadoEm) return;
    const k = dayjs(p.auditadoEm).format("YYYY-MM-DD");
    contagemDias.set(k, (contagemDias.get(k) || 0) + 1);
  });
  let dia = dayjs().format("YYYY-MM-DD");
  let max = 0;
  for (const [k, v] of contagemDias) {
    if (v > max) {
      max = v;
      dia = k;
    }
  }
  const dataAuditoria = dayjs(dia).startOf("day").toDate();

  const tipo =
    tipoForcado ||
    detectarTipo({ sheetName, filename, situacoes, dataAuditoria });
  if (!tipo)
    throw new Error(
      "Não foi possível detectar o tipo de auditoria. Informe manualmente.",
    );

  return { tipo, sheetName, dataAuditoria, situacoes, linhas: parsed };
}
