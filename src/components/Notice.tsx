import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';

/**
 * CAIXAS DE AVISO GLOBAIS (estilo Unitel) — erros, avisos e informações.
 *
 * Em vez de faixas soltas dentro de cada ecrã, tudo aparece numa caixa de diálogo no topo, com botão
 * para fechar e fundo da cor correspondente: erro = vermelho, aviso = amarelo, informação = azul
 * (sucesso = verde). Duas formas de usar:
 *  • declarativa: <Notice tone="error">{erro}</Notice> — fica visível enquanto o componente existir
 *    (substitui as antigas faixas inline; desaparece ao sair do ecrã ou ao carregar em fechar);
 *  • imperativa: notify.error('texto') — desaparece sozinha ao fim de uns segundos.
 * O <NoticeHost /> (montado uma vez em main.tsx) desenha todas.
 */
export type NoticeTone = 'error' | 'warn' | 'info' | 'success';

interface Item {
  id: string;
  tone: NoticeTone;
  content: React.ReactNode;
  actions?: React.ReactNode;
  icon?: string;
  title?: string;
  duration?: number;          // ms; undefined = fica até ser fechada
  onClose?: () => void;
}

let items: Item[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const snapshot = () => items;

function upsert(it: Item) {
  const i = items.findIndex((x) => x.id === it.id);
  items = i >= 0 ? items.map((x, k) => (k === i ? it : x)) : [...items, it];
  emit();
}
function remove(id: string) {
  if (!items.some((x) => x.id === id)) return;
  items = items.filter((x) => x.id !== id);
  emit();
}

let seq = 0;
const DURATION: Record<NoticeTone, number> = { error: 8000, warn: 8000, info: 6000, success: 4000 };
function push(tone: NoticeTone, content: React.ReactNode, opts?: { actions?: React.ReactNode; duration?: number; title?: string; icon?: string }) {
  const id = `n${++seq}`;
  upsert({ id, tone, content, actions: opts?.actions, title: opts?.title, icon: opts?.icon, duration: opts?.duration ?? DURATION[tone] });
  return id;
}
export const notify = {
  error: (c: React.ReactNode, o?: Parameters<typeof push>[2]) => push('error', c, o),
  warn: (c: React.ReactNode, o?: Parameters<typeof push>[2]) => push('warn', c, o),
  info: (c: React.ReactNode, o?: Parameters<typeof push>[2]) => push('info', c, o),
  success: (c: React.ReactNode, o?: Parameters<typeof push>[2]) => push('success', c, o),
  dismiss: remove
};

const STYLE: Record<NoticeTone, { bg: string; border: string; color: string; icon: string }> = {
  error: { bg: '#a82222', border: '#7f1717', color: '#ffffff', icon: 'cancel' },
  warn: { bg: '#fef3c7', border: '#fcd34d', color: '#78350f', icon: 'warning' },
  info: { bg: '#dbeafe', border: '#93c5fd', color: '#1e3a8a', icon: 'info' },
  success: { bg: '#dcfce7', border: '#86efac', color: '#14532d', icon: 'check_circle' }
};

/** Botão para usar dentro de uma caixa de aviso (fundo claro, legível em qualquer cor). */
export const NoticeButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ children, style, ...rest }) => (
  <button
    type="button"
    data-no-btn-style
    {...rest}
    style={{ background: 'rgba(255,255,255,.92)', color: '#0b1f3a', border: '1px solid rgba(0,0,0,.12)', borderRadius: 8, padding: '6px 12px', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', ...style }}
  >
    {children}
  </button>
);

const Card: React.FC<{ it: Item }> = ({ it }) => {
  const s = STYLE[it.tone];
  const hover = useRef(false);
  useEffect(() => {
    if (!it.duration) return;
    let t = window.setTimeout(function tick() {
      if (hover.current) { t = window.setTimeout(tick, 1500); return; }   // com o rato em cima, não fecha
      if (it.onClose) it.onClose(); else remove(it.id);
    }, it.duration);
    return () => window.clearTimeout(t);
  }, [it.id, it.duration]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => { if (it.onClose) it.onClose(); else remove(it.id); };
  return (
    <div
      role={it.tone === 'error' ? 'alert' : 'status'}
      className={`bm-notice bm-notice-${it.tone}`}
      onMouseEnter={() => { hover.current = true; }}
      onMouseLeave={() => { hover.current = false; }}
      style={{ background: s.bg, color: s.color, borderColor: s.border }}
    >
      <span className="material-symbols-outlined bm-notice-icon" aria-hidden="true">{it.icon || s.icon}</span>
      <div className="bm-notice-body">
        {it.title && <div className="bm-notice-title">{it.title}</div>}
        <div className="bm-notice-text">{it.content}</div>
        {it.actions && <div className="bm-notice-actions">{it.actions}</div>}
      </div>
      <button type="button" data-no-btn-style onClick={close} aria-label="Fechar" title="Fechar" className="bm-notice-close" style={{ color: s.color }}>
        <span className="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </div>
  );
};

/** Texto corrido de um nó React (serve de chave para saber se a mensagem mudou). */
function textOf(n: React.ReactNode): string {
  if (n === null || n === undefined || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(textOf).join('');
  if (React.isValidElement(n)) return textOf((n.props as { children?: React.ReactNode }).children);
  return '';
}

/** Montar uma única vez (main.tsx): desenha todas as caixas de aviso no topo do ecrã. */
export const NoticeHost: React.FC = () => {
  const list = useSyncExternalStore(subscribe, snapshot, snapshot);
  if (list.length === 0) return null;
  return (
    <div className="bm-notices" data-no-btn-style data-no-row-select>
      {list.map((it) => <Card key={it.id} it={it} />)}
    </div>
  );
};

interface NoticeProps {
  tone?: NoticeTone;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  title?: string;
  icon?: string;
  /** Chave que reabre a caixa depois de fechada (por omissão, o próprio texto quando é uma string). */
  resetKey?: string;
}

/**
 * Aviso declarativo: substitui as faixas inline. Enquanto estiver montado mostra a caixa no topo;
 * ao fechar não volta a aparecer até o texto mudar. Sem conteúdo (null/''/false) não mostra nada.
 */
export const Notice: React.FC<NoticeProps> = ({ tone = 'info', children, actions, title, icon, resetKey }) => {
  const id = useId();
  const key = resetKey ?? textOf(children);
  const [closedKey, setClosedKey] = useState<string | null>(null);
  const closed = closedKey !== null && closedKey === key;
  const empty = !title && textOf(children).trim() === '' && !React.isValidElement(children);

  useEffect(() => {
    if (closed || empty) { remove(id); return; }
    upsert({ id, tone, content: children, actions, title, icon, onClose: () => setClosedKey(key) });
  });
  useEffect(() => () => remove(id), [id]);
  return null;
};
