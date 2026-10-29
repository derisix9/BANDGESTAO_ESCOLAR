import React, { useCallback, useEffect, useRef, useState } from 'react';
import { dbService } from '../services/db';
import { Notice, NoticeButton } from './Notice';
import { Spinner } from './Spinner';
import { SyncConflictsModal, useSyncConflicts } from './SyncConflictsModal';

type Status = 'synced' | 'syncing' | 'offline' | 'error';

/** Tempo que um envio pode demorar antes de o utilizador ser avisado (um envio normal leva ~1 s). */
const STUCK_AFTER_MS = 6000;

/**
 * Estado da ligação e do que ainda não foi enviado. Só aparece quando é útil:
 *  - sem rede: avisa que o trabalho (presenças, notas…) fica guardado neste aparelho;
 *  - com alterações por enviar: mostra quantas e permite "Sincronizar agora";
 *  - ao terminar o envio: confirma durante uns segundos.
 */
const SyncStatusInner: React.FC = () => {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  const [status, setStatus] = useState<Status>(dbService.getSyncStatus());
  const [summary, setSummary] = useState(() => dbService.getPendingSummary());
  const [busy, setBusy] = useState(false);
  const [justSynced, setJustSynced] = useState(false);
  /**
   * Só se mostra "por enviar" quando o envio FICA preso (rede em baixo ou falha repetida). Qualquer alteração normal
   * (até as automáticas ao abrir uma página) liga a bandeira por ~1 s enquanto segue para o servidor: mostrar o
   * aviso nesse instante dava "Alterações por enviar" + "Tudo sincronizado" sem haver nada a fazer.
   */
  const [stuck, setStuck] = useState(false);
  const shownRef = useRef(false);   // o aviso chegou a ser visto? só então faz sentido confirmar "Tudo sincronizado"
  /** Resultado do último clique em "Sincronizar agora": confirma ao utilizador o que aconteceu. */
  const [manual, setManual] = useState<null | { ok: boolean; sent: number; left: number }>(null);
  const hadPending = useRef(false);
  const manualTimer = useRef<number | null>(null);

  const refresh = useCallback(() => setSummary(dbService.getPendingSummary()), []);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const unsub = dbService.subscribeSyncStatus((s) => { setStatus(s); refresh(); });
    const unsubDb = dbService.subscribe(() => refresh());
    const timer = window.setInterval(() => { if (dbService.getPendingSummary().pending || hadPending.current) refresh(); }, 8000);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      unsub(); unsubDb(); window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    const needsAttention = online && (summary.pending || status === 'error');
    if (!needsAttention) { setStuck(false); return; }
    const t = window.setTimeout(() => setStuck(true), STUCK_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [online, summary.pending, status]);

  useEffect(() => { if (stuck || !online) shownRef.current = true; }, [stuck, online]);

  useEffect(() => {
    if (summary.pending) { hadPending.current = true; return; }
    if (hadPending.current && status === 'synced') {
      hadPending.current = false;
      const seen = shownRef.current;
      shownRef.current = false;
      if (!seen) return;   // o envio foi rápido e silencioso: não há nada a confirmar
      setJustSynced(true);
      const t = window.setTimeout(() => setJustSynced(false), 4000);
      return () => window.clearTimeout(t);
    }
  }, [summary.pending, status]);

  const syncNow = async () => {
    if (busy) return;
    const before = dbService.getPendingSummary().records;
    if (manualTimer.current) { window.clearTimeout(manualTimer.current); manualTimer.current = null; }
    setManual(null);
    setBusy(true);
    let ok = false;
    try { ok = (await dbService.syncNow()) !== false; } catch { ok = false; }
    const after = dbService.getPendingSummary();
    setBusy(false);
    refresh();
    const failed = !ok || after.pending;
    setManual({ ok: !failed, sent: Math.max(0, before - after.records), left: after.records });
    // A confirmação de sucesso desaparece sozinha; o erro fica até ser fechado ou até nova tentativa.
    if (!failed) manualTimer.current = window.setTimeout(() => { setManual(null); manualTimer.current = null; }, 5000);
  };

  useEffect(() => () => { if (manualTimer.current) window.clearTimeout(manualTimer.current); }, []);

  // 1) A enviar: caixa azul com o indicador de carregamento (sem botão, para não haver cliques repetidos).
  if (busy) {
    const n0 = summary.records;
    return (
      <Notice tone="info" icon="sync" resetKey="sync-busy">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Spinner size={16} />
          A sincronizar{n0 > 0 ? ` ${n0} ${n0 === 1 ? 'registo' : 'registos'}` : ''}… aguarde.
        </span>
      </Notice>
    );
  }

  // 2) Resultado do clique: confirmação (verde) ou erro (vermelho) com nova tentativa.
  if (manual) {
    if (manual.ok) {
      return (
        <Notice tone="success" icon="cloud_done" resetKey={`sync-ok-${manual.sent}`}>
          Sincronização concluída{manual.sent > 0 ? ` — ${manual.sent} ${manual.sent === 1 ? 'registo enviado' : 'registos enviados'} com sucesso` : ' — tudo está atualizado'}.
        </Notice>
      );
    }
    return (
      <Notice
        tone="error"
        resetKey={`sync-fail-${manual.left}`}
        actions={<NoticeButton onClick={syncNow}>Tentar novamente</NoticeButton>}
      >
        Não foi possível sincronizar{manual.left > 0 ? ` — ${manual.left} ${manual.left === 1 ? 'registo continua' : 'registos continuam'} por enviar` : ''}. Verifique a ligação e tente novamente.
      </Notice>
    );
  }

  if (online && !justSynced && !stuck) return null;   // a enviar normalmente: nada a mostrar

  if (justSynced && online && !summary.pending) {
    return <Notice tone="success" icon="cloud_done" resetKey="synced">Tudo sincronizado.</Notice>;
  }

  const n = summary.records;
  const pendingText = n > 0 ? `${n} ${n === 1 ? 'registo por enviar' : 'registos por enviar'}` : 'Alterações por enviar';

  if (!online) {
    return (
      <Notice tone="warn" icon="cloud_off" resetKey="offline">
        Sem internet. O trabalho fica guardado neste aparelho{summary.pending ? ` · ${pendingText}` : ''} e segue quando a rede voltar.
      </Notice>
    );
  }

  const failed = status === 'error';
  return (
    <Notice
      tone={failed ? 'error' : 'info'}
      icon={failed ? undefined : 'sync'}
      resetKey={failed ? 'sync-error' : 'sync-pending'}
      actions={<NoticeButton onClick={syncNow}>Sincronizar agora</NoticeButton>}
    >
      {failed ? 'Erro ao sincronizar' : pendingText}
    </Notice>
  );
};

/** Aviso de conflitos de edição (por resolver) + janela para os resolver. Nada é sobrescrito até o utilizador escolher. */
const SyncConflictsBanner: React.FC = () => {
  const conflicts = useSyncConflicts();
  const [open, setOpen] = useState(false);
  if (conflicts.length === 0) return null;
  const n = conflicts.length;
  return (
    <>
      <Notice
        tone="warn"
        icon="merge_type"
        resetKey={`sync-conflicts-${n}`}
        actions={<NoticeButton onClick={() => setOpen(true)}>Resolver</NoticeButton>}
      >
        {n === 1 ? '1 alteração sua entrou em conflito com a de outra pessoa' : `${n} alterações suas entraram em conflito com as de outras pessoas`} e não foi enviada. Escolha que versão fica.
      </Notice>
      {open && <SyncConflictsModal onClose={() => setOpen(false)} />}
    </>
  );
};

export const SyncStatusPill: React.FC = () => (
  <>
    <SyncConflictsBanner />
    <SyncStatusInner />
  </>
);
