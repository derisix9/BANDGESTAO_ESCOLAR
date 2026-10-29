// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('../src/context/OperationContext', () => ({
  showAppConfirm: vi.fn(async () => true),
  showAppAlert: vi.fn(),
  showOperationSuccess: vi.fn(),
}));

import { enableTableEnhancements } from '../src/utils/tableEnhancements';
import { showAppAlert, showOperationSuccess } from '../src/context/OperationContext';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mountTable() {
  document.body.innerHTML = `
  <div id="app"><table id="t"><thead><tr><th>Nome</th><th>Ações</th></tr></thead><tbody id="tb"></tbody></table></div>`;
  const tb = document.getElementById('tb')!;
  const names = ['Ana', 'Bruno', 'Carla', 'Diogo'];
  const render = () => {
    tb.innerHTML = '';
    names.forEach((n) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${n}</td><td>
        <button title="Ver"><span class="material-symbols-outlined">visibility</span></button>
        <button title="Editar"><span class="material-symbols-outlined">edit</span></button>
        <button class="del" title="Eliminar"><span class="material-symbols-outlined">delete</span></button></td>`;
      tr.querySelector('.del')!.addEventListener('click', () => {
        // modal de confirmação do próprio ecrã (como FornecedoresView)
        const ov = document.createElement('div');
        ov.className = 'fixed inset-0';
        ov.innerHTML = `<button>Cancelar</button><button class="ok"><span class="material-symbols-outlined">delete</span><span>Eliminar</span></button>`;
        document.body.appendChild(ov);
        ov.querySelector('.ok')!.addEventListener('click', () => {
          setTimeout(() => { names.splice(names.indexOf(n), 1); ov.remove(); render(); }, 30);
        });
      });
      tb.appendChild(tr);
    });
  };
  render();
  return { names };
}

describe('tableEnhancements', () => {
  beforeAll(() => {
    (Element.prototype as any).getClientRects = () => [{}];
  });

  it('classifica botões, cria coluna de seleção e elimina em lote', async () => {
    const { names } = mountTable();
    enableTableEnhancements();
    await sleep(100);

    const table = document.getElementById('t')!;
    expect(table.hasAttribute('data-gr-table')).toBe(true);
    const acts = Array.from(table.querySelectorAll('tbody tr:first-child [data-gr-act]')).map((b) => b.getAttribute('data-gr-act'));
    expect(acts).toEqual(['view', 'edit', 'delete']);

    // cabeçalho + 1 caixa por linha
    expect(table.querySelectorAll('thead input.gr-sel-all').length).toBe(1);
    const boxes = table.querySelectorAll<HTMLInputElement>('tbody input.gr-sel-input');
    expect(boxes.length).toBe(4);

    // seleciona Bruno e Diogo
    for (const i of [1, 3]) { boxes[i].checked = true; boxes[i].dispatchEvent(new Event('change', { bubbles: true })); }
    const bar = document.querySelector<HTMLElement>('.gr-bulkbar')!;
    expect(bar.hidden).toBe(false);
    expect(bar.textContent).toContain('2 selecionados');

    // elimina em lote
    (bar.querySelector('.gr-bulkbar__del') as HTMLButtonElement).click();
    await sleep(2500);
    expect(names).toEqual(['Ana', 'Carla']);
    expect(bar.hidden).toBe(true);
    // Sucesso total → diálogo global (carregamento → visto animado), já não uma caixa de aviso.
    expect(showOperationSuccess).toHaveBeenCalled();
    expect((showOperationSuccess as any).mock.calls[0][1].details).toContain('2 registos eliminados');
    expect(showAppAlert).not.toHaveBeenCalled();
    // Re-render manteve coluna de seleção
    expect(table.querySelectorAll('tbody input.gr-sel-input').length).toBe(2);
  });

  it('selecionar todos marca só as linhas visíveis', async () => {
    mountTable();
    await sleep(100);
    const table = document.getElementById('t')!;
    table.querySelectorAll('tbody tr')[3].setAttribute('data-gr-pg-hidden', '');
    const all = table.querySelector<HTMLInputElement>('input.gr-sel-all')!;
    all.checked = true; all.dispatchEvent(new Event('change', { bubbles: true }));
    const marked = Array.from(table.querySelectorAll<HTMLInputElement>('tbody input.gr-sel-input')).filter((c) => c.checked).length;
    expect(marked).toBe(3);
  });

  it('tabela sem botão eliminar não ganha coluna; data-no-table-style é ignorada', async () => {
    document.body.innerHTML = `<table id="a"><thead><tr><th>X</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>
      <table id="b" data-no-table-style><thead><tr><th>X</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>`;
    await sleep(100);
    const a = document.getElementById('a')!, b = document.getElementById('b')!;
    expect(a.hasAttribute('data-gr-table')).toBe(true);
    expect(a.querySelector('[data-gr-sel]')).toBeNull();
    expect(b.hasAttribute('data-gr-table')).toBe(false);
  });

  it('botões só com ícone ganham cor mesmo sem ver/editar/eliminar', async () => {
    const ic = (n: string) => `<button><span class="material-symbols-outlined">${n}</span></button>`;
    document.body.innerHTML = `<table id="c"><thead><tr><th>X</th><th>A</th></tr></thead><tbody><tr><td>1</td><td>${ic('task_alt')}${ic('print')}${ic('block')}${ic('expand_more')}${ic('grading')}</td></tr></tbody></table>`;
    await sleep(100);
    const got = Array.from(document.querySelectorAll('#c tbody button')).map((b) => b.getAttribute('data-gr-act'));
    expect(got).toEqual(['success', 'other', 'danger', null, 'edit']);
  });
});
