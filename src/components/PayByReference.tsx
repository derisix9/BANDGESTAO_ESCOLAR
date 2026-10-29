import React, { useEffect, useState } from 'react';
import type { TuitionInvoice } from '../types';
import { paymentGatewayApi, paymentsEnabled } from '../services/paymentGateway';
import { formatKz, friendlyPaymentError, type ReferenceResult } from '../utils/paymentGatewayApi';
import { Notice } from './Notice';

interface Props {
  invoice: TuitionInvoice;
  /** 'staff' = coluna "Referência" da Tesouraria; 'portal' = botão no extrato do aluno/encarregado. */
  variant: 'staff' | 'portal';
  /** Staff pode cancelar a referência activa (volta a "Balcão / Caixa"). */
  canCancel?: boolean;
}

const fmtDay = (iso?: string) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

/**
 * Pagamento por referência Multicaixa de UMA factura. Só aparece se a escola ligou um fornecedor (Configurações → Integrações)
 * e a factura ainda não está paga. A referência é pedida ao servidor (Edge Function `payments`) — nunca calculada aqui —
 * e, quando paga no ATM / Multicaixa Express / banco, a factura fica paga sozinha.
 */
export const PayByReference: React.FC<Props> = ({ invoice, variant, canCancel }) => {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReferenceResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void paymentsEnabled().then((v) => { if (alive) setEnabled(v); });
    return () => { alive = false; };
  }, []);

  const unpaid = invoice.status !== 'pago' && invoice.status !== 'isento';
  const hasRef = !!invoice.multicaixaRef;
  if (!unpaid) return null;
  if (!enabled && !hasRef) return variant === 'staff' ? <span className="text-slate-400 italic text-[11px]" title="Os pagamentos por referência não estão ligados nesta escola (Configurações → Integrações). A factura é liquidada ao balcão.">Balcão / Caixa</span> : null;

  const shown = result ?? (hasRef ? {
    ok: true, created: false, reference: String(invoice.multicaixaRef), entity: String(invoice.multicaixaEntity || ''),
    amountKz: Number(invoice.multicaixaAmountKz ?? invoice.totalAmountKz), expiresOn: String(invoice.multicaixaExpires || '')
  } : null);

  const generate = async () => {
    setBusy(true); setError(null);
    try { setResult(await paymentGatewayApi.reference(String(invoice.id))); setOpen(true); }
    catch (e) { setError(friendlyPaymentError(e)); setOpen(true); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    setBusy(true); setError(null);
    try { await paymentGatewayApi.cancel(String(invoice.id)); setResult(null); setOpen(false); }
    catch (e) { setError(friendlyPaymentError(e)); }
    finally { setBusy(false); }
  };

  const copy = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(key); setTimeout(() => setCopied(null), 1800);
  };

  const Row: React.FC<{ k: string; label: string; value: string }> = ({ k, label, value }) => (
    <div className="flex items-center justify-between gap-3 p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
      <div className="min-w-0">
        <span className="block text-[10px] uppercase font-bold text-slate-500">{label}</span>
        <span className="block font-mono text-sm font-bold text-slate-900 break-all">{value}</span>
      </div>
      <button type="button" onClick={() => copy(k, value.replace(/\s+/g, ''))} className="shrink-0 px-2 py-1 rounded-md border border-slate-300 bg-white text-[11px] font-bold text-slate-700 cursor-pointer" aria-label={`Copiar ${label}`}>
        {copied === k ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  );

  const modal = open && (
    <div className="fixed inset-0 z-[300] bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Pagar por referência">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 flex flex-col gap-3 shadow-2xl">
        <h4 className="font-headline text-lg font-bold text-slate-900">Pagar por referência Multicaixa</h4>
        {error && <Notice tone="error">{error}</Notice>}
        {shown && !error && (
          <>
            <p className="text-xs text-slate-600">
              {invoice.description || `Propina — ${invoice.period}`}. Pague no <strong>ATM</strong>, no <strong>Multicaixa Express</strong> ou no <strong>homebanking</strong>,
              na opção de pagamentos por referência, com estes dados. A factura fica paga sozinha, normalmente em poucos minutos.
            </p>
            <Row k="ent" label="Entidade" value={shown.entity} />
            <Row k="ref" label="Referência" value={shown.reference} />
            <Row k="val" label="Montante a pagar" value={formatKz(shown.amountKz)} />
            <p className="text-[11px] text-slate-500">
              Válida até <strong>{fmtDay(shown.expiresOn)}</strong>. Pague exactamente o montante indicado. {shown.expiresOn ? 'Depois desta data peça uma nova referência.' : ''}
            </p>
          </>
        )}
        <div className="flex justify-end gap-2 pt-1">
          {canCancel && hasRef && !error && (
            <button type="button" onClick={cancel} disabled={busy} className="px-3 py-2 rounded-lg border border-red-300 bg-white text-red-700 text-xs font-bold disabled:opacity-40 cursor-pointer">Cancelar referência</button>
          )}
          <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 rounded-lg bg-[#0b1f3a] text-white text-xs font-bold cursor-pointer">Fechar</button>
        </div>
      </div>
    </div>
  );

  if (variant === 'portal') {
    return (
      <>
        <button type="button" onClick={() => (shown ? setOpen(true) : void generate())} disabled={busy}
          className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-[11px] font-semibold transition-colors inline-flex items-center gap-1 cursor-pointer disabled:opacity-50" data-testid="pay-by-reference">
          <span className="material-symbols-outlined text-[14px]">pin</span>
          <span>{busy ? 'A gerar…' : 'Pagar por referência'}</span>
        </button>
        {modal}
      </>
    );
  }

  return (
    <>
      {shown ? (
        <button type="button" onClick={() => setOpen(true)} className="text-left text-[11px] font-mono cursor-pointer" title="Ver os dados de pagamento">
          <span className="text-slate-500 block text-[10px]">Ent: {shown.entity}</span>
          <span className="font-bold text-slate-800">{shown.reference}</span>
        </button>
      ) : (
        <button type="button" onClick={() => void generate()} disabled={busy}
          className="px-2 py-1 rounded-none border border-[#0b1f3a] text-[#0b1f3a] hover:bg-slate-100 font-bold text-[10px] flex items-center gap-1 cursor-pointer disabled:opacity-50" data-testid="generate-reference">
          <span className="material-symbols-outlined text-[13px]">pin</span>{busy ? 'A gerar…' : 'Gerar referência'}
        </button>
      )}
      {modal}
    </>
  );
};
