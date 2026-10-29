import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../services/supabase';
import { dbService } from '../../services/db';
import { buildBackupZip, backupZipName, startDownload } from '../../utils/schoolBackupZip';
import { purgeLocalSchoolCache } from '../../utils/schoolBackupApi';
import { FormModalHeader } from '../../components/FormModalHeader';
import './dangerZone.css';
import { Notice } from '../../components/Notice';

export const DELETE_PHRASE = 'Eliminar banco de dados';

interface Check { ok: boolean; adminOk: boolean; schoolOk: boolean; nameOk: boolean; phraseOk: boolean; expectedName?: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (e: any) => {
  const m = String(e?.message || '');
  if (/failed to fetch|network/i.test(m)) return 'Sem ligação ao servidor. Nada foi apagado.';
  if (/Could not find the function|PGRST202/i.test(m)) return 'A migração 0015 ainda não foi aplicada no Supabase.';
  if (/Falta a migra[cç][aã]o/i.test(m)) return 'Falta aplicar a migração 0016 (supabase/migrations/0016_fix_delete_prepare_backup.sql) no SQL Editor do Supabase. Nada foi apagado.';
  if (/Bilhete inválido/i.test(m)) return 'O backup expirou (mais de 15 minutos). Descarregue o backup outra vez. Nada foi apagado.';
  return m || 'Erro desconhecido. Nada foi apagado.';
};

/**
 * Configurações → Segurança & Backups → Zona de perigo.
 * Um botão abre um modal de confirmação: nome da escola + frase (verificados no servidor) → descarregar o backup .zip
 * (JSON + Excel) → confirmar que o ficheiro foi guardado → eliminar. Só afecta a escola do administrador autenticado.
 */
export const DangerZone: React.FC<{ isAdmin: boolean }> = ({ isAdmin }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [phrase, setPhrase] = useState('');
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileConfirmed, setFileConfirmed] = useState(false);
  const seq = useRef(0);
  const busy = stage !== null;

  const resetBackup = () => { setTicket(null); setFileName(null); setFileConfirmed(false); };
  const close = () => {
    if (busy || done) return;
    setOpen(false); setName(''); setPhrase(''); setError(null); resetBackup();
  };

  // Verificação no servidor (com pequena espera enquanto se escreve). Também traz o nome esperado.
  useEffect(() => {
    if (!isAdmin || !open) return;
    const my = ++seq.current;
    setChecking(true);
    const t = setTimeout(async () => {
      const { data, error: e } = await supabase.rpc('school_delete_check', { p_name: name, p_phrase: phrase });
      if (my !== seq.current) return;
      setChecking(false);
      setCheck(e ? null : (data as Check));
    }, 300);
    return () => clearTimeout(t);
  }, [name, phrase, isAdmin, open]);

  // Fecha com Esc (se não estiver a processar).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!isAdmin) return null;
  const verified = !!check?.ok && !checking;
  const canDelete = verified && !!ticket && fileConfirmed && !busy && !done;

  const onChangeName = (v: string) => { setName(v); resetBackup(); };
  const onChangePhrase = (v: string) => { setPhrase(v); resetBackup(); };

  // Passo 3: o servidor entrega o backup (+ bilhete de uso único); o navegador descarrega o .zip.
  const handleDownload = async () => {
    if (!verified || busy) return;
    setError(null); resetBackup();
    try {
      setStage('A preparar o backup…');
      const { data, error: pe } = await supabase.rpc('school_delete_prepare', { p_name: name, p_phrase: phrase });
      if (pe) throw pe;
      const { ticket: tk, backup } = data as { ticket: string; backup: any };
      setStage('A gerar o ficheiro ZIP (JSON + Excel)…');
      const blob = await buildBackupZip(backup);
      const file = backupZipName(backup?.schoolName || backup?.institution_name || check?.expectedName || 'escola');
      startDownload(blob, file);
      await sleep(800);
      setTicket(tk); setFileName(file);
    } catch (e: any) {
      setError(errText(e));
    } finally { setStage(null); }
  };

  // Passo 5: só com o backup descarregado e confirmado.
  const handleDelete = async () => {
    if (!canDelete || !ticket) return;
    setError(null);
    try {
      setStage('A eliminar os dados da escola…');
      const { error: de } = await supabase.rpc('school_delete_execute', { p_ticket: ticket, p_name: name, p_phrase: phrase });
      if (de) { resetBackup(); throw de; }
      const inst = dbService.activeInstitutionId;
      setDone('Dados eliminados. A terminar a sessão…');
      try { await dbService.logout(); } catch { /* ignore */ }
      await purgeLocalSchoolCache(inst);
      await sleep(2000);
      window.location.reload();
    } catch (e: any) {
      setStage(null);
      setError(errText(e));
    }
  };

  const Row = ({ ok, text }: { ok: boolean; text: string }) => (
    <li className={ok ? 'ok' : ''}>
      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{ok ? 'check_circle' : 'radio_button_unchecked'}</span>{text}
    </li>
  );

  // Mesmo padrão dos modais do sistema: overlay `fixed inset-0` (por isso fica redimensionável/movível pelo
  // utilitário global resizableModals), cabeçalho azul (FormModalHeader), corpo com scroll e rodapé.
  const modal = open && (
    <div
      className="dz fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6 animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="dz-modal bg-white max-w-xl w-full shadow-2xl border border-slate-400 flex flex-col max-h-[94vh]" role="dialog" aria-modal="true">
        <FormModalHeader
          title="Eliminar banco de dados da escola"
          subtitle={check?.expectedName || undefined}
          icon="delete_forever"
          badge="Irreversível"
          onClose={close}
        />

        <div className="dz-scroll flex-1 overflow-y-auto">
          <div className="dz-section">
            <div className="dz-warn">
              <span className="material-symbols-outlined" style={{ color: 'var(--dz-btn)', fontSize: 26 }}>warning</span>
              <div style={{ fontSize: 13 }}>
                <p style={{ margin: 0, fontWeight: 700 }}>Esta acção não pode ser desfeita.</p>
                <p style={{ margin: '4px 0 0' }}>
                  Apaga todos os dados da sua escola (alunos, turmas, notas, finanças editáveis, definições…).
                  Ficam as contas de utilizadores e o registo imutável (auditoria, pagamentos e documentos fiscais).
                </p>
              </div>
            </div>
          </div>

          <div className="dz-section">
            <label className="dz-label" htmlFor="dz-name">
              1. Escreva o nome da escola{check?.expectedName ? <>: <span className="dz-code">{check.expectedName}</span></> : null}
            </label>
            <input id="dz-name" className="dz-input" value={name} onChange={(e) => onChangeName(e.target.value)} disabled={busy || !!done}
              autoComplete="off" spellCheck={false} placeholder="Nome exacto da escola" />
            <label className="dz-label" htmlFor="dz-phrase">
              2. Escreva a frase: <span className="dz-code">{DELETE_PHRASE}</span>
            </label>
            <input id="dz-phrase" className="dz-input" value={phrase} onChange={(e) => onChangePhrase(e.target.value)} disabled={busy || !!done}
              autoComplete="off" spellCheck={false} placeholder={DELETE_PHRASE} />
            <ul className="dz-checks">
              <Row ok={!!check?.adminOk} text="Você é o administrador desta escola" />
              <Row ok={!!check?.nameOk} text="O nome corresponde à escola a que a sua conta pertence" />
              <Row ok={!!check?.phraseOk} text="A frase de confirmação está correcta" />
            </ul>
          </div>

          <div className="dz-section">
            <span className="dz-label">3. Descarregue o backup</span>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="dz-btn dz-btn-outline" onClick={handleDownload} disabled={!verified || busy || !!done}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>download</span>
                {ticket ? 'Descarregar outra vez' : 'Descarregar backup'}
              </button>
              {fileName && <span className="dz-done">✓ Download iniciado: {fileName}</span>}
            </div>
            {!verified && <span className="dz-muted">Disponível depois de o nome e a frase serem verificados.</span>}

            <label className={`dz-check-row ${ticket ? '' : 'off'}`}>
              <input type="checkbox" checked={fileConfirmed} disabled={!ticket || busy || !!done} onChange={(e) => setFileConfirmed(e.target.checked)} />
              <span>4. Confirmo que o ficheiro de backup <strong>já está guardado no meu computador</strong> (abri a pasta de downloads e vi o ficheiro .zip).</span>
            </label>
          </div>

          {stage && <div className="dz-section"><span className="dz-label">{stage}</span></div>}
          {error && <Notice tone="error">{error}</Notice>}
          {done && <div className="dz-section"><span className="dz-done">{done}</span></div>}
        </div>

        <div className="dz-footer px-6 py-4 bg-slate-100 border-t border-slate-300 flex items-center justify-end gap-3 shrink-0">
          <button type="button" className="dz-btn dz-btn-ghost" onClick={close} disabled={busy || !!done}>Cancelar</button>
          <button type="button" className="dz-btn" onClick={handleDelete} disabled={!canDelete}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete_forever</span>
            Eliminar os dados
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <section className="dz dz-card">
      <div className="dz-head">
        <span className="material-symbols-outlined" style={{ color: 'var(--dz-title)', fontSize: 24 }}>warning</span>
        <h3 className="dz-title">4. Zona de Perigo</h3>
      </div>
      <div className="dz-body">
        <p style={{ margin: 0 }}>
          <strong>Eliminar o banco de dados da escola.</strong> Apaga todos os dados da sua escola.
          Antes de apagar, é obrigatório descarregar um backup em .zip e confirmar que o ficheiro foi guardado.
        </p>
        <div>
          <button type="button" className="dz-btn" onClick={() => setOpen(true)}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete_forever</span>
            Eliminar
          </button>
        </div>
      </div>
      {typeof document !== 'undefined' && modal ? createPortal(modal, document.body) : null}
    </section>
  );
};
