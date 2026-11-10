/**
 * Destaque animado de cards ao passar o rato. O comportamento limita-se à elevação/escala
 * e ao recuo discreto dos cards vizinhos. Fundo, bordas, texto e ícones conservam sempre
 * as cores definidas pelo tema e pela própria secção.
 *
 * Alvos: `.kpi-card`, `.bm-stat-card`, `.card-hl`, `[data-card-hl]` e, automaticamente, qualquer "card de estatística" de qualquer secção
 * (caixa com borda arredondada, tamanho de card, sem formulários/tabelas, com irmãos parecidos na mesma grelha).
 * Para excluir um card: `data-card-hl="off"`.
 */

const DEFAULT_SELECTOR = '.kpi-card, .bm-stat-card, .card-hl, [data-card-hl]:not([data-card-hl="off"])';
const TRANSITION =
  'transform .28s cubic-bezier(.2,.75,.25,1), box-shadow .28s ease, opacity .24s ease';

// ---------------------------------------------------------------------------
// Deteção automática de cards (secções que não usam a classe .kpi-card)
// ---------------------------------------------------------------------------
const NOT_CARD_TAGS = new Set(['HTML', 'BODY', 'MAIN', 'FORM', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'LI', 'UL', 'OL', 'SELECT', 'INPUT', 'TEXTAREA', 'OPTION', 'LABEL', 'SVG']);

const ICON_BY_TEXT: Array<[RegExp, string]> = [
  [/alun|estudant|matr[ií]cul|educand/, 'school'],
  [/professor|docente|funcion[aá]rio|colaborador|utilizador/, 'badge'],
  [/pagamento|cobran[cç]a|receita|propina|fatura|financeir|saldo|lucro/, 'payments'],
  [/despesa|sa[ií]da|d[eé]bito/, 'receipt_long'],
  [/assiduidade|presen[cç]a|falta|frequ[eê]ncia/, 'fact_check'],
  [/turma|sala|hor[aá]rio|disciplina|curso|classe/, 'groups'],
  [/exame|pauta|nota|avalia[cç][aã]o|aproveitamento/, 'leaderboard'],
  [/trabalho|entrega|tarefa|atividade|actividade/, 'assignment'],
  [/internamento|paciente|consulta|m[eé]dico|sa[uú]de/, 'medical_services'],
  [/stock|invent[aá]rio|armaz[eé]m|produto/, 'inventory_2'],
  [/document|ficheiro|relat[oó]rio|exporta/, 'description'],
  [/plano|subscri[cç][aã]o|consumo|armazenamento/, 'workspace_premium'],
  [/admiss[aã]o|candidat|inscri[cç][aã]o/, 'person_add'],
  [/reuni[aã]o|comunica[cç][aã]o|mensagem|notifica/, 'campaign'],
  [/transporte|viatura|rota/, 'directions_bus'],
  [/refeit[oó]rio|refei[cç][aã]o|alimenta/, 'restaurant'],
  [/f[eé]rias|licen[cç]a/, 'beach_access'],
  [/fornecedor|compra|aquisi[cç][aã]o/, 'local_shipping'],
];

/** Garante uma marca-d'água coerente mesmo nos cartões antigos sem metadados. */
function ensureStatIcon(el: HTMLElement): void {
  if (el.dataset.statIcon) return;
  const glyph = el.querySelector<HTMLElement>('.material-symbols-outlined, .material-icons, [data-stat-icon]');
  const glyphText = (glyph?.dataset.statIcon || glyph?.textContent || '').trim().replace(/\s+/g, '_');
  if (glyphText && /^[a-z0-9_]{2,40}$/i.test(glyphText)) {
    el.dataset.statIcon = glyphText;
    return;
  }
  const label = (el.querySelector<HTMLElement>('.kpi-label, .bm-stat-label, h1, h2, h3, h4, strong, b')?.textContent || el.textContent || '').trim().toLowerCase();
  el.dataset.statIcon = ICON_BY_TEXT.find(([pattern]) => pattern.test(label))?.[1] || 'analytics';
}

function decorateStatCards(root: ParentNode): void {
  if (root instanceof HTMLElement && root.matches('.kpi-card, .bm-stat-card')) ensureStatIcon(root);
  root.querySelectorAll<HTMLElement>('.kpi-card, .bm-stat-card').forEach(ensureStatIcon);
}

function classSimilarity(a: Element, b: Element): number {
  const A = new Set(Array.from(a.classList)); const B = new Set(Array.from(b.classList));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0; A.forEach((x) => { if (B.has(x)) inter++; });
  return inter / (A.size + B.size - inter);
}

/** Irmãos "do mesmo grupo" (mesma etiqueta e classes parecidas): os outros cards da grelha. */
function cardGroup(el: HTMLElement): HTMLElement[] {
  const parent = el.parentElement;
  if (!parent) return [];
  return (Array.from(parent.children) as HTMLElement[]).filter((o) => o !== el && o.tagName === el.tagName && classSimilarity(el, o) >= 0.5);
}

export function isStatCard(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.classList.contains('card-hl-on')) return true;
  if (NOT_CARD_TAGS.has(el.tagName.toUpperCase())) return false;
  if (el.closest('[data-card-hl="off"], table, nav, aside')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 110 || r.width > 560 || r.height < 52 || r.height > 260) return false;
  const cs = getComputedStyle(el);
  const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some((side) => (parseFloat((cs as any)[`border${side}Width`]) || 0) > 0 && (cs as any)[`border${side}Style`] !== 'none');
  if (!hasBorder || (parseFloat(cs.borderTopLeftRadius) || 0) < 6) return false;
  if ((el.textContent || '').trim().length > 200) return false;
  if (el.querySelector('input, select, textarea, table, form, canvas')) return false;
  return cardGroup(el).length >= 1;
}

function findCard(target: EventTarget | null, selector: string): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  if (target.closest('[data-card-hl="off"]')) return null;
  let n: Element | null = target;
  for (let depth = 0; n && n !== document.body && depth < 8; depth++, n = n.parentElement) {
    if (n.matches(selector)) return n as HTMLElement;
    if (isStatCard(n)) return n;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Aplicar / remover: apenas classes visuais, sem escrever cores inline.
// ---------------------------------------------------------------------------
const peersBy = new WeakMap<HTMLElement, HTMLElement[]>();

function ensureMotion(el: HTMLElement) {
  if (!el.style.transition) {
    el.style.transition = TRANSITION;
    el.setAttribute('data-hl-t', '1');
  }
}

/** Activa/desactiva o destaque sem alterar nenhuma cor do card ou dos seus filhos. */
export function setCardHighlight(el: HTMLElement, on: boolean): void {
  if (!on) {
    el.classList.remove('card-hl-on');
    (peersBy.get(el) || []).forEach((peer) => peer.classList.remove('card-hl-peer'));
    peersBy.delete(el);
    return;
  }
  if (el.classList.contains('card-hl-on')) return;

  ensureMotion(el);
  el.classList.add('card-hl-on');

  // Os vizinhos recuam apenas em escala/opacidade; mantêm integralmente as cores.
  const peers = cardGroup(el).concat(
    Array.from(el.parentElement?.children || []).filter(
      (peer): peer is HTMLElement => peer instanceof HTMLElement && peer !== el && peer.matches(DEFAULT_SELECTOR)
    )
  );
  const uniquePeers = Array.from(new Set(peers));
  uniquePeers.forEach((peer) => {
    ensureMotion(peer);
    peer.classList.add('card-hl-peer');
  });
  peersBy.set(el, uniquePeers);
}

let installed = false;

/** Liga o destaque a todos os cards (inclusive os criados mais tarde) com um único conjunto de ouvintes. */
export function installCardHighlight(selector: string = DEFAULT_SELECTOR): () => void {
  if (installed || typeof document === 'undefined') return () => {};
  installed = true;
  let active: HTMLElement | null = null;

  // Inclui os cards que já existem e os que são montados dinamicamente pelas secções.
  decorateStatCards(document);
  const observer = new MutationObserver((records) => {
    records.forEach((record) => record.addedNodes.forEach((node) => {
      if (node instanceof HTMLElement) decorateStatCards(node);
    }));
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });

  const over = (e: Event) => {
    const card = findCard(e.target, selector);
    if (!card) return;
    const from = (e as MouseEvent).relatedTarget as Node | null;
    if (from && card.contains(from)) return;          // continua dentro do mesmo card
    if (active && active !== card) setCardHighlight(active, false);
    active = card;
    setCardHighlight(card, true);
  };
  const out = (e: Event) => {
    if (!active) return;
    const to = (e as MouseEvent).relatedTarget as Node | null;
    if (to && active.contains(to)) return;
    setCardHighlight(active, false);
    active = null;
  };

  document.addEventListener('mouseover', over);
  document.addEventListener('mouseout', out);
  document.addEventListener('focusin', over);
  document.addEventListener('focusout', out);
  window.addEventListener('blur', out);
  return () => {
    document.removeEventListener('mouseover', over);
    document.removeEventListener('mouseout', out);
    document.removeEventListener('focusin', over);
    document.removeEventListener('focusout', out);
    window.removeEventListener('blur', out);
    observer.disconnect();
    installed = false;
  };
}
