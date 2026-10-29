import React, { useMemo, useState } from 'react';
import { SchoolDatabase } from '../types';

interface SqlExportModalProps {
  db: SchoolDatabase;
  isOpen: boolean;
  onClose: () => void;
}

export const SqlExportModal: React.FC<SqlExportModalProps> = ({ db, isOpen, onClose }) => {
  const [copied, setCopied] = useState(false);

  const jsonString = useMemo(() => {
    if (!isOpen) return '';
    // Real export of the current live database. Never include auth secrets:
    // Firebase Auth passwords are never stored in this object in the first
    // place (see src/services/auth.ts), so there is nothing to redact here.
    return JSON.stringify(db, null, 2);
  }, [db, isOpen]);

  const sizeLabel = useMemo(() => {
    const bytes = new Blob([jsonString]).size;
    return bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
  }, [jsonString]);

  if (!isOpen) return null;

  const filename = `bandmed_export_${new Date().toISOString().slice(0, 10)}.json`;

  const handleDownload = () => {
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-3xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-[#0b1f3a] text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-amber-400 text-[24px]">save_alt</span>
            <div>
              <h3 className="font-bold text-base text-white">Exportação de Dados (.json)</h3>
              <p className="text-xs text-slate-300">Estado atual e real da base de dados desta instituição</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Info Banner */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 text-xs text-slate-700 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-blue-600 text-[18px]">info</span>
            <span>
              Exportação em JSON de todos os registos reais atualmente guardados (alunos, professores, turmas, notas, propinas e avisos). Tamanho atual: {sizeLabel}.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 font-semibold text-xs flex items-center gap-1.5 transition-colors shadow-xs"
            >
              <span className="material-symbols-outlined text-[16px] text-slate-600">
                {copied ? 'check' : 'content_copy'}
              </span>
              <span>{copied ? 'Copiado!' : 'Copiar JSON'}</span>
            </button>
            <button
              onClick={handleDownload}
              className="px-3.5 py-1.5 rounded-lg bg-[#7a0c0c] hover:bg-[#5e0909] text-white font-bold text-xs flex items-center gap-1.5 transition-colors shadow-xs"
            >
              <span className="material-symbols-outlined text-[16px]">download</span>
              <span>Descarregar .json</span>
            </button>
          </div>
        </div>

        {/* Data Preview */}
        <div className="p-4 overflow-y-auto font-mono text-[11px] bg-slate-900 text-emerald-300 leading-relaxed max-h-[500px]">
          <pre className="whitespace-pre-wrap select-all">{jsonString}</pre>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-100 border-t border-slate-200 flex items-center justify-between text-xs">
          <span className="text-slate-500 font-mono">Ficheiro: {filename}</span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-300 hover:bg-slate-400 text-slate-800 font-semibold"
          >
            Fechar Janela
          </button>
        </div>
      </div>
    </div>
  );
};
