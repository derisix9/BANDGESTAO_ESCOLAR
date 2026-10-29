// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const conflicts = [
  { id: 'students/s1/phone', collection: 'students', recordId: 's1', field: 'phone', recordLabel: 'Ana Silva', mine: '923', theirs: '900', detectedAt: '2026-10-29T10:00:00Z' },
  { id: 'students/s2/note', collection: 'students', recordId: 's2', field: 'note', recordLabel: 'Rui Costa', mine: 'minha nota', theirs: undefined, detectedAt: '2026-10-29T10:00:00Z' }
];
const h = vi.hoisted(() => ({ resolve: vi.fn(), resolveAll: vi.fn() }));
vi.mock('../src/services/db', () => ({
  dbService: {
    getSyncConflicts: () => conflicts,
    subscribeSyncConflicts: (fn: any) => { fn(conflicts); return () => {}; },
    resolveSyncConflict: h.resolve,
    resolveAllSyncConflicts: h.resolveAll
  }
}));
import { SyncConflictsModal } from '../src/components/SyncConflictsModal';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function render(onClose = vi.fn()) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(React.createElement(SyncConflictsModal, { onClose })); });
  return { el, onClose, unmount: () => act(() => root.unmount()) };
}
const btn = (el: HTMLElement, label: string) => Array.from(el.querySelectorAll('button')).filter((b) => b.textContent === label);

describe('ecrã de conflitos de edição', () => {
  it('mostra o registo, o campo e as duas versões', async () => {
    const { el, unmount } = await render();
    const t = el.textContent || '';
    expect(t).toContain('Conflitos de edição (2)');
    expect(t).toContain('Ana Silva');
    expect(t).toContain('«phone»');
    expect(t).toContain('923');
    expect(t).toContain('900');
    expect(t).toContain('(vazio)');            // o servidor não tem valor no 2.º conflito
    await unmount();
  });
  it('cada botão resolve o conflito certo', async () => {
    const { el, unmount } = await render();
    await act(async () => { btn(el, 'Manter a minha')[0].click(); });
    expect(h.resolve).toHaveBeenCalledWith('students/s1/phone', 'mine');
    await act(async () => { btn(el, 'Usar a do servidor')[1].click(); });
    expect(h.resolve).toHaveBeenCalledWith('students/s2/note', 'theirs');
    await unmount();
  });
  it('acções em lote e "Decidir depois"', async () => {
    const { el, onClose, unmount } = await render();
    await act(async () => { btn(el, 'Usar todas do servidor')[0].click(); });
    expect(h.resolveAll).toHaveBeenCalledWith('theirs');
    await act(async () => { btn(el, 'Manter todas as minhas')[0].click(); });
    expect(h.resolveAll).toHaveBeenCalledWith('mine');
    await act(async () => { btn(el, 'Decidir depois')[0].click(); });
    expect(onClose).toHaveBeenCalled();
    await unmount();
  });
});
