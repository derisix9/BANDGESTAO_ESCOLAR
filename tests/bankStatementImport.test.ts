import { describe, expect, it } from 'vitest';
import { cellToISODate, detectColumns, parseBankText, rowsToBankLines, statementTotals } from '../src/utils/bankStatementImport';

describe('importação de extratos', () => {
  it('CSV com título, colunas Crédito/Débito separadas e linha de total', () => {
    const csv = `Extrato BAI;;;\nConta 123;;;\nData Mov.;Descrição;Débito;Crédito;Referência\n05/10/2026;TRF Silva;;45.000,00;123456789\n06/10/2026;Comissão;1.500,00;;\nTotal;;1.500,00;45.000,00;`;
    const r = parseBankText(csv, 'extrato.csv');
    expect(r.errors).toEqual([]);
    expect(r.lines).toEqual([
      { date: '2026-10-05', amount: 45000, description: 'TRF Silva', reference: '123456789' },
      { date: '2026-10-06', amount: -1500, description: 'Comissão', reference: undefined }
    ]);
    expect(r.skipped).toBe(1);
  });
  it('CSV clássico sem cabeçalho: data; descrição; valor; referência', () => {
    const r = parseBankText('05/10/2026;Transf. Silva;45.000,00;999', 'x.txt');
    expect(r.lines[0]).toMatchObject({ date: '2026-10-05', amount: 45000, reference: '999' });
  });
  it('OFX', () => {
    const ofx = '<OFX><STMTTRN><DTPOSTED>20261005120000<TRNAMT>45000.00<FITID>ABC1<NAME>Silva<MEMO>Propina</STMTTRN><STMTTRN><DTPOSTED>20261006<TRNAMT>-1500.00<FITID>D2<NAME>Comissao</STMTTRN></OFX>';
    const r = parseBankText(ofx, 'a.ofx');
    expect(r.format).toBe('ofx');
    expect(r.lines.map((l) => l.amount)).toEqual([45000, -1500]);
    expect(r.lines[0]).toMatchObject({ date: '2026-10-05', description: 'Silva - Propina', reference: 'ABC1' });
  });
  it('camt.053 trata débitos como valores negativos', () => {
    const xml = '<Document><BkToCstmrStmt><Stmt><Ntry><Amt Ccy="AOA">45000.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-10-05</Dt></BookgDt><NtryDtls><TxDtls><Refs><EndToEndId>REF9</EndToEndId></Refs><RmtInf><Ustrd>Pagamento</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry></Stmt></BkToCstmrStmt></Document>';
    const r = parseBankText(xml, 'a.xml');
    expect(r.lines).toEqual([{ date: '2026-10-05', amount: -45000, description: 'Pagamento', reference: 'REF9' }]);
  });
  it('linhas de folha de cálculo com data em número de série Excel', () => {
    const r = rowsToBankLines([['Data', 'Descrição', 'Valor', 'Ref'], [46300, 'Excel', 20000, 'R1'], ['x', 'sem data', 'y']]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].date).toBe(cellToISODate(46300));
    expect(r.skipped).toBe(1);
  });
  it('detecta colunas pelo cabeçalho', () => {
    expect(detectColumns(['Data valor', 'Histórico', 'Crédito', 'Débito'])).toMatchObject({ date: 0, description: 1, credit: 2, debit: 3 });
  });
  it('totais do extrato', () => {
    expect(statementTotals([{ date: '2026-10-05', amount: 10 }, { date: '2026-10-01', amount: -4 }])).toEqual({ credits: 10, debits: 4, count: 2, from: '2026-10-01', to: '2026-10-05' });
  });
});
