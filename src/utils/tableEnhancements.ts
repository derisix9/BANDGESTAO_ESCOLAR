/**
 * TABELAS PADRONIZADAS — função global (par de `tablePagination.ts` e `stickyTableHeaders.ts`).
 *
 * Chamada UMA vez no arranque (ver main.tsx). Qualquer tabela do sistema, existente ou futura,
 * passa a ter o mesmo aspeto e comportamento — sem nenhum ecrã precisar de mudar:
 *
 *   1. LINHAS ALTERNADAS — o corpo da tabela alterna 2 tons de azul (cabeçalho intacto).
 *      As cores vivem em src/styles/global-layout.css (secção 6).
 *
 *   2. BOTÕES DE AÇÃO COLORIDOS — botões só com ícone dentro das linhas ganham fundo
 *      próprio e ícone branco: Ver = azul · Editar = âmbar · Eliminar = vermelho · outros = cinza.
 *      O tipo é detetado pelo ícone (Material Symbols) ou, em alternativa, pelo `title`.
 *
 *   3. SELEÇÃO DE LINHAS + ELIMINAÇÃO EM LOTE — se a tabela tiver botão "Eliminar" nas linhas,
 *      ganha uma coluna de caixas de seleção (com "selecionar todos" no cabeçalho, que marca só
 *      as linhas da página visível). Ao marcar linhas aparece a barra "N selecionados ·
 *      Eliminar selecionados". A eliminação em lote confirma UMA vez e depois aciona, linha a
 *      linha, o botão "Eliminar" do próprio ecrã — por isso permissões (ACL), regras de negócio,
 *      auditoria e atualização da lista funcionam exatamente como numa eliminação individual.
 *      Tabelas sem botão "Eliminar" (relatórios, consultas) não ganham a coluna.
 *
 * Como o programador usa
 *   • nada, por defeito;
 *   • `data-no-table-style` na tabela (ou num ancestral) exclui-a por completo;
 *   • `data-no-row-select` na tabela mantém o estilo mas não cria a coluna de seleção.
 */

import { setBulkAutoConfirm } from './bulkConfirm';
import { showAppAlert, showAppConfirm, showOperationSuccess } from '../context/OperationContext';

const SEL = 'data-gr-sel';
// Documentos em janela (recibos, boletins, fichas) ficam de fora; ecrãs inteiros com `printable-*` (Assiduidade, Relatórios…) não.
const SKIP = '[data-no-table-style], .printable-document[class*="shadow-2xl"]';
const HIDDEN_ATTR = 'data-gr-pg-hidden';

type Act = 'view' | 'edit' | 'delete' | 'danger' | 'success' | 'other';

const ICONS: Record<Exclude<Act, 'other'>, string[]> = {
  view: ['visibility', 'preview', 'zoom_in', 'open_in_new', 'info', 'find_in_page', 'folder_open', 'manage_search', 'search', 'visibility_off'],
  edit: ['edit', 'edit_note', 'edit_square', 'edit_document', 'drive_file_rename_outline', 'mode_edit', 'border_color',
    'grading', 'rate_review', 'history_edu', 'post_add', 'edit_calendar', 'person_alert'],
  delete: ['delete', 'delete_forever', 'delete_outline', 'person_remove', 'playlist_remove'],
  danger: ['block', 'cancel', 'do_not_disturb', 'report', 'error', 'warning', 'remove_circle', 'person_off', 'event_busy', 'gpp_bad'],
  success: ['check', 'done', 'done_all', 'task_alt', 'check_circle', 'verified', 'assignment_turned_in', 'how_to_reg',
    'assignment_return', 'link', 'thumb_up', 'paid', 'price_check']
};

/** Ícones de navegação/expansão: não são botões de ação, ficam como estão. */
const NAV_ICON = /^(expand_|chevron_|arrow_|keyboard_arrow|unfold_|more_|drag_|close$|menu$|first_page|last_page)/;

const TITLE_RX: Array<[Exclude<Act, 'other' | 'danger' | 'success'>, RegExp]> = [
  ['delete', /elimin|apag|remov|exclu|delete/i],
  ['edit', /edit|alterar|modific/i],
  ['view', /visualiz|detalh|\bver\b|abrir|consultar/i]
];

const CONFIRM_RX = /elimin|apag|remov|exclu|anular|confirm|definitiv|continuar|^\s*(sim|ok)\s*$/i;
const CANCEL_RX = /cancel|n[aã]o\b|fechar|voltar|desist/i;

let dispose: (() => void) | null = null;

export function enableTableEnhancements(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  if (dispose) return dispose;

  const tracked = new Set<HTMLTableElement>();
  const dirty = new Set<HTMLTableElement>();
  const rowSig = new WeakMap<HTMLTableRowElement, string>();
  let raf = 0;
  let running = false;
  let activeTable: HTMLTableElement | null = null;

  // ------------------------------------------------------------------ utilitários

  const ours = (n: Node) => n instanceof Element && (n.hasAttribute(SEL) || !!n.closest('.gr-bulkbar'));

  function eligible(table: HTMLTableElement): boolean {
    if (!table.isConnected || table.closest(SKIP)) return false;
    if (table.parentElement?.closest('table')) return false;       // tabelas aninhadas: não mexer
    if (!table.tHead || !table.tHead.querySelector('th')) return false;
    return table.tBodies.length > 0;
  }

  function bodyRows(table: HTMLTableElement): HTMLTableRowElement[] {
    const out: HTMLTableRowElement[] = [];
    for (const b of Array.from(table.tBodies)) out.push(...Array.from(b.rows));
    return out;
  }

  const isSpan = (r: HTMLTableRowElement) => {
    const cells = Array.from(r.cells).filter((c) => !c.hasAttribute(SEL));
    return cells.length === 1 && cells[0].colSpan > 1;
  };

  function sigOf(row: HTMLTableRowElement): string {
    return Array.from(row.cells).filter((c) => !c.hasAttribute(SEL)).map((c) => c.textContent || '').join('|');
  }

  // ------------------------------------------------------------------ botões de ação

  function actOf(btn: HTMLElement): Act | null {
    const ic = btn.querySelector('.material-symbols-outlined, .material-symbols-rounded, .material-icons');
    if (!ic) return null;
    const name = (ic.textContent || '').trim();
    const rest = (btn.textContent || '').replace(ic.textContent || '', '').trim();
    if (rest) return null;                                          // tem texto: não é botão só de ícone
    if (NAV_ICON.test(name)) return null;
    for (const k of Object.keys(ICONS) as Array<keyof typeof ICONS>) if (ICONS[k].includes(name)) return k;
    const label = `${btn.getAttribute('title') || ''} ${btn.getAttribute('aria-label') || ''}`;
    for (const [k, rx] of TITLE_RX) if (rx.test(label)) return k;
    return 'other';
  }

  function classifyButtons(table: HTMLTableElement) {
    for (const row of bodyRows(table)) {
      const btns = Array.from(row.querySelectorAll<HTMLElement>('button, a[role="button"]'))
        .filter((b) => !b.closest('table table'));
      const acts = btns.map((b) => [b, actOf(b)] as const);
      for (const [b, a] of acts) {
        if (a) { if (b.getAttribute('data-gr-act') !== a) b.setAttribute('data-gr-act', a); }
        else if (b.hasAttribute('data-gr-act')) b.removeAttribute('data-gr-act');
      }
    }
  }

  const deleteBtn = (row: HTMLTableRowElement) => row.querySelector<HTMLButtonElement>('[data-gr-act="delete"]');


  // ------------------------------------------------------------------ coluna de seleção

  function makeCheckbox(cls: string, label: string): HTMLInputElement {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = cls;
    cb.setAttribute('aria-label', label);
    cb.setAttribute('data-acl-ignore', '');
    return cb;
  }

  function ensureSelection(table: HTMLTableElement, rows: HTMLTableRowElement[]) {
    // Cabeçalho (a 1.ª linha do thead leva a célula; as seguintes ficam cobertas por rowSpan).
    const head = table.tHead!;
    const hr = head.rows[0];
    let th = hr.querySelector<HTMLTableCellElement>(`:scope > th[${SEL}]`);
    if (!th) {
      th = document.createElement('th');
      th.setAttribute(SEL, '');
      const first = Array.from(hr.cells).find((c) => !c.hasAttribute(SEL));
      th.className = `${first?.className || ''} gr-sel-col`;
      th.rowSpan = head.rows.length;
      th.appendChild(makeCheckbox('gr-sel-input gr-sel-all', 'Selecionar todos'));
      hr.insertBefore(th, hr.firstChild);
    } else if (th.rowSpan !== head.rows.length) th.rowSpan = head.rows.length;

    // Corpo e rodapé.
    const foot = table.tFoot ? Array.from(table.tFoot.rows) : [];
    for (const row of [...rows, ...foot]) {
      const hasDel = !!deleteBtn(row) && !table.tFoot?.contains(row);
      if (isSpan(row)) {
        const c = Array.from(row.cells).find((x) => !x.hasAttribute(SEL))!;
        if (c.getAttribute('data-gr-cs') !== String(c.colSpan)) {
          c.colSpan = c.colSpan + 1;
          c.setAttribute('data-gr-cs', String(c.colSpan));
        }
        continue;
      }
      let td = row.querySelector<HTMLTableCellElement>(`:scope > td[${SEL}]`);
      const hadBox = !!td?.querySelector('input');
      if (td && hadBox === hasDel) continue;
      if (!td) {
        td = document.createElement('td');
        td.setAttribute(SEL, '');
        td.className = 'gr-sel-cell';
        row.insertBefore(td, row.firstChild);
      }
      td.replaceChildren();
      if (hasDel) td.appendChild(makeCheckbox('gr-sel-input', 'Selecionar linha'));
    }
  }

  function removeSelection(table: HTMLTableElement) {
    table.querySelectorAll(`[${SEL}]`).forEach((n) => n.remove());
    table.querySelectorAll<HTMLElement>('[data-gr-cs]').forEach((c) => {
      (c as HTMLTableCellElement).colSpan = Math.max(1, (c as HTMLTableCellElement).colSpan - 1);
      c.removeAttribute('data-gr-cs');
    });
    table.querySelectorAll('[data-gr-selected]').forEach((r) => r.removeAttribute('data-gr-selected'));
  }

  const rowBox = (row: HTMLTableRowElement) =>
    row.querySelector<HTMLInputElement>(`:scope > td[${SEL}] input.gr-sel-input`);

  function checkedRows(table: HTMLTableElement): HTMLTableRowElement[] {
    return bodyRows(table).filter((r) => rowBox(r)?.checked);
  }

  /** Mantém a seleção coerente: linha cujo conteúdo mudou (lista reordenada/refrescada) perde a marca. */
  function syncSelection(table: HTMLTableElement) {
    const rows = bodyRows(table);
    for (const row of rows) {
      const cb = rowBox(row);
      if (!cb) { row.removeAttribute('data-gr-selected'); continue; }
      if (cb.checked && rowSig.get(row) !== sigOf(row)) cb.checked = false;
      if (cb.checked) { if (!row.hasAttribute('data-gr-selected')) row.setAttribute('data-gr-selected', ''); }
      else row.removeAttribute('data-gr-selected');
    }
    const all = table.tHead?.querySelector<HTMLInputElement>(`input.gr-sel-all`);
    if (all) {
      const vis = rows.filter((r) => rowBox(r) && !r.hasAttribute(HIDDEN_ATTR));
      const n = vis.filter((r) => rowBox(r)!.checked).length;
      all.checked = vis.length > 0 && n === vis.length;
      all.indeterminate = n > 0 && n < vis.length;
      all.disabled = vis.length === 0;
    }
  }

  // ------------------------------------------------------------------ barra de ações em lote

  const bar = document.createElement('div');
  bar.className = 'gr-bulkbar';
  bar.hidden = true;
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-live', 'polite');
  bar.setAttribute('data-acl-ignore', '');
  bar.setAttribute('data-no-resize', '');
  bar.innerHTML =
    '<span class="gr-bulkbar__count"></span>' +
    '<button type="button" class="gr-bulkbar__clear">Limpar</button>' +
    '<button type="button" class="gr-bulkbar__pay" hidden><span class="material-symbols-outlined" style="font-size:20px">payments</span><span class="gr-bulkbar__paylabel">Pagar selecionados</span></button>' +
    '<button type="button" class="gr-bulkbar__enroll" hidden><span class="material-symbols-outlined" style="font-size:20px">assignment_turned_in</span><span class="gr-bulkbar__enrolllabel">Matricular selecionados</span></button>' +
    '<button type="button" class="gr-bulkbar__del">' +
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>' +
    '<span class="gr-bulkbar__dellabel">Eliminar selecionados</span></button>';
  document.body.appendChild(bar);
  const barCount = bar.querySelector<HTMLSpanElement>('.gr-bulkbar__count')!;
  const barDel = bar.querySelector<HTMLButtonElement>('.gr-bulkbar__del')!;
  const barClear = bar.querySelector<HTMLButtonElement>('.gr-bulkbar__clear')!;
  const barPay = bar.querySelector<HTMLButtonElement>('.gr-bulkbar__pay')!;
  const barEnroll = bar.querySelector<HTMLButtonElement>('.gr-bulkbar__enroll')!;

  /** Linhas selecionadas de alunos (`data-student-id`) numa tabela que aceita matrícula em lote (`data-bulk-enroll`). */
  const enrollRows = (table: HTMLTableElement) =>
    table.hasAttribute('data-bulk-enroll') ? checkedRows(table).filter((r) => r.hasAttribute('data-student-id')) : [];

  /** Linhas selecionadas que têm botão "Pagar" (tabela de faturas, com `data-invoice-id`). */
  const payRows = (table: HTMLTableElement) =>
    checkedRows(table).filter((r) => r.hasAttribute('data-invoice-id') && Array.from(r.querySelectorAll('button')).some((b) => /^\s*(pagar|liquidar)\b/i.test((b.textContent || '').replace(/^[a-z_]+(?=\s*(pagar|liquidar))/i, ''))));

  function refreshBar() {
    if (running) return;
    let target: HTMLTableElement | null = null;
    if (activeTable && activeTable.isConnected && checkedRows(activeTable).length) target = activeTable;
    else for (const t of tracked) if (t.isConnected && checkedRows(t).length) { target = t; break; }
    activeTable = target;
    if (!target) { bar.hidden = true; return; }
    const n = checkedRows(target).length;
    barCount.textContent = `${n} ${n === 1 ? 'selecionado' : 'selecionados'}`;
    const np = payRows(target).length;
    barPay.hidden = np === 0;
    barPay.querySelector('.gr-bulkbar__paylabel')!.textContent = np > 1 ? `Pagar ${np} faturas` : 'Pagar fatura';
    const ne = enrollRows(target).length;
    barEnroll.hidden = ne === 0;
    barEnroll.querySelector('.gr-bulkbar__enrolllabel')!.textContent = ne > 1 ? `Matricular ${ne} alunos` : 'Matricular aluno';
    bar.hidden = false;
  }

  function clearSelection(table: HTMLTableElement) {
    table.querySelectorAll<HTMLInputElement>('input.gr-sel-input').forEach((c) => { c.checked = false; c.indeterminate = false; });
    syncSelection(table);
    refreshBar();
  }

  // ------------------------------------------------------------------ eliminação em lote

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const shown = (e: Element) => getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;

  function overlays(): Set<Element> {
    const found = document.querySelectorAll('.fixed.inset-0, [role="dialog"], [role="alertdialog"], [aria-modal="true"]');
    return new Set(Array.from(found).filter((e) => !e.closest('.gr-bulkbar') && shown(e)));
  }

  function findButton(scope: Element, rx: RegExp, neg?: RegExp): HTMLButtonElement | null {
    const list = Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).filter((b) => {
      const t = (b.textContent || '').trim();
      return !b.disabled && (!neg || !neg.test(t)) && rx.test(t);
    });
    return list.length ? list[list.length - 1] : null;   // a ação principal costuma ser a última
  }

  function findRow(table: HTMLTableElement, sig: string): HTMLTableRowElement | null {
    return bodyRows(table).find((r) => !!deleteBtn(r) && sigOf(r) === sig) || null;
  }

  async function deleteOne(table: HTMLTableElement, sig: string): Promise<'ok' | 'fail' | 'gone'> {
    const row = findRow(table, sig);
    if (!row) return 'gone';
    const btn = deleteBtn(row);
    if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return 'fail';
    const base = overlays();
    btn.click();

    // 1) Caixa de confirmação do próprio ecrã (se existir): procura o botão "Eliminar/Confirmar" e carrega.
    for (let i = 0; i < 16; i++) {
      await sleep(50);
      const fresh = Array.from(overlays()).filter((o) => !base.has(o));
      const withButtons = fresh.filter((o) => o.querySelector('button'));
      if (!withButtons.length) continue;
      const dlg = withButtons[withButtons.length - 1];
      const ok = findButton(dlg, CONFIRM_RX, CANCEL_RX);
      if (ok) { ok.click(); break; }
      // Janela desconhecida (ex.: aviso de permissão): fecha-a e dá a linha como não eliminada.
      (findButton(dlg, CANCEL_RX) || dlg.querySelector<HTMLButtonElement>('button'))?.click();
      await sleep(150);
      return 'fail';
    }

    // 2) Espera que a linha desapareça e que o ecrã de "a processar / sucesso" feche.
    let idle = 0;
    for (let i = 0; i < 200; i++) {
      await sleep(100);
      const gone = !row.isConnected || !findRow(table, sig);
      const open = Array.from(overlays()).filter((o) => !base.has(o)).length;
      if (gone && !open) { await sleep(80); return 'ok'; }
      if (!gone && !open) { if (++idle >= 15) return 'fail'; } else idle = 0;
    }
    return 'fail';
  }

  async function bulkDelete(table: HTMLTableElement) {
    if (running) return;
    const sigs = checkedRows(table).map(sigOf);
    if (!sigs.length) return;
    const ok = await showAppConfirm(
      `Eliminar ${sigs.length} ${sigs.length === 1 ? 'registo selecionado' : 'registos selecionados'}? Esta ação não pode ser anulada.`,
      { title: 'Eliminar selecionados', variant: 'error', confirmLabel: 'Eliminar', cancelLabel: 'Cancelar' }
    );
    if (!ok) return;

    running = true;
    barDel.disabled = true; barClear.disabled = true;
    const nativeConfirm = window.confirm;
    window.confirm = () => true;          // confirmações nativas dos ecrãs
    setBulkAutoConfirm(true);             // confirmações do sistema (showAppConfirm) + sem pausas de "sucesso"
    let done = 0, failed = 0;
    try {
      for (let i = 0; i < sigs.length; i++) {
        barCount.textContent = `A eliminar ${i + 1} de ${sigs.length}…`;
        const r = await deleteOne(table, sigs[i]);
        if (r === 'ok') done++; else if (r === 'fail') failed++;
      }
    } finally {
      setBulkAutoConfirm(false);
      window.confirm = nativeConfirm;
      running = false;
      barDel.disabled = false; barClear.disabled = false;
      table.querySelectorAll<HTMLInputElement>('input.gr-sel-input').forEach((c) => { c.checked = false; });
      queue(table);
      refreshBar();
    }
    if (failed) {
      showAppAlert(
        `${done} eliminado(s). ${failed} não pôde(puderam) ser eliminado(s) — verifique as permissões ou dependências do registo.`,
        { title: 'Eliminação em lote', variant: 'warning' }
      );
    } else {
      // Tudo eliminado: confirmação pelo diálogo global (carregamento → visto animado).
      void showOperationSuccess('Operação feita com sucesso!', {
        details: `${done} ${done === 1 ? 'registo eliminado' : 'registos eliminados'}.`
      });
    }
  }

  barDel.addEventListener('click', () => { if (activeTable) void bulkDelete(activeTable); });
  barPay.addEventListener('click', () => {
    if (!activeTable) return;
    const ids = payRows(activeTable).map((r) => r.getAttribute('data-invoice-id') || '').filter(Boolean);
    window.dispatchEvent(new CustomEvent('bm-bulk-pay', { detail: { ids } }));
  });
  barEnroll.addEventListener('click', () => {
    if (!activeTable) return;
    const ids = enrollRows(activeTable).map((r) => r.getAttribute('data-student-id') || '').filter(Boolean);
    if (ids.length) window.dispatchEvent(new CustomEvent('bm-bulk-enroll', { detail: { ids } }));
  });
  barClear.addEventListener('click', () => { if (activeTable) clearSelection(activeTable); });

  // ------------------------------------------------------------------ eventos das caixas

  document.addEventListener('change', (e) => {
    const t = e.target as HTMLElement | null;
    if (!t || !(t instanceof HTMLInputElement) || !t.classList.contains('gr-sel-input')) return;
    const table = t.closest('table') as HTMLTableElement | null;
    if (!table) return;
    activeTable = table;
    if (t.classList.contains('gr-sel-all')) {
      for (const row of bodyRows(table)) {
        const cb = rowBox(row);
        if (!cb || row.hasAttribute(HIDDEN_ATTR)) continue;
        cb.checked = t.checked;
        if (cb.checked) rowSig.set(row, sigOf(row));
      }
    } else {
      const row = t.closest('tr') as HTMLTableRowElement | null;
      if (row && t.checked) rowSig.set(row, sigOf(row));
    }
    syncSelection(table);
    refreshBar();
  });

  // ------------------------------------------------------------------ ciclo de atualização

  function update(table: HTMLTableElement) {
    if (!eligible(table)) {
      if (table.hasAttribute('data-gr-table')) {
        table.removeAttribute('data-gr-table');
        removeSelection(table);
      }
      if (!table.isConnected) tracked.delete(table);
      return;
    }
    if (!table.hasAttribute('data-gr-table')) table.setAttribute('data-gr-table', '');
    classifyButtons(table);
    const rows = bodyRows(table);
    const wantsSelect = !table.closest('[data-no-row-select]') && rows.some((r) => !!deleteBtn(r));
    if (wantsSelect) { ensureSelection(table, rows); syncSelection(table); }
    else if (table.querySelector(`[${SEL}]`)) removeSelection(table);
    if (!table.isConnected) tracked.delete(table);
  }

  function flush() {
    raf = 0;
    const batch = Array.from(dirty);
    dirty.clear();
    for (const t of batch) update(t);
    refreshBar();
  }

  function queue(table: HTMLTableElement) {
    dirty.add(table);
    if (!raf) raf = requestAnimationFrame(flush);
  }

  function track(table: HTMLTableElement) {
    if (!tracked.has(table)) tracked.add(table);
    queue(table);
  }

  function scan(node: HTMLElement) {
    if (node instanceof HTMLTableElement) track(node);
    node.querySelectorAll<HTMLTableElement>('table').forEach(track);
  }

  const mo = new MutationObserver((records) => {
    for (const r of records) {
      const target = r.target as Element;
      if (target.closest?.('.gr-bulkbar')) continue;
      const added = Array.from(r.addedNodes);
      const removed = Array.from(r.removedNodes);
      if (added.every(ours) && removed.every(ours) && (added.length || removed.length)) continue;   // só mexemos nós
      added.forEach((n) => { if (n instanceof HTMLElement && !ours(n)) scan(n); });
      const table = target.closest?.('table') as HTMLTableElement | null;
      if (table && (added.length || removed.length)) track(table);
      if (removed.length) tracked.forEach((t) => { if (!t.isConnected) queue(t); });
    }
  });

  mo.observe(document.body, { childList: true, subtree: true });
  scan(document.body);

  dispose = () => {
    mo.disconnect();
    if (raf) cancelAnimationFrame(raf);
    tracked.forEach((t) => { t.removeAttribute('data-gr-table'); removeSelection(t); });
    tracked.clear(); dirty.clear();
    bar.remove();
    dispose = null;
  };
  return dispose;
}
