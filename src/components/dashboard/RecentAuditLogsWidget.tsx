import React, { useState, useEffect } from 'react';
import { SchoolAuditLog, SchoolDatabase } from '../../types';
import { dbService } from '../../services/db';

interface RecentAuditLogsWidgetProps {
  initialDb: SchoolDatabase;
  onNavigate?: (view: any) => void;
}

export const RecentAuditLogsWidget: React.FC<RecentAuditLogsWidgetProps> = ({
  initialDb,
  onNavigate
}) => {
  const [logs, setLogs] = useState<SchoolAuditLog[]>(
    initialDb.auditLogs && initialDb.auditLogs.length > 0
      ? initialDb.auditLogs
      : dbService.getAuditLogs()
  );
  const [selectedModule, setSelectedModule] = useState<string>('all');

  // Subscrever às atualizações em tempo real do banco de dados (Realtime Database / IndexedDB)
  useEffect(() => {
    const unsubscribe = dbService.subscribe((currentDb) => {
      if (currentDb.auditLogs && currentDb.auditLogs.length > 0) {
        setLogs(currentDb.auditLogs);
      } else {
        setLogs(dbService.getAuditLogs());
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const filteredLogs = logs.filter((log) => {
    if (selectedModule === 'all') return true;
    return log.module === selectedModule;
  });

  const getModuleBadge = (module: string) => {
    switch (module) {
      case 'pautas':
        return { label: 'Pautas & Notas', bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' };
      case 'propinas':
        return { label: 'Tesouraria', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' };
      case 'assiduidade':
        return { label: 'Assiduidade', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' };
      case 'alunos':
        return { label: 'Secretaria', bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200' };
      default:
        return { label: 'Sistema', bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' };
    }
  };

  const getModuleIcon = (module: string) => {
    switch (module) {
      case 'pautas':
        return 'assignment_turned_in';
      case 'propinas':
        return 'payments';
      case 'assiduidade':
        return 'how_to_reg';
      case 'alunos':
        return 'person_add';
      default:
        return 'history';
    }
  };

  return (
    <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200 flex flex-col h-full">
      {/* Header com indicador de Tempo Real */}
      <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Segurança e Rastreabilidade
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-extrabold font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Tempo Real
            </span>
          </div>
          <h2 className="font-headline text-lg font-bold text-[#0b1f3a] mt-0.5">
            ACTIVIDADES RECENTES
          </h2>
        </div>

        {/* Filtro rápido por módulo */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-[11px]">
          <button
            type="button"
            onClick={() => setSelectedModule('all')}
            className={`px-2 py-1 rounded font-bold transition-all ${
              selectedModule === 'all'
                ? 'bg-white text-[#0b1f3a] shadow-2xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Todos
          </button>
          <button
            type="button"
            onClick={() => setSelectedModule('pautas')}
            className={`px-2 py-1 rounded font-bold transition-all ${
              selectedModule === 'pautas'
                ? 'bg-white text-[#0b1f3a] shadow-2xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Pautas
          </button>
          <button
            type="button"
            onClick={() => setSelectedModule('propinas')}
            className={`px-2 py-1 rounded font-bold transition-all ${
              selectedModule === 'propinas'
                ? 'bg-white text-[#0b1f3a] shadow-2xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Propinas
          </button>
        </div>
      </div>

      {/* Lista de Registos de Auditoria em Tempo Real */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 max-h-[360px]">
        {filteredLogs.length === 0 ? (
          <div className="text-center py-10 text-slate-400">
            <span className="material-symbols-outlined text-3xl mb-1 text-slate-300">manage_search</span>
            <p className="text-xs">Nenhum registo de atividade encontrado para este filtro.</p>
          </div>
        ) : (
          filteredLogs.slice(0, 15).map((log) => {
            const badge = getModuleBadge(log.module);
            const icon = getModuleIcon(log.module);

            return (
              <div
                key={log.id}
                className="p-3 rounded-xl border border-slate-100 bg-slate-50/70 hover:bg-slate-50 hover:border-slate-200 transition-all flex items-start gap-3 text-xs"
              >
                {/* Ícone contextual */}
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${badge.bg} ${badge.text} ${badge.border}`}
                >
                  <span className="material-symbols-outlined text-[17px]">{icon}</span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="font-bold text-slate-900 truncate">{log.userName}</span>
                      <span className="text-[10px] text-slate-400 font-medium">({log.userRole})</span>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400 whitespace-nowrap shrink-0">
                      {log.timestamp}
                    </span>
                  </div>

                  <p className="text-slate-600 line-clamp-2 leading-relaxed">
                    <strong className="text-slate-800 font-semibold">{log.action}:</strong> {log.details}
                  </p>

                  <div className="mt-2 flex items-center justify-between">
                    <span
                      className={`text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded border ${badge.bg} ${badge.text} ${badge.border}`}
                    >
                      {badge.label}
                    </span>

                    {log.module === 'pautas' && onNavigate && (
                      <button
                        type="button"
                        onClick={() => onNavigate('pautas')}
                        className="text-[10px] font-bold text-[#0b1f3a] hover:underline"
                      >
                        Abrir Pauta
                      </button>
                    )}
                    {log.module === 'propinas' && onNavigate && (
                      <button
                        type="button"
                        onClick={() => onNavigate('propinas')}
                        className="text-[10px] font-bold text-emerald-800 hover:underline"
                      >
                        Ver Fatura
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer com contagem total de logs ativos */}
      <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
        <span>{filteredLogs.length} registos ativos</span>
      </div>
    </div>
  );
};
