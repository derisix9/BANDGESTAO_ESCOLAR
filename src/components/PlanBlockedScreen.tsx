import React, { useState } from 'react';
import { createSupportTicket } from '../services/cloud';
import { Notice } from './Notice';

interface Props { schoolName?: string; role?: string; onLogout: () => void }

/**
 * Mostrado quando o teste/plano terminou e a escola não tem tolerância (status = pendente), ou quando a
 * tolerância concedida pelo Admin Master também acabou. O Administrador/Diretor pode pedir ajuda ou
 * tolerância à equipa BandMed daqui mesmo (my_ticket_create não depende de o plano estar ativo).
 */
export const PlanBlockedScreen: React.FC<Props> = ({ schoolName, role, onLogout }) => {
  const canAsk = role === 'admin' || role === 'director';
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async () => {
    setBusy(true); setMsg(null);
    const r = await createSupportTicket(
      'Pedido de regularização / tolerância',
      text.trim() || 'A conta está bloqueada. Peço regularização do plano ou um período de tolerância.',
      'alta'
    );
    setBusy(false);
    if (r.success) { setMsg({ ok: true, text: 'Pedido enviado. A equipa BandMed vai contactá-lo.' }); setOpen(false); setText(''); }
    else setMsg({ ok: false, text: r.error || 'Não foi possível enviar o pedido.' });
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-[#eff4ff]">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-2xl border border-slate-200 p-8 text-center">
        <span className="material-symbols-outlined text-[48px] text-[#7a0c0c]">lock</span>
        <h1 className="text-xl font-bold text-[#0b1f3a] mt-2">Acesso bloqueado — pagamento pendente</h1>
        <p className="text-sm text-slate-600 mt-3">
          {schoolName ? <>O acesso de <strong>{schoolName}</strong> está bloqueado</> : <>O acesso está bloqueado</>} porque
          o período de teste, o plano pago ou o prazo de tolerância terminou (estado: <strong>pendente</strong>).
        </p>
        <p className="text-sm text-slate-600 mt-2">
          Os seus dados estão guardados. Assim que o pagamento for confirmado pela equipa BandMed, o sistema volta a ficar disponível.
        </p>

        {msg && <Notice tone={msg.ok ? 'success' : 'error'}>{msg.text}</Notice>}
        {canAsk && !open && (
          <button type="button" onClick={() => setOpen(true)}
            className="mt-4 w-full py-2.5 px-6 rounded-xl font-bold text-[#0b1f3a] border border-[#0b1f3a] text-sm cursor-pointer">
            Pedir regularização ou tolerância
          </button>
        )}
        {canAsk && open && (
          <div className="mt-4 text-left">
            <textarea value={text} rows={3} maxLength={4000} onChange={(e) => setText(e.target.value)}
              placeholder="Mensagem para a equipa BandMed (opcional)" className="w-full border border-slate-300 px-3 py-2 text-sm" />
            <button type="button" disabled={busy} onClick={send}
              className="mt-2 w-full py-2.5 px-6 rounded-xl font-bold text-white bg-[#0b1f3a] disabled:opacity-50 text-sm cursor-pointer">
              {busy ? 'A enviar...' : 'Enviar pedido'}
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={onLogout}
          className="mt-4 w-full py-3 px-6 rounded-xl font-bold text-white bg-[#0b1f3a] hover:bg-[#7a0c0c] transition-colors text-sm cursor-pointer"
        >
          Terminar sessão
        </button>
      </div>
    </div>
  );
};
