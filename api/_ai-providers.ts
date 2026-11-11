/**
 * BANDGESTÃO AI — fornecedores de IA (OpenAI, Google Gemini, Anthropic Claude, Groq, OpenRouter).
 *
 * Um único "agente" (pedido → ferramentas → resposta) com adaptadores para cada API.
 * Aceita chaves pagas e gratuitas (por exemplo Gemini no Google AI Studio, Groq, modelos :free do OpenRouter).
 * Se um fornecedor falhar (quota, chave inválida, indisponível), passa automaticamente ao seguinte.
 * As ferramentas executam sempre no servidor, com permissões validadas: o modelo nunca acede à base de dados.
 */
declare const process: { env: Record<string, string | undefined> };

export type ProviderId = 'openai' | 'gemini' | 'claude' | 'groq' | 'openrouter';
export const PROVIDER_IDS: readonly ProviderId[] = ['openai', 'gemini', 'claude', 'groq', 'openrouter'] as const;

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  kind: 'openai' | 'gemini' | 'claude';
  baseUrl: string;
  defaultModel: string;
  /** Tem plano/chave gratuita utilizável (com limites de pedidos). */
  free: boolean;
  note: string;
  helpUrl: string;
  envKeys: string[];
  envModel: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  gemini: {
    id: 'gemini', label: 'Google Gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash', free: true,
    note: 'Chave gratuita no Google AI Studio (com limites diários). Boa opção para começar sem custos.',
    helpUrl: 'https://aistudio.google.com/apikey', envKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], envModel: 'GEMINI_MODEL'
  },
  openai: {
    id: 'openai', label: 'OpenAI (ChatGPT)', kind: 'openai', baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini', free: false,
    note: 'A API tem facturação própria, separada da subscrição do ChatGPT.',
    helpUrl: 'https://platform.openai.com/api-keys', envKeys: ['OPENAI_API_KEY'], envModel: 'OPENAI_MODEL'
  },
  claude: {
    id: 'claude', label: 'Anthropic Claude', kind: 'claude', baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-haiku-5-5', free: false,
    note: 'Chave da Claude Developer Platform (pré-pago). Indique outro modelo se pretender mais capacidade.',
    helpUrl: 'https://console.anthropic.com/settings/keys', envKeys: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'], envModel: 'ANTHROPIC_MODEL'
  },
  groq: {
    id: 'groq', label: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile', free: true,
    note: 'Plano gratuito com limites de pedidos por minuto. Muito rápido.',
    helpUrl: 'https://console.groq.com/keys', envKeys: ['GROQ_API_KEY'], envModel: 'GROQ_MODEL'
  },
  openrouter: {
    id: 'openrouter', label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free', free: true,
    note: 'Dá acesso a muitos modelos, incluindo modelos gratuitos (terminam em :free).',
    helpUrl: 'https://openrouter.ai/keys', envKeys: ['OPENROUTER_API_KEY'], envModel: 'OPENROUTER_MODEL'
  }
};

export interface ProviderCredential {
  provider: ProviderId;
  apiKey: string;
  model: string;
  source: 'institution' | 'server';
}

export interface ChatMsg { role: 'user' | 'assistant'; content: string }

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema (type/properties/required/enum/items/description). */
  parameters: Record<string, any>;
}

export interface ToolOutcome {
  result: unknown;
  /** Se existir, a resposta ao utilizador é este texto e o modelo não volta a ser chamado (ex.: documento já enviado). */
  finalText?: string;
}
export type ToolExecutor = (name: string, args: Record<string, any>) => Promise<ToolOutcome>;

export class ProviderError extends Error {
  constructor(public provider: ProviderId, message: string, public status?: number) {
    super(message);
    this.name = 'ProviderError';
  }
  /** Chave recusada: convém marcá-la como inválida no painel. */
  get authFailed(): boolean { return this.status === 401 || this.status === 403; }
}

export interface AttemptLog { provider: ProviderId; model: string; ok: boolean; error?: string; status?: number; ms: number }

const MAX_ROUNDS = 5;
const MAX_OUTPUT_TOKENS = 1400;

export function validateApiKeyFormat(provider: ProviderId, raw: unknown): string {
  const key = String(raw ?? '').trim();
  if (key.length < 20 || key.length > 400) throw new Error('A chave indicada tem um tamanho inválido.');
  if (!/^[A-Za-z0-9_\-.:~+/=]+$/.test(key)) throw new Error('A chave contém caracteres inválidos. Copie-a novamente, sem espaços.');
  const looksLike = key.startsWith('sk-ant-') ? 'claude' : key.startsWith('AIza') ? 'gemini'
    : key.startsWith('gsk_') ? 'groq' : key.startsWith('sk-or-') ? 'openrouter' : null;
  if (looksLike && looksLike !== provider) {
    throw new Error(`Esta chave parece ser de ${PROVIDERS[looksLike].label}, não de ${PROVIDERS[provider].label}.`);
  }
  return key;
}

export function sanitizeModel(provider: ProviderId, raw: unknown): string {
  const model = String(raw ?? '').trim();
  if (!model) return PROVIDERS[provider].defaultModel;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/\-]{0,119}$/.test(model)) throw new Error('Nome de modelo inválido.');
  return model;
}

function friendly(status: number | undefined): string {
  if (status === 401 || status === 403) return 'Chave recusada pelo fornecedor (inválida, revogada ou sem permissão).';
  if (status === 404) return 'Modelo não encontrado ou sem acesso com esta chave.';
  if (status === 402) return 'Sem saldo ou crédito neste fornecedor.';
  if (status === 429) return 'Limite de pedidos ou quota excedida neste fornecedor.';
  if (status && status >= 500) return 'O fornecedor está temporariamente indisponível.';
  if (status === 400) return 'O fornecedor recusou o pedido (modelo ou parâmetros não suportados).';
  return 'Não foi possível contactar o fornecedor.';
}

async function postJson(provider: ProviderId, apiKey: string, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<any> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(3000, timeoutMs))
    });
  } catch {
    throw new ProviderError(provider, 'Tempo de resposta esgotado ou ligação falhada.');
  }
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.text()).slice(0, 240); } catch { /* sem corpo */ }
    // Nunca registar a chave, mesmo que o fornecedor a repita na mensagem de erro.
    console.error(`BANDGESTAO AI: ${provider} HTTP ${response.status}`, detail.split(apiKey).join('[chave]'));
    throw new ProviderError(provider, friendly(response.status), response.status);
  }
  try { return await response.json(); }
  catch { throw new ProviderError(provider, 'Resposta inválida do fornecedor.'); }
}

function safeParse(text: unknown): Record<string, any> {
  if (text && typeof text === 'object') return text as Record<string, any>;
  try { const v = JSON.parse(String(text || '{}')); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

/** Garante alternância user/assistant começando por "user" (exigido pela Claude e mais seguro nas restantes). */
export function normalizeHistory(history: ChatMsg[]): ChatMsg[] {
  const out: ChatMsg[] = [];
  for (const m of history) {
    const content = String(m.content || '').trim();
    if (!content || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const last = out[out.length - 1];
    if (!out.length && m.role !== 'user') continue;
    if (last && last.role === m.role) last.content += `\n${content}`;
    else out.push({ role: m.role, content });
  }
  return out;
}

interface RunCtx {
  cred: ProviderCredential;
  info: ProviderInfo;
  system: string;
  history: ChatMsg[];
  tools: ToolSpec[];
  exec: ToolExecutor;
  deadline: number;
}
const left = (ctx: RunCtx) => ctx.deadline - Date.now();

/* ───────────── OpenAI e compatíveis (Groq, OpenRouter) — Chat Completions ───────────── */
async function runOpenAI(ctx: RunCtx): Promise<string> {
  const { cred, info } = ctx;
  const messages: any[] = [{ role: 'system', content: ctx.system }, ...ctx.history];
  const tools = ctx.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const headers: Record<string, string> = { Authorization: `Bearer ${cred.apiKey}` };
  if (info.id === 'openrouter') { headers['X-Title'] = 'BANDGESTAO AI'; }
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const body: Record<string, any> = { model: cred.model, messages };
    if (tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
    body[info.id === 'openai' ? 'max_completion_tokens' : 'max_tokens'] = MAX_OUTPUT_TOKENS;
    const data = await postJson(cred.provider, cred.apiKey, `${info.baseUrl}/chat/completions`, headers, body, Math.min(22000, left(ctx)));
    const msg = data?.choices?.[0]?.message;
    if (!msg) throw new ProviderError(cred.provider, 'Resposta vazia do fornecedor.');
    const calls: any[] = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    if (!calls.length) {
      const content = Array.isArray(msg.content) ? msg.content.map((p: any) => p?.text || '').join('') : String(msg.content || '');
      return content.trim();
    }
    messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: calls });
    for (const call of calls) {
      const outcome = await ctx.exec(String(call?.function?.name || ''), safeParse(call?.function?.arguments));
      if (outcome.finalText) return outcome.finalText;
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(outcome.result) });
    }
  }
  return '';
}

/* ───────────── Google Gemini — generateContent ───────────── */
function toGeminiSchema(schema: any): any {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties' || k === '$schema' || k === 'strict') continue;
    out[k] = k === 'type' && typeof v === 'string' ? v.toUpperCase() : toGeminiSchema(v);
  }
  return out;
}

async function runGemini(ctx: RunCtx): Promise<string> {
  const { cred, info } = ctx;
  const contents: any[] = ctx.history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const url = `${info.baseUrl}/models/${encodeURIComponent(cred.model)}:generateContent`;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const body: Record<string, any> = {
      systemInstruction: { parts: [{ text: ctx.system }] },
      contents,
      generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS }
    };
    if (ctx.tools.length) {
      body.tools = [{ functionDeclarations: ctx.tools.map((t) => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.parameters) })) }];
      body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
    }
    const data = await postJson(cred.provider, cred.apiKey, url, { 'x-goog-api-key': cred.apiKey }, body, Math.min(22000, left(ctx)));
    const candidate = data?.candidates?.[0];
    const parts: any[] = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    if (!parts.length) {
      const reason = data?.promptFeedback?.blockReason || candidate?.finishReason;
      throw new ProviderError(cred.provider, reason ? `O fornecedor não devolveu resposta (${String(reason).slice(0, 40)}).` : 'Resposta vazia do fornecedor.');
    }
    const calls = parts.filter((p) => p?.functionCall);
    if (!calls.length) return parts.filter((p) => typeof p?.text === 'string' && !p.thought).map((p) => p.text).join('').trim();
    // O turno do modelo é devolvido tal como veio (preserva assinaturas de raciocínio dos modelos Gemini mais recentes).
    contents.push({ role: 'model', parts });
    const responses: any[] = [];
    for (const part of calls) {
      const fc = part.functionCall;
      const outcome = await ctx.exec(String(fc?.name || ''), safeParse(fc?.args));
      if (outcome.finalText) return outcome.finalText;
      responses.push({ functionResponse: { ...(fc.id ? { id: fc.id } : {}), name: fc.name, response: { result: outcome.result } } });
    }
    contents.push({ role: 'user', parts: responses });
  }
  return '';
}

/* ───────────── Anthropic Claude — Messages API ───────────── */
async function runClaude(ctx: RunCtx): Promise<string> {
  const { cred, info } = ctx;
  const messages: any[] = ctx.history.map((m) => ({ role: m.role, content: m.content }));
  const headers = { 'x-api-key': cred.apiKey, 'anthropic-version': '2023-06-01' };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const body: Record<string, any> = { model: cred.model, max_tokens: MAX_OUTPUT_TOKENS, system: ctx.system, messages };
    if (ctx.tools.length) body.tools = ctx.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    const data = await postJson(cred.provider, cred.apiKey, `${info.baseUrl}/messages`, headers, body, Math.min(22000, left(ctx)));
    const blocks: any[] = Array.isArray(data?.content) ? data.content : [];
    const uses = blocks.filter((b) => b?.type === 'tool_use');
    if (!uses.length) return blocks.filter((b) => b?.type === 'text').map((b) => String(b.text || '')).join('').trim();
    messages.push({ role: 'assistant', content: blocks });
    const results: any[] = [];
    for (const use of uses) {
      const outcome = await ctx.exec(String(use.name || ''), safeParse(use.input));
      if (outcome.finalText) return outcome.finalText;
      results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(outcome.result) });
    }
    messages.push({ role: 'user', content: results });
  }
  return '';
}

async function runProvider(ctx: RunCtx): Promise<string> {
  switch (ctx.info.kind) {
    case 'gemini': return runGemini(ctx);
    case 'claude': return runClaude(ctx);
    default: return runOpenAI(ctx);
  }
}

export interface AssistantRun {
  text: string;
  provider: ProviderId;
  model: string;
  attempts: AttemptLog[];
  toolsUsed: string[];
}

export class AllProvidersFailedError extends Error {
  constructor(public attempts: AttemptLog[]) {
    super('Nenhum fornecedor de IA conseguiu responder.');
    this.name = 'AllProvidersFailedError';
  }
}

/**
 * Corre o pedido pelo primeiro fornecedor disponível; em caso de falha segue para o seguinte.
 * Os resultados das ferramentas ficam em cache: se um fornecedor falhar depois de a ferramenta já ter
 * produzido efeitos (por exemplo enviar um PDF), o fornecedor seguinte reutiliza o resultado em vez de repetir.
 */
export async function runAssistant(opts: {
  chain: ProviderCredential[];
  system: string;
  history: ChatMsg[];
  tools: ToolSpec[];
  exec: ToolExecutor;
  budgetMs?: number;
}): Promise<AssistantRun> {
  const deadline = Date.now() + (opts.budgetMs ?? 48000);
  const history = normalizeHistory(opts.history);
  const cache = new Map<string, ToolOutcome>();
  const toolsUsed: string[] = [];
  const exec: ToolExecutor = async (name, args) => {
    const key = `${name}:${JSON.stringify(args)}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const outcome = await opts.exec(name, args);
    cache.set(key, outcome);
    if (!toolsUsed.includes(name)) toolsUsed.push(name);
    return outcome;
  };
  const attempts: AttemptLog[] = [];
  for (const cred of opts.chain) {
    if (deadline - Date.now() < 5000) break;
    const started = Date.now();
    const info = PROVIDERS[cred.provider];
    try {
      const text = await runProvider({ cred, info, system: opts.system, history, tools: opts.tools, exec, deadline });
      attempts.push({ provider: cred.provider, model: cred.model, ok: true, ms: Date.now() - started });
      return { text: text || 'Não consegui produzir uma resposta. Reformule o pedido, por favor.', provider: cred.provider, model: cred.model, attempts, toolsUsed };
    } catch (error) {
      const pe = error instanceof ProviderError ? error : new ProviderError(cred.provider, 'Falha inesperada no fornecedor.');
      attempts.push({ provider: cred.provider, model: cred.model, ok: false, error: pe.message, status: pe.status, ms: Date.now() - started });
    }
  }
  throw new AllProvidersFailedError(attempts);
}

/** Teste rápido de uma chave (sem ferramentas). */
export async function testCredential(cred: ProviderCredential): Promise<{ ok: boolean; message: string; ms: number; status?: number }> {
  const started = Date.now();
  try {
    const text = await runProvider({
      cred, info: PROVIDERS[cred.provider], system: 'Responde apenas com a palavra OK.',
      history: [{ role: 'user', content: 'Teste de ligação.' }], tools: [],
      exec: async () => ({ result: null }), deadline: Date.now() + 20000
    });
    return { ok: true, message: text ? 'Ligação confirmada.' : 'Ligação confirmada (resposta vazia).', ms: Date.now() - started };
  } catch (error) {
    const pe = error instanceof ProviderError ? error : null;
    return { ok: false, message: pe?.message || 'Falha ao testar a chave.', ms: Date.now() - started, status: pe?.status };
  }
}

/** Chaves definidas como variáveis de ambiente do servidor (reserva para todas as instituições). */
export function serverCredentials(): ProviderCredential[] {
  const env = (k: string) => String(process.env[k] || '').trim();
  const list: ProviderCredential[] = [];
  for (const id of PROVIDER_IDS) {
    const info = PROVIDERS[id];
    const apiKey = info.envKeys.map(env).find(Boolean);
    if (!apiKey) continue;
    let model = env(info.envModel) || info.defaultModel;
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/\-]{0,119}$/.test(model)) model = info.defaultModel;
    list.push({ provider: id, apiKey, model, source: 'server' });
  }
  return list;
}
