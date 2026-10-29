import React, { useState, useEffect } from 'react';
import { SchoolCalendarEvent, SchoolDatabase } from '../../types';
import { dbService } from '../../services/db';
import { useAccessControl } from '../../hooks/useAccessControl';
import { getFallbackAcademicYear } from '../../utils/academicYear';

interface InstitutionalAgendaWidgetProps {
  initialDb: SchoolDatabase;
  currentUserRole?: string;
  onNavigate?: (view: any) => void;
}

export const InstitutionalAgendaWidget: React.FC<InstitutionalAgendaWidgetProps> = ({
  initialDb,
  currentUserRole,
  onNavigate
}) => {
  const canDeleteEvents = useAccessControl(currentUserRole || '').can('calendario.delete');
  const [events, setEvents] = useState<SchoolCalendarEvent[]>(
    initialDb.events && initialDb.events.length > 0 ? initialDb.events : dbService.getEvents()
  );
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [newCategory, setNewCategory] = useState<'feriado' | 'exame' | 'reuniao' | 'evento'>('evento');
  const [newDesc, setNewDesc] = useState('');

  // Subscrever em tempo real às alterações de eventos da agenda
  useEffect(() => {
    const unsubscribe = dbService.subscribe((currentDb) => {
      if (currentDb.events && currentDb.events.length > 0) {
        setEvents(currentDb.events);
      } else {
        setEvents(dbService.getEvents());
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleAddEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle || !newDate) return;

    const parsedDate = new Date(newDate);
    const months = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
    const monthShort = isNaN(parsedDate.getTime()) ? 'CAL' : months[parsedDate.getMonth()];
    const dayNumber = isNaN(parsedDate.getTime()) ? 1 : parsedDate.getDate();
    const colorMap: Record<string, string> = {
      feriado: '#0b1f3a',
      exame: '#7a0c0c',
      reuniao: '#2563eb',
      evento: '#059669'
    };

    dbService.addEvent({
      title: newTitle,
      description: newDesc || 'Compromisso no calendário institucional',
      monthShort,
      dayNumber,
      date: newDate,
      time: newTime || '08:00',
      category: newCategory,
      color: colorMap[newCategory] || '#0b1f3a'
    });

    setNewTitle('');
    setNewDate('');
    setNewTime('');
    setNewDesc('');
    setIsModalOpen(false);
  };

  const handleDeleteEvent = (id: string) => {
    if (confirm('Deseja eliminar este evento da agenda institucional?')) {
      dbService.deleteEvent(id);
    }
  };

  // Helper para formatar a data do evento em Badge de Calendário (Mês e Dia)
  const parseDateBadge = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) {
        return { mes: 'AGENDA', dia: '•' };
      }
      const meses = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
      return {
        mes: meses[d.getMonth()] || 'MÊS',
        dia: String(d.getDate()).padStart(2, '0')
      };
    } catch {
      return { mes: 'AGENDA', dia: '•' };
    }
  };

  const getCategoryBadge = (category: string) => {
    switch (category) {
      case 'feriado':
        return { label: 'Feriado Oficial', bg: 'bg-emerald-50 text-emerald-800 border-emerald-200' };
      case 'exame':
        return { label: 'Avaliação & Provas', bg: 'bg-purple-50 text-purple-800 border-purple-200' };
      case 'reuniao':
        return { label: 'Conselho / Reunião', bg: 'bg-blue-50 text-blue-800 border-blue-200' };
      default:
        return { label: 'Atividade Geral', bg: 'bg-amber-50 text-amber-800 border-amber-200' };
    }
  };

  return (
    <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200 flex flex-col h-full">
      {/* Top Header */}
      <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Calendário Escolar {initialDb.settings?.currentAcademicYear || getFallbackAcademicYear()}
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-[#0b1f3a] border border-blue-100 text-[10px] font-extrabold font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
			  Tempo Real
            </span>
          </div>
          <h2 className="font-headline text-lg font-bold text-[#0b1f3a] mt-0.5">
            AGENDA ESCOLAR
          </h2>
        </div>

        {/* Botão para Agendar Evento */}
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#0b1f3a] text-white text-xs font-bold hover:bg-[#16355f] transition-colors shadow-xs"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          <span>Novo Evento</span>
        </button>
      </div>

      {/* Lista de Eventos em Tempo Real */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 max-h-[360px]">
        {events.length === 0 ? (
          <div className="text-center py-10 text-slate-400">
            <span className="material-symbols-outlined text-3xl mb-1 text-slate-300">event_busy</span>
            <p className="text-xs">Não existem eventos agendados para este período.</p>
          </div>
        ) : (
          events.map((evt) => {
            const badge = parseDateBadge(evt.date);
            const cat = getCategoryBadge(evt.category);

            return (
              <div
                key={evt.id}
                className="p-3 rounded-xl border border-slate-100 bg-slate-50/70 hover:bg-slate-50 hover:border-slate-200 transition-all flex items-start gap-3 text-xs group"
              >
                {/* Calendário Badge */}
                <div className="w-11 rounded-lg border border-slate-200 overflow-hidden shrink-0 text-center shadow-2xs bg-white">
                  <div className="bg-[#0b1f3a] text-white font-mono font-bold text-[9px] py-0.5 tracking-wider">
                    {badge.mes}
                  </div>
                  <div className="font-headline font-extrabold text-sm text-[#0b1f3a] py-1">
                    {badge.dia}
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <h3 className="font-bold text-slate-900 text-[13px] truncate">{evt.title}</h3>
                    <div className="flex items-center gap-1">
                      <span
                        className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded border ${cat.bg}`}
                      >
                        {cat.label}
                      </span>
                      {canDeleteEvents && (
                        <button
                          type="button"
                          onClick={() => handleDeleteEvent(evt.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-[#7a0c0c] transition-opacity"
                          title="Eliminar evento"
                        >
                          <span className="material-symbols-outlined text-[14px]">delete</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="text-slate-600 line-clamp-2 leading-relaxed">{evt.description}</p>

                  <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px]">schedule</span>
                      {evt.time || '08:00'} • {evt.date}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer com contagem */}
      <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
        <span>{events.length} compromissos agendados</span>
        {onNavigate ? (
          <button
            type="button"
            onClick={() => onNavigate('calendario_escolar')}
            className="inline-flex items-center gap-1 font-bold text-[#0b1f3a] hover:underline cursor-pointer"
          >
            <span className="material-symbols-outlined text-[14px]">calendar_month</span>
            Ver calendário
          </button>
        ) : (
          <span className="font-mono text-[10px] text-slate-400">Sincronizado em tempo real</span>
        )}
      </div>

      {/* Modal para Adicionar Evento */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
              <h3 className="font-headline font-bold text-base text-[#0b1f3a]">
                Novo Evento
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form onSubmit={handleAddEvent} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Título do Evento *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Início das Provas do 1.º Trimestre"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-[#0b1f3a]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Data *</label>
                  <input
                    type="date"
                    required
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-[#0b1f3a]"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Hora</label>
                  <input
                    type="time"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-[#0b1f3a]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Categoria *</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-[#0b1f3a]"
                >
                  <option value="exame">Avaliação & Exames Trimestrais</option>
                  <option value="feriado">Feriado Nacional ou Ponte</option>
                  <option value="reuniao">Conselho Pedagógico / Reunião de Pais</option>
                  <option value="evento">Evento Cultural ou Desportivo</option>
				  <option value="evento">Ano Lectivo</option>
				  <option value="evento">Outros</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Descrição</label>
                <textarea
                  rows={2}
                  placeholder="Detalhes adicionais para o corpo docente e discente..."
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-[#0b1f3a]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-slate-600 font-bold hover:bg-slate-100 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#0b1f3a] text-white font-bold hover:bg-[#16355f] transition-colors"
                >
                  Publicar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
