/**
 * Tradução automática da interface para inglês — comportamento semelhante ao "Traduzir página" do Chrome.
 *
 * Percorre o ecrã (textos, placeholders, títulos/tooltips, botões, opções, tabelas, gráficos SVG) e acompanha
 * tudo o que a aplicação desenha depois (modais, avisos, listas). Mantém intactos:
 *   • os DADOS da base de dados (nomes, turmas, moradas…) — ver setDataStrings();
 *   • ícones, campos que o utilizador está a escrever, código e os documentos oficiais do Estúdio
 *     (qualquer elemento com translate="no", data-no-translate ou class "notranslate" também fica de fora).
 * Ao voltar a Português restaura exatamente o texto original.
 *
 * Ordem de tradução: dicionário local → cache → serviço (/api/translate). O que ainda não tem tradução
 * fica em português por instantes e troca assim que a tradução chega.
 */
import { EN } from './en';
import { EN_COMMON } from './enDictionary';
import { getLang, onLangChange, type Lang } from './index';
import { cachedTranslation, requestTranslation } from './remote';

const DICT = new Map<string, string>();
const DICT_LOWER = new Map<string, string>();
const ENGLISH_VALUES = new Set<string>();
for (const rec of [EN_COMMON, EN]) {
  for (const [k, v] of Object.entries(rec)) {
    DICT.set(k, v); DICT_LOWER.set(k.toLowerCase(), v); ENGLISH_VALUES.add(v);
  }
}

// ───────────────────────── dados da base de dados (não traduzir) ─────────────────────────
let exactData = new Set<string>();
let multiWordRegex: RegExp | null = null;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function setDataStrings(strings: Iterable<string>): void {
  const next = new Set<string>();
  const multi: string[] = [];
  for (const raw of strings) {
    const t = raw.trim();
    if (t.length < 3 || !/\p{L}/u.test(t)) continue;
    if (DICT_LOWER.has(t.toLowerCase()) || ENGLISH_VALUES.has(t)) continue; // vocabulário da interface (ex.: "Masculino")
    next.add(t);
    if (/\s/.test(t) && t.length >= 6 && multi.length < 3000) multi.push(t);
  }
  let same = next.size === exactData.size;
  if (same) for (const t of next) if (!exactData.has(t)) { same = false; break; }
  if (same) return;
  exactData = next;
  multiWordRegex = multi.length ? new RegExp(multi.sort((a, b) => b.length - a.length).map(esc).join('|'), 'g') : null;
  resolved.clear();
  if (enabled) { restoreProtected(); scheduleFull(); }
}

// ───────────────────────── regras de tradução de um texto ─────────────────────────
const resolved = new Map<string, string>();

function worth(body: string): boolean {
  if (body.length > 1500 || !/\p{L}{2}/u.test(body)) return false;
  if (/^(https?:\/\/|www\.)/i.test(body) || /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(body)) return false;
  if (/^[A-Z0-9][A-Z0-9_\-./]*$/.test(body) && /[\d_\-./]/.test(body)) return false; // códigos (ROTA-0001, DECL-SEM-NOTAS)
  if (ENGLISH_VALUES.has(body)) return false;
  return true;
}

function matchCase(src: string, tr: string): string {
  const letters = src.replace(/[^\p{L}]/gu, '');
  if (letters.length >= 2 && letters === letters.toUpperCase()) return tr.toUpperCase();
  if (/^\p{Ll}/u.test(src)) return tr.charAt(0).toLowerCase() + tr.slice(1);
  return tr;
}

/** Traduz um bloco simples (sem dados protegidos). Devolve undefined enquanto a tradução não chegou. */
function translatePlain(text: string, onReady: () => void): string | undefined {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  const [, lead, body, trail] = m;
  if (!body) return text;
  const p = /^([^\p{L}\p{N}]*)([\s\S]*?)([^\p{L}\p{N}]*)$/u.exec(body)!;
  const [, pre, mid, post] = p;
  if (!worth(mid)) return text;
  let tr = DICT.get(mid);
  if (tr === undefined) { const l = DICT_LOWER.get(mid.toLowerCase()); if (l !== undefined) tr = matchCase(mid, l); }
  if (tr === undefined) tr = cachedTranslation(mid);
  if (tr === undefined) { requestTranslation(mid, onReady); return undefined; }
  return lead + pre + tr + post + trail;
}

/** Traduz protegendo os dados; undefined = ainda a aguardar tradução. */
function translateText(text: string, onReady: () => void): string | undefined {
  const t = text.trim();
  if (exactData.has(t)) return text;
  const hit = resolved.get(text);
  if (hit !== undefined) return hit;
  let out: string | undefined;
  if (multiWordRegex && (multiWordRegex.lastIndex = 0, multiWordRegex.test(text))) {
    multiWordRegex.lastIndex = 0;
    const parts: string[] = [];
    let last = 0, pending = false, m: RegExpExecArray | null;
    while ((m = multiWordRegex.exec(text))) {
      if (m.index > last) { const r = translatePlain(text.slice(last, m.index), onReady); if (r === undefined) pending = true; else parts.push(r); }
      parts.push(m[0]);
      last = m.index + m[0].length;
    }
    if (last < text.length) { const r = translatePlain(text.slice(last), onReady); if (r === undefined) pending = true; else parts.push(r); }
    multiWordRegex.lastIndex = 0;
    out = pending ? undefined : parts.join('');
  } else {
    out = translatePlain(text, onReady);
  }
  if (out !== undefined) { if (resolved.size > 20000) resolved.clear(); resolved.set(text, out); }
  return out;
}

// ───────────────────────── DOM ─────────────────────────
const TEXT_ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'aria-placeholder', 'label'];
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE', 'KBD', 'TITLE']);

let enabled = false;
let observer: MutationObserver | null = null;
const origText = new WeakMap<Node, string>();
const appliedText = new WeakMap<Node, string>();
const origAttr = new WeakMap<Element, Map<string, string>>();
const appliedAttr = new WeakMap<Element, Map<string, string>>();
const pendingNodes = new Set<Node>();
const pendingAttrs = new Map<Element, Set<string>>();
let flushTimer: number | undefined;

function skipEl(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP_TAGS.has(e.tagName)) return true;
    const cls = typeof e.className === 'string' ? e.className : '';
    if (cls && (cls.includes('material-symbols') || cls.includes('material-icons') || cls.includes('notranslate') || cls.includes('studio-paper'))) return true;
    if (e.getAttribute('translate') === 'no' || e.hasAttribute('data-no-translate')) return true;
    const ce = e.getAttribute('contenteditable');
    if (ce === 'true' || ce === '') return true;
  }
  return false;
}

function schedule() {
  if (flushTimer !== undefined) return;
  flushTimer = window.setTimeout(flush, 16);
}
function scheduleFull() { collect(document.body); schedule(); }

function addAttr(e: Element, name: string) {
  let s = pendingAttrs.get(e); if (!s) pendingAttrs.set(e, (s = new Set())); s.add(name);
}

function collect(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) { pendingNodes.add(root); return; }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) pendingNodes.add(n);
  const sel = TEXT_ATTRS.map((a) => `[${a}]`).join(',') + ',input[type=button],input[type=submit],input[type=reset]';
  const els: Element[] = [el, ...Array.from(el.querySelectorAll(sel))];
  for (const e of els) {
    for (const a of TEXT_ATTRS) if (e.hasAttribute(a)) addAttr(e, a);
    if (isButtonInput(e)) addAttr(e, 'value');
  }
}

function isButtonInput(e: Element): boolean {
  return e.tagName === 'INPUT' && /^(button|submit|reset)$/.test((e as HTMLInputElement).type);
}

function processText(node: Node) {
  const cur = node.nodeValue ?? '';
  if (appliedText.get(node) === cur) return;
  if (!node.isConnected || skipEl(node.parentElement)) return;
  const out = translateText(cur, () => { if (node.nodeValue === cur) { pendingNodes.add(node); schedule(); } });
  if (out === undefined || out === cur) return;
  origText.set(node, cur); appliedText.set(node, out); node.nodeValue = out;
}

function processAttr(el: Element, name: string) {
  if (name === 'value' && !isButtonInput(el)) return; // nunca tocar no que o utilizador escreve
  const cur = el.getAttribute(name);
  if (cur === null) return;
  if (appliedAttr.get(el)?.get(name) === cur) return;
  if (!el.isConnected || skipEl(el)) return;
  const out = translateText(cur, () => { if (el.getAttribute(name) === cur) { addAttr(el, name); schedule(); } });
  if (out === undefined || out === cur) return;
  let o = origAttr.get(el); if (!o) origAttr.set(el, (o = new Map())); o.set(name, cur);
  let a = appliedAttr.get(el); if (!a) appliedAttr.set(el, (a = new Map())); a.set(name, out);
  el.setAttribute(name, out);
}

function flush() {
  flushTimer = undefined;
  if (!enabled) { pendingNodes.clear(); pendingAttrs.clear(); return; }
  const t0 = performance.now();
  for (const n of pendingNodes) {
    pendingNodes.delete(n);
    if (n.nodeType === Node.TEXT_NODE) processText(n); else collect(n);
    if (performance.now() - t0 > 10) { schedule(); return; }
  }
  for (const [el, names] of pendingAttrs) {
    pendingAttrs.delete(el);
    names.forEach((a) => processAttr(el, a));
    if (performance.now() - t0 > 10) { schedule(); return; }
  }
  if (pendingNodes.size || pendingAttrs.size) schedule();
}

function restoreProtected() {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const o = origText.get(n);
    if (o !== undefined && appliedText.get(n) === n.nodeValue && exactData.has(o.trim())) { n.nodeValue = o; appliedText.delete(n); }
  }
}

function restoreAll() {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const o = origText.get(n);
    if (o !== undefined && appliedText.get(n) === n.nodeValue) n.nodeValue = o;
    appliedText.delete(n);
  }
  document.body.querySelectorAll('*').forEach((el) => {
    const o = origAttr.get(el), a = appliedAttr.get(el);
    if (o && a) o.forEach((orig, name) => { if (el.getAttribute(name) === a.get(name)) el.setAttribute(name, orig); });
    appliedAttr.delete(el);
  });
}

function onMutations(records: MutationRecord[]) {
  if (!enabled) return;
  for (const r of records) {
    if (r.type === 'childList') r.addedNodes.forEach((n) => pendingNodes.add(n));
    else if (r.type === 'characterData') pendingNodes.add(r.target);
    else if (r.type === 'attributes' && r.attributeName) addAttr(r.target as Element, r.attributeName);
  }
  schedule();
}

// ───────────────────────── caixas de diálogo do navegador ─────────────────────────
const nativeDialogs = { alert: window.alert, confirm: window.confirm, prompt: window.prompt };
function translateMessage(msg: unknown): string {
  const s = String(msg ?? '');
  return s.split('\n').map((line) => translateText(line, () => {}) ?? line).join('\n');
}
function patchDialogs(on: boolean) {
  window.alert = on ? (m?: unknown) => nativeDialogs.alert.call(window, translateMessage(m)) : nativeDialogs.alert;
  window.confirm = on ? (m?: string) => nativeDialogs.confirm.call(window, translateMessage(m)) : nativeDialogs.confirm;
  window.prompt = on ? (m?: string, d?: string) => nativeDialogs.prompt.call(window, translateMessage(m), d) : nativeDialogs.prompt;
}

// ───────────────────────── ligar / desligar ─────────────────────────
let savedTitle: string | null = null;

function enable() {
  if (enabled) return;
  enabled = true;
  document.documentElement.lang = 'en';
  patchDialogs(true);
  savedTitle = document.title;
  const tt = translateText(document.title, () => { if (enabled) document.title = translateText(savedTitle || '', () => {}) ?? document.title; });
  if (tt) document.title = tt;
  observer = new MutationObserver(onMutations);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...TEXT_ATTRS, 'value'] });
  scheduleFull();
}

function disable() {
  if (!enabled) return;
  enabled = false;
  observer?.disconnect(); observer = null;
  pendingNodes.clear(); pendingAttrs.clear();
  patchDialogs(false);
  restoreAll();
  document.documentElement.lang = 'pt-AO';
  if (savedTitle !== null) { document.title = savedTitle; savedTitle = null; }
}

function apply(lang: Lang) { if (lang === 'en') enable(); else disable(); }

/** Liga a tradução ao seletor de idioma (chamar uma vez no arranque). */
export function startAutoTranslate(): void {
  const go = () => apply(getLang());
  if (document.body) go(); else document.addEventListener('DOMContentLoaded', go, { once: true });
  onLangChange(apply);
}
