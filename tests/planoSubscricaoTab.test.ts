// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const day = 86400000;
let sub: any;
let tickets: any[] = [];
vi.mock('../src/services/cloud', () => ({
  getMySubscription: vi.fn(async () => sub),
  getMySupportTickets: vi.fn(async () => tickets),
  markSupportTicketSeen: vi.fn(async () => {}),
  replySupportTicket: vi.fn(async () => ({ success: true })),
  createSupportTicket: vi.fn(async () => ({ success: true }))
}));
import { TabPlanoSubscricao } from '../src/views/configuracoes/TabPlanoSubscricao';
import { NoticeHost } from '../src/components/Notice';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function render(role: string) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  // Os avisos (<Notice>) são desenhados pelo NoticeHost global (montado em main.tsx), não dentro da aba: monta-se aqui também.
  await act(async () => { root.render(React.createElement(React.Fragment, null, React.createElement(TabPlanoSubscricao, { currentUserRole: role as any }), React.createElement(NoticeHost))); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return { el, unmount: () => act(() => root.unmount()) };
}

const base = () => ({
  schoolName: 'Escola X', phase: 'pago', active: true,
  activatedAt: new Date(Date.now() - 10 * day).toISOString(), createdAt: new Date(Date.now() - 40 * day).toISOString(),
  trialEndsAt: null, paidUntil: new Date(Date.now() + 20 * day).toISOString(),
  expiresAt: new Date(Date.now() + 20 * day).toISOString(), planEndedAt: null, graceUntil: null, graceNote: null,
  plan: { name: 'Profissional', cycle: 'Mensal', priceKz: 85000, trialDays: 30 },
  limits: { students: 800, users: 25, storageBytes: 10 * 1024 ** 3 },
  usage: { students: 800, users: 3, storageBytes: 5 * 1024 ** 2, dbBytes: 4 * 1024 ** 2, filesBytes: 1024 ** 2 },
  blocked: { students: true, users: false, storage: false }, serverTime: new Date().toISOString()
});

describe('TabPlanoSubscricao', () => {
  it('plano pago: mostra plano, contagem e bloqueio de alunos no limite', async () => {
    sub = base(); tickets = [];
    const { el, unmount } = await render('admin');
    expect(el.textContent).toContain('Profissional');
    expect(el.textContent).toContain('Plano ativo');
    expect(el.textContent).toContain('dias');
    expect(el.textContent).toMatch(/não é possível cadastrar novos alunos/i);
    expect(el.textContent).toContain('800');
    await unmount();
  });
  it('tolerância: mostra aviso com nota', async () => {
    sub = { ...base(), phase: 'tolerancia', graceUntil: new Date(Date.now() + 3 * day).toISOString(), expiresAt: new Date(Date.now() + 3 * day).toISOString(), graceNote: 'aguarda transferência', planEndedAt: new Date(Date.now() - 2 * day).toISOString(), blocked: { students: false, users: false, storage: false } };
    const { el, unmount } = await render('director');
    expect(el.textContent).toContain('Em tolerância');
    expect(el.textContent).toContain('aguarda transferência');
    await unmount();
  });
  it('limites vazios = ilimitado; pedidos de suporte com não lido', async () => {
    sub = { ...base(), plan: null, limits: { students: null, users: null, storageBytes: null }, blocked: { students: false, users: false, storage: false } };
    tickets = [{ id: 't1', subject: 'Pagamento', message: 'olá', priority: 'alta', status: 'aberto', origin: 'plataforma', replies: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), unread: true }];
    const { el, unmount } = await render('admin');
    expect(el.textContent).toContain('Ilimitado');
    expect(el.textContent).toContain('Pagamento');
    expect(el.textContent).toContain('1 nova');
    await unmount();
  });
  it('outros perfis não veem o plano', async () => {
    const { el, unmount } = await render('secretaria');
    expect(el.textContent).toMatch(/Só o Administrador ou o Diretor/);
    await unmount();
  });
});
