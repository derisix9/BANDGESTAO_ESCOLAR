import { afterEach, describe, expect, it } from 'vitest';
import {
  AllProvidersFailedError, normalizeHistory, runAssistant, sanitizeModel, testCredential, validateApiKeyFormat,
  type ProviderCredential, type ToolSpec
} from '../api/_ai-providers';
import { decryptKey, encryptKey } from '../api/_ai-store';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const tool: ToolSpec = { name: 'consultar_indicador', description: 'x', parameters: { type: 'object', properties: { area: { type: 'string' } }, required: ['area'] } };
const cred = (provider: ProviderCredential['provider'], model = 'm'): ProviderCredential => ({ provider, apiKey: `${provider}-key-1234567890abcdef`, model, source: 'institution' });
const base = { system: 's', history: [{ role: 'user' as const, content: 'Quantos alunos?' }], tools: [tool] };

describe('BANDGESTÃO AI: chaves e modelos', () => {
  it('rejeita chaves de outro fornecedor e caracteres inválidos', () => {
    expect(() => validateApiKeyFormat('openai', 'sk-ant-' + 'a'.repeat(30))).toThrow(/Claude/);
    expect(() => validateApiKeyFormat('openai', 'AIza' + 'b'.repeat(30))).toThrow(/Gemini/);
    expect(() => validateApiKeyFormat('gemini', 'abc def ' + 'x'.repeat(30))).toThrow();
    expect(validateApiKeyFormat('gemini', '  AIza' + 'c'.repeat(30) + '  ')).toBe('AIza' + 'c'.repeat(30));
  });
  it('modelo vazio usa o padrão e nomes estranhos são recusados', () => {
    expect(sanitizeModel('gemini', '')).toBe('gemini-2.5-flash');
    expect(sanitizeModel('openrouter', 'meta-llama/llama-3.3-70b-instruct:free')).toContain(':free');
    expect(() => sanitizeModel('openai', 'gpt; drop table')).toThrow();
  });
  it('histórico alterna papéis e começa sempre por "user"', () => {
    const h = normalizeHistory([{ role: 'assistant', content: 'olá' }, { role: 'user', content: 'a' }, { role: 'user', content: 'b' }, { role: 'assistant', content: 'c' }]);
    expect(h.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(h[0].content).toBe('a\nb');
  });
});

describe('BANDGESTÃO AI: cifra das chaves', () => {
  process.env.AI_KEYS_SECRET = 'segredo-de-teste-com-mais-de-16-caracteres';
  it('cifra e decifra, sem guardar a chave em claro', () => {
    const c = encryptKey('sk-or-minha-chave-secreta-123456', 'escola-1', 'openrouter');
    expect(c).not.toContain('minha-chave');
    expect(decryptKey(c, 'escola-1', 'openrouter')).toBe('sk-or-minha-chave-secreta-123456');
  });
  it('não decifra noutra escola nem noutro fornecedor', () => {
    const c = encryptKey('AIza' + 'x'.repeat(30), 'escola-1', 'gemini');
    expect(() => decryptKey(c, 'escola-2', 'gemini')).toThrow();
    expect(() => decryptKey(c, 'escola-1', 'openai')).toThrow();
  });
});

describe('BANDGESTÃO AI: fornecedores e alternativa automática', () => {
  it('OpenAI: pede a ferramenta, devolve o resultado e responde', async () => {
    const calls: any[] = [];
    globalThis.fetch = (async (_u: any, init: any) => {
      const body = JSON.parse(init.body); calls.push(body);
      if (calls.length === 1) return json({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'consultar_indicador', arguments: '{"area":"alunos"}' } }] } }] });
      return json({ choices: [{ message: { content: 'Tem *877* alunos.' } }] });
    }) as any;
    const seen: any[] = [];
    const r = await runAssistant({ chain: [cred('openai')], ...base, exec: async (n, a) => { seen.push([n, a]); return { result: { total: 877 } }; } });
    expect(r.text).toBe('Tem *877* alunos.');
    expect(seen).toEqual([['consultar_indicador', { area: 'alunos' }]]);
    expect(r.toolsUsed).toEqual(['consultar_indicador']);
    expect(calls[1].messages.at(-1).role).toBe('tool');
  });

  it('se o 1.º fornecedor falhar (quota), passa ao seguinte e reutiliza o resultado da ferramenta', async () => {
    let n = 0; let toolRuns = 0;
    globalThis.fetch = (async (url: any) => {
      n++;
      if (String(url).includes('openai.com')) {
        // 1.ª ronda pede a ferramenta; a 2.ª falha com 429
        return n === 1 ? json({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'consultar_indicador', arguments: '{"area":"turmas"}' } }] } }] }) : json({ error: 'quota' }, 429);
      }
      if (String(url).includes('anthropic.com')) {
        return String(url).endsWith('/messages') && n === 3
          ? json({ content: [{ type: 'tool_use', id: 't1', name: 'consultar_indicador', input: { area: 'turmas' } }] })
          : json({ content: [{ type: 'text', text: 'Há 30 turmas.' }] });
      }
      return json({}, 500);
    }) as any;
    const r = await runAssistant({ chain: [cred('openai'), cred('claude')], ...base, exec: async () => { toolRuns++; return { result: { total: 30 } }; } });
    expect(r.provider).toBe('claude');
    expect(r.text).toBe('Há 30 turmas.');
    expect(r.attempts.map((a) => a.ok)).toEqual([false, true]);
    expect(toolRuns).toBe(1);
  });

  it('Gemini: usa x-goog-api-key, tipos em maiúsculas e devolve o functionResponse', async () => {
    const reqs: any[] = [];
    globalThis.fetch = (async (_u: any, init: any) => {
      reqs.push({ headers: init.headers, body: JSON.parse(init.body) });
      if (reqs.length === 1) return json({ candidates: [{ content: { parts: [{ functionCall: { name: 'consultar_indicador', args: { area: 'alunos' } } }] } }] });
      return json({ candidates: [{ content: { parts: [{ text: 'Resposta Gemini' }] } }] });
    }) as any;
    const r = await runAssistant({ chain: [cred('gemini', 'gemini-2.5-flash')], ...base, exec: async () => ({ result: { total: 1 } }) });
    expect(r.text).toBe('Resposta Gemini');
    expect(reqs[0].headers['x-goog-api-key']).toContain('gemini-key');
    expect(reqs[0].body.tools[0].functionDeclarations[0].parameters.type).toBe('OBJECT');
    expect(reqs[1].body.contents.at(-1).parts[0].functionResponse.name).toBe('consultar_indicador');
  });

  it('finalText (documento já enviado) termina sem nova chamada à IA', async () => {
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return json({ content: [{ type: 'tool_use', id: 't', name: 'consultar_indicador', input: {} }] }); }) as any;
    const r = await runAssistant({ chain: [cred('claude')], ...base, exec: async () => ({ result: {}, finalText: 'PDF enviado.' }) });
    expect(r.text).toBe('PDF enviado.');
    expect(calls).toBe(1);
  });

  it('todos falham: lança AllProvidersFailedError sem expor a chave', async () => {
    globalThis.fetch = (async () => json({ error: 'invalid key AIza-segredo' }, 401)) as any;
    try {
      await runAssistant({ chain: [cred('gemini'), cred('groq')], ...base, exec: async () => ({ result: {} }) });
      throw new Error('devia ter falhado');
    } catch (e) {
      expect(e).toBeInstanceOf(AllProvidersFailedError);
      const attempts = (e as AllProvidersFailedError).attempts;
      expect(attempts).toHaveLength(2);
      expect(JSON.stringify(attempts)).not.toContain('key-1234567890');
      expect(attempts[0].status).toBe(401);
    }
  });

  it('testCredential devolve ok/erro amigável', async () => {
    globalThis.fetch = (async () => json({ choices: [{ message: { content: 'OK' } }] })) as any;
    expect((await testCredential(cred('groq'))).ok).toBe(true);
    globalThis.fetch = (async () => json({}, 402)) as any;
    const bad = await testCredential(cred('openrouter'));
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/saldo|crédito/i);
  });
});
