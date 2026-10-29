/**
 * Importação de extratos bancários em vários formatos: CSV/TSV/TXT, folhas de cálculo
 * (XLSX/XLSM), OFX/QFX e XML camt.053 (ISO 20022).
 *
 * As funções de leitura são puras (recebem texto ou linhas já extraídas) para poderem ser
 * testadas sem navegador. A leitura de ficheiros binários (folhas de cálculo) fica em
 * `readBankStatementFile`, que carrega a biblioteca `xlsx` só quando é preciso.
 */
import { parseAmount, toISODate } from './financeExtras';

export interface ImportedBankLine {
  /** AAAA-MM-DD */
  date: string;
  /** Positivo = crédito (entrada), negativo = débito. */
  amount: number;
  description: string;
  reference?: string;
}

export type BankFileFormat = 'csv' | 'planilha' | 'ofx' | 'camt053';

export interface ParsedBankFile {
  format: BankFileFormat;
  lines: ImportedBankLine[];
  errors: string[];
  /** Linhas ignoradas por não terem data/valor (cabeçalhos, totais, saldos). */
  skipped: number;
}

const strip = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

type Col = 'date' | 'description' | 'amount' | 'credit' | 'debit' | 'reference';

const HEADER_HINTS: Record<Col, string[]> = {
  date: ['data', 'date', 'data mov', 'data movimento', 'data valor', 'data operacao', 'dt', 'data lancamento'],
  description: ['descricao', 'descritivo', 'description', 'historico', 'movimento', 'detalhes', 'narrativa', 'observacoes', 'memo'],
  amount: ['valor', 'montante', 'amount', 'importancia', 'quantia'],
  credit: ['credito', 'creditos', 'entrada', 'entradas', 'credit', 'a credito'],
  debit: ['debito', 'debitos', 'saida', 'saidas', 'debit', 'a debito'],
  reference: ['referencia', 'ref', 'reference', 'ref pagamento', 'referencia multicaixa', 'n documento', 'documento', 'entidade referencia']
};

/** Detecta que coluna é cada uma a partir da linha de cabeçalho. */
export function detectColumns(header: string[]): Partial<Record<Col, number>> {
  const out: Partial<Record<Col, number>> = {};
  const cells = header.map((h) => strip(String(h ?? '')));
  (Object.keys(HEADER_HINTS) as Col[]).forEach((col) => {
    // 1.º igualdade exata, 2.º "começa por"/contém.
    let idx = cells.findIndex((c, i) => HEADER_HINTS[col].includes(c) && !Object.values(out).includes(i));
    if (idx < 0) {
      idx = cells.findIndex(
        (c, i) => c && !Object.values(out).includes(i) && HEADER_HINTS[col].some((h) => c === h || c.startsWith(h + ' '))
      );
    }
    if (idx >= 0) out[col] = idx;
  });
  return out;
}

const looksLikeHeader = (cols: Partial<Record<Col, number>>) =>
  cols.date !== undefined && (cols.amount !== undefined || cols.credit !== undefined || cols.debit !== undefined);

/** Converte uma data vinda de folha de cálculo (texto, Date ou número de série Excel). */
export function cellToISODate(v: unknown): string {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  const s = String(v ?? '').trim();
  const iso = toISODate(s);
  if (iso) return iso;
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(s); // 20261005
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

const cellToAmount = (v: unknown): number => (typeof v === 'number' ? v : parseAmount(String(v ?? '')));

/**
 * Linhas (matriz de células) → movimentos. Serve CSV e folhas de cálculo.
 * Aceita cabeçalho em qualquer das primeiras 15 linhas (extratos de bancos trazem títulos antes),
 * colunas separadas de Crédito/Débito, ou a ordem clássica data; descrição; valor; referência.
 */
export function rowsToBankLines(rows: unknown[][]): { lines: ImportedBankLine[]; errors: string[]; skipped: number } {
  const lines: ImportedBankLine[] = [];
  const errors: string[] = [];
  let skipped = 0;
  let cols: Partial<Record<Col, number>> | null = null;
  let start = 0;

  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const found = detectColumns((rows[i] || []).map((c) => String(c ?? '')));
    if (looksLikeHeader(found)) { cols = found; start = i + 1; break; }
  }
  if (!cols) cols = { date: 0, description: 1, amount: 2, reference: 3 };

  for (let i = start; i < rows.length; i++) {
    const row = rows[i] || [];
    if (row.every((c) => String(c ?? '').trim() === '')) continue;
    const date = cellToISODate(row[cols.date ?? 0]);
    let amount = NaN;
    if (cols.amount !== undefined) amount = cellToAmount(row[cols.amount]);
    if (!Number.isFinite(amount) && (cols.credit !== undefined || cols.debit !== undefined)) {
      const cr = cols.credit !== undefined ? cellToAmount(row[cols.credit]) : NaN;
      const db = cols.debit !== undefined ? cellToAmount(row[cols.debit]) : NaN;
      if (Number.isFinite(cr) && cr !== 0) amount = Math.abs(cr);
      else if (Number.isFinite(db) && db !== 0) amount = -Math.abs(db);
      else if (Number.isFinite(cr) || Number.isFinite(db)) amount = 0;
    }
    if (!date || !Number.isFinite(amount)) {
      // Sem data nem valor = título, saldo ou total: ignora em silêncio; só avisa se parecia uma linha de dados.
      // Com data mas sem valor é um erro real; sem data conta como linha ignorada (aparece no resumo).
      if (date) errors.push(`Linha ${i + 1}: valor inválido.`);
      else skipped++;
      continue;
    }
    const ref = cols.reference !== undefined ? String(row[cols.reference] ?? '').trim() : '';
    lines.push({
      date,
      amount,
      description: String(row[cols.description ?? 1] ?? '').trim(),
      reference: ref || undefined
    });
  }
  return { lines, errors, skipped };
}

/** Divide uma linha CSV respeitando aspas. */
function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (ch === sep && !q) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function parseBankCsvText(text: string): ParsedBankFile {
  const raw = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  const sample = raw.slice(0, 20).join('\n');
  const count = (c: string) => (sample.match(new RegExp(c === '\t' ? '\\t' : `\\${c}`, 'g')) || []).length;
  const sep = [';', '\t', '|', ','].sort((a, b) => count(b) - count(a))[0];
  const rows = raw.map((l) => splitCsvLine(l, sep));
  return { format: 'csv', ...rowsToBankLines(rows) };
}

const tag = (block: string, name: string) => {
  const m = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block);
  return m ? m[1].trim() : '';
};

/** OFX/QFX (SGML ou XML): <STMTTRN> com DTPOSTED, TRNAMT, NAME/MEMO, FITID/CHECKNUM. */
export function parseOfx(text: string): ParsedBankFile {
  const lines: ImportedBankLine[] = [];
  const errors: string[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  blocks.forEach((b, i) => {
    const block = b.split(/<\/STMTTRN>/i)[0];
    const date = cellToISODate(tag(block, 'DTPOSTED').slice(0, 8));
    const amount = parseAmount(tag(block, 'TRNAMT').replace(',', '.'));
    if (!date || !Number.isFinite(amount)) { errors.push(`Movimento OFX ${i + 1}: data ou valor inválido.`); return; }
    const name = tag(block, 'NAME');
    const memo = tag(block, 'MEMO');
    lines.push({
      date,
      amount,
      description: [name, memo].filter(Boolean).join(' - '),
      reference: tag(block, 'CHECKNUM') || tag(block, 'REFNUM') || tag(block, 'FITID') || undefined
    });
  });
  return { format: 'ofx', lines, errors, skipped: 0 };
}

/** camt.053 (extrato ISO 20022): <Ntry> com Amt, CdtDbtInd, BookgDt/Dt, RmtInf/Ustrd, EndToEndId. */
export function parseCamt053(xml: string): ParsedBankFile {
  const lines: ImportedBankLine[] = [];
  const errors: string[] = [];
  const entries = xml.split(/<(?:\w+:)?Ntry>/i).slice(1);
  const get = (b: string, name: string) => {
    const m = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([^<]*)<`, 'i').exec(b);
    return m ? m[1].trim() : '';
  };
  entries.forEach((e, i) => {
    const b = e.split(/<\/(?:\w+:)?Ntry>/i)[0];
    const bookg = /<(?:\w+:)?BookgDt>([\s\S]*?)<\/(?:\w+:)?BookgDt>/i.exec(b)?.[1] || b;
    const date = cellToISODate(get(bookg, 'Dt') || get(bookg, 'DtTm').slice(0, 10));
    let amount = Number(get(b, 'Amt'));
    if (!date || !Number.isFinite(amount)) { errors.push(`Movimento camt ${i + 1}: data ou valor inválido.`); return; }
    if (get(b, 'CdtDbtInd').toUpperCase() === 'DBIT') amount = -Math.abs(amount);
    const ref = get(b, 'EndToEndId') || get(b, 'AcctSvcrRef') || get(b, 'Ref');
    lines.push({
      date,
      amount,
      description: get(b, 'Ustrd') || get(b, 'AddtlNtryInf') || get(b, 'Nm'),
      reference: ref && ref.toUpperCase() !== 'NOTPROVIDED' ? ref : undefined
    });
  });
  return { format: 'camt053', lines, errors, skipped: 0 };
}

/** Escolhe o leitor de texto certo pelo conteúdo e pelo nome do ficheiro. */
export function parseBankText(text: string, fileName = ''): ParsedBankFile {
  const name = fileName.toLowerCase();
  if (/\.(ofx|qfx)$/.test(name) || /<OFX>|<STMTTRN>/i.test(text.slice(0, 4000))) return parseOfx(text);
  if (/\.xml$/.test(name) || /<(?:\w+:)?BkToCstmrStmt/i.test(text.slice(0, 4000))) return parseCamt053(text);
  return parseBankCsvText(text);
}

/**
 * Lê um ficheiro carregado pelo utilizador, qualquer que seja o formato suportado.
 * Folhas de cálculo (.xlsx/.xlsm) são lidas com o exceljs (xlsxSafe.ts, carregado só aqui).
 */
export async function readBankStatementFile(file: File): Promise<ParsedBankFile> {
  const name = file.name.toLowerCase();
  if (/\.(xls|ods)$/.test(name)) {
    return { format: 'planilha', lines: [], skipped: 0, errors: ['Os formatos antigos .xls e .ods já não são lidos (por segurança). No Excel/LibreOffice use "Guardar como" .xlsx ou CSV e carregue esse ficheiro.'] };
  }
  if (/\.(xlsx|xlsm)$/.test(name)) {
    const { xlsxLib, XlsxLimitError } = await import('./xlsxSafe');
    let sheets;
    try { sheets = await xlsxLib.read(await file.arrayBuffer(), { skipBlankRows: false }); }
    catch (e) {
      const msg = e instanceof XlsxLimitError ? e.message : 'Não foi possível abrir o ficheiro Excel (está corrompido, protegido por palavra-passe ou não é .xlsx).';
      return { format: 'planilha', lines: [], skipped: 0, errors: [msg] };
    }
    const all: ImportedBankLine[] = [];
    const errors: string[] = [];
    let skipped = 0;
    for (const sheet of sheets) {
      const r = rowsToBankLines(sheet.rows);
      all.push(...r.lines);
      errors.push(...r.errors.map((e) => `${sheets.length > 1 ? `[${sheet.name}] ` : ''}${e}`));
      skipped += r.skipped;
    }
    return { format: 'planilha', lines: all, errors, skipped };
  }
  if (/\.pdf$/.test(name)) {
    return { format: 'csv', lines: [], skipped: 0, errors: ['PDF não é suportado: exporte o extrato do banco em CSV, Excel, OFX ou XML.'] };
  }
  return parseBankText(await file.text(), file.name);
}

export const BANK_FILE_ACCEPT = '.csv,.tsv,.txt,.xlsx,.xlsm,.ofx,.qfx,.xml';

export interface StatementTotals { credits: number; debits: number; count: number; from?: string; to?: string }

export function statementTotals(lines: Array<{ date: string; amount: number }>): StatementTotals {
  const dates = lines.map((l) => l.date).sort();
  return {
    credits: lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0),
    debits: lines.filter((l) => l.amount < 0).reduce((s, l) => s + -l.amount, 0),
    count: lines.length,
    from: dates[0],
    to: dates[dates.length - 1]
  };
}
