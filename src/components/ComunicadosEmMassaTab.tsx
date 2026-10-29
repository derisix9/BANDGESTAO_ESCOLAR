import React, { useMemo, useState } from 'react';
import { SchoolDatabase } from '../types';
import { runGlobalOperation } from '../context/OperationContext';
import { FormModalHeader } from './FormModalHeader';
import { Notice } from './Notice';

interface ComunicadosEmMassaTabProps {
  db: SchoolDatabase;
}

type GroupKey = 'alunos' | 'encarregados' | 'professores' | 'todos';

interface Contact {
  name: string;
  role: string;
  phone?: string;
  email?: string;
}

// Normaliza número para formato internacional (assume Angola +244 quando não indicado)
const normalizePhone = (raw?: string): string | undefined => {
  if (!raw) return undefined;
  let digits = raw.replace(/[^\d+]/g, '');
  if (!digits) return undefined;
  if (digits.startsWith('00')) digits = '+' + digits.slice(2);
  if (!digits.startsWith('+')) {
    if (digits.startsWith('244')) digits = '+' + digits;
    else digits = '+244' + digits.replace(/^0+/, '');
  }
  return digits.length >= 12 ? digits : undefined;
};

const dedupeContacts = (contacts: Contact[]): Contact[] => {
  const seen = new Set<string>();
  const result: Contact[] = [];
  for (const c of contacts) {
    const key = `${c.phone || ''}|${c.email || ''}|${c.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(c);
  }
  return result;
};

const BATCH_SIZE_SMS = 8;
const BATCH_SIZE_EMAIL = 60;

export const ComunicadosEmMassaTab: React.FC<ComunicadosEmMassaTabProps> = ({ db }) => {
  const [group, setGroup] = useState<GroupKey>('todos');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  const isIOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent);

  const contactsByGroup = useMemo(() => {
    const alunos: Contact[] = (db.students || [])
      .filter((s) => s.status === 'active')
      .map((s) => ({ name: s.name, role: 'Aluno', phone: s.studentPhone, email: s.email }));

    const encarregados: Contact[] = (db.students || [])
      .filter((s) => s.status === 'active')
      .map((s) => ({
        name: s.guardianName || `Encarregado(a) de ${s.name}`,
        role: 'Encarregado',
        phone: s.guardianPhone,
        email: s.guardianEmail
      }));

    const professores: Contact[] = (db.teachers || []).map((t) => ({
      name: t.name,
      role: 'Professor',
      phone: t.phone,
      email: t.email
    }));

    return {
      alunos: dedupeContacts(alunos),
      encarregados: dedupeContacts(encarregados),
      professores: dedupeContacts(professores),
      todos: dedupeContacts([...alunos, ...encarregados, ...professores])
    };
  }, [db.students, db.teachers]);

  const activeContacts = contactsByGroup[group];

  const phoneContacts = useMemo(
    () =>
      activeContacts
        .map((c) => ({ ...c, phone: normalizePhone(c.phone) }))
        .filter((c) => !!c.phone) as (Contact & { phone: string })[],
    [activeContacts]
  );

  const emailContacts = useMemo(
    () => activeContacts.filter((c) => c.email && c.email.includes('@')),
    [activeContacts]
  );

  const smsBatches = useMemo(() => {
    const batches: string[][] = [];
    for (let i = 0; i < phoneContacts.length; i += BATCH_SIZE_SMS) {
      batches.push(phoneContacts.slice(i, i + BATCH_SIZE_SMS).map((c) => c.phone));
    }
    return batches;
  }, [phoneContacts]);

  const emailBatches = useMemo(() => {
    const batches: string[][] = [];
    for (let i = 0; i < emailContacts.length; i += BATCH_SIZE_EMAIL) {
      batches.push(emailContacts.slice(i, i + BATCH_SIZE_EMAIL).map((c) => c.email as string));
    }
    return batches;
  }, [emailContacts]);

  const openSmsBatch = (numbers: string[]) => {
    const separator = isIOS ? '&' : '?';
    const url = `sms:${numbers.join(',')}${separator}body=${encodeURIComponent(message)}`;
    window.open(url, '_self');
  };

  const openEmailBatch = (emails: string[]) => {
    const url = `mailto:?bcc=${encodeURIComponent(emails.join(','))}&subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(message)}`;
    window.open(url, '_self');
  };

  const openWhatsapp = (phone: string) => {
    const number = phone.replace(/\D/g, '');
    const url = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  };

  // Confirmação prévia (estilo próprio do sistema) antes de abrir a app nativa —
  // substitui a caixa de diálogo genérica do navegador por uma confirmação consistente
  // com o resto do sistema (mesmo padrão usado, por exemplo, ao eliminar uma turma).
  const [pendingAction, setPendingAction] = useState<
    | { type: 'sms'; batch: string[]; batchIndex: number }
    | { type: 'email'; batch: string[]; batchIndex: number }
    | null
  >(null);

  const confirmPendingAction = async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);

    if (action.type === 'sms') {
      await runGlobalOperation(
        async () => {
          openSmsBatch(action.batch);
        },
        {
          loadingMessage: 'A abrir a aplicação de Mensagens...',
          successMessage: 'Aplicação de Mensagens aberta com sucesso!'
        }
      );
    } else {
      await runGlobalOperation(
        async () => {
          openEmailBatch(action.batch);
        },
        {
          loadingMessage: 'A abrir a aplicação de Email...',
          successMessage: 'Aplicação de Email aberta com sucesso!'
        }
      );
    }
  };

  const groupLabels: Record<GroupKey, string> = {
    alunos: 'Alunos',
    encarregados: 'Encarregados de Educação',
    professores: 'Professores',
    todos: 'Toda a Comunidade Escolar'
  };

  return (
    <div className="space-y-5">
      {/* Explicação honesta do que isto faz */}
      <Notice tone="info" icon="info">
        <div>
          <strong className="block text-[#0b1f3a] mb-1">Como funciona o envio em massa</strong>
          Este sistema usa os contactos já registados na base de dados (não acede aos contactos do teu telemóvel).
          Para Email, abre o teu programa de email com todos os destinatários em cópia oculta (BCC) — um único clique
          "Enviar" alcança todo o lote. Para SMS/WhatsApp, por limitação dos próprios telemóveis, os contactos são
          divididos em pequenos lotes e cada lote abre a app nativa (Mensagens ou WhatsApp) já pronta — precisas de
          confirmar o envio em cada lote/contacto.
        </div>
      </Notice>

      {/* Seleção de Grupo */}
      <div className="bg-white p-5 rounded-none border border-slate-300 shadow-xs">
        <label className="block uppercase font-bold text-slate-700 text-xs mb-2">Selecionar Grupo de Destinatários</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(Object.keys(groupLabels) as GroupKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setGroup(key)}
              className={`px-3 py-2.5 text-xs font-bold border transition-colors cursor-pointer ${
                group === key
                  ? 'bg-[#0b1f3a] text-white border-[#0b1f3a]'
                  : 'bg-white text-slate-700 border-slate-300 hover:border-[#0b1f3a]'
              }`}
            >
              {groupLabels[key]}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-slate-500 font-mono">
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">groups</span>
            {activeContacts.length} contactos no grupo
          </span>
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">smartphone</span>
            {phoneContacts.length} com telefone válido
          </span>
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">alternate_email</span>
            {emailContacts.length} com email válido
          </span>
        </div>
      </div>

      {/* Composição da Mensagem */}
      <div className="bg-white p-5 rounded-none border border-slate-300 shadow-xs space-y-3">
        <div>
          <label className="block uppercase font-bold text-slate-700 text-xs mb-1">
            Assunto (usado apenas no Email)
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Ex: Comunicado Importante — Início do 2º Trimestre"
            className="w-full h-9 px-3 rounded-none bg-white text-xs text-slate-800 border border-slate-300 focus:outline-none focus:border-[#0b1f3a]"
          />
        </div>
        <div>
          <label className="block uppercase font-bold text-slate-700 text-xs mb-1">Mensagem</label>
          <textarea
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Escreva aqui a mensagem a enviar para o grupo selecionado..."
            className="w-full p-3 rounded-none bg-white text-xs text-slate-800 border border-slate-300 focus:outline-none focus:border-[#0b1f3a]"
          />
        </div>
      </div>

      {/* Envio por Email */}
      <div className="bg-white p-5 rounded-none border border-slate-300 shadow-xs">
        <h3 className="font-headline font-bold text-sm text-[#0b1f3a] mb-1 flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">mail</span>
          Enviar por Email
        </h3>
        <p className="text-[11px] text-slate-500 mb-3">
          {emailContacts.length === 0
            ? 'Nenhum contacto com email válido neste grupo.'
            : `${emailContacts.length} destinatário(s) em ${emailBatches.length} lote(s) de até ${BATCH_SIZE_EMAIL}.`}
        </p>
        <div className="flex flex-wrap gap-2">
          {emailBatches.map((batch, idx) => (
            <button
              key={idx}
              disabled={!message}
              onClick={() => setPendingAction({ type: 'email', batch, batchIndex: idx })}
              className="px-4 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">send</span>
              Abrir Email — Lote {idx + 1} ({batch.length})
            </button>
          ))}
        </div>
      </div>

      {/* Envio por SMS */}
      <div className="bg-white p-5 rounded-none border border-slate-300 shadow-xs">
        <h3 className="font-headline font-bold text-sm text-[#0b1f3a] mb-1 flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">sms</span>
          Enviar por SMS
        </h3>
        <p className="text-[11px] text-slate-500 mb-3">
          {phoneContacts.length === 0
            ? 'Nenhum contacto com telefone válido neste grupo.'
            : `${phoneContacts.length} destinatário(s) em ${smsBatches.length} lote(s) de até ${BATCH_SIZE_SMS} (limite prático da app de Mensagens).`}
        </p>
        <div className="flex flex-wrap gap-2">
          {smsBatches.map((batch, idx) => (
            <button
              key={idx}
              disabled={!message}
              onClick={() => setPendingAction({ type: 'sms', batch, batchIndex: idx })}
              className="px-4 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">chat</span>
              Abrir SMS — Lote {idx + 1} ({batch.length})
            </button>
          ))}
        </div>
      </div>

      {/* Envio por WhatsApp (individual) */}
      <div className="bg-white p-5 rounded-none border border-slate-300 shadow-xs">
        <h3 className="font-headline font-bold text-sm text-[#0b1f3a] mb-1 flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">chat_bubble</span>
          Enviar por WhatsApp
        </h3>
        <p className="text-[11px] text-slate-500 mb-3">
          O WhatsApp não permite envio em lote sem uma conta comercial paga — cada contacto abre uma conversa
          individual já com a mensagem escrita, só precisas de confirmar o envio.
        </p>
        <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
          {phoneContacts.length === 0 && (
            <p className="text-xs text-slate-400 italic">Nenhum contacto com telefone válido neste grupo.</p>
          )}
          {phoneContacts.map((c, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between px-3 py-2 bg-slate-50 border border-slate-200 text-xs"
            >
              <div>
                <span className="font-bold text-slate-800">{c.name}</span>
                <span className="text-slate-400 ml-2">({c.role})</span>
                <span className="block text-[10px] font-mono text-slate-400">{c.phone}</span>
              </div>
              <button
                disabled={!message}
                onClick={() => openWhatsapp(c.phone)}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-[11px] flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                Abrir
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Confirmação (mesmo padrão visual usado, por exemplo, ao eliminar uma turma) */}
      {pendingAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white max-w-md w-full rounded-none shadow-2xl overflow-hidden border border-slate-400">
            <FormModalHeader
              title={pendingAction.type === 'sms' ? 'Abrir Aplicação de Mensagens' : 'Abrir Aplicação de Email'}
              subtitle={`Lote ${pendingAction.batchIndex + 1} — ${pendingAction.batch.length} destinatário(s)`}
              icon={pendingAction.type === 'sms' ? 'sms' : 'mail'}
              onClose={() => setPendingAction(null)}
            />

            <div className="p-6">
              <div className="w-12 h-12 rounded-none bg-blue-100 text-[#0b1f3a] flex items-center justify-center mx-auto mb-4 border border-blue-300">
                <span className="material-symbols-outlined text-[28px]">
                  {pendingAction.type === 'sms' ? 'sms' : 'mail'}
                </span>
              </div>
              <h3 className="font-headline text-lg font-bold text-slate-900 text-center">
                {pendingAction.type === 'sms'
                  ? 'Abrir a Aplicação de Mensagens do Dispositivo?'
                  : 'Abrir a Aplicação de Email do Dispositivo?'}
              </h3>
              <p className="text-xs text-slate-600 text-center mt-2 leading-relaxed">
                {pendingAction.type === 'sms'
                  ? `Vai ser aberta a aplicação de Mensagens com ${pendingAction.batch.length} destinatário(s) e a mensagem já preenchida. Terás de confirmar o envio dentro dessa aplicação.`
                  : `Vai ser aberto o teu programa de Email com ${pendingAction.batch.length} destinatário(s) em cópia oculta (BCC) e a mensagem já preenchida. Terás de confirmar o envio dentro desse programa.`}
              </p>
              <div className="mt-6 flex items-center justify-end gap-2">
                <button
                  onClick={() => setPendingAction(null)}
                  className="px-4 py-2 rounded-none bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs border border-slate-300 cursor-pointer transition-colors"
                  type="button"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmPendingAction}
                  className="px-5 py-2.5 rounded-none bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-colors shadow-none border-none"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {pendingAction.type === 'sms' ? 'sms' : 'send'}
                  </span>
                  <span>Sim, Abrir</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
