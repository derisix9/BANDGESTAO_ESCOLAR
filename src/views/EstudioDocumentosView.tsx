import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { SchoolDatabase, UserRole } from '../types';
import { SearchableSelect } from '../components/SearchableSelect';
import { BORDER_OPTIONS, PAPER_OPTIONS } from '../studio/flow';
import type { BorderKey, PaperKey } from '../studio/flow';
import { STUDIO_TABS, isCardTab, isFlowTab } from '../studio/session';
import { LEVEL_LABEL } from '../studio/data';
import type { StaffPerson } from '../studio/data';
import { hasEdits } from '../studio/state';
import { MAX_CARD_RADIUS } from '../studio/scene';
import { BG_MODES } from '../studio/bg';
import type { BgMode } from '../studio/bg';
import { printPreview } from '../studio/actions';
import { useStudio } from '../studio/useStudio';
import { FlowPaper } from '../studio/ui/FlowPaper';
import { SceneView } from '../studio/ui/SceneView';
import { CardSheets } from '../studio/ui/CardSheets';
import { TablePagination, usePagedList } from '../components/TablePagination';

interface Props {
  db: SchoolDatabase;
  currentUserRole: UserRole;
  /** Navegar para a ficha do aluno (App.tsx liga esta ação ao módulo Alunos). */
  onNavigateToStudent?: (studentId: string) => void;
}

const field = 'w-full text-xs border border-slate-200 rounded-lg px-2.5 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#0b1f3a]/20';
const label = 'block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1';
const btn = 'inline-flex items-center justify-center gap-1.5 text-xs font-bold rounded-lg px-3 py-2 transition disabled:opacity-50 disabled:cursor-not-allowed';

const Icon = ({ n, className = '' }: { n: string; className?: string }) => <span className={`material-symbols-outlined text-[18px] ${className}`}>{n}</span>;

export const EstudioDocumentosView: React.FC<Props> = ({ db, currentUserRole }) => {
  const st = useStudio(db, currentUserRole);
  const { state: s, view: v, dispatch } = st;
  const { page: pgBatchData, setPage: setPgBatchData, pageItems: visibleBatchData } = usePagedList(v.batchData ?? [], [v.batchData?.length ?? 0]);
  const { page: pgHistory, setPage: setPgHistory, pageItems: visibleHistory } = usePagedList(v.data?.history ?? [], [v.data?.history?.length ?? 0]);
  const previewRef = useRef<HTMLDivElement>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingSlot = useRef('');
  const tab = STUDIO_TABS.find((t) => t.id === s.tab)!;
  const isCard = isCardTab(s.tab);
  const isFlow = s.tab === 'certificado' || s.tab === 'declaracao';
  const onEdit = (id: string, text: string, scope: 'model' | 'doc' = 'doc') => dispatch({ type: 'edit', id, text, scope });
  const pick = (slot: string) => { pendingSlot.current = slot; fileRef.current?.click(); };

  // ---- Área de pré-visualização dimensionável (zoom, altura, largura dos controlos, ecrã inteiro) ----
  const ls = (k: string, d: number) => { try { const n = Number(localStorage.getItem('studio.' + k)); return Number.isFinite(n) && n > 0 ? n : d; } catch { return d; } };
  const [zm, setZm] = useState(() => ls('zoom', 1));
  const [ctrlW, setCtrlW] = useState(() => ls('ctrlW', 340));
  const [full, setFull] = useState(false);
  const stageRef = useRef<HTMLElement>(null);
  const clampZ = (n: number) => Math.min(3, Math.max(0.3, Math.round(n * 100) / 100));
  const setZoom = (n: number) => setZm(() => { const z = clampZ(n); try { localStorage.setItem('studio.zoom', String(z)); } catch { /* ignora */ } return z; });
  const startResizeCtrl = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = ctrlW;
    const move = (ev: PointerEvent) => setCtrlW(Math.min(560, Math.max(260, w0 + ev.clientX - x0)));
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setCtrlW((w) => { try { localStorage.setItem('studio.ctrlW', String(w)); } catch { /* ignora */ } return w; });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  useEffect(() => {
    const el = stageRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); setZoom(zm + (e.deltaY < 0 ? 0.1 : -0.1)); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zm]);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  // Transporte: só podem receber cartão os passageiros com inscrição confirmada numa rota.
  const transportStudentIds = useMemo(() => {
    if (s.tab !== 'transporte') return null;
    const set = new Set<string>();
    for (const r of db.transportRoutes || []) for (const id of r.studentIds || []) set.add(String(id));
    return set;
  }, [db.transportRoutes, s.tab]);
  const transportStaffIds = useMemo(() => {
    if (s.tab !== 'transporte') return null;
    const set = new Set<string>();
    for (const r of db.transportRoutes || []) {
      for (const id of r.teacherIds || []) set.add(`t:${id}`);
      for (const id of r.funcionarioIds || []) set.add(`f:${id}`);
    }
    return set;
  }, [db.transportRoutes, s.tab]);

  const studentOptions = useMemo(
    () => (transportStudentIds ? v.students.filter((x) => transportStudentIds.has(String(x.id))) : v.students).map((x) => ({ value: String(x.id), label: x.name, sublabel: `${x.grade || ''}${x.className ? ' · ' + x.className : ''}${x.procNumber ? ' · proc. ' + x.procNumber : ''}` })),
    [v.students, transportStudentIds]
  );

  // Crachá de funcionário: pesquisa como nos cartões + filtro por categoria de departamento.
  const [deptKind, setDeptKind] = useState<'' | 'curricular' | 'profissional'>('');
  const [deptName, setDeptName] = useState('');
  const deptOptions = useMemo(
    () => (db.departments || []).filter((d) => d.status === 'ativo' && (!deptKind || d.kind === deptKind)).map((d) => d.name).sort((a, b) => a.localeCompare(b, 'pt')),
    [db.departments, deptKind]
  );
  const staffFiltered = useMemo(
    () => v.staff.filter((p) => {
      const kindOk = !deptKind || (deptKind === 'curricular' ? p.kind === 'docente' : p.kind === 'funcionario');
      const riderOk = !transportStaffIds || transportStaffIds.has(p.id);
      return kindOk && riderOk && (!deptName || p.department === deptName);
    }),
    [v.staff, deptKind, deptName, transportStaffIds]
  );
  const staffOptions = useMemo(
    () => staffFiltered.map((p: StaffPerson) => ({ value: p.id, label: p.name, sublabel: [p.role, p.department].filter(Boolean).join(' · '), badge: p.kind === 'docente' ? 'Docente' : 'Func.' })),
    [staffFiltered]
  );

  const canBatch = tab.person === 'aluno';
  const batch = v.isBatch;
  const isBatchFlow = batch && isFlowTab(s.tab);
  const isBatchHistorico = batch && s.tab === 'historico';
  const classOptions = useMemo(
    () => (db.classes || []).map((c) => ({ value: String(c.id), label: c.name, sublabel: `${(db.students || []).filter((x) => String(x.classId) === String(c.id)).length} aluno(s)` })),
    [db.classes, db.students]
  );
  const firstScene = v.cardItems[0]?.front;

  // Selector de docentes/funcionários (crachás e, no transporte, os inscritos na rota).
  const staffPicker = (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={label}>Categoria</label>
          <select className={field} value={deptKind} onChange={(e) => { setDeptKind(e.target.value as typeof deptKind); setDeptName(''); }}>
            <option value="">Todas</option>
            <option value="curricular">Curricular (docentes)</option>
            <option value="profissional">Profissional (funcionários)</option>
          </select>
        </div>
        <div>
          <label className={label}>Departamento</label>
          <select className={field} value={deptName} onChange={(e) => setDeptName(e.target.value)}>
            <option value="">Todos</option>
            {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>
      <SearchableSelect
        label={s.tab === 'transporte' ? `Docentes/Funcionários inscritos (${staffFiltered.length})` : `Funcionários (${staffFiltered.length})`}
        options={staffOptions}
        value=""
        onChange={(id) => { if (id && !s.staffIds.includes(id)) dispatch({ type: 'staff', ids: [...s.staffIds, id] }); }}
        placeholder={s.tab === 'transporte' ? 'Só aparecem inscritos confirmados no transporte…' : 'Pesquisar funcionário por nome, cargo ou departamento…'}
        emptyMessage={s.tab === 'transporte' ? 'Nenhum docente/funcionário inscrito nesta categoria/departamento' : 'Nenhum funcionário nesta categoria/departamento'}
      />
      {staffFiltered.length > 0 && (
        <button className="text-[11px] font-bold text-[#0b1f3a] hover:underline" onClick={() => dispatch({ type: 'staff', ids: [...new Set([...s.staffIds, ...staffFiltered.map((p) => p.id)])] })}>
          + Seleccionar todos ({staffFiltered.length})
        </button>
      )}
      {v.staffSelected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {v.staffSelected.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 text-[11px] bg-slate-100 border border-slate-200 rounded-full pl-2.5 pr-1 py-0.5">
              {p.name}
              <button title="Remover" className="w-4 h-4 rounded-full hover:bg-slate-300 flex items-center justify-center" onClick={() => dispatch({ type: 'staff', ids: s.staffIds.filter((x) => x !== p.id) })}>
                <Icon n="close" className="!text-[12px]" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );

  const print = async () => {
    const ready = await st.issueOnly();
    if (!ready) return;
    await new Promise((r) => setTimeout(r, 600)); // deixa o QR oficial desenhar-se antes de imprimir
    printPreview(batch ? printRef.current : previewRef.current, { landscape: s.tab === 'diploma' || (batch && !!firstScene && firstScene.h > firstScene.w), title: tab.label, sheets: batch });
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-[#0b1f3a]">ESTÚDIO DE EMISSÃO DE DOCUMENTOS</h1>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {STUDIO_TABS.map((t) => (
          <button key={t.id} onClick={() => st.setTab(t.id)} className={`flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide cursor-pointer border-b-2 -mb-px ${t.id === s.tab ? 'border-[#0b1f3a] text-[#0b1f3a]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            <Icon n={t.icon} /> {t.label} <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{t.output}</span>
          </button>
        ))}
      </div>

      {st.notice && (
        <div className={`px-3 py-2 rounded-lg text-xs font-semibold border ${st.notice.ok ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'}`}>{st.notice.text}</div>
      )}

      <div className={full ? '' : 'grid gap-4 lg:grid-cols-[var(--ctrl-w)_minmax(0,1fr)] items-start'} style={{ ['--ctrl-w' as string]: ctrlW + 'px' }}>
        {/* ------------------------------ Controlos ------------------------------ */}
        <aside className={`space-y-3 bg-white border border-slate-200 rounded-xl p-3 ${full ? 'hidden' : ''}`}>
          {canBatch && (
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
              {([['aluno', 'Um aluno', 'person'], ['turma', 'Turma inteira', 'groups']] as const).map(([k, l, ic]) => (
                <button key={k} onClick={() => dispatch({ type: 'scope', scope: k })} className={`${btn} ${s.scope === k ? 'bg-white text-[#0b1f3a] shadow-sm' : 'text-slate-500'}`}><Icon n={ic} /> {l}</button>
              ))}
            </div>
          )}
          {batch ? (
            <div>
              <SearchableSelect label="Turma" options={classOptions} value={s.classId} onChange={(id) => dispatch({ type: 'classId', classId: id })} placeholder="Escolher a turma…" />
              {v.batchStudents.length > 0 && (
                <p className="text-[11px] text-slate-500 mt-1.5">
                  {v.batchStudents.length} {s.tab === 'diploma' ? 'diplomas · 1 por folha A4 paisagem.'
                    : isBatchFlow ? 'documentos · cada aluno numa página do mesmo Word.'
                    : s.tab === 'historico' ? 'históricos · cada aluno numa secção do mesmo PDF.'
                    : `cartões · ${Math.ceil(v.batchStudents.length / 8)} folha(s) A4 com 8 cartões, frente e verso.`}
                </p>
              )}
            </div>
          ) : tab.person === 'aluno' ? (
            <>
              <SearchableSelect
                label={s.tab === 'transporte' ? `Aluno inscrito no transporte (${studentOptions.length})` : 'Aluno'}
                options={studentOptions}
                value={s.studentId}
                onChange={(id) => st.pickStudent(id)}
                placeholder={s.tab === 'transporte' ? 'Só aparecem alunos com inscrição confirmada…' : 'Pesquisar aluno por nome ou processo…'}
                emptyMessage={s.tab === 'transporte' ? 'Nenhum aluno com inscrição confirmada — inscreva-o em Transporte Escolar' : 'Nenhum aluno encontrado'}
              />
              {s.tab === 'transporte' && staffPicker}
            </>
          ) : (
            staffPicker
          )}

          {v.data && !batch && tab.person === 'aluno' && (
            <p className="text-[11px] text-slate-500">{v.data.enrollment.grade || 'Sem classe'} · {v.level ? LEVEL_LABEL[v.level] : ''} · {v.data.history.length} ano(s) no histórico</p>
          )}

          {tab.person === 'aluno' && (v.data || batch) && (
            <div>
              <label className={label}>Ano lectivo</label>
              <select className={field} value={s.year || db.settings?.currentAcademicYear || v.data?.enrollment.year || ''} onChange={(e) => dispatch({ type: 'year', year: e.target.value })}>
                {(v.years.length ? v.years : [db.settings?.currentAcademicYear || '']).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          )}

          {(isCard || isFlow) && (
            <div>
              <label className={label}>Modelo</label>
              <div className="grid gap-1.5 max-h-80 overflow-auto pr-1">
                {(isCard ? v.cardModels : v.flowModels).map((m) => {
                  const on = (v.cardModel?.id || v.flowModel?.id) === m.id;
                  const sw = 'swatch' in m ? m.swatch : undefined;
                  return (
                    <button key={m.id} onClick={() => dispatch({ type: 'model', modelId: m.id })} className={`text-left rounded-lg border px-2.5 py-2 flex gap-2 items-center ${on ? 'border-[#0b1f3a] bg-slate-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                      {sw && <span className="w-6 h-8 rounded shrink-0" style={{ background: `linear-gradient(135deg, ${sw[0]}, ${sw[1]})` }} />}
                      <span className="min-w-0"><span className="block text-xs font-bold text-slate-800 truncate">{m.name}</span><span className="block text-[10px] text-slate-500 line-clamp-2">{m.description}</span></span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {isFlow && v.flowModel && (
            <>
              {v.flowModel.classes.length > 1 && (
                <div>
                  <label className={label}>Classe</label>
                  <select className={field} value={s.classNum ?? ''} onChange={(e) => dispatch({ type: 'class', classNum: e.target.value ? Number(e.target.value) : null })}>
                    {v.flowModel.classes.map((c) => <option key={c} value={c}>{c}.ª Classe</option>)}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div><label className={label}>Moldura</label>
                  <select className={field} value={s.page.border ?? v.flowModel.defaultPage.border} onChange={(e) => dispatch({ type: 'page', patch: { border: e.target.value as BorderKey } })}>
                    {BORDER_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select></div>
                <div><label className={label}>Papel</label>
                  <select className={field} value={s.page.paper ?? v.flowModel.defaultPage.paper} onChange={(e) => dispatch({ type: 'page', patch: { paper: e.target.value as PaperKey, customPaper: undefined } })}>
                    {PAPER_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select></div>
                <div><label className={label}>Cor da moldura</label>
                  <input type="color" className="w-full h-9 rounded-lg border border-slate-200 cursor-pointer bg-white"
                    value={s.page.borderColor || BORDER_OPTIONS.find((o) => o.key === (s.page.border ?? v.flowModel!.defaultPage.border))?.color || '#000000'}
                    onChange={(e) => dispatch({ type: 'page', patch: { borderColor: e.target.value } })} /></div>
                <div><label className={label}>Cor do papel (fundo)</label>
                  <input type="color" className="w-full h-9 rounded-lg border border-slate-200 cursor-pointer bg-white"
                    value={s.page.customPaper || PAPER_OPTIONS.find((o) => o.key === (s.page.paper ?? v.flowModel!.defaultPage.paper))?.color || '#FFFFFF'}
                    onChange={(e) => dispatch({ type: 'page', patch: { customPaper: e.target.value } })} /></div>
              </div>
              {(s.page.borderColor || s.page.customPaper) && (
                <button className="text-[11px] font-bold text-[#0b1f3a] hover:underline" onClick={() => dispatch({ type: 'page', patch: { borderColor: undefined, customPaper: undefined } })}>Repor cores do modelo</button>
              )}
              {s.extras && (
                <div className="grid grid-cols-2 gap-2">
                  <div><label className={label}>Livro</label><input className={field} value={s.extras.livro} onChange={(e) => dispatch({ type: 'extras', patch: { livro: e.target.value } })} /></div>
                  <div><label className={label}>Folha</label><input className={field} value={s.extras.folha} onChange={(e) => dispatch({ type: 'extras', patch: { folha: e.target.value } })} /></div>
                </div>
              )}
              {s.tab === 'declaracao' && (
                <div><label className={label}>Fim a que se destina</label><input className={field} placeholder="Ex.: fins militares, bolsa de estudo…" value={s.purpose} onChange={(e) => { dispatch({ type: 'field', field: 'purpose', value: e.target.value }); dispatch({ type: 'extras', patch: { purpose: e.target.value } }); }} /></div>
              )}
            </>
          )}

          {isCard && (
            <>
              <div><label className={label}>Lados</label>
                <select className={field} value={s.sides} onChange={(e) => dispatch({ type: 'sides', sides: e.target.value as typeof s.sides })}>
                  <option value="ambos">Frente e verso</option><option value="frente">Só frente</option><option value="verso">Só verso</option>
                </select></div>
              {s.tab !== 'diploma' && (
                <div>
                  <label className={label}>Posição do cartão</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {([['h', 'Horizontal', 'crop_landscape'], ['v', 'Vertical', 'crop_portrait']] as const).map(([o, l, ic]) => {
                      const on = (v.cardOrient || 'h') === o;
                      const usable = o === v.cardModel?.orientation || v.hasAlt;
                      return (
                        <button key={o} type="button" disabled={!usable} onClick={() => dispatch({ type: 'orientation', orientation: o })}
                          className={`${btn} border ${on ? 'border-[#0b1f3a] bg-[#0b1f3a] text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
                          <Icon n={ic} className="!text-[16px]" />{l}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {s.tab === 'estudante' && (
                <div>
                  <label className={label}>Verso do cartão</label>
                  <select className={field} value={s.backSide} onChange={(e) => dispatch({ type: 'backSide', side: e.target.value as typeof s.backSide })}>
                    <option value="padrao">Padrão (normas de utilização + QR)</option>
                    <option value="talao">Talão de propinas (10 meses · RUPE)</option>
                  </select>
                  {s.backSide === 'talao' && <p className="text-[10px] text-slate-500 mt-1">Os meses pagos (com recibo) saem preenchidos a partir da Tesouraria; os restantes ficam para o carimbo/RUPE.</p>}
                </div>
              )}
              {s.tab === 'transporte' && (
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 space-y-1">
                  <span className={label + ' !mb-0'}>Rota, turno e QR</span>
                  <p className="text-[10px] text-slate-500 leading-snug">
                    Saem da inscrição em <b>Transporte Escolar</b>. O QR do cartão grava a pessoa, a rota, o turno e o ano —
                    a aplicação do motorista valida inscrição, mensalidade do mês e embarque único por dia.
                  </p>
                </div>
              )}
              {s.tab === 'diploma' && (
                <div><label className={label}>Texto de outorga</label><textarea rows={3} className={field} value={s.outorga ?? ''} placeholder="Deixe vazio para o texto padrão" onChange={(e) => dispatch({ type: 'field', field: 'outorga', value: e.target.value || null })} /></div>
              )}

              {/* ------------------------- Arredondamento das bordas ------------------------- */}
              {s.tab !== 'diploma' && (
                <div className="border border-slate-200 rounded-lg p-2.5 space-y-1.5 bg-slate-50/60">
                  <div className="flex items-center justify-between">
                    <span className={label + ' !mb-0'}>Arredondamento das bordas</span>
                    <span className="text-[11px] font-bold tabular-nums text-slate-600">{s.radius == null ? 'Modelo' : s.radius === 0 ? 'Quadrado' : `${s.radius} mm`}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button type="button" title="Menos arredondado" className={`${btn} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 !px-2 !py-1`}
                      onClick={() => dispatch({ type: 'radius', radius: Math.max(0, (s.radius ?? 3) - 0.5) })}><Icon n="remove" /></button>
                    <input type="range" min={0} max={MAX_CARD_RADIUS} step={0.5} value={s.radius ?? 3} className="flex-1 accent-[#0b1f3a]" aria-label="Arredondamento das bordas"
                      onChange={(e) => dispatch({ type: 'radius', radius: Number(e.target.value) })} />
                    <button type="button" title="Mais arredondado" className={`${btn} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 !px-2 !py-1`}
                      onClick={() => dispatch({ type: 'radius', radius: Math.min(MAX_CARD_RADIUS, (s.radius ?? 3) + 0.5) })}><Icon n="add" /></button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className={`${btn} flex-1 basis-[7.5rem] border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 !py-1`} onClick={() => dispatch({ type: 'radius', radius: 0 })}><Icon n="crop_square" /> Quadrado</button>
                    <button type="button" className={`${btn} flex-1 basis-[7.5rem] border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 !py-1`} onClick={() => dispatch({ type: 'radius', radius: 6 })}><Icon n="rounded_corner" /> Redondo</button>
                    <button type="button" className={`${btn} flex-1 basis-[7.5rem] border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 !py-1`} onClick={() => dispatch({ type: 'radius', radius: null })}><Icon n="undo" /> Modelo</button>
                  </div>
                </div>
              )}

              {/* ------------------------- Fundo personalizado ------------------------- */}
              <div className="border border-slate-200 rounded-lg p-2.5 space-y-2 bg-slate-50/60">
                <span className={label}>Fundo do {s.tab === 'diploma' ? 'diploma' : 'cartão'}</span>
                <div className="grid grid-cols-4 gap-1">
                  {BG_MODES.map((m) => (
                    <button key={m.key} onClick={() => dispatch({ type: 'bg', patch: { mode: m.key as BgMode } })}
                      className={`${btn} !px-1 flex-col !gap-0.5 border ${s.bg.mode === m.key ? 'bg-[#0b1f3a] text-white border-[#0b1f3a]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                      <Icon n={m.icon} className="!text-[16px]" /><span className="text-[9px] leading-tight">{m.label}</span>
                    </button>
                  ))}
                </div>
                {s.bg.mode === 'cor' && (
                  <div><label className={label}>Cor de fundo</label>
                    <input type="color" className="w-full h-9 rounded-lg border border-slate-200 cursor-pointer bg-white" value={s.bg.color} onChange={(e) => dispatch({ type: 'bg', patch: { color: e.target.value } })} /></div>
                )}
                {s.bg.mode === 'gradiente' && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className={label}>Cor inicial</label>
                        <input type="color" className="w-full h-9 rounded-lg border border-slate-200 cursor-pointer bg-white" value={s.bg.color} onChange={(e) => dispatch({ type: 'bg', patch: { color: e.target.value } })} /></div>
                      <div><label className={label}>Cor final</label>
                        <input type="color" className="w-full h-9 rounded-lg border border-slate-200 cursor-pointer bg-white" value={s.bg.color2} onChange={(e) => dispatch({ type: 'bg', patch: { color2: e.target.value } })} /></div>
                    </div>
                    <div><label className={label}>Ângulo ({s.bg.angle}°)</label>
                      <input type="range" min={0} max={360} step={5} className="w-full" value={s.bg.angle} onChange={(e) => dispatch({ type: 'bg', patch: { angle: Number(e.target.value) } })} /></div>
                  </div>
                )}
                {s.bg.mode === 'imagem' && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      <button onClick={() => pick('fundo')} className={`${btn} border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 flex-1`}>
                        <Icon n={s.images.fundo ? 'check_circle' : 'upload'} className={s.images.fundo ? 'text-emerald-600' : ''} /> {s.images.fundo ? 'Trocar imagem' : 'Carregar imagem'}
                      </button>
                      {s.images.fundo && (
                        <button onClick={() => dispatch({ type: 'image', slot: 'fundo' })} title="Remover imagem de fundo" className={`${btn} border border-slate-200 bg-white text-red-500 hover:bg-red-50`}><Icon n="delete" /></button>
                      )}
                    </div>
                    {!s.images.fundo && <p className="text-[10px] text-amber-700">Carregue uma imagem: ela cobre a folha toda, por baixo do texto.</p>}
                    <div><label className={label}>Ajuste da imagem</label>
                      <select className={field} value={s.bg.fit} onChange={(e) => dispatch({ type: 'bg', patch: { fit: e.target.value as 'cover' | 'stretch' } })}>
                        <option value="cover">Preencher a folha (corta o excesso)</option>
                        <option value="stretch">Esticar à folha inteira</option>
                      </select></div>
                    <div><label className={label}>Véu branco para leitura ({Math.round(s.bg.veil * 100)}%)</label>
                      <input type="range" min={0} max={0.85} step={0.05} className="w-full" value={s.bg.veil} onChange={(e) => dispatch({ type: 'bg', patch: { veil: Number(e.target.value) } })} /></div>
                  </div>
                )}
                {s.bg.mode !== 'modelo' && s.tab !== 'diploma' && (
                  <label className="flex items-center gap-2 text-[11px] text-slate-700">
                    <input type="checkbox" checked={s.bg.back} onChange={(e) => dispatch({ type: 'bg', patch: { back: e.target.checked } })} /> Aplicar também no verso
                  </label>
                )}
              </div>
            </>
          )}

          {s.tab === 'historico' && (
            <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={s.trimestres} onChange={(e) => dispatch({ type: 'trimestres', on: e.target.checked })} /> Incluir notas por trimestre</label>
          )}

          <div>
            <span className={label}>Imagens</span>
            <div className="flex flex-wrap gap-1.5">
              {['brasao', 'logo', 'assinatura', ...(isCard ? ['foto'] : [])].map((slot) => (
                <button key={slot} onClick={() => pick(slot)} className={`${btn} border border-slate-200 bg-white text-slate-600 hover:bg-slate-50`}>
                  <Icon n={s.images[slot] ? 'check_circle' : 'upload'} className={s.images[slot] ? 'text-emerald-600' : ''} /> {slot === 'brasao' ? 'Brasão' : slot === 'logo' ? 'Logótipo' : slot === 'assinatura' ? 'Assinatura' : 'Foto'}
                </button>
              ))}
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) st.pickImage(pendingSlot.current, f); e.target.value = ''; }} />
          </div>

          <div className="border-t border-slate-100 pt-3 space-y-2">
            {v.docType ? (
              <p className="text-[11px] text-slate-600 flex items-center gap-1.5">
                <Icon n={s.issued ? 'verified' : 'tag'} className={s.issued ? 'text-emerald-600' : 'text-slate-400'} />
                {s.issued ? <>Registado: <b>{s.issued.number}</b> · {s.issued.code}</> : <>Próximo número: <b>{v.nextNumber}</b> (atribuído ao exportar)</>}
              </p>
            ) : <p className="text-[11px] text-slate-500">Os crachás de funcionário não geram registo numerado.</p>}
            {v.docType && !st.canIssue && <p className="text-[11px] text-amber-700">O seu perfil não tem permissão para emitir documentos numerados.</p>}
            {v.warnings.map((w, i) => <p key={i} className="text-[11px] text-amber-700">⚠ {w}</p>)}
            {v.blockers.map((w, i) => <p key={i} className="text-[11px] text-slate-500">{w}</p>)}
            <div className="flex flex-wrap gap-2">
              <button className={`${btn} bg-[#0b1f3a] text-white hover:bg-[#12305a] flex-1`} disabled={st.busy || v.blockers.length > 0 || (!!v.docType && !st.canIssue)} onClick={st.exportCurrent}>
                <Icon n="download" /> Exportar {tab.output}
              </button>
              {s.tab !== 'historico' && (
                <button className={`${btn} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`} disabled={st.busy || v.blockers.length > 0 || (!!v.docType && !st.canIssue)} onClick={print}><Icon n="print" /> Imprimir</button>
              )}
              {hasEdits(s) && <button className={`${btn} border border-slate-200 bg-white text-slate-600 hover:bg-slate-50`} onClick={() => dispatch({ type: 'resetEdits' })}><Icon n="undo" /> Repor textos</button>}
            </div>
          </div>
        </aside>

        {/* ---------------------------- Pré-visualização ---------------------------- */}
        <div className={full ? 'fixed inset-0 z-[200] bg-slate-100 flex flex-col' : 'relative min-w-0'}>
          {/* Barra divisória: arraste para alargar/estreitar os controlos */}
          {!full && (
            <div onPointerDown={startResizeCtrl} onDoubleClick={() => { setCtrlW(340); try { localStorage.setItem('studio.ctrlW', '340'); } catch { /* ignora */ } }}
              title="Arraste para redimensionar (duplo clique repõe)" className="hidden lg:flex absolute -left-3 top-0 bottom-0 w-3 cursor-col-resize items-center justify-center group z-10">
              <span className="w-1 h-12 rounded bg-slate-300 group-hover:bg-[#0b1f3a]/60 transition" />
            </div>
          )}
          {/* Barra de ferramentas da área de edição */}
          <div data-no-print className={`flex flex-wrap items-center gap-1.5 bg-white border border-slate-200 px-2 py-1.5 ${full ? 'rounded-none border-x-0 border-t-0' : 'rounded-t-xl border-b-0'}`}>
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mr-1">Área de edição</span>
            <button type="button" title="Reduzir zoom" onClick={() => setZoom(zm - 0.1)} className={`${btn} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 !px-2 !py-1`}><Icon n="zoom_out" /></button>
            <input type="range" min={30} max={300} step={5} value={Math.round(zm * 100)} onChange={(e) => setZoom(Number(e.target.value) / 100)} className="w-28 sm:w-40 accent-[#0b1f3a]" aria-label="Zoom" />
            <button type="button" title="Aumentar zoom" onClick={() => setZoom(zm + 0.1)} className={`${btn} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 !px-2 !py-1`}><Icon n="zoom_in" /></button>
            <button type="button" title="Repor zoom a 100%" onClick={() => setZoom(1)} className="text-[11px] font-bold tabular-nums text-slate-600 hover:text-[#0b1f3a] w-12 text-center">{Math.round(zm * 100)}%</button>
            <span className="hidden md:inline text-[10px] text-slate-400">Ctrl + roda do rato = zoom</span>
            <button type="button" onClick={() => setFull((f) => !f)} title={full ? 'Sair do ecrã inteiro (Esc)' : 'Expandir área de edição'} className={`${btn} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 !px-2 !py-1 ml-auto`}>
              <Icon n={full ? 'close_fullscreen' : 'open_in_full'} /> {full ? 'Sair (Esc)' : 'Ecrã inteiro'}
            </button>
          </div>
        <section ref={stageRef} style={full ? undefined : { height: 'max(520px, calc(100vh - 230px))', minHeight: 360, maxHeight: '300vh', resize: 'vertical' }} className={`bg-slate-100 border border-slate-200 p-4 overflow-auto ${full ? 'flex-1 rounded-none border-0' : 'rounded-b-xl'}`}>
          {v.flowDoc ? (
            <div className="space-y-3">
              {isBatchFlow && (
                <p data-no-print className="text-[11px] text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-2">
                  A pré-visualização mostra o 1.º aluno da turma ({v.batchData[0]?.person.name}). O Word exportado traz os <b>{v.batchFlowDocs.length}</b> alunos, um por página, todos com este modelo, moldura e papel.
                </p>
              )}
              <div ref={previewRef} className="flex justify-center">
                <FlowPaper doc={v.flowDoc} images={s.images} overrides={v.overrides} onEdit={(id, html) => onEdit(id, html)} onPickImage={pick} watermarkSrc={s.images.brasao} zoom={0.9 * zm} />
              </div>
              {isBatchFlow && (
                <div ref={printRef} aria-hidden style={{ position: 'absolute', left: -99999, top: 0, width: 0, height: 0, overflow: 'hidden' }}>
                  {v.batchFlowDocs.map((d, i) => (
                    <FlowPaper key={i} doc={d} images={s.images} overrides={v.overrides} watermarkSrc={s.images.brasao} zoom={1} />
                  ))}
                </div>
              )}
            </div>
          ) : batch && v.cardItems.length ? (
            <>
              <div ref={previewRef}>
                <CardSheets items={v.cardItems} photos={v.photos} images={s.images} overrides={v.overrides} sides={s.sides} batch zoom={0.55 * zm} onEdit={onEdit} onPickImage={pick} />
              </div>
              <div ref={printRef} aria-hidden style={{ position: 'absolute', left: -99999, top: 0, width: 0, height: 0, overflow: 'hidden' }}>
                <CardSheets items={v.cardItems} photos={v.photos} images={s.images} overrides={v.overrides} sides={s.sides} batch zoom={1} />
              </div>
            </>
          ) : isCard && v.cardItems.length ? (
            <div ref={previewRef} className="flex flex-wrap gap-5 justify-center">
              {v.cardItems.map((it, i) => (
                <div key={i} className="flex flex-wrap gap-4 justify-center">
                  {s.sides !== 'verso' && <SceneView scene={it.front} images={s.images} photo={v.photos[i] || s.images.foto} overrides={v.overrides} onEdit={onEdit} onPickImage={pick} zoom={(s.tab === 'diploma' ? 1.5 : 2) * zm} />}
                  {s.sides !== 'frente' && it.back && <SceneView scene={it.back} images={s.images} photo={v.photos[i] || s.images.foto} overrides={v.overrides} onEdit={onEdit} onPickImage={pick} zoom={(s.tab === 'diploma' ? 1.5 : 2) * zm} />}
                </div>
              ))}
            </div>
          ) : s.tab === 'historico' && (v.data || isBatchHistorico) ? (
            <div className="bg-white rounded-lg p-4 text-xs space-y-2 max-w-2xl mx-auto">
              {isBatchHistorico ? (
                <>
                  <p className="font-bold text-[#0b1f3a] text-sm">Históricos Académicos — turma inteira ({v.batchData.length} alunos)</p>
                  <p className="text-slate-500">O PDF exportado traz o histórico de cada aluno a começar em página nova, com quadro-resumo e QR de validação numerado.</p>
                  <table className="w-full border-collapse">
                    <thead><tr className="text-left text-slate-500 border-b"><th className="py-1">Aluno</th><th>Classe</th><th>Anos</th><th>Registo</th></tr></thead>
                    <tbody>{visibleBatchData.map((d) => (
                      <tr key={d.person.id} className="border-b border-slate-100">
                        <td className="py-1">{d.person.name}</td><td>{d.enrollment.grade || '—'}</td><td>{d.history.length}</td>
                        <td className="font-mono text-[10px]">{s.batchIssued[d.person.id]?.number || '—'}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                  <TablePagination total={v.batchData.length} page={pgBatchData} onPageChange={setPgBatchData} />
                </>
              ) : v.data ? (
                <>
                  <p className="font-bold text-[#0b1f3a] text-sm">Histórico Académico — {v.data.person.name}</p>
                  <p className="text-slate-500">O histórico é gerado em PDF paginado, com quadro-resumo e QR de validação.</p>
                  <table className="w-full border-collapse">
                    <thead><tr className="text-left text-slate-500 border-b"><th className="py-1">Ano</th><th>Classe</th><th>Média</th><th>Resultado</th></tr></thead>
                    <tbody>{visibleHistory.map((h) => <tr key={h.year} className="border-b border-slate-100"><td className="py-1">{h.year}</td><td>{h.grade}</td><td>{h.finalAverage ?? '—'}</td><td>{h.result}</td></tr>)}</tbody>
                  </table>
                  <TablePagination total={v.data.history.length} page={pgHistory} onPageChange={setPgHistory} />
                </>
              ) : null}
            </div>
          ) : (
            <div className="h-full min-h-[280px] flex flex-col items-center justify-center text-slate-400 gap-2">
              <Icon n={tab.icon} className="!text-[40px]" />
              <p className="text-xs font-semibold">{batch ? (s.tab === 'transporte' ? 'Escolha a turma — saem só os alunos com inscrição confirmada no transporte.' : 'Escolha a turma para pré-visualizar.') : tab.person === 'aluno' ? (s.tab === 'transporte' ? 'Escolha um passageiro inscrito no transporte para ver o cartão.' : 'Escolha um aluno para ver o documento.') : 'Escolha um ou mais funcionários para ver o crachá.'}</p>
            </div>
          )}
        </section>
        </div>
      </div>
    </div>
  );
};
