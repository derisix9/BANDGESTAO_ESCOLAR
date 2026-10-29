import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createSupportTicket,
  getMySubscription,
  getMySupportTickets,
  markSupportTicketSeen,
  replySupportTicket,
  type MySubscription,
  type SubscriptionPhase,
  type SupportTicket
} from '../../services/cloud';
import { UserRole } from '../../types';
import { Notice } from '../../components/Notice';

interface Props {
  currentUserRole?: UserRole;
}

/**
 * Configurações > Plano e Subscrição.
 *
 * Mostra ao Administrador/Diretor da escola, em tempo real:
 *  • o plano em vigor, a data de ativação e a contagem do tempo que falta para expirar;
 *  • os dias de tolerância concedidos pelo Admin Master (quando existem);
 *  • os benefícios do plano (alunos, utilizadores, armazenamento) com o consumo atual —
 *    ao atingir um limite o servidor bloqueia o cadastro/escrita (migração 0020);
 *  • os pedidos de suporte registados pela equipa BandMed, com resposta e novos pedidos.
 * Os dados vêm das funções my_subscription() e my_support_tickets() (só leitura aqui:
 * a escola não consegue alterar plano, datas nem limites).
 */

const PHASE_META: Record<SubscriptionPhase, { label: string; tone: string; icon: string; help: string }> = {
  trial: { label: 'Teste gratuito', tone: 'bg-sky-100 text-sky-800 border-sky-300', icon: 'hourglass_top', help: 'Período de teste em curso.' },
  pago: { label: 'Plano ativo', tone: 'bg-emerald-100 text-emerald-800 border-emerald-300', icon: 'verified', help: 'Subscrição paga em vigor.' },
  tolerancia: { label: 'Em tolerância', tone: 'bg-amber-100 text-amber-900 border-amber-300', icon: 'schedule', help: 'Prazo extra concedido pela equipa BandMed.' },
  expirada: { label: 'Expirado', tone: 'bg-red-100 text-red-800 border-red-300', icon: 'lock', help: 'O acesso está bloqueado até regularizar o plano.' }
};

const fmtDate = (iso?: string | null): string =>
  iso ? new Date(iso).toLocaleString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export const fmtBytes = (b: number): string => {
  if (!Number.isFinite(b) || b <= 0) return '0 KB';
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Decompõe milissegundos em dias/horas/minutos/segundos. */
function splitMs(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(t / 86400), h: Math.floor((t % 86400) / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
}

const STATUS_LABEL: Record<SupportTicket['status'], string> = { aberto: 'Aberto', em_curso: 'Em curso', fechado: 'Fechado' };
const PRIORITY_LABEL: Record<SupportTicket['priority'], string> = { baixa: 'Baixa', media: 'Média', alta: 'Alta' };

/** Barra de consumo de um benefício do plano. */
const UsageMeter: React.FC<{
  icon: string; label: string; used: number; limit: number | null; blocked: boolean;
  format?: (n: number) => string; blockedText: string;
}> = ({ icon, label, used, limit, blocked, format = (n) => String(n), blockedText }) => {
  const unlimited = limit === null || limit === undefined;
  const pct = unlimited ? 0 : limit! > 0 ? Math.min(100, Math.round((used / limit!) * 100)) : 100;
  const bar = blocked ? 'bg-red-600' : pct >= 85 ? 'bg-amber-500' : 'bg-emerald-600';
  return (
    <div data-card-hl className={`border p-4 bg-white ${blocked ? 'border-red-300' : 'border-slate-200'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[#0b1f3a] font-bold text-sm">
          <span className="material-symbols-outlined text-[20px]">{icon}</span>{label}
        </div>
        <span className="text-xs font-semibold text-slate-500">{unlimited ? 'Ilimitado' : `${pct}%`}</span>
      </div>
      <div className="mt-2 text-2xl font-extrabold text-[#0b1f3a]">
        {format(used)}
        <span className="text-sm font-semibold text-slate-500"> / {unlimited ? '∞' : format(limit!)}</span>
      </div>
      <div className="mt-2 h-2.5 w-full bg-slate-200 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={`h-full ${bar} transition-all`} style={{ width: unlimited ? '6%' : `${pct}%` }} />
      </div>
      {blocked && (
        <p className="mt-2 text-[11px] font-semibold text-red-700 flex items-start gap-1">
          <span className="material-symbols-outlined text-[15px]">block</span>{blockedText}
        </p>
      )}
    </div>
  );
};

export const TabPlanoSubscricao: React.FC<Props> = ({ currentUserRole }) => {
  const [sub, setSub] = useState<MySubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ subject: '', message: '', priority: 'media' as 'baixa' | 'media' | 'alta' });
  const [now, setNow] = useState(() => Date.now());
  const offsetRef = useRef(0); // relógio do servidor − relógio local

  const canSee = currentUserRole === 'admin' || currentUserRole === 'director';

  const load = useCallback(async () => {
    const [s, t] = await Promise.all([getMySubscription(), getMySupportTickets()]);
    if (s?.serverTime) offsetRef.current = new Date(s.serverTime).getTime() - Date.now();
    setSub(s);
    setTickets(t);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!canSee) { setLoading(false); return; }
    void load();
    const refresh = setInterval(() => void load(), 60_000);   // consumo e pedidos atualizam sozinhos
    return () => clearInterval(refresh);
  }, [canSee, load]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const expiresMs = sub?.expiresAt ? new Date(sub.expiresAt).getTime() : null;
  const remaining = expiresMs !== null ? expiresMs - (now + offsetRef.current) : null;
  const parts = remaining !== null ? splitMs(remaining) : null;

  // Percentagem do período já gasta (do início ao fim do período em vigor).
  const elapsedPct = useMemo(() => {
    if (!sub || expiresMs === null) return null;
    const startIso = sub.phase === 'trial' ? sub.createdAt
      : sub.phase === 'pago' ? sub.activatedAt
      : sub.phase === 'tolerancia' ? sub.planEndedAt : null;
    if (!startIso) return null;
    const start = new Date(startIso).getTime();
    const total = expiresMs - start;
    if (total <= 0) return 100;
    return Math.min(100, Math.max(0, Math.round(((now + offsetRef.current - start) / total) * 100)));
  }, [sub, expiresMs, now]);

  const openTicket = async (t: SupportTicket) => {
    const next = openId === t.id ? null : t.id;
    setOpenId(next);
    setReplyText('');
    setMsg(null);
    if (next && t.unread) {
      await markSupportTicketSeen(t.id);
      setTickets((prev) => prev.map((x) => (x.id === t.id ? { ...x, unread: false } : x)));
    }
  };

  const sendReply = async (id: string) => {
    if (!replyText.trim()) return;
    setBusy(true); setMsg(null);
    const r = await replySupportTicket(id, replyText.trim());
    setBusy(false);
    if (r.success) { setReplyText(''); setMsg({ type: 'ok', text: 'Resposta enviada.' }); await load(); }
    else setMsg({ type: 'err', text: r.error || 'Não foi possível enviar a resposta.' });
  };

  const sendNew = async () => {
    if (!form.subject.trim()) { setMsg({ type: 'err', text: 'Indique o assunto do pedido.' }); return; }
    setBusy(true); setMsg(null);
    const r = await createSupportTicket(form.subject.trim(), form.message.trim(), form.priority);
    setBusy(false);
    if (r.success) {
      setCreating(false); setForm({ subject: '', message: '', priority: 'media' });
      setMsg({ type: 'ok', text: 'Pedido enviado à equipa BandMed.' });
      await load();
    } else setMsg({ type: 'err', text: r.error || 'Não foi possível criar o pedido.' });
  };

  if (!canSee) {
    return (
      <div className="bg-white border border-slate-200 p-8 text-center text-sm text-slate-600">
        Só o Administrador ou o Diretor podem ver o plano e a subscrição da escola.
      </div>
    );
  }
  if (loading) return <div className="bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">A carregar plano e subscrição...</div>;
  if (!sub) {
    return (
      <div className="bg-white border border-slate-200 p-8 text-center text-sm text-slate-600">
        Não foi possível ler o plano. Verifique a ligação e <button type="button" className="underline font-bold" onClick={() => { setLoading(true); void load(); }}>tente de novo</button>.
        <p className="mt-2 text-xs text-slate-500">Se o erro persistir, a migração 0020 ainda não foi aplicada na base de dados.</p>
      </div>
    );
  }

  const meta = PHASE_META[sub.phase];
  const unread = tickets.filter((t) => t.unread).length;
  const anyBlocked = sub.blocked.students || sub.blocked.users || sub.blocked.storage;

  return (
    <div className="flex flex-col gap-5">
      {/* ---------------- Plano em vigor + contagem ---------------- */}
      <section className="bg-white border border-slate-200 shadow-xs p-6">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Plano da escola</div>
            <h2 className="text-2xl font-extrabold text-[#0b1f3a] mt-1">
              {sub.plan ? sub.plan.name : 'Sem plano atribuído'}
            </h2>
            <div className="mt-1 text-sm text-slate-600">
              {sub.plan
                ? <>{sub.plan.cycle} · {sub.plan.priceKz.toLocaleString('pt-PT')} Kz</>
                : 'A equipa BandMed ainda não atribuiu um plano: sem limites de alunos, utilizadores e armazenamento.'}
            </div>
            <span className={`inline-flex items-center gap-1 mt-3 px-3 py-1 border text-xs font-bold ${meta.tone}`}>
              <span className="material-symbols-outlined text-[16px]">{meta.icon}</span>{meta.label}
            </span>
            <p className="mt-2 text-xs text-slate-500">{meta.help}</p>
          </div>

          <div className="lg:text-right">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {sub.phase === 'expirada' ? 'Expirou em' : sub.phase === 'tolerancia' ? 'Tolerância termina em' : 'Tempo restante'}
            </div>
            {sub.phase === 'expirada' || !parts ? (
              <div className="text-3xl font-extrabold text-red-700 mt-1">{sub.phase === 'expirada' ? fmtDate(sub.expiresAt) : '—'}</div>
            ) : (
              <div className="flex lg:justify-end gap-2 mt-1" aria-live="off">
                {([['d', 'dias'], ['h', 'horas'], ['m', 'min'], ['s', 'seg']] as const).map(([k, l]) => (
                  <div key={k} data-card-hl className={`min-w-[64px] text-center border px-2 py-2 ${remaining! < 3 * 86400000 ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
                    <div className="text-2xl font-extrabold text-[#0b1f3a] tabular-nums">{k === 'd' ? parts[k] : pad(parts[k])}</div>
                    <div className="text-[10px] font-bold uppercase text-slate-500">{l}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {elapsedPct !== null && sub.phase !== 'expirada' && (
          <div className="mt-5">
            <div className="flex justify-between text-[11px] font-semibold text-slate-500 mb-1">
              <span>{elapsedPct}% do período utilizado</span>
              <span>Termina: {fmtDate(sub.expiresAt)}</span>
            </div>
            <div className="h-2.5 bg-slate-200 overflow-hidden">
              <div className={`h-full ${elapsedPct >= 85 ? 'bg-amber-500' : 'bg-[#0b1f3a]'}`} style={{ width: `${elapsedPct}%` }} />
            </div>
          </div>
        )}

        <dl className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <div data-card-hl className="bg-slate-50 border border-slate-200 p-3"><dt className="text-[11px] font-bold uppercase text-slate-500">Conta criada</dt><dd className="font-semibold text-[#0b1f3a]">{fmtDate(sub.createdAt)}</dd></div>
          <div data-card-hl className="bg-slate-50 border border-slate-200 p-3"><dt className="text-[11px] font-bold uppercase text-slate-500">Plano ativado</dt><dd className="font-semibold text-[#0b1f3a]">{fmtDate(sub.activatedAt)}</dd></div>
          <div data-card-hl className="bg-slate-50 border border-slate-200 p-3"><dt className="text-[11px] font-bold uppercase text-slate-500">Fim do teste</dt><dd className="font-semibold text-[#0b1f3a]">{fmtDate(sub.trialEndsAt)}</dd></div>
          <div data-card-hl className="bg-slate-50 border border-slate-200 p-3"><dt className="text-[11px] font-bold uppercase text-slate-500">Pago até</dt><dd className="font-semibold text-[#0b1f3a]">{fmtDate(sub.paidUntil)}</dd></div>
        </dl>

        {sub.phase === 'tolerancia' && (
          <Notice tone="warn" icon="schedule">
            <div>
              O plano terminou em {fmtDate(sub.planEndedAt)}. A equipa BandMed concedeu uma tolerância até <strong>{fmtDate(sub.graceUntil)}</strong>.
              Depois dessa data a conta bloqueia automaticamente se o pagamento não for regularizado.
              {sub.graceNote && <div className="mt-1 text-xs italic">Nota: {sub.graceNote}</div>}
            </div>
          </Notice>
        )}
        {sub.phase === 'expirada' && (
          <Notice tone="error" icon="lock">
            <div>O plano expirou. Contacte a equipa BandMed (pedido de suporte abaixo) para regularizar o pagamento ou pedir tolerância.</div>
          </Notice>
        )}
      </section>

      {/* ---------------- Benefícios e consumo ---------------- */}
      <section className="bg-white border border-slate-200 shadow-xs p-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-lg font-extrabold text-[#0b1f3a]">Benefícios do plano e consumo</h3>
          {anyBlocked && <span className="text-xs font-bold text-red-700 bg-red-100 border border-red-300 px-2 py-1">Limite atingido</span>}
        </div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
          <UsageMeter icon="school" label="Alunos ativos" used={sub.usage.students} limit={sub.limits.students} blocked={sub.blocked.students}
            blockedText="Limite atingido: não é possível cadastrar novos alunos. Peça um plano maior." />
          <UsageMeter icon="group" label="Utilizadores" used={sub.usage.users} limit={sub.limits.users} blocked={sub.blocked.users}
            blockedText="Limite atingido: não é possível criar nem reativar utilizadores. Desative alguém ou peça um plano maior." />
          <UsageMeter icon="database" label="Armazenamento" used={sub.usage.storageBytes} limit={sub.limits.storageBytes} blocked={sub.blocked.storage} format={fmtBytes}
            blockedText="Cheio: a base de dados deixa de aceitar gravações. Elimine registos ou ficheiros para libertar espaço (eliminar nunca é bloqueado)." />
        </div>
        {sub.breakdown && sub.breakdown.length > 1 && (
          <div className="mt-4 border border-slate-200 overflow-x-auto">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-sm font-bold text-[#0b1f3a] flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">hub</span>
              Plano único: escola mãe + filiais somam-se
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-slate-500 text-left">
                  <th className="px-4 py-2 font-bold">Escola</th>
                  <th className="px-4 py-2 font-bold">Alunos</th>
                  <th className="px-4 py-2 font-bold">Utilizadores</th>
                  <th className="px-4 py-2 font-bold">Armazenamento</th>
                </tr>
              </thead>
              <tbody>
                {sub.breakdown.map((b) => (
                  <tr key={b.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-semibold text-[#0b1f3a]">
                      {b.name} <span className="text-[10px] font-bold uppercase text-slate-500">{b.isMother ? 'mãe' : 'filial'}</span>
                    </td>
                    <td className="px-4 py-2">{b.students.toLocaleString('pt-AO')}</td>
                    <td className="px-4 py-2">{b.users}</td>
                    <td className="px-4 py-2">{fmtBytes(b.storageBytes)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-extrabold text-[#0b1f3a]">
                  <td className="px-4 py-2">Total no plano</td>
                  <td className="px-4 py-2">{sub.usage.students.toLocaleString('pt-AO')}</td>
                  <td className="px-4 py-2">{sub.usage.users}</td>
                  <td className="px-4 py-2">{fmtBytes(sub.usage.storageBytes)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Alunos transferidos ou inativos não contam. Nos utilizadores contam as contas da equipa e as contas de alunos do portal; as contas de encarregados não contam. Armazenamento: dados
          ({fmtBytes(sub.usage.dbBytes)}) + ficheiros ({fmtBytes(sub.usage.filesBytes)}); a medição atualiza-se de minuto a minuto.
        </p>
      </section>

      {/* ---------------- Suporte ---------------- */}
      <section className="bg-white border border-slate-200 shadow-xs p-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-lg font-extrabold text-[#0b1f3a] flex items-center gap-2">
            Pedidos de suporte
            {unread > 0 && <span className="text-[11px] font-bold bg-red-600 text-white px-2 py-0.5">{unread} nova{unread > 1 ? 's' : ''}</span>}
          </h3>
          <button type="button" data-acl-ignore onClick={() => { setCreating((v) => !v); setMsg(null); }}
            className="px-4 py-2 text-xs font-bold text-white bg-[#0b1f3a] hover:bg-[#7a0c0c] cursor-pointer">
            {creating ? 'Cancelar' : 'Novo pedido'}
          </button>
        </div>

        {msg && <Notice tone={msg.type === 'ok' ? 'success' : 'error'}>{msg.text}</Notice>}

        {creating && (
          <div className="mt-3 border border-slate-200 p-4 grid gap-3">
            <input value={form.subject} maxLength={200} onChange={(e) => setForm({ ...form, subject: e.target.value })}
              placeholder="Assunto" className="w-full border border-slate-300 px-3 py-2 text-sm" />
            <textarea value={form.message} maxLength={4000} rows={4} onChange={(e) => setForm({ ...form, message: e.target.value })}
              placeholder="Descreva o pedido (pagamento, tolerância, aumento de plano, problema...)" className="w-full border border-slate-300 px-3 py-2 text-sm" />
            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-xs font-bold text-slate-600">Prioridade</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as any })} className="border border-slate-300 px-2 py-1.5 text-sm">
                <option value="baixa">Baixa</option><option value="media">Média</option><option value="alta">Alta</option>
              </select>
              <button type="button" data-acl-ignore disabled={busy} onClick={sendNew}
                className="ml-auto px-4 py-2 text-xs font-bold text-white bg-[#0b1f3a] hover:bg-[#7a0c0c] disabled:opacity-50 cursor-pointer">Enviar pedido</button>
            </div>
          </div>
        )}

        {tickets.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">Ainda não há pedidos de suporte.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-200 border border-slate-200">
            {tickets.map((t) => (
              <li key={t.id}>
                <button type="button" data-acl-ignore onClick={() => void openTicket(t)}
                  className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-50 cursor-pointer">
                  <span className={`w-2.5 h-2.5 shrink-0 ${t.unread ? 'bg-red-600' : 'bg-transparent'}`} aria-label={t.unread ? 'Não lido' : undefined} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-sm text-[#0b1f3a] truncate">{t.subject}</span>
                    <span className="block text-[11px] text-slate-500">
                      {t.origin === 'plataforma' ? 'Registado pela equipa BandMed' : 'Aberto pela escola'} · {fmtDate(t.updatedAt)} · {t.replies.length} resposta{t.replies.length === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className="text-[11px] font-bold px-2 py-0.5 border border-slate-300 text-slate-700">{PRIORITY_LABEL[t.priority]}</span>
                  <span className={`text-[11px] font-bold px-2 py-0.5 border ${t.status === 'fechado' ? 'bg-slate-100 border-slate-300 text-slate-600' : t.status === 'em_curso' ? 'bg-sky-100 border-sky-300 text-sky-800' : 'bg-amber-100 border-amber-300 text-amber-900'}`}>{STATUS_LABEL[t.status]}</span>
                </button>
                {openId === t.id && (
                  <div className="px-4 pb-4 bg-slate-50 border-t border-slate-200">
                    {t.message && (
                      <div className="mt-3 text-sm whitespace-pre-wrap text-slate-800 bg-white border border-slate-200 p-3">{t.message}</div>
                    )}
                    {t.replies.map((r, i) => (
                      <div key={i} className={`mt-2 p-3 text-sm border whitespace-pre-wrap ${r.by === 'plataforma' ? 'bg-sky-50 border-sky-200' : 'bg-white border-slate-200'}`}>
                        <div className="text-[11px] font-bold text-slate-500 mb-1">{r.name} · {fmtDate(r.at)}</div>
                        {r.text}
                      </div>
                    ))}
                    <div className="mt-3 flex gap-2 items-end">
                      <textarea value={replyText} rows={2} maxLength={4000} onChange={(e) => setReplyText(e.target.value)}
                        placeholder={t.status === 'fechado' ? 'Responder reabre o pedido...' : 'Escreva a sua resposta...'}
                        className="flex-1 border border-slate-300 px-3 py-2 text-sm" />
                      <button type="button" data-acl-ignore disabled={busy || !replyText.trim()} onClick={() => void sendReply(t.id)}
                        className="px-4 py-2 text-xs font-bold text-white bg-[#0b1f3a] hover:bg-[#7a0c0c] disabled:opacity-50 cursor-pointer">Responder</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
