import React, { useEffect, useMemo, useState } from 'react';
import { SchoolDatabase, UserRole } from '../types';
import { StudentMiniPautaItem } from '../types/pauta';
import { dbService, SchoolDatabaseService } from '../services/db';
import { reauthenticate } from '../services/authSupabase';
import { TurnstileWidget, TURNSTILE_SITE_KEY } from '../components/TurnstileWidget';
import { getStudentsForClass } from '../utils/classStudentsRoster';
import { sortPautaRowsByName } from '../utils/alphabetical';
import { getSubjectsForClass } from '../utils/classSubjects';
import { useAccessControl } from '../hooks/useAccessControl';
import {
  buildMiniPautaRows,
  recalcMiniPautaRow,
  syncStoredMiniPautaRows,
  getPautaRegime,
  normalizeGradeRules
} from '../utils/pautaCalculations';
import { isKeySubjectFor } from '../utils/keySubjects';
import { resolveCourseDurationYears } from '../utils/recursoRules';
import { TablePagination, usePagedList } from '../components/TablePagination';
import { Notice } from '../components/Notice';

interface HomologacaoPautaViewProps {
  db: SchoolDatabase;
  currentUserRole: UserRole;
  onBackToPautas: () => void;
  onNavigateToImport?: () => void;
}

type TrimesterChoice = 1 | 2 | 3 | 'final';


export const HomologacaoPautaView: React.FC<HomologacaoPautaViewProps> = ({
  db,
  currentUserRole,
  onBackToPautas,
  onNavigateToImport
}) => {
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [trimester, setTrimester] = useState<TrimesterChoice>('final');
  const [searchFilter, setSearchFilter] = useState('');

  const [password, setPassword] = useState('');
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [isHonorDeclared, setIsHonorDeclared] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [signSuccess, setSignSuccess] = useState<string | null>(null);

  const currentUser = db.currentUser;
  // Matriz ACL: assinar/homologar exige a regra pautas.homologar autorizada
  // para o perfil (a reabertura, com pautas.unlock, vive em Ano Letivo).
  const acl = useAccessControl(currentUserRole);
  const canSign = acl.can('pautas.homologar');

  const classes = db.classes || [];
  const activeClass = classes.find((c) => String(c.id) === String(selectedClassId));
  // Disciplinas da turma selecionada, sempre a partir da Atribuição (Secretaria
  // Académica → Atribuição) — nunca a lista completa de disciplinas da instituição,
  // senão a Homologação deixaria assinar pautas de disciplinas que a turma nem tem.
  const subjects = useMemo(() => {
    return getSubjectsForClass(db, activeClass);
  }, [db, activeClass]);
  const activeSubject = subjects.find((s) => String(s.id) === String(selectedSubjectId));

  // Ao trocar de turma, a disciplina antes selecionada pode já não pertencer à
  // nova turma (Atribuição diferente) — limpa a seleção para evitar assinar
  // uma pauta com Turma/Disciplina incoerentes entre si.
  useEffect(() => {
    if (selectedSubjectId && !subjects.some((s) => String(s.id) === String(selectedSubjectId))) {
      setSelectedSubjectId('');
    }
  }, [selectedClassId, subjects, selectedSubjectId]);

  const classStudents = useMemo(
    () => (selectedClassId ? getStudentsForClass(selectedClassId, db.students || [], activeClass?.name) : []),
    [selectedClassId, db.students, activeClass?.name]
  );

  const gradeRules = useMemo(() => normalizeGradeRules(db.settings?.gradeRules as any), [db.settings?.gradeRules]);

  /** Linhas REAIS da mini-pauta guardada; se não houver, linhas vazias dos alunos da turma. */
  const rows: StudentMiniPautaItem[] = useMemo(() => {
    if (!selectedClassId || !selectedSubjectId) return [];
    const saved = dbService.getMiniPautaRows(selectedClassId, selectedSubjectId) as
      | StudentMiniPautaItem[]
      | null;
    if (saved && saved.length > 0) {
      // Recalcula MT1/MT2/MT3/MFD a partir do MAC/NPP/NPT guardados em vez de
      // confiar no valor persistido — a homologação nunca deve assinar uma pauta
      // com médias "presas" em 0 por causa de um cálculo antigo/desatualizado.
      const hRegime = getPautaRegime(activeClass?.grade, activeClass?.name, activeClass?.area);
      const hSubject = subjects.find((sb) => String(sb.id) === String(selectedSubjectId));
      const ctx = {
        regime: hRegime,
        classGrade: activeClass?.grade,
        isKeySubject: isKeySubjectFor(hSubject, activeClass?.grade, activeClass?.area),
        rules: gradeRules,
        courseDurationYears: resolveCourseDurationYears(db.courses, activeClass)
      };
      const synced = syncStoredMiniPautaRows(saved, classStudents, selectedSubjectId, db.students || [], gradeRules, { ...ctx, subjectName: hSubject?.name });
      return sortPautaRowsByName(synced.map((row) => recalcMiniPautaRow(row, ctx)));
    }
    return buildMiniPautaRows(classStudents, selectedSubjectId, db.students || [], undefined, gradeRules, {
      regime: getPautaRegime(activeClass?.grade, activeClass?.name, activeClass?.area),
      classGrade: activeClass?.grade,
      subjectName: (subjects || []).find((x: any) => String(x.id) === String(selectedSubjectId))?.name
    });
  }, [selectedClassId, selectedSubjectId, classStudents, db.students, db.miniPautasStore, gradeRules]);

  const scoreFor = (r: StudentMiniPautaItem): number | '' => {
    if (trimester === 1) return r.mt1;
    if (trimester === 2) return r.mt2;
    if (trimester === 3) return r.mt3;
    return r.mfd;
  };

  const filteredRows = rows.filter((r) =>
    r.name.toLowerCase().includes(searchFilter.trim().toLowerCase())
  );
  const { page: pgFilteredRows, setPage: setPgFilteredRows, pageItems: visibleFilteredRows } = usePagedList(filteredRows, [filteredRows.length]);

  const stats = useMemo(() => {
    const graded = rows.filter((r) => typeof scoreFor(r) === 'number');
    const approved = graded.filter((r) => (scoreFor(r) as number) >= 10).length;
    return {
      total: rows.length,
      graded: graded.length,
      pending: rows.length - graded.length,
      approved,
      failed: graded.length - approved
    };
  }, [rows, trimester]);

  const fingerprint = useMemo(() => SchoolDatabaseService.fingerprintGrades(rows as any[]), [rows]);

  const existingHomologation = useMemo(
    () =>
      selectedClassId && selectedSubjectId
        ? dbService.findHomologation(selectedClassId, selectedSubjectId, trimester)
        : null,
    [selectedClassId, selectedSubjectId, trimester, db.homologations]
  );

  const gradesChangedSinceSignature =
    !!existingHomologation && existingHomologation.gradesFingerprint !== fingerprint;

  const readyToSign =
    canSign &&
    !!selectedClassId &&
    !!selectedSubjectId &&
    stats.graded > 0 &&
    stats.pending === 0 &&
    isHonorDeclared &&
    password.length > 0 &&
    (!TURNSTILE_SITE_KEY || !!captchaToken);

  const handleSign = async () => {
    if (!readyToSign || !currentUser) return;
    if (!acl.can('pautas.homologar')) {
      acl.guard('pautas.homologar', () => undefined);
      return;
    }
    setSigning(true);
    setSignError(null);
    setSignSuccess(null);

    try {
      // Assinatura real: o Supabase reconfirma a identidade com a palavra-passe.
      const token = captchaToken;
      setCaptchaToken(null);
      setCaptchaKey((k) => k + 1);   // o token do captcha é de uso único
      const check = await reauthenticate(password, token);
      if (!check.success) {
        setSignError(check.error || 'Não foi possível confirmar a sua identidade.');
        return;
      }

      dbService.homologatePauta({
        classId: selectedClassId,
        className: activeClass?.name || '',
        subjectId: selectedSubjectId,
        subjectName: activeSubject?.name || '',
        trimester,
        academicYear: db.settings?.currentAcademicYear || '',
        signedByUserId: currentUser.id,
        signedByName: currentUser.name,
        signedByRole: currentUser.roleTitle || currentUserRole,
        studentCount: stats.total,
        approvedCount: stats.approved,
        failedCount: stats.failed,
        gradesFingerprint: fingerprint
      });

      await dbService.pushToCloudStorage();

      setPassword('');
      setIsHonorDeclared(false);
      setSignSuccess(
        `Pauta homologada por ${currentUser.name} em ${new Date().toLocaleString('pt-PT')}.`
      );
    } catch (e: any) {
      setSignError(e?.message || 'Ocorreu um erro ao homologar a pauta.');
    } finally {
      setSigning(false);
    }
  };

  return (
    <div className="flex flex-col w-full gap-6 pb-12">
      <div className="flex items-center gap-1 text-xs font-semibold text-slate-400 uppercase tracking-wider flex-wrap">
        <button onClick={onBackToPautas} className="hover:underline text-slate-500">
          AVALIAÇÃO &amp; EXAMES
        </button>
        <span className="material-symbols-outlined text-[14px]">chevron_right</span>
        <span className="text-[#0b1f3a] font-bold">HOMOLOGAÇÃO DE PAUTA</span>
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#7a0c0c] text-white flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[24px]">verified_user</span>
          </div>
          <div>
            <h1 className="font-headline text-2xl font-bold text-slate-900 tracking-tight">
              Homologação Oficial de Pauta
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              A assinatura é confirmada com a sua palavra-passe de acesso e fica registada na trilha de auditoria.
            </p>
          </div>
        </div>
        {onNavigateToImport && (
          <button
            type="button"
            onClick={onNavigateToImport}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs shrink-0"
          >
            <span className="material-symbols-outlined text-[16px]">upload_file</span>
            Importar notas de ficheiro
          </button>
        )}
      </div>

      {/* Seleção */}
      <div className="bg-white rounded-xl p-5 shadow-xs border border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-1">Turma</label>
          <select
            value={selectedClassId}
            onChange={(e) => setSelectedClassId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-100 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a]"
          >
            <option value="">Selecione a turma...</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-1">Disciplina</label>
          <select
            value={selectedSubjectId}
            onChange={(e) => setSelectedSubjectId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-100 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a]"
          >
            <option value="">Selecione a disciplina...</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-1">Período</label>
          <select
            value={String(trimester)}
            onChange={(e) => setTrimester(e.target.value === 'final' ? 'final' : (Number(e.target.value) as 1 | 2 | 3))}
            className="w-full px-3 py-2 rounded-lg bg-slate-100 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a]"
          >
            <option value="1">I Trimestre (MT1)</option>
            <option value="2">II Trimestre (MT2)</option>
            <option value="3">III Trimestre (MT3)</option>
            <option value="final">Classificação Final (MFD)</option>
          </select>
        </div>
      </div>

      {(!selectedClassId || !selectedSubjectId) && (
        <div className="p-6 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 text-sm text-center">
          Selecione a turma e a disciplina para carregar a pauta a homologar.
        </div>
      )}

      {selectedClassId && selectedSubjectId && rows.length === 0 && (
        <Notice tone="warn">
          Esta turma não tem alunos matriculados, por isso não há pauta para homologar.
        </Notice>
      )}

      {rows.length > 0 && (
        <>
          {/* Estado */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {([
              ['Alunos', stats.total, 'text-slate-900'],
              ['Com nota', stats.graded, 'text-[#0b1f3a]'],
              ['Por lançar', stats.pending, stats.pending > 0 ? 'text-amber-600' : 'text-slate-400'],
              ['Aprovados', stats.approved, 'text-emerald-600'],
              ['Não aprovados', stats.failed, 'text-[#7a0c0c]']
            ] as const).map(([label, value, color]) => (
              <div key={label} className="bg-white rounded-xl p-4 shadow-xs border border-slate-200">
                <span className="block text-[10px] uppercase font-bold tracking-wider text-slate-400">{label}</span>
                <span className={`block mt-1 font-headline text-2xl font-bold ${color}`}>{value}</span>
              </div>
            ))}
          </div>

          {existingHomologation && (
            <div
              className={`p-4 rounded-xl border text-xs ${
                gradesChangedSinceSignature
                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-900'
              }`}
            >
              <span className="font-bold block">
                {gradesChangedSinceSignature
                  ? 'Atenção: as notas foram alteradas depois da homologação.'
                  : 'Esta pauta já se encontra homologada.'}
              </span>
              <span className="block mt-1">
                Assinada por {existingHomologation.signedByName} ({existingHomologation.signedByRole}) em{' '}
                {new Date(existingHomologation.signedAt).toLocaleString('pt-PT')} ·{' '}
                {existingHomologation.approvedCount} aprovados / {existingHomologation.failedCount} não aprovados.
              </span>
              {gradesChangedSinceSignature && (
                <span className="block mt-1">
                  A assinatura já não corresponde às notas atuais. É necessário voltar a homologar.
                </span>
              )}
            </div>
          )}

          {/* Tabela real */}
          <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center gap-3">
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Procurar aluno..."
                className="flex-1 px-3 py-2 rounded-lg bg-slate-100 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a]"
              />
              <span className="text-[11px] text-slate-400 font-mono shrink-0">
                impressão digital {fingerprint}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-bold">N.º</th>
                    <th className="px-3 py-2.5 text-left font-bold">Aluno</th>
                    <th className="px-3 py-2.5 text-center font-bold">Sexo</th>
                    <th className="px-3 py-2.5 text-right font-bold">MT1</th>
                    <th className="px-3 py-2.5 text-right font-bold">MT2</th>
                    <th className="px-3 py-2.5 text-right font-bold">MT3</th>
                    <th className="px-3 py-2.5 text-right font-bold">MFD</th>
                    <th className="px-3 py-2.5 text-left font-bold">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleFilteredRows.map((r, i) => {
                    const score = scoreFor(r);
                    const pending = typeof score !== 'number';
                    return (
                      <tr key={r.id} className={pending ? 'bg-amber-50/40' : ''}>
                        <td className="px-3 py-2.5 font-mono text-slate-500">{r.num || i + 1}</td>
                        <td className="px-3 py-2.5 text-slate-800 font-semibold">{r.name}</td>
                        <td className="px-3 py-2.5 text-center text-slate-500">{r.gender}</td>
                        <td className="px-3 py-2.5 text-right font-mono">{r.mt1 === '' ? '—' : r.mt1}</td>
                        <td className="px-3 py-2.5 text-right font-mono">{r.mt2 === '' ? '—' : r.mt2}</td>
                        <td className="px-3 py-2.5 text-right font-mono">{r.mt3 === '' ? '—' : r.mt3}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-[#0b1f3a]">
                          {r.mfd === '' ? '—' : r.mfd}
                        </td>
                        <td className="px-3 py-2.5">
                          {r.isDesistente ? (
                            <span className="text-slate-500 font-semibold">Desistente</span>
                          ) : pending ? (
                            <span className="text-amber-700 font-semibold">Por lançar</span>
                          ) : (score as number) >= 10 ? (
                            <span className="text-emerald-700 font-semibold">Aprovado</span>
                          ) : (
                            <span className="text-[#7a0c0c] font-semibold">Exame de recurso</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <TablePagination total={filteredRows.length} page={pgFilteredRows} onPageChange={setPgFilteredRows} />
            </div>
          </div>

          {/* Assinatura */}
          <div className="bg-white rounded-xl p-5 shadow-xs border border-slate-200">
            <h2 className="font-headline text-sm font-bold text-slate-900 mb-3">Assinatura digital</h2>

            {!canSign ? (
              <Notice tone="warn">
                Só a Direção Pedagógica ou a Administração podem homologar pautas. O seu perfil permite
                consultar, mas não assinar.
              </Notice>
            ) : stats.pending > 0 ? (
              <Notice tone="warn">
                Existem {stats.pending} {stats.pending === 1 ? 'aluno sem nota lançada' : 'alunos sem nota lançada'}.
                Uma pauta incompleta não pode ser homologada — lance as notas em falta ou importe-as de ficheiro.
              </Notice>
            ) : (
              <>
                <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isHonorDeclared}
                    onChange={(e) => setIsHonorDeclared(e.target.checked)}
                    className="mt-0.5 shrink-0"
                  />
                  <span>
                    Declaro, na qualidade de {currentUser?.roleTitle || currentUserRole}, que verifiquei as
                    classificações de {stats.total} alunos de <strong>{activeSubject?.name}</strong> —{' '}
                    <strong>{activeClass?.name}</strong> e que estas correspondem às avaliações realizadas.
                  </span>
                </label>

                <div className="mt-4 max-w-sm">
                  <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-600 mb-1">
                    Palavra-passe de acesso
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    placeholder="Confirme a sua identidade"
                    className="w-full px-3 py-2 rounded-lg bg-slate-100 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a]"
                  />
                  <div className="mt-3">
                    <TurnstileWidget onToken={setCaptchaToken} resetKey={captchaKey} />
                  </div>
                </div>

                {signError && (
                  <Notice tone="error">
                    {signError}
                  </Notice>
                )}
                {signSuccess && (
                  <div className="mt-3 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold">
                    {signSuccess}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={!readyToSign || signing}
                    onClick={handleSign}
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#7a0c0c] hover:bg-[#8f1010] text-white font-bold text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span className="material-symbols-outlined text-[16px]">draw</span>
                    {signing ? 'A verificar identidade...' : 'Homologar e assinar'}
                  </button>
                  <button
                    type="button"
                    onClick={onBackToPautas}
                    className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs"
                  >
                    Voltar às pautas
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};
