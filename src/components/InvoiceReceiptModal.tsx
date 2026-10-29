import React from 'react';
import { TuitionInvoice, InvoiceItem, InstitutionSettings } from '../types';
import { dbService } from '../services/db';

interface InvoiceReceiptModalProps {
  invoice: TuitionInvoice;
  onClose: () => void;
  institutionSettings?: InstitutionSettings;
}

export const InvoiceReceiptModal: React.FC<InvoiceReceiptModalProps> = ({
  invoice,
  onClose,
  institutionSettings
}) => {
  const handlePrint = () => {
    window.focus();
    window.print();
  };

  const settings: InstitutionSettings = institutionSettings || dbService.getDb().settings;
  const schoolName = settings?.schoolName || 'COMPLEXO ESCOLAR PRIVADO BANDMED';
  const schoolSub = settings?.subTitle || 'Ensino Primário, Iº e IIº Ciclos do Ensino Secundário • Luanda, Angola';
  const schoolNif = settings?.nif?.trim() || '';
  const schoolPhone = settings?.phone || '(+244) 923 456 789 / 991 234 567';
  const schoolEmail = settings?.email || 'secretaria@bandmed.ao';
  const schoolAddress = settings?.address || 'Bairro Morro Bento, Estrada Direita, Luanda';

  const currentYear = new Date().getFullYear();

  const formattedInvoiceNumber = React.useMemo(() => {
    if (invoice.invoiceNumber) {
      const trimmed = invoice.invoiceNumber.trim();
      if (/^FT\s+\d{4}\/\d+/i.test(trimmed)) {
        return trimmed;
      }
      const digits = trimmed.replace(/\D/g, '');
      const seq = digits.slice(-4) || '1850';
      return `FT ${currentYear}/${seq}`;
    }
    return `FT ${currentYear}/1850`;
  }, [invoice.invoiceNumber, currentYear]);

  const formattedEmissionDate = React.useMemo(() => {
    const rawDate = invoice.paymentDate || invoice.receiptGeneratedAt;
    if (rawDate) {
      if (/^\d{2}\/\d{2}\/\d{4}/.test(rawDate.trim())) {
        return rawDate.trim().split(' ')[0];
      }
      if (/^\d{4}-\d{2}-\d{2}/.test(rawDate.trim())) {
        const parts = rawDate.trim().split('T')[0].split('-');
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
    }
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${now.getFullYear()}`;
  }, [invoice.paymentDate, invoice.receiptGeneratedAt]);

  // Real items from invoice (no fictitious fallback services)
  const items: InvoiceItem[] = invoice.items && invoice.items.length > 0 ? invoice.items : [
    {
      code: 'PROP-MED',
      description: invoice.description || `Propina Curricular - ${invoice.period || 'Mês em Curso'}`,
      periodOrRef: invoice.period || 'Mês em Curso',
      unitPriceKz: invoice.baseAmountKz || invoice.totalAmountKz || 35000,
      quantity: 1,
      discountKz: invoice.discountAmountKz || 0,
      taxRegime: 'Isento (Art. 12 CIVA)',
      liquidTotalKz: invoice.baseAmountKz || invoice.totalAmountKz || 35000,
    }
  ];

  const subtotal = invoice.subtotalKz || items.reduce((acc, it) => acc + (it.liquidTotalKz || (it.unitPriceKz * (it.quantity || 1))), 0);
  const discountAmount = invoice.discountAmountKz || 0;
  const stampDuty = invoice.stampDutyKz !== undefined ? invoice.stampDutyKz : Math.round(subtotal * 0.001);
  const totalPaid = invoice.totalPaidKz || (subtotal - discountAmount + stampDuty);

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 p-3 sm:p-6 flex items-start sm:items-center justify-center animate-fade-in printable-modal-overlay overflow-y-auto print:p-0 print:m-0 print:block"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <style>{`
        @media print {
          @page {
            size: A4 portrait !important;
            margin: 8mm 8mm !important;
          }
        }
      `}</style>
      <div className="printable-document printable-portrait relative bg-white rounded-none max-w-4xl w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col my-4 sm:my-auto print:border-none print:shadow-none print:max-h-none print:w-full print:m-0 print:top-0">
        {/* Modal Top Bar (Hidden in Print) */}
        <div className="no-print print:hidden shrink-0 px-6 py-3.5 bg-[#0b1f3a] text-white flex items-center justify-between border-b border-slate-700 sticky top-0 z-20">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[22px] text-amber-400">receipt_long</span>
            <h3 className="font-extrabold text-sm uppercase tracking-wider">
              Fatura / Recibo de Pagamento
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1 text-slate-300 hover:text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer"
              title="Fechar Documento"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        </div>

        {/* Printable Document Body - Imagens 1 e 2 */}
        <div className="p-6 sm:p-8 bg-white overflow-y-auto flex-1 space-y-5 text-slate-800 text-xs">
          {/* Header Institucional & Badge da Fatura */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b-2 border-[#0b1f3a]">
            <div className="flex items-start gap-3">
              <div className="w-14 h-14 bg-white border border-slate-300 p-1 flex items-center justify-center shrink-0 shadow-xs">
                <img
                  src={settings.logoUrl || '/school_emblem.png'}
                  alt={schoolName}
                  className="w-full h-full object-contain"
                  referrerPolicy="no-referrer"
                />
              </div>
              <div>
                <h1 className="text-base sm:text-lg font-black uppercase text-[#0b1f3a] tracking-tight">
                  {schoolName}
                </h1>
                <p className="text-[11px] text-slate-600 font-semibold mt-0.5">
                  {schoolSub}
                </p>
                <div className="text-[11px] text-slate-500 font-mono mt-1 space-y-0.5">
                  <p>NIF: <strong>{schoolNif || 'NIF NÃO CONFIGURADO'}</strong> • Telefone: {schoolPhone}</p>
                  <p>Email: {schoolEmail} • {schoolAddress}</p>
                </div>
              </div>
            </div>

            <div className="sm:text-right shrink-0">
              <div className="inline-block p-3 bg-slate-50 border border-slate-300 text-left sm:text-right">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  DOCUMENTO FISCAL
                </span>
                <span className="block font-black text-sm text-[#0b1f3a] uppercase">
                  FATURA / RECIBO DE PAGAMENTO
                </span>
                <span className="block font-mono font-extrabold text-xs text-[#0b1f3a] mt-0.5">
                  N.º: {formattedInvoiceNumber}
                </span>
                <span className="block text-[10px] text-slate-600 font-mono mt-0.5">
                  Data de Emissão: {formattedEmissionDate}
                </span>
              </div>
            </div>
          </div>

          {/* DADOS DO ALUNO & ENCARREGADO (2 Colunas) */}
          <div className="border border-slate-300 p-4 bg-slate-50/70">
            <h4 className="font-extrabold text-[11px] uppercase tracking-wider text-[#0b1f3a] mb-2.5 flex items-center gap-1.5 border-b border-slate-200 pb-1">
              <span className="material-symbols-outlined text-[16px]">person</span>
              <span>DADOS DO ALUNO E ENCARREGADO DE EDUCAÇÃO</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1.5">
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Aluno(a):</span>
                  <strong className="text-[#0b1f3a] text-sm">{invoice.studentName}</strong>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-0.5">
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase block">N.º de Processo:</span>
                    <span className="font-mono font-bold text-slate-800">#{invoice.procNumber}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase block">Turma:</span>
                    <span className="font-semibold text-slate-800">{invoice.className}</span>
                  </div>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">N.º de Bilhete de Identidade (BI):</span>
                  <span className="font-mono font-semibold text-slate-800">{invoice.studentBiNumber || 'Não registado'}</span>
                </div>
              </div>

              <div className="space-y-1.5 sm:border-l sm:border-slate-200 sm:pl-4">
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Encarregado(a) de Educação:</span>
                  <span className="font-bold text-slate-800">{invoice.guardianName || 'Dr. Miguel Ramos'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Contacto Telefónico:</span>
                  <span className="font-mono font-semibold text-slate-800">{invoice.guardianPhone || '+244 923 881 200'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">Endereço Residencial:</span>
                  <span className="text-slate-700">{invoice.guardianAddress || 'Morro Bento, Rua Direita, Luanda'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* TABELA DE ITENS / SERVIÇOS FATURADOS */}
          <div className="border border-slate-300 overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-[#0b1f3a] text-white font-bold text-[10px] uppercase tracking-wider">
                <tr>
                  <th className="p-2.5 border-r border-slate-700">CÓD.</th>
                  <th className="p-2.5 border-r border-slate-700">DESCRIÇÃO DOS SERVIÇOS / PRODUTOS</th>
                  <th className="p-2.5 border-r border-slate-700 text-center">MÊS / REF</th>
                  <th className="p-2.5 border-r border-slate-700 text-right">PREÇO UNIT.</th>
                  <th className="p-2.5 border-r border-slate-700 text-right">DESC.</th>
                  <th className="p-2.5 border-r border-slate-700 text-center">IMPOSTO</th>
                  <th className="p-2.5 text-right">TOTAL LÍQUIDO</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {items.map((item, idx) => (
                  <tr key={idx} className={idx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'}>
                    <td className="p-2.5 font-mono font-bold text-slate-700 border-r border-slate-200">{item.code}</td>
                    <td className="p-2.5 font-medium text-slate-900 border-r border-slate-200">{item.description}</td>
                    <td className="p-2.5 text-center font-medium text-slate-700 border-r border-slate-200">{item.periodOrRef}</td>
                    <td className="p-2.5 text-right font-mono text-slate-800 border-r border-slate-200">
                      {item.unitPriceKz.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} Kz
                    </td>
                    <td className="p-2.5 text-right font-mono text-slate-600 border-r border-slate-200">
                      {(item.discountKz || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2 })} Kz
                    </td>
                    <td className="p-2.5 text-center text-[10px] text-slate-600 border-r border-slate-200">
                      {item.taxRegime || 'Isento (Art. 12 CIVA)'}
                    </td>
                    <td className="p-2.5 text-right font-mono font-bold text-[#0b1f3a]">
                      {(item.liquidTotalKz || (item.unitPriceKz * (item.quantity || 1))).toLocaleString('pt-PT', { minimumFractionDigits: 2 })} Kz
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* QUADRO DE TOTAIS */}
          <div className="flex flex-col sm:flex-row justify-end items-end pt-1">
            <div className="w-full sm:w-80 bg-slate-50 border border-slate-300 p-3 space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal Ilíquido:</span>
                <span className="font-mono font-semibold">{subtotal.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} Kz</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Desconto Comercial ({invoice.discountName || '0%'}):</span>
                <span className="font-mono">{discountAmount.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} Kz</span>
              </div>
              <div className="flex justify-between text-slate-600 border-b border-slate-200 pb-1.5">
                <span>Imposto de Selo (0.1%):</span>
                <span className="font-mono">{stampDuty.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} Kz</span>
              </div>
              <div className="flex justify-between text-sm font-black text-[#0b1f3a] pt-1">
                <span className="uppercase">TOTAL PAGO:</span>
                <span className="font-mono text-base">{totalPaid.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} Kz</span>
              </div>
            </div>
          </div>

          {/* DETALHES DE LIQUIDAÇÃO & DADOS LEGAIS AGT (Imagem 2) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border border-slate-300 p-4 bg-slate-50/50">
            <div className="space-y-1.5 text-xs">
              <h5 className="font-extrabold text-[11px] uppercase text-[#0b1f3a] tracking-wider border-b border-slate-200 pb-1">
                FORMA DE PAGAMENTO & LIQUIDAÇÃO
              </h5>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Forma de Pagamento:</span>
                <strong className="text-slate-800">{invoice.methodLabel || 'TPA Multicaixa / Transferência Express'}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Instituição / Banco:</span>
                <span className="font-semibold text-slate-800">{invoice.bankName || 'BAI - Banco Angolano de Investimentos'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">N.º Transação / Borderô:</span>
                <span className="font-mono font-bold text-[#0b1f3a]">{invoice.transactionNumber || 'TX-BAI-88912401'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Operador(a) de Caixa:</span>
                <span className="text-slate-700">{invoice.operatorName || 'Cecília Bartolomeu (Secretaria Financeira)'}</span>
              </div>
            </div>

            <div className="space-y-1.5 text-xs sm:border-l sm:border-slate-200 sm:pl-4">
              <h5 className="font-extrabold text-[11px] uppercase text-[#0b1f3a] tracking-wider border-b border-slate-200 pb-1">
                REGIME FISCAL & CERTIFICAÇÃO AGT
              </h5>
              <p className="text-[11px] text-slate-700">
                <strong>Regime de IVA:</strong> Isento nos termos do artigo 12.º do CIVA (Educação e Ensino).
              </p>
              <p className="text-[10px] font-mono text-slate-500">
                {invoice.saftHash
                  ? <>Hash SAF-T: <strong>{invoice.saftHash}</strong></>
                  : <span className="text-amber-700">Documento sem certificação SAF-T/AGT associada.</span>}
              </p>
              <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wide pt-1">
                VIA: ORIGINAL • 1.ª VIA DESTINADA AO ENCARREGADO DE EDUCAÇÃO
              </p>
            </div>
          </div>

          {/* ASSINATURAS E CARIMBO OFICIAL */}
          <div className="pt-6 border-t-2 border-slate-800 grid grid-cols-2 gap-8 text-center text-xs print-break-avoid">
            <div>
              <div className="h-10 border-b border-slate-400 mx-6 mb-1" />
              <span className="font-bold uppercase text-slate-900 block">O(A) Responsável</span>
            </div>

            <div>
              <div className="border border-dashed border-slate-400 p-2 mx-6 text-center bg-slate-50/50">
                <span className="font-bold text-[#0b1f3a] text-xs uppercase block mt-0.5">{schoolName}</span>
              </div>
            </div>
          </div>

          <div className="pt-2 text-center text-[10px] text-slate-400">
            Este documento é emitido nos termos da legislação fiscal em vigor.
          </div>
        </div>

        {/* Modal Actions (Hidden in Print) */}
        <div className="no-print print:hidden shrink-0 px-6 py-4 bg-slate-100 border-t border-slate-300 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#7a0c0c] hover:bg-[#5e0909] text-white font-bold text-xs border border-[#7a0c0c] cursor-pointer transition-colors shadow-xs"
          >
            <span className="material-symbols-outlined text-[16px]">print</span>
            <span>Imprimir</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-300 hover:bg-slate-400 text-slate-800 font-bold text-xs cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
