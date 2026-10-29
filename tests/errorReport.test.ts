import { describe, expect, it } from 'vitest';
import { buildPayload, fingerprintOf, isIgnorableError, ReportThrottle, scrubText, scrubUrl, topFrame } from '../src/utils/errorReport';

describe('monitorização: limpeza de dados pessoais', () => {
  it('remove JWT, e-mails, tokens em parâmetros e números longos', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123456';
    const out = scrubText(`falhou ${jwt} para joao@escola.ao em /x?access_token=abc123&y=1 BI 004567890LA042 tel 923456789`);
    expect(out).not.toContain('eyJ');
    expect(out).not.toContain('joao@escola.ao');
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('923456789');
    expect(out).toContain('[email]');
  });
  it('URL fica só com origem, caminho e secção; sem parâmetros', () => {
    expect(scrubUrl('https://app.bandmed.ao/?code=SECRET&x=1#/alunos?token=abc')).toBe('https://app.bandmed.ao/#/alunos');
    expect(scrubUrl('https://app.bandmed.ao/#access_token=abc&type=recovery')).toBe('https://app.bandmed.ao/');
  });
  it('trunca a mensagem a 500 caracteres', () => {
    expect(scrubText('a'.repeat(900)).length).toBe(500);
  });
});

describe('monitorização: impressão digital', () => {
  it('o mesmo erro com ids e números diferentes dá a mesma chave', () => {
    const a = fingerprintOf('error', 'Aluno 123 não encontrado (id 550e8400-e29b-41d4-a716-446655440000)', 'Error\n    at f (https://x/assets/App-3fa9c1.js:12:34)');
    const b = fingerprintOf('error', 'Aluno 987 não encontrado (id 11111111-2222-3333-4444-555555555555)', 'Error\n    at f (https://x/assets/App-77ab12.js:99:1)');
    expect(a).toBe(b);
  });
  it('erros diferentes ou tipos diferentes dão chaves diferentes', () => {
    expect(fingerprintOf('error', 'x is undefined')).not.toBe(fingerprintOf('error', 'y is undefined'));
    expect(fingerprintOf('error', 'x')).not.toBe(fingerprintOf('react', 'x'));
  });
  it('topFrame ignora linha/coluna e o hash do ficheiro', () => {
    expect(topFrame('Error: x\n    at foo (https://a.b/assets/Main-abc12345.js:10:20)')).toBe('at foo (Main.js)');
  });
});

describe('monitorização: payload e ruído', () => {
  it('ignora ruído conhecido', () => {
    expect(isIgnorableError('ResizeObserver loop completed with undelivered notifications.')).toBe(true);
    expect(isIgnorableError('Script error.')).toBe(true);
    expect(isIgnorableError('boom', 'at x (chrome-extension://abc/content.js:1:1)')).toBe(true);
    expect(isIgnorableError('Cannot read properties of undefined')).toBe(false);
  });
  it('constrói o payload limpo ou null para ruído', () => {
    const p = buildPayload({ kind: 'react', error: new Error('falha para ana@x.ao'), url: 'https://a.b/?token=1#/turmas', appVersion: '1.2.3' });
    expect(p?.kind).toBe('react');
    expect(p?.message).toBe('falha para [email]');
    expect(p?.url).toBe('https://a.b/#/turmas');
    expect(buildPayload({ kind: 'error', error: 'Script error.' })).toBeNull();
    expect(buildPayload({ kind: 'error', error: '' })).toBeNull();
  });
});

describe('monitorização: limitador', () => {
  it('o mesmo erro só volta passado o intervalo', () => {
    const t = new ReportThrottle(10, 60_000);
    expect(t.allow('a', 0)).toBe(true);
    expect(t.allow('a', 30_000)).toBe(false);
    expect(t.allow('a', 61_000)).toBe(true);
  });
  it('máximo por sessão', () => {
    const t = new ReportThrottle(3, 0);
    expect([1, 2, 3, 4, 5].map((i) => t.allow(`f${i}`, i))).toEqual([true, true, true, false, false]);
  });
});
