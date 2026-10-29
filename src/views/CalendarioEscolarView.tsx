import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { SchoolDatabase, User, UserRole } from '../types';
import { dbService } from '../services/db';
import { useAccessControl } from '../hooks/useAccessControl';
import { buildAcademicYearList, getFallbackAcademicYear } from '../utils/academicYear';
import {
  CALENDAR_CATEGORIES,
  CALENDAR_CATEGORY_ORDER,
  CalendarCategory,
  CalendarEntry,
  MONTH_NAMES,
  WEEKDAY_SHORT,
  academicYearOfIso,
  buildCalendar,
  dominantCategory,
  entriesInMonth,
  entriesOnDay,
  formatIsoPt,
  getAcademicYearMonths,
  getMonthMatrix,
  isoToParts,
  todayIso
} from '../utils/schoolCalendar';
import { Notice } from '../components/Notice';

interface CalendarioEscolarViewProps {
  db: SchoolDatabase;
  currentUser: User;
  currentUserRole: UserRole;
  onNavigate?: (view: string) => void;
}

type Cursor = { y: number; m: number };
type PrintScope = 'mes' | 'ano' | null;

const monthKey = (c: Cursor) => c.y * 12 + c.m;
const rangeLabel = (e: CalendarEntry) =>
  e.startIso === e.endIso ? formatIsoPt(e.startIso) : `${formatIsoPt(e.startIso)} → ${formatIsoPt(e.endIso)}`;

export const CalendarioEscolarView: React.FC<CalendarioEscolarViewProps> = ({
  db,
  currentUser,
  currentUserRole,
  onNavigate
}) => {
  const settings = db.settings;
  const currentYear = settings?.currentAcademicYear || getFallbackAcademicYear();
  const today = todayIso();

  // Mesma fonte da Agenda Institucional do Dashboard (db.events), como o widget faz.
  const events = useMemo(
    () => (db.events && db.events.length > 0 ? db.events : dbService.getEvents()),
    [db.events]
  );

  const [selectedYear, setSelectedYear] = useState<string>(currentYear);
  const [mode, setMode] = useState<'calendario' | 'lista'>('calendario');
  const [showSettingsDates, setShowSettingsDates] = useState(true);
  const [hidden, setHidden] = useState<Set<CalendarCategory>>(new Set());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [printScope, setPrintScope] = useState<PrintScope>(null);
  const [printMenuOpen, setPrintMenuOpen] = useState(false);

  // Anos lectivos oferecidos: o ativo, os configurados/arquivados e os que têm eventos na Agenda.
  const yearOptions = useMemo(() => {
    const fromEvents = events
      .map((e) => (e.date || '').slice(0, 10))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .map(academicYearOfIso);
    return buildAcademicYearList(settings, fromEvents);
  }, [events, settings]);
  const year = yearOptions.includes(selectedYear) ? selectedYear : currentYear;

  const built = useMemo(
    () => buildCalendar(events, settings, year, showSettingsDates),
    [events, settings, year, showSettingsDates]
  );
  const visible = useMemo(() => built.entries.filter((e) => !hidden.has(e.category)), [built.entries, hidden]);
  const months = useMemo(() => getAcademicYearMonths(settings, year, built.entries), [settings, year, built.entries]);

  const initialCursor = (): Cursor => {
    const t = isoToParts(today);
    if (months.some((mo) => mo.y === t.y && mo.m === t.m)) return { y: t.y, m: t.m };
    return months[0] || { y: t.y, m: t.m };
  };
  const [cursor, setCursor] = useState<Cursor>(initialCursor);
  // Se o mês mostrado deixou de existir neste ano lectivo (mudança de ano), volta ao início.
  const cursorInYear = months.some((mo) => mo.y === cursor.y && mo.m === cursor.m);
  const shown: Cursor = cursorInYear ? cursor : initialCursor();

  const changeYear = (next: string) => {
    setSelectedYear(next);
    setSelectedDay(null);
    setCursor({ y: -1, m: 0 }); // força recalcular para o primeiro mês do novo ano
  };

  const idx = months.findIndex((mo) => mo.y === shown.y && mo.m === shown.m);
  const goto = (delta: number) => {
    const next = months[idx + delta];
    if (next) {
      setCursor(next);
      setSelectedDay(null);
    }
  };

  const monthEntries = useMemo(() => entriesInMonth(visible, shown.y, shown.m), [visible, shown.y, shown.m]);
  const panelEntries = selectedDay ? entriesOnDay(visible, selectedDay) : monthEntries;
  const toggleCategory = (c: CalendarCategory) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(c) ? next.delete(c) : next.add(c);
      return next;
    });

  // ---- Impressão / PDF: usa o diálogo de impressão do navegador ("Guardar como PDF") ----
  useEffect(() => {
    if (!printScope) return;
    document.body.classList.add('calendar-printing');
    const finish = () => {
      document.body.classList.remove('calendar-printing');
      setPrintScope(null);
    };
    window.addEventListener('afterprint', finish, { once: true });
    const timer = window.setTimeout(() => window.print(), 150);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', finish);
      document.body.classList.remove('calendar-printing');
    };
  }, [printScope]);

  const startPrint = (scope: Exclude<PrintScope, null>) => {
    setPrintMenuOpen(false);
    setPrintScope(scope);
  };

  const canManageAgenda = useAccessControl(currentUserRole).can('calendario.manage');
  const monthTitle = `${MONTH_NAMES[shown.m]} ${shown.y}`;

  // ------------------------------------------------------------------------------------
  const renderEntryRow = (e: CalendarEntry, showDate = true) => {
    const cat = CALENDAR_CATEGORIES[e.category];
    return (
      <div key={e.id} className="flex gap-3 p-3 rounded-xl border border-slate-100 bg-slate-50/70 text-xs">
        <span className="w-1 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-bold text-slate-900 text-[13px] leading-snug">{e.title}</h4>
            <span
              className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded shrink-0"
              style={{ color: cat.color, backgroundColor: `${cat.color}18` }}
            >
              {cat.label}
            </span>
          </div>
          {e.description && <p className="text-slate-600 mt-0.5 leading-relaxed">{e.description}</p>}
          <p className="mt-1 text-[10px] font-mono text-slate-400 flex flex-wrap gap-x-3">
            {showDate && <span>{rangeLabel(e)}</span>}
            {e.time && e.source === 'agenda' && <span>{e.time}</span>}
            <span>{e.source === 'agenda' ? 'Agenda Institucional' : 'Configurações · Ano Letivo'}</span>
          </p>
        </div>
      </div>
    );
  };

  const renderScreenGrid = () => (
    <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
      <div className="grid grid-cols-7 bg-[#0b1f3a] text-white text-[10px] sm:text-[11px] font-bold uppercase tracking-wide">
        {WEEKDAY_SHORT.map((d) => (
          <div key={d} className="py-2 text-center">{d}</div>
        ))}
      </div>
      {getMonthMatrix(shown.y, shown.m).map((week, wi) => (
        <div key={wi} className="grid grid-cols-7">
          {week.map((cell, ci) => {
            const dayEntries = cell.inMonth ? entriesOnDay(visible, cell.iso) : [];
            const isToday = cell.iso === today;
            const isSelected = selectedDay === cell.iso;
            return (
              <button
                key={cell.iso}
                type="button"
                data-gr-alt={cell.inMonth ? (wi + ci) % 2 : undefined}
                disabled={!cell.inMonth}
                onClick={() => setSelectedDay(isSelected ? null : cell.iso)}
                className={`min-h-[58px] sm:min-h-[92px] p-1 sm:p-1.5 text-left border-t border-l border-slate-100 flex flex-col gap-1 transition-colors ${
                  !cell.inMonth ? 'bg-slate-50/60 cursor-default' : cell.isWeekend ? 'bg-slate-50 hover:bg-blue-50/50' : 'bg-white hover:bg-blue-50/50'
                } ${isSelected ? 'ring-2 ring-inset ring-[#0b1f3a]' : ''}`}
              >
                <span
                  data-today={cell.inMonth && isToday ? 'true' : undefined}
                  className={`text-[11px] font-bold w-6 h-6 inline-flex items-center justify-center ${isToday ? 'rounded-md' : 'rounded-full'} ${
                    !cell.inMonth ? 'text-slate-300' : isToday ? 'bg-[#12498a] text-white' : cell.isWeekend ? 'text-slate-400' : 'text-slate-700'
                  }`}
                >
                  {cell.day}
                </span>
                <div className="hidden sm:flex flex-col gap-0.5 min-w-0">
                  {dayEntries.slice(0, 2).map((e) => {
                    const c = CALENDAR_CATEGORIES[e.category].color;
                    return (
                      <span
                        key={e.id}
                        className="block truncate text-[10px] font-semibold px-1.5 py-0.5 rounded"
                        style={{ color: c, backgroundColor: `${c}18`, borderLeft: `3px solid ${c}` }}
                        title={e.title}
                      >
                        {e.title}
                      </span>
                    );
                  })}
                  {dayEntries.length > 2 && (
                    <span className="text-[10px] font-bold text-slate-400 px-1">+{dayEntries.length - 2} mais</span>
                  )}
                </div>
                <div className="sm:hidden flex flex-wrap gap-0.5">
                  {dayEntries.slice(0, 4).map((e) => (
                    <span key={e.id} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: CALENDAR_CATEGORIES[e.category].color }} />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );

  const renderYearList = () => {
    const groups = months
      .map((mo) => ({ mo, list: entriesInMonth(visible, mo.y, mo.m) }))
      .filter((g) => g.list.length > 0);
    if (groups.length === 0) {
      return <p className="text-xs text-slate-400 text-center py-10">Sem eventos neste ano lectivo com os filtros atuais.</p>;
    }
    return (
      <div className="space-y-5">
        {groups.map(({ mo, list }) => (
          <div key={`${mo.y}-${mo.m}`}>
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
              {MONTH_NAMES[mo.m]} {mo.y}
            </h3>
            <div className="space-y-2">{list.map((e) => renderEntryRow(e))}</div>
          </div>
        ))}
      </div>
    );
  };

  // ------------------------------------------------------------------------------------
  // Documento de impressão (renderizado fora da app, em <body>, só visível ao imprimir)
  // ------------------------------------------------------------------------------------
  const renderPrintHeader = (subtitle: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '2px solid #0b1f3a', paddingBottom: 8, marginBottom: 10 }}>
      {settings?.logoUrl ? <img src={settings.logoUrl} alt="" style={{ height: 46, width: 'auto' }} /> : null}
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 800, fontSize: '14pt', color: '#0b1f3a' }}>{settings?.schoolName || 'Instituição de Ensino'}</div>
        <div style={{ fontSize: '8pt', color: '#475569' }}>{settings?.subTitle || settings?.decreeAuthorization || ''}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontWeight: 800, fontSize: '12pt', color: '#7a0c0c' }}>CALENDÁRIO ESCOLAR {year}</div>
        <div style={{ fontSize: '8.5pt', color: '#334155', fontWeight: 600 }}>{subtitle}</div>
      </div>
    </div>
  );

  const renderPrintLegend = () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: '7.5pt', color: '#334155', margin: '6px 0' }}>
      {CALENDAR_CATEGORY_ORDER.filter((c) => !hidden.has(c)).map((c) => (
        <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: CALENDAR_CATEGORIES[c].color, display: 'inline-block' }} />
          {CALENDAR_CATEGORIES[c].label}
        </span>
      ))}
    </div>
  );

  const renderPrintFooter = () => (
    <div style={{ marginTop: 10, paddingTop: 6, borderTop: '1px solid #cbd5e1', fontSize: '7pt', color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
      <span>Fonte: Agenda Institucional{showSettingsDates ? ' e Configurações > Ano Letivo' : ''}</span>
      <span>
        Emitido em {new Date().toLocaleString('pt-PT')} por {currentUser?.name || '—'}
      </span>
    </div>
  );

  const renderPrintEventTable = (groups: Array<{ mo: Cursor; list: CalendarEntry[] }>) => (
    <table data-no-table-style style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8pt' }}>
      <thead>
        <tr style={{ backgroundColor: '#0b1f3a', color: '#fff', textAlign: 'left' }}>
          <th style={{ padding: '4px 6px', width: '22%' }}>Data</th>
          <th style={{ padding: '4px 6px' }}>Evento</th>
          <th style={{ padding: '4px 6px', width: '20%' }}>Categoria</th>
        </tr>
      </thead>
      {groups.map(({ mo, list }) => (
        // Um <tbody> por mês, sem quebra a meio: o título do mês nunca fica órfão no fim da página.
        <tbody key={`${mo.y}-${mo.m}`} style={{ breakInside: 'avoid' }}>
            <tr>
              <td colSpan={3} style={{ backgroundColor: '#e2e8f0', padding: '3px 6px', fontWeight: 800, textTransform: 'uppercase', fontSize: '7.5pt', color: '#0b1f3a' }}>
                {MONTH_NAMES[mo.m]} {mo.y}
              </td>
            </tr>
            {list.map((e) => {
              const c = CALENDAR_CATEGORIES[e.category];
              return (
                <tr key={e.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '3px 6px', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                    {rangeLabel(e)}
                    {e.time && e.source === 'agenda' ? ` · ${e.time}` : ''}
                  </td>
                  <td style={{ padding: '3px 6px' }}>
                    <strong>{e.title}</strong>
                    {e.description ? <span style={{ color: '#64748b' }}> — {e.description}</span> : null}
                  </td>
                  <td style={{ padding: '3px 6px', color: c.color, fontWeight: 700 }}>{c.label}</td>
                </tr>
              );
            })}
        </tbody>
      ))}
    </table>
  );

  const renderPrintMonth = () => {
    const weeks = getMonthMatrix(shown.y, shown.m);
    return (
      <div className="print-landscape">
        {renderPrintHeader(monthTitle.toUpperCase())}
        <table data-no-table-style style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '7.5pt' }}>
          <thead>
            <tr style={{ backgroundColor: '#0b1f3a', color: '#fff' }}>
              {WEEKDAY_SHORT.map((d) => (
                <th key={d} style={{ padding: '3px 0', textTransform: 'uppercase', fontSize: '7.5pt' }}>{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, wi) => (
              <tr key={wi}>
                {week.map((cell) => {
                  const list = cell.inMonth ? entriesOnDay(visible, cell.iso) : [];
                  return (
                    <td
                      key={cell.iso}
                      style={{
                        height: '21mm',
                        verticalAlign: 'top',
                        border: '1px solid #cbd5e1',
                        padding: 2,
                        backgroundColor: !cell.inMonth ? '#f1f5f9' : cell.isWeekend ? '#f8fafc' : '#fff',
                        overflow: 'hidden'
                      }}
                    >
                      {cell.inMonth && (
                        <>
                          <div style={{ fontWeight: 800, color: cell.isWeekend ? '#94a3b8' : '#0b1f3a' }}>{cell.day}</div>
                          {list.slice(0, 3).map((e) => {
                            const c = CALENDAR_CATEGORIES[e.category].color;
                            return (
                              <div key={e.id} style={{ borderLeft: `3px solid ${c}`, backgroundColor: `${c}1f`, color: c, fontWeight: 700, fontSize: '6.5pt', lineHeight: 1.15, padding: '1px 3px', marginTop: 1 }}>
                                {e.title}
                              </div>
                            );
                          })}
                          {list.length > 3 && <div style={{ fontSize: '6.5pt', color: '#64748b' }}>+{list.length - 3} mais</div>}
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {renderPrintLegend()}
        {monthEntries.length > 0 ? (
          renderPrintEventTable([{ mo: shown, list: monthEntries }])
        ) : (
          <p style={{ fontSize: '8pt', color: '#64748b' }}>Sem eventos neste mês.</p>
        )}
        {renderPrintFooter()}
      </div>
    );
  };

  const renderPrintYear = () => {
    const groups = months.map((mo) => ({ mo, list: entriesInMonth(visible, mo.y, mo.m) })).filter((g) => g.list.length > 0);
    return (
      <div className="print-portrait">
        {renderPrintHeader(`Ano Lectivo completo${settings?.academicPeriod && year === currentYear ? ` · ${settings.academicPeriod}` : ''}`)}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {months.map((mo) => (
            <div key={`${mo.y}-${mo.m}`} style={{ border: '1px solid #cbd5e1', padding: 4, breakInside: 'avoid' }}>
              <div style={{ textAlign: 'center', fontWeight: 800, fontSize: '8pt', color: '#0b1f3a', textTransform: 'uppercase', marginBottom: 2 }}>
                {MONTH_NAMES[mo.m]} {mo.y}
              </div>
              <table data-no-table-style style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '6.5pt', textAlign: 'center' }}>
                <thead>
                  <tr>
                    {WEEKDAY_SHORT.map((d) => (
                      <th key={d} style={{ color: '#64748b', fontWeight: 700 }}>{d[0]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {getMonthMatrix(mo.y, mo.m).map((week, wi) => (
                    <tr key={wi}>
                      {week.map((cell) => {
                        const dom = cell.inMonth ? dominantCategory(entriesOnDay(visible, cell.iso)) : null;
                        return (
                          <td
                            key={cell.iso}
                            style={{
                              padding: '1.5px 0',
                              color: !cell.inMonth ? 'transparent' : dom ? '#fff' : cell.isWeekend ? '#94a3b8' : '#1e293b',
                              backgroundColor: dom ? CALENDAR_CATEGORIES[dom].color : 'transparent',
                              fontWeight: dom ? 800 : 500
                            }}
                          >
                            {cell.day}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        {renderPrintLegend()}
        <div style={{ marginTop: 6 }}>
          {groups.length > 0 ? renderPrintEventTable(groups) : <p style={{ fontSize: '8pt', color: '#64748b' }}>Sem eventos neste ano lectivo.</p>}
        </div>
        {renderPrintFooter()}
      </div>
    );
  };

  // ------------------------------------------------------------------------------------
  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Calendário Escolar {year}</span>
          <h1 className="font-headline text-xl font-bold text-[#0b1f3a] mt-0.5">CALENDÁRIO ESCOLAR</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={year}
            onChange={(e) => changeYear(e.target.value)}
            className="h-9 px-3 text-xs font-bold rounded-lg border border-slate-300 bg-slate-50"
            aria-label="Ano Lectivo"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}{y === currentYear ? '' : ''}
              </option>
            ))}
          </select>

          <div className="relative">
            <button
              type="button"
              onClick={() => setPrintMenuOpen((v) => !v)}
              className="h-9 px-3.5 bg-[#0b1f3a] hover:bg-[#15345d] text-white rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-base text-amber-400">picture_as_pdf</span>
              <span>IMPRIMIR</span>
              <span className="material-symbols-outlined text-base">expand_more</span>
            </button>
            {printMenuOpen && (
              <div className="absolute right-0 mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-lg z-20 overflow-hidden text-xs">
                <button type="button" onClick={() => startPrint('mes')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 cursor-pointer">
                  <strong className="block text-slate-800">Mês em vista</strong>
                  <span className="text-slate-500">{monthTitle} · A4 horizontal</span>
                </button>
                <button type="button" onClick={() => startPrint('ano')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-t border-slate-100 cursor-pointer">
                  <strong className="block text-slate-800">Ano Lectivo</strong>
                  <span className="text-slate-500">{year} · A4 vertical</span>
                </button>
               
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Barra de ferramentas */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => goto(-1)} disabled={idx <= 0} className="w-8 h-8 rounded-lg border border-slate-300 flex items-center justify-center disabled:opacity-30 cursor-pointer" aria-label="Mês anterior">
              <span className="material-symbols-outlined text-lg">chevron_left</span>
            </button>
            <h2 className="font-headline text-base font-bold text-[#0b1f3a] w-44 text-center">{monthTitle}</h2>
            <button type="button" onClick={() => goto(1)} disabled={idx < 0 || idx >= months.length - 1} className="w-8 h-8 rounded-lg border border-slate-300 flex items-center justify-center disabled:opacity-30 cursor-pointer" aria-label="Mês seguinte">
              <span className="material-symbols-outlined text-lg">chevron_right</span>
            </button>
            {months.some((mo) => mo.y === isoToParts(today).y && mo.m === isoToParts(today).m) && (
              <button
                type="button"
                onClick={() => { const t = isoToParts(today); setCursor({ y: t.y, m: t.m }); setSelectedDay(today); }}
                className="ml-1 h-8 px-3 rounded-lg border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Hoje
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
            {([['calendario', 'Calendário', 'calendar_month'], ['lista', 'Lista do Ano', 'format_list_bulleted']] as const).map(([id, label, icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-1 cursor-pointer ${mode === id ? 'bg-[#0b1f3a] text-white' : 'text-slate-600 hover:text-slate-900'}`}
              >
                <span className="material-symbols-outlined text-[16px]">{icon}</span>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {months.map((mo) => {
            const active = mo.y === shown.y && mo.m === shown.m;
            const has = entriesInMonth(visible, mo.y, mo.m).length > 0;
            return (
              <button
                key={`${mo.y}-${mo.m}`}
                type="button"
                onClick={() => { setCursor(mo); setSelectedDay(null); setMode('calendario'); }}
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold whitespace-nowrap cursor-pointer border ${active ? 'bg-[#0b1f3a] text-white border-[#0b1f3a]' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
              >
                {MONTH_NAMES[mo.m].slice(0, 3)}
                {has && <span className={`inline-block w-1.5 h-1.5 rounded-full ml-1 align-middle ${active ? 'bg-amber-400' : 'bg-blue-500'}`} />}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
          {CALENDAR_CATEGORY_ORDER.map((c) => {
            const off = hidden.has(c);
            const meta = CALENDAR_CATEGORIES[c];
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggleCategory(c)}
                aria-pressed={!off}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold border flex items-center gap-1.5 cursor-pointer ${off ? 'opacity-40 border-slate-200 text-slate-500' : 'border-transparent'}`}
                style={off ? undefined : { color: meta.color, backgroundColor: `${meta.color}18` }}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: meta.color }} />
                {meta.label}
              </button>
            );
          })}
          <label className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer">
            <input type="checkbox" checked={showSettingsDates} onChange={(e) => setShowSettingsDates(e.target.checked)} />
            Incluir trimestres, provas e feriados de Configurações
          </label>
        </div>
      </div>

      {built.invalidAgendaEvents > 0 && (
        <Notice tone="warn">
          {built.invalidAgendaEvents} evento(s) da Agenda Institucional não têm uma data válida e não aparecem no calendário.
        </Notice>
      )}

      {/* Conteúdo */}
      {mode === 'calendario' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
          <div className="lg:col-span-2">{renderScreenGrid()}</div>
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-headline text-sm font-bold text-[#0b1f3a]">
                {selectedDay ? formatIsoPt(selectedDay) : `Eventos de ${MONTH_NAMES[shown.m]}`}
              </h3>
              {selectedDay && (
                <button type="button" onClick={() => setSelectedDay(null)} className="text-[11px] font-bold text-slate-500 hover:text-slate-800 cursor-pointer">
                  Ver o mês
                </button>
              )}
            </div>
            <div data-gr-cards className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
              {panelEntries.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <span className="material-symbols-outlined text-3xl text-slate-300">event_busy</span>
                  <p className="text-xs mt-1">{selectedDay ? 'Sem eventos neste dia.' : 'Sem eventos neste mês.'}</p>
                </div>
              ) : (
                panelEntries.map((e) => renderEntryRow(e, !selectedDay))
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">{renderYearList()}</div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>{visible.length} evento(s) no Ano Lectivo {year}</span>
      </div>

      {/* Documento de impressão fora da árvore da app (ver .calendar-print-root em index.css) */}
      {printScope &&
        createPortal(
          <div className="calendar-print-root">{printScope === 'mes' ? renderPrintMonth() : renderPrintYear()}</div>,
          document.body
        )}
    </div>
  );
};
