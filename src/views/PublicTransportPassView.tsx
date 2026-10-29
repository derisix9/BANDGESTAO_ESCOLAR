import React from 'react';
import type { SchoolDatabase } from '../types';
import { MONTHS_PT, SHIFT_LABEL, evaluateTransportPass, parseTransportLink, REASON } from '../utils/transportPass';
import { Notice } from '../components/Notice';

/**
 * Página pública (sem login) aberta ao ler o QR do cartão de transporte com a câmara do telemóvel.
 * Só consulta: mostra Verde/Vermelho com a mesma validação que a app do motorista vai usar
 * (inscrição, turno, mensalidade do mês, embarque do dia). Não regista embarques.
 */
export const PublicTransportPassView: React.FC<{ db: SchoolDatabase; link?: { key: string; route: string; year?: string } }> = ({ db, link: linkProp }) => {
  const link = linkProp || parseTransportLink(typeof window !== 'undefined' ? window.location.search : '');
  const schoolName = db.settings?.schoolName || 'Instituição de ensino';

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 text-center font-sans">
      <div className="w-full max-w-sm bg-white rounded-xl shadow overflow-hidden">{children}</div>
    </div>
  );

  if (!link) {
    return shell(
      <div className="p-6 space-y-2">
        <h1 className="text-lg font-bold text-[#0b1f3a]">Código inválido</h1>
        <p className="text-sm text-slate-600">Este código QR de transporte está incompleto. Contacte a secretaria da escola.</p>
      </div>
    );
  }

  const r = evaluateTransportPass(db, { key: link.key, route: link.route, year: link.year });
  if (!r.person) {
    return shell(
      <div className="p-6 space-y-2">
        <h1 className="text-lg font-bold text-[#0b1f3a]">Registo não encontrado</h1>
        <p className="text-sm text-slate-600">Este cartão de transporte não corresponde a nenhum registo desta instituição. Contacte a secretaria da escola.</p>
      </div>
    );
  }

  const ok = r.approved;
  const row = (label: string, good: boolean) => (
    <div className="flex items-center justify-between text-sm py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-slate-600">{label}</span>
      <span className={`font-bold ${good ? 'text-emerald-700' : 'text-red-700'}`}>{good ? 'OK' : 'NÃO'}</span>
    </div>
  );

  return shell(
    <>
      <div className={`${ok ? 'bg-emerald-600' : 'bg-red-600'} text-white px-4 py-5`}>
        <div className="text-[11px] uppercase tracking-widest opacity-90">Transporte escolar · {schoolName}</div>
        <div className="text-2xl font-extrabold mt-1">{ok ? 'APROVADO' : 'BLOQUEADO'}</div>
        {!ok && <div className="text-sm mt-1 font-semibold">{r.reasons.join(' · ')}</div>}
      </div>
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-3 text-left">
          {r.person.photo
            ? <img src={r.person.photo} alt={r.person.name} className="w-16 h-16 rounded-lg object-cover border border-slate-200" />
            : <div className="w-16 h-16 rounded-lg bg-slate-200 text-slate-600 text-2xl font-bold flex items-center justify-center">{(r.person.name[0] || '?').toUpperCase()}</div>}
          <div>
            <div className="font-bold text-[#0b1f3a] leading-tight">{r.person.name}</div>
            <div className="text-xs text-slate-500">{r.person.detail}</div>
          </div>
        </div>
        {r.route ? (
          <div className="text-left text-xs bg-slate-50 border border-slate-200 rounded-lg p-3">
            <div><b>{r.route.code}</b> · {r.route.name}</div>
            <div className="text-slate-500">Turno {SHIFT_LABEL[r.route.shift]}{r.route.plate ? ` · Viatura ${r.route.plate}` : ''}</div>
          </div>
        ) : (
          <Notice tone="warn">
            {REASON.notEnrolled}: a rota deste cartão ({link.route || '—'}) não está activa ou a pessoa já não está inscrita.
          </Notice>
        )}
        <div className="text-left">
          {row('Inscrito nesta rota', r.checks.enrolled)}
          {row('Turno correcto', r.checks.shiftOk)}
          {row(`Mensalidade de ${MONTHS_PT[r.month - 1]} paga`, r.checks.feePaid)}
          {row('Ainda não embarcou neste turno', r.checks.notBoarded)}
        </div>
        <p className="text-[10px] text-slate-400">Consulta em {new Date().toLocaleString('pt-PT')} · apenas leitura, não regista embarque.</p>
      </div>
    </>
  );
};
