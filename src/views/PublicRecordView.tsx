import React, { useEffect, useState } from 'react';
import type { SchoolDatabase } from '../types';
import { fetchPublicRecord, type FetchResult } from '../services/publicVerify';
import { recordToDb, type PublicRecord } from '../utils/publicProjection';
import { PublicTransportPassView } from './PublicTransportPassView';
import { setDataStrings } from '../i18n/autoTranslate';
import { collectDataStrings } from '../i18n/dataStrings';

const shell = (children: React.ReactNode) => (
  <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6 text-center font-sans">
    <div className="max-w-sm w-full bg-white rounded-xl shadow p-6 space-y-3">{children}</div>
  </div>
);

/**
 * Consulta pública MÍNIMA (sem login): confirma que o cartão é autêntico e activo. Não mostra BI, contactos,
 * notas, histórico, facturas nem folha de pagamento — esses dados exigem sessão iniciada na escola.
 */
const CardCheck: React.FC<{ rec: PublicRecord; onGoToLogin?: () => void }> = ({ rec, onGoToLogin }) => {
  const sl: any = rec.slice;
  const person: any = (sl.students || sl.teachers || sl.funcionarios || [])[0] || {};
  const school = sl.settings?.schoolName || 'Instituição de ensino';
  const detail = rec.kind === 'student'
    ? [person.className || person.grade, person.procNumber].filter(Boolean).join(' · ')
    : rec.kind === 'docente' ? ['Docente', person.department].filter(Boolean).join(' · ') : [person.cargo || 'Funcionário', person.department].filter(Boolean).join(' · ');
  const st = String(person.status || '').toLowerCase();
  const active = !st || ['active', 'ativo', 'activo', 'matriculado'].includes(st);
  return shell(
    <>
      <div className={`${active ? 'bg-emerald-600' : 'bg-amber-600'} text-white -m-6 mb-2 px-4 py-4 rounded-t-xl`}>
        <div className="text-[11px] uppercase tracking-widest opacity-90">{school}</div>
        <div className="text-xl font-extrabold mt-1">{active ? 'CARTÃO VÁLIDO' : 'CARTÃO INACTIVO'}</div>
      </div>
      <p className="text-base font-bold text-[#0b1f3a] leading-tight pt-2">{person.name || '—'}</p>
      {detail && <p className="text-xs text-slate-500">{detail}</p>}
      <p className="text-[11px] text-slate-500">Consulta de autenticidade. Por privacidade, esta página não mostra dados pessoais, notas nem situação financeira.</p>
      <p className="text-[10px] text-slate-400">Consulta em {new Date().toLocaleString('pt-PT')}</p>
      {onGoToLogin && <button onClick={onGoToLogin} className="px-4 py-2 text-sm font-bold bg-[#0b1f3a] text-white rounded-lg">Entrar na conta da escola</button>}
    </>
  );
};

/**
 * Página aberta por QR / código de barras: vai buscar o registo público da pessoa (token no link) e mostra a
 * consulta certa — validade do cartão ou passe de transporte. Sem registo público,
 * recorre aos dados locais (só funciona no computador onde a escola trabalha).
 */
export const PublicRecordView: React.FC<{ db: SchoolDatabase; onGoToLogin?: () => void }> = ({ db, onGoToLogin }) => {
  const q = new URLSearchParams(window.location.search);
  const token = q.get('k') || q.get('pv') || '';
  const type = q.get('type') || '';
  const wantsTransport = type === 'transport' || q.get('t') === '1';
  const wantsHist = q.get('dl') === 'historico';
  const [res, setRes] = useState<FetchResult | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    fetchPublicRecord(token).then((r) => { if (alive) setRes(r); });
    return () => { alive = false; };
  }, [token]);

  // Dados da pessoa (nome, turma…) nunca são traduzidos pela tradução automática do Inglês.
  useEffect(() => {
    const rec = res?.rec;
    setDataStrings([...collectDataStrings(db), ...(rec ? collectDataStrings(recordToDb(rec)) : [])]);
  }, [res, db]);

  if (res === undefined) return shell(<p className="text-sm text-slate-600">A consultar o registo…</p>);

  const rec = res.rec;
  if (!rec) {
    // Sem registo válido (inexistente, expirado ou revogado): NUNCA se recorre a dados locais do aparelho,
    // para um cartão revogado não abrir a ficha completa num computador da escola.
    const why: Record<string, string> = {
      token: 'Este cartão foi emitido antes da actualização dos códigos seguros (o QR/código não tem identificação pública). A secretaria deve reemitir o cartão.',
      inexistente: 'Este cartão não é válido: pode ter expirado, ter sido revogado ou ainda não ter sido sincronizado. Contacte a secretaria da instituição.',
      permissao: 'A consulta pública ainda não está disponível. Contacte a secretaria da instituição.',
      rede: 'Sem ligação ao servidor. Verifique a internet e tente de novo.'
    };
    return shell(
      <>
        <h1 className="text-lg font-bold text-[#0b1f3a]">Registo não encontrado</h1>
        <p className="text-sm text-slate-600">{why[res.error || 'inexistente']}</p>
        <p className="text-[10px] text-slate-400">Código técnico: {res.error || 'inexistente'}{token ? ` · ${token}` : ''}</p>
      </>
    );
  }

  const pdb = recordToDb(rec);
  if (wantsHist) {
    return shell(
      <>
        <h1 className="text-lg font-bold text-[#0b1f3a]">Histórico Académico</h1>
        <p className="text-sm text-slate-600">Por privacidade, o histórico académico já não é descarregado por QR público. Peça-o na secretaria ou entre na sua conta da escola.</p>
        {onGoToLogin && <button onClick={onGoToLogin} className="px-4 py-2 text-sm font-bold bg-[#0b1f3a] text-white rounded-lg">Entrar na conta da escola</button>}
      </>
    );
  }
  if (wantsTransport) {
    const route = (rec.slice.transportRoutes || [])[0];
    return <PublicTransportPassView db={pdb} link={{ key: rec.key, route: route?.code || q.get('r') || '' }} />;
  }
  return <CardCheck rec={rec} onGoToLogin={onGoToLogin} />;
};
