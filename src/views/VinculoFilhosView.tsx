import React, { useMemo, useState } from 'react';
import { GuardianRelation, GuardianUnlinkReason, SchoolDatabase, Student, User, UserRole } from '../types';
import { dbService } from '../services/db';
import { runGlobalOperation } from '../context/OperationContext';
import { useAccessControl } from '../hooks/useAccessControl';
import { FormModalHeader } from '../components/FormModalHeader';
import { SearchableSelect } from '../components/SearchableSelect';
import {
  GUARDIAN_RELATION_LABELS,
  UNLINK_REASON_LABELS,
  relationFromText,
  relationLabel,
  resolveGuardianChildren,
  studentsWithoutGuardianAccess,
  suggestStudentsForGuardian
} from '../utils/guardianLinks';
import { TablePagination, usePagedList } from '../components/TablePagination';
import { Notice } from '../components/Notice';

interface VinculoFilhosViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
  currentUser?: User;
}

type Tab = 'encarregados' | 'sem_acesso' | 'historico';

interface LinkForm {
  guardianUserId: string;
  studentId: string;
  /** '' = ainda por escolher (nunca se grava uma relação que ninguém indicou). */
  relation: GuardianRelation | '';
  relationOther: string;
  financialResponsible: boolean;
  notes: string;
}

const emptyLinkForm = (): LinkForm => ({
  guardianUserId: '',
  studentId: '',
  relation: '',
  relationOther: '',
  financialResponsible: false,
  notes: ''
});

const inputCls =
  'w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs';
const labelCls = 'block uppercase font-bold text-slate-700 mb-1 text-[11px]';

/** Relação sugerida pela ficha do aluno: só preenche quando a ficha diz alguma coisa. */
function relationPreset(student?: Student): Pick<LinkForm, 'relation' | 'relationOther'> {
  const text = (student?.guardianRelation || '').trim();
  if (!text) return { relation: '', relationOther: '' };
  const relation = relationFromText(text);
  return { relation, relationOther: relation === 'outro' ? text : '' };
}

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('pt-PT') : '—');

export const VinculoFilhosView: React.FC<VinculoFilhosViewProps> = ({ db, currentUserRole }) => {
  const acl = useAccessControl(currentUserRole);
  const canManage = acl.can('vinculos.manage');

  const [tab, setTab] = useState<Tab>('encarregados');
  const [search, setSearch] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkForm, setLinkForm] = useState<LinkForm>(emptyLinkForm());
  const [linkError, setLinkError] = useState('');
  const [unlinkTarget, setUnlinkTarget] = useState<{ guardian: User; student: Student; fromRecord: boolean } | null>(null);
  const [unlinkReason, setUnlinkReason] = useState<GuardianUnlinkReason>('mudanca_encarregado');
  const [unlinkNotes, setUnlinkNotes] = useState('');
  const [unlinkError, setUnlinkError] = useState('');

  const students = db.students || [];
  const links = db.guardianLinks || [];
  const guardians = useMemo(
    () => (db.users || []).filter((u) => u.role === 'encarregado').sort((a, b) => a.name.localeCompare(b.name, 'pt')),
    [db.users]
  );

  const childrenByGuardian = useMemo(() => {
    const map = new Map<string, ReturnType<typeof resolveGuardianChildren>>();
    guardians.forEach((g) => map.set(g.id, resolveGuardianChildren(g, students, links)));
    return map;
  }, [guardians, students, links]);

  const suggestionsByGuardian = useMemo(() => {
    const map = new Map<string, ReturnType<typeof suggestStudentsForGuardian>>();
    guardians.forEach((g) => map.set(g.id, suggestStudentsForGuardian(g, students, links)));
    return map;
  }, [guardians, students, links]);

  const withoutAccess = useMemo(() => studentsWithoutGuardianAccess(guardians, students, links), [guardians, students, links]);
  const history = useMemo(
    () =>
      links
        .filter((l) => l.status === 'desvinculado')
        .sort((a, b) => (b.unlinkedAt || '').localeCompare(a.unlinkedAt || '')),
    [links]
  );

  const q = search.trim().toLowerCase();
  const filteredGuardians = guardians.filter((g) => {
    if (!q) return true;
    const kids = (childrenByGuardian.get(g.id) || []).map((c) => c.student.name.toLowerCase()).join(' ');
    return g.name.toLowerCase().includes(q) || (g.email || '').toLowerCase().includes(q) || kids.includes(q);
  });
  const filteredWithout = withoutAccess.filter(
    (s) => !q || s.name.toLowerCase().includes(q) || (s.guardianName || '').toLowerCase().includes(q) || s.procNumber.toLowerCase().includes(q)
  );
  const { page: pgFilteredWithout, setPage: setPgFilteredWithout, pageItems: visibleFilteredWithout } = usePagedList(filteredWithout, [filteredWithout.length]);
  const filteredHistory = history.filter(
    (l) => !q || l.guardianName.toLowerCase().includes(q) || l.studentName.toLowerCase().includes(q)
  );
  const { page: pgFilteredHistory, setPage: setPgFilteredHistory, pageItems: visibleFilteredHistory } = usePagedList(filteredHistory, [filteredHistory.length]);

  const totalActiveLinks = links.filter((l) => l.status === 'ativo').length;
  const totalSuggestions = Array.from(suggestionsByGuardian.values()).reduce((n, list) => n + list.length, 0);

  // ---- ações -------------------------------------------------------------
  const run = async (action: () => void, loadingMessage: string, successMessage: string) => {
    try {
      await runGlobalOperation(action, { loadingMessage, successMessage, requiredRule: 'vinculos.manage', userRole: currentUserRole });
      return { ok: true, error: '' };
    } catch (err: any) {
      return { ok: false, error: err?.message || '' };
    }
  };

  const openLink = (preset?: Partial<LinkForm>) => {
    const base = { ...emptyLinkForm(), ...preset };
    if (!preset?.relation) Object.assign(base, relationPreset(students.find((s) => s.id === base.studentId)));
    setLinkForm(base);
    setLinkError('');
    setLinkOpen(true);
  };

  const submitLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkForm.guardianUserId) return setLinkError('Escolha a conta do Encarregado de Educação.');
    if (!linkForm.studentId) return setLinkError('Escolha o educando.');
    if (!linkForm.relation) return setLinkError('Indique a relação do Encarregado com o aluno.');
    const relation = linkForm.relation;
    let failure = '';
    const result = await run(
      () => {
        const r = dbService.linkGuardianToStudent({
          guardianUserId: linkForm.guardianUserId,
          studentId: linkForm.studentId,
          relation,
          relationOther: linkForm.relationOther,
          financialResponsible: linkForm.financialResponsible,
          notes: linkForm.notes
        });
        if (!r.success) {
          failure = r.error || '';
          throw new Error(r.error);
        }
      },
      'A vincular educando...',
      'Educando vinculado com sucesso!'
    );
    if (result.ok) setLinkOpen(false);
    else setLinkError(failure || result.error || 'Não foi possível vincular.');
  };

  const openUnlink = (guardian: User, student: Student, fromRecord: boolean) => {
    setUnlinkTarget({ guardian, student, fromRecord });
    setUnlinkReason('mudanca_encarregado');
    setUnlinkNotes('');
    setUnlinkError('');
  };

  const submitUnlink = async () => {
    if (!unlinkTarget) return;
    const { guardian, student } = unlinkTarget;
    let failure = '';
    const result = await run(
      () => {
        const r = dbService.unlinkGuardianFromStudent({
          guardianUserId: guardian.id,
          studentId: student.id,
          reason: unlinkReason,
          notes: unlinkNotes
        });
        if (!r.success) {
          failure = r.error || '';
          throw new Error(r.error);
        }
      },
      'A desvincular educando...',
      'Educando desvinculado.'
    );
    if (result.ok) setUnlinkTarget(null);
    else setUnlinkError(failure || result.error || 'Não foi possível desvincular.');
  };

  // Educandos elegíveis no modal: os que a conta escolhida ainda não vê.
  const studentOptions = useMemo(() => {
    const guardian = guardians.find((g) => g.id === linkForm.guardianUserId);
    const hasAccess = new Set(
      guardian ? (childrenByGuardian.get(guardian.id) || []).filter((c) => c.source === 'vinculo').map((c) => c.student.id) : []
    );
    return students
      .filter((s) => s.status !== 'transferred' && !hasAccess.has(s.id))
      .map((s) => ({
        value: s.id,
        label: s.name,
        sublabel: `Nº ${s.procNumber}${s.className ? ' · ' + s.className : ''}${s.guardianName ? ' · Enc. na ficha: ' + s.guardianName : ''}`
      }));
  }, [students, guardians, linkForm.guardianUserId, childrenByGuardian]);

  const guardianOptions = useMemo(
    () => guardians.map((g) => ({ value: g.id, label: g.name, sublabel: g.email })),
    [guardians]
  );

  // ---- render ------------------------------------------------------------
  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">SERVIÇOS</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#0b1f3a]" />
            <span className="text-xs font-semibold text-[#0b1f3a]">VÍNCULO/DESVÍNCULO</span>
          </div>
          <h1 className="font-headline text-2xl lg:text-3xl font-extrabold text-[#0b1f3a] tracking-tight">
            VÍNCULAR ALUNOS/ENCARREGADOS
          </h1>
        </div>
        {canManage && (
          <button
            onClick={() => openLink()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] active:scale-[0.98] transition-all text-white font-bold text-xs shadow-sm shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">link</span>
            <span>REGISTRAR</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Contas de Encarregado', value: guardians.length, icon: 'family_restroom' },
          { label: 'Vínculos registados', value: totalActiveLinks, icon: 'link' },
          { label: 'Alunos sem Encarregado', value: withoutAccess.length, icon: 'link_off', warn: withoutAccess.length > 0 },
          { label: 'Sugestões por rever', value: totalSuggestions, icon: 'lightbulb', warn: totalSuggestions > 0 }
        ].map((k) => (
          <div key={k.label} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
            <div
              className={`w-10 h-10 flex items-center justify-center rounded-lg ${
                k.warn ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-[#0b1f3a]'
              }`}
            >
              <span className="material-symbols-outlined text-[22px]">{k.icon}</span>
            </div>
            <div>
              <div className="font-mono text-xl font-extrabold text-[#0b1f3a] leading-none">{k.value}</div>
              <div className="text-[11px] text-slate-500 font-semibold mt-1">{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
          {(
            [
              ['encarregados', 'Encarregados'],
              ['sem_acesso', `Sem Encarregado (${withoutAccess.length})`],
              ['historico', `Histórico (${history.length})`]
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 h-8 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                tab === key ? 'bg-white text-[#0b1f3a] shadow-xs' : 'text-slate-600 hover:text-[#0b1f3a]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative flex items-center w-full md:w-96 border border-slate-400/30 bg-slate-50/60 focus-within:bg-white">
          <span className="material-symbols-outlined ml-3 text-slate-400 text-[18px] shrink-0">search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar encarregado, educando ou nº de processo..."
            className="w-full h-9 pl-2 pr-3 bg-transparent border-0 outline-none text-xs text-slate-800 placeholder:text-slate-400"
          />
        </div>
      </div>

      {/* ---------------- Encarregados ---------------- */}
      {tab === 'encarregados' && (
        <div className="flex flex-col gap-3">
          {filteredGuardians.length === 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl py-12 px-6 text-center text-xs text-slate-500">
              {guardians.length === 0
                ? 'Ainda não existem contas de Encarregado de Educação. Crie-as em Configurações → Criação de Utilizadores ou a partir da ficha do aluno.'
                : 'Nenhum encarregado corresponde à pesquisa.'}
            </div>
          )}
          {filteredGuardians.map((g) => {
            const kids = childrenByGuardian.get(g.id) || [];
            const suggestions = suggestionsByGuardian.get(g.id) || [];
            return (
              <div key={g.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100">
                  <div className="min-w-0">
                    <div className="font-bold text-[#0b1f3a] text-sm">{g.name}</div>
                    <div className="text-[11px] text-slate-500 font-mono truncate">
                      {g.email}
                      {g.phone ? ` · ${g.phone}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                      {kids.length} {kids.length === 1 ? 'educando' : 'educandos'}
                    </span>
                    {canManage && (
                      <button
                        onClick={() => openLink({ guardianUserId: g.id })}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0b1f3a] hover:bg-[#7a0c0c] active:scale-[0.98] transition-all text-white font-bold text-xs shadow-sm shrink-0"
                      >
                        <span className="material-symbols-outlined text-[16px]">add_link</span>
                        Vincular
                      </button>
                    )}
                  </div>
                </div>

                {kids.length === 0 ? (
                  <div className="px-4 py-4 text-xs text-slate-400">
                    Esta conta não vê nenhum educando. Ao entrar no Portal Online não terá acesso a notas nem a finanças.
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {kids.map((c) => (
                      <li key={c.student.id} className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-800">{c.student.name}</div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            Nº {c.student.procNumber}
                            {c.student.className ? ` · ${c.student.className}` : ''}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {c.link ? (
                            <>
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                {relationLabel(c.link)}
                              </span>
                              {c.link.financialResponsible && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">
                                  Resp. Financeiro
                                </span>
                              )}
                            </>
                          ) : (
                            <span
                              className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800"
                              title="O acesso vem dos dados do Encarregado na ficha do aluno. Ao desvincular fica bloqueado."
                            >
                              Pela ficha do aluno
                            </span>
                          )}
                          {canManage && (
                            <button
                              onClick={() => openUnlink(g, c.student, !!c.link)}
                              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#dc2626] hover:bg-[#b91c1c] active:scale-[0.98] transition-all text-white font-bold text-xs shadow-sm shrink-0" data-tone="danger"
                            >
                              <span className="material-symbols-outlined text-[16px]">link_off</span>
                              Desvincular
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {suggestions.length > 0 && canManage && (
                  <div className="px-4 py-3 bg-amber-50 border-t border-amber-200 text-xs space-y-1.5">
                    <div className="font-bold text-amber-900 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[16px]">lightbulb</span>
                      Possíveis educandos deste Encarregado
                    </div>
                    {suggestions.map((s) => (
                      <div key={s.student.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-amber-900">
                          <strong>{s.student.name}</strong> — {s.reason}
                        </span>
                        <button
                          onClick={() => openLink({ guardianUserId: g.id, studentId: s.student.id })}
                          className="px-2.5 h-7 rounded-lg bg-amber-200 hover:bg-amber-300 text-amber-950 font-bold cursor-pointer"
                        >
                          Vincular
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ---------------- Sem Encarregado ---------------- */}
      {tab === 'sem_acesso' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-4 py-3 text-xs text-slate-600 bg-slate-50 border-b border-slate-200">
            Alunos ativos que nenhuma conta de Encarregado consegue ver. Cada um destes educandos não tem quem consulte o seu
            boletim ou as suas propinas no Portal Online.
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-4">Aluno</th>
                  <th className="py-3 px-3">Turma</th>
                  <th className="py-3 px-3">Encarregado na ficha</th>
                  <th className="py-3 px-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredWithout.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-slate-400">
                      Todos os alunos têm pelo menos um Encarregado com acesso.
                    </td>
                  </tr>
                ) : (
                  visibleFilteredWithout.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4">
                        <div className="font-bold text-[#0b1f3a]">{s.name}</div>
                        <div className="text-[11px] text-slate-500 font-mono">Nº {s.procNumber}</div>
                      </td>
                      <td className="py-3 px-3 text-slate-700">{s.className || s.grade || '—'}</td>
                      <td className="py-3 px-3 text-slate-700">
                        {s.guardianName || <span className="text-slate-400">—</span>}
                        {s.guardianPhone && <div className="text-[11px] text-slate-400 font-mono">{s.guardianPhone}</div>}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {canManage && (
                          <button
                            onClick={() => openLink({ studentId: s.id })}
                            className="px-3 h-8 rounded-md bg-[#2563eb] hover:bg-[#1d4ed8] !text-white font-bold cursor-pointer"
                          >
                            Vincular a Encarregado
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <TablePagination total={filteredWithout.length} page={pgFilteredWithout} onPageChange={setPgFilteredWithout} />
          </div>
        </div>
      )}

      {/* ---------------- Histórico ---------------- */}
      {tab === 'historico' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-4">Encarregado</th>
                  <th className="py-3 px-3">Educando</th>
                  <th className="py-3 px-3">Motivo</th>
                  <th className="py-3 px-3">Desvinculado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredHistory.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-slate-400">
                      Ainda não houve desvínculos.
                    </td>
                  </tr>
                ) : (
                  visibleFilteredHistory.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4">
                        <div className="font-bold text-[#0b1f3a]">{l.guardianName}</div>
                        <div className="text-[11px] text-slate-500 font-mono">{l.guardianEmail}</div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="text-slate-800 font-semibold">{l.studentName}</div>
                        <div className="text-[11px] text-slate-500 font-mono">Nº {l.studentProcNumber}</div>
                      </td>
                      <td className="py-3 px-3 text-slate-700">
                        {l.unlinkReason ? UNLINK_REASON_LABELS[l.unlinkReason] : '—'}
                        {l.unlinkNotes && <div className="text-[11px] text-slate-500">{l.unlinkNotes}</div>}
                      </td>
                      <td className="py-3 px-3 text-slate-600">
                        {fmtDate(l.unlinkedAt)}
                        <div className="text-[11px] text-slate-400">{l.unlinkedBy}</div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <TablePagination total={filteredHistory.length} page={pgFilteredHistory} onPageChange={setPgFilteredHistory} />
          </div>
        </div>
      )}

      {/* ---------------- Modal: Vincular ---------------- */}
      {linkOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setLinkOpen(false);
          }}
        >
          <form
            onSubmit={submitLink}
            className="bg-white max-w-lg w-full shadow-2xl border border-slate-400 flex flex-col max-h-[94vh]"
          >
            <FormModalHeader
              title="Registrar Vínculo"
              subtitle="O Encarregado passa a ver notas, boletim e finanças deste educando"
              icon="add_link"
              onClose={() => setLinkOpen(false)}
            />
            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              {linkError && (
                <Notice tone="error">{linkError}</Notice>
              )}
              <div>
                <label className={labelCls}>Encarregado de Educação *</label>
                <SearchableSelect
                  options={guardianOptions}
                  value={linkForm.guardianUserId}
                  onChange={(v) => setLinkForm({ ...linkForm, guardianUserId: v, studentId: '' })}
                  placeholder="Pesquisar conta de Encarregado..."
                  emptyMessage="Nenhuma conta de Encarregado criada"
                />
              </div>
              <div>
                <label className={labelCls}>Educando *</label>
                <SearchableSelect
                  options={studentOptions}
                  value={linkForm.studentId}
                  onChange={(v) => {
                    const preset = relationPreset(students.find((s) => s.id === v));
                    setLinkForm({
                      ...linkForm,
                      studentId: v,
                      relation: linkForm.relation || preset.relation,
                      relationOther: linkForm.relationOther || preset.relationOther
                    });
                  }}
                  placeholder="Pesquisar aluno por nome..."
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Relação com o aluno *</label>
                  <select
                    value={linkForm.relation}
                    onChange={(e) => setLinkForm({ ...linkForm, relation: e.target.value as GuardianRelation | '' })}
                    className={inputCls}
                  >
                    <option value="">Selecione...</option>
                    {Object.entries(GUARDIAN_RELATION_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                {linkForm.relation === 'outro' && (
                  <div>
                    <label className={labelCls}>Descreva a relação *</label>
                    <input
                      value={linkForm.relationOther}
                      onChange={(e) => setLinkForm({ ...linkForm, relationOther: e.target.value })}
                      className={inputCls}
                      placeholder="Ex.: Padrinho"
                    />
                  </div>
                )}
              </div>
              <label className="flex items-center gap-2 text-slate-700 font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={linkForm.financialResponsible}
                  onChange={(e) => setLinkForm({ ...linkForm, financialResponsible: e.target.checked })}
                />
                É o responsável pelo pagamento das propinas
              </label>
              <div>
                <label className={labelCls}>Observações</label>
                <textarea
                  value={linkForm.notes}
                  onChange={(e) => setLinkForm({ ...linkForm, notes: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs"
                />
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-100 border-t border-slate-300 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setLinkOpen(false)}
                className="px-5 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 font-bold text-xs cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer"
              >
                Vincular
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ---------------- Modal: Desvincular ---------------- */}
      {unlinkTarget && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setUnlinkTarget(null);
          }}
        >
          <div className="bg-white max-w-lg w-full shadow-2xl border border-slate-400 flex flex-col max-h-[94vh]">
            <FormModalHeader
              title="Desvincular Educando"
              subtitle={`${unlinkTarget.guardian.name} → ${unlinkTarget.student.name}`}
              icon="link_off"
              onClose={() => setUnlinkTarget(null)}
            />
            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              {unlinkError && (
                <Notice tone="error">{unlinkError}</Notice>
              )}
              <div className="p-3 bg-amber-50 border border-amber-300 text-amber-900">
                Depois de desvinculado, <strong>{unlinkTarget.guardian.name}</strong> deixa de ver notas, boletim e finanças de{' '}
                <strong>{unlinkTarget.student.name}</strong>.
                {!unlinkTarget.fromRecord &&
                  ' Como o acesso vinha dos dados da ficha do aluno, fica registado um bloqueio para que a ficha não o volte a abrir.'}
              </div>
              <div>
                <label className={labelCls}>Motivo *</label>
                <select
                  value={unlinkReason}
                  onChange={(e) => setUnlinkReason(e.target.value as GuardianUnlinkReason)}
                  className={inputCls}
                >
                  {Object.entries(UNLINK_REASON_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Observações {unlinkReason === 'outro' ? '*' : ''}</label>
                <textarea
                  value={unlinkNotes}
                  onChange={(e) => setUnlinkNotes(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs"
                  placeholder="Ex.: referência da decisão judicial, quem pediu o desvínculo..."
                />
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-100 border-t border-slate-300 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setUnlinkTarget(null)}
                className="px-5 py-2 bg-slate-300 hover:bg-slate-400 text-slate-900 font-bold text-xs cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submitUnlink}
                data-tone="danger" className="px-5 py-2 bg-[#dc2626] hover:bg-[#b91c1c] text-white font-bold text-xs cursor-pointer"
              >
                Desvincular
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
