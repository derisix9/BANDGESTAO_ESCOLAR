import React, { useMemo } from 'react';
import { StudentPautaGeralItem, GradeTypeKey } from '../../types/pauta';
import { ClassRoom, Subject, InstitutionSettings } from '../../types';
import { dbService } from '../../services/db';
import { buildUniqueSubjectAbbreviations } from '../../utils/subjectAbbreviation';
import { usesFullSubjectNames } from '../../utils/pautaView';
import { GradeRules, PautaRegime, PautaClassContext, DEFAULT_GRADE_RULES } from '../../utils/pautaCalculations';
import { isKeySubjectFor } from '../../utils/keySubjects';
import { buildPautaHeader } from '../../utils/pautaHeader';
import { PautaOfficialHeader } from './PautaOfficialHeader';
import { visiblePautaRows } from '../../utils/pautaView';

interface PautaGeralTableProps {
  rows: StudentPautaGeralItem[];
  subjects: Subject[];
  selectedGradeTypes: Set<GradeTypeKey>;
  hideDebtorGrades: boolean;
  previewHiddenOnScreen: boolean;
  /** Ocultar da listagem os alunos desistentes / transferidos. */
  hideDesistentes?: boolean;
  hideTransferidos?: boolean;
  activeClass?: ClassRoom;
  onUpdateGrade?: (studentIndex: number, subjectId: string, field: 'mt1' | 'mt2' | 'mt3' | 'mfd', value: number | '') => void;
  onToggleDesistente?: (studentIndex: number) => void;
  settings?: InstitutionSettings;
  regime?: PautaRegime;
  gradeRules?: GradeRules;
  classCtx?: PautaClassContext;
}

// Largura útil aproximada (em px CSS) de uma folha A4 Paisagem com margens de 4mm/5mm,
// usada apenas para calcular o fator de escala que garante que a Pauta Geral — com
// qualquer número de disciplinas — cabe sempre numa ÚNICA folha impressa.
const PRINT_USABLE_WIDTH_PX = 1080;

export const PautaGeralTable: React.FC<PautaGeralTableProps> = ({
  rows,
  subjects,
  selectedGradeTypes,
  hideDebtorGrades,
  hideDesistentes = false,
  hideTransferidos = false,
  activeClass,
  settings,
  regime = 'transicao',
  gradeRules = DEFAULT_GRADE_RULES,
  classCtx
}) => {
  // Sempre reflete os Dados da Instituição definidos em Configurações
  const institution = settings || dbService.getSettings();

  // Cabeçalhos das disciplinas abreviados a 3 letras (ou siglas) para que a pauta
  // caiba com folga numa única folha A4 Paisagem.
  const subjectAbbreviations = useMemo(
    () => buildUniqueSubjectAbbreviations(subjects.map((s) => s.name)),
    [subjects]
  );

  // Check which sub-columns for each discipline are enabled
  const showMT1 = selectedGradeTypes.has('MT1');
  const showMT2 = selectedGradeTypes.has('MT2');
  const showMT3 = selectedGradeTypes.has('MT3');
  const showMFD = selectedGradeTypes.has('MFD');
  const showMF = selectedGradeTypes.has('MF');
  // Com MT1, MT2 e MT3 ocultas (só MFD/MF), cada disciplina mostra o NOME COMPLETO em vez da sigla.
  const fullNames = usesFullSubjectNames(selectedGradeTypes);
  const subjectLabel = (name: string) => (fullNames ? name : subjectAbbreviations.get(name) || name);
  // Classes de exame: por disciplina, MF (nota final com exame) e NER (exame de recurso).
  const isExame = regime === 'exame';
  const showSubjMF = isExame && showMF;
  const showSubjNER = isExame && selectedGradeTypes.has('NER');

  const shownRows = visiblePautaRows(rows, { hideDesistentes, hideTransferidos });
  const header = buildPautaHeader({
    kind: 'pauta',
    settings: institution,
    activeClass,
    regime,
    totalStudents: shownRows.length
  });

  const disciplineSubCols = [showMT1, showMT2, showMT3, showMFD, showSubjMF, showSubjNER].filter(Boolean).length;
  // If user unselected all 4 discipline sub-cols, default to at least MFD so columns don't break
  const effectiveDisciplineSubCols = disciplineSubCols > 0 ? disciplineSubCols : 1;

  // ---------------------------------------------------------------------------------
  // Pauta Geral numa ÚNICA folha: todas as disciplinas lado a lado, sem divisão em
  // "Folha 1/2/3". Na tela, rola horizontalmente; na impressão, é automaticamente
  // reduzida (zoom) para caber sempre numa única folha A4 Paisagem, seja qual for o
  // número de disciplinas da turma.
  //
  // A largura real da tabela é calculada célula a célula (não um valor aproximado
  // fixo por disciplina) porque uma disciplina com as 4 sub-colunas visíveis
  // (MT1+MT2+MT3+MFD) é bem mais larga do que uma com apenas 1. Uma estimativa
  // plana subestimava a largura real quando várias sub-colunas estavam visíveis,
  // pelo que o "zoom" aplicado não reduzia o suficiente e as últimas colunas
  // (Situação) ainda saíam cortadas fisicamente da folha impressa — isto não é um
  // problema de "overflow" do CSS, é a tabela a ser mesmo mais larga do que a
  // folha, por isso o cálculo tem de ser exacto.
  const COL_NUM_PX = 40; // N.º (w-10)
  const COL_NAME_PX = 170; // Nome do Aluno (min-w-[170px])
  const COL_SEXO_PX = 40; // Sexo (w-10)
  const COL_IDADE_PX = 44; // Idade (w-11)
  const COL_MF_PX = 48; // MF (w-12), só quando showMF
  const COL_SITUACAO_PX = 85; // Situação (min-w-[85px])
  const COL_SUBCOL_PX = 32; // MT1 / MT2 / MT3 (w-8)
  const COL_MFD_PX = 36; // MFD (w-9)
  const BORDERS_BUFFER_PX = 60; // margem de segurança para bordas/paddings acumulados

  const MIN_FULLNAME_SUBJECT_PX = 84; // nome completo: a coluna tem de dar espaço para o texto quebrar em linhas
  const computedSubjectWidth =
    disciplineSubCols > 0
      ? (showMT1 ? COL_SUBCOL_PX : 0) + (showMT2 ? COL_SUBCOL_PX : 0) + (showMT3 ? COL_SUBCOL_PX : 0) + (showMFD ? COL_MFD_PX : 0) +
        (showSubjMF ? COL_MFD_PX : 0) + (showSubjNER ? COL_SUBCOL_PX : 0)
      : COL_MFD_PX; // nenhuma sub-coluna seleccionada: cai sempre para MFD (ver renderização)
  const perSubjectWidth = fullNames ? Math.max(computedSubjectWidth, MIN_FULLNAME_SUBJECT_PX) : computedSubjectWidth;

  // Fator de escala calculado de forma síncrona e determinística — directamente a
  // partir das mesmas larguras usadas para desenhar as colunas (ver "minWidth"
  // abaixo) — em vez de medir o DOM depois de montado. Medir o DOM (scrollWidth) e
  // guardar o resultado num estado (useState/useEffect) exigia esperar por um novo
  // render antes de o "zoom" de impressão ficar correcto; como window.print() é
  // síncrono, a impressão podia arrancar antes de esse estado ser aplicado.
  // Calculando o valor directamente no render, o "zoom" aplicado ao imprimir está
  // sempre certo logo à primeira impressão, sem depender do evento "beforeprint".
  const naturalTableWidth = Math.max(
    1200,
    COL_NUM_PX +
      COL_NAME_PX +
      COL_SEXO_PX +
      COL_IDADE_PX +
      COL_SITUACAO_PX +
      (showMF ? COL_MF_PX : 0) +
      subjects.length * perSubjectWidth +
      BORDERS_BUFFER_PX
  );
  const printScale = naturalTableWidth > PRINT_USABLE_WIDTH_PX ? PRINT_USABLE_WIDTH_PX / naturalTableWidth : 1;


  const renderGrade = (val: number | '', isDebtor: boolean, isDesistente: boolean, isMFD = false) => {
    if (isDesistente) {
      return <span className="text-slate-300 font-mono">-</span>;
    }

    if (isDebtor && hideDebtorGrades) {
      return (
        <span className="text-slate-400 font-mono font-bold text-xs select-none print:text-[9px] print:text-slate-500">
          -
        </span>
      );
    }

    if (val === '' || val === undefined || val === null) {
      return <span className="text-slate-400 font-mono">-</span>;
    }

    const num = typeof val === 'number' ? val : parseFloat(val as any);
    const isNegative = !isNaN(num) && num < 10;

    return (
      <span
        className={`font-mono font-bold text-xs print:text-[9px] ${
          isNegative ? 'text-rose-600 font-extrabold print:text-red-600' : 'text-slate-900 print:text-black'
        } ${isMFD ? 'text-[#0b1f3a]' : ''}`}
      >
        {num}
      </span>
    );
  };

  const renderSituationBadge = (row: StudentPautaGeralItem) => {
    if (row.isTransferido) {
      return (
        <span className="pauta-badge inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-50 text-violet-700 border border-violet-200 print:text-black">
          TRANSFERIDO
        </span>
      );
    }
    if (row.isDesistente) {
      return (
        <span className="pauta-badge inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200 print:text-black">
          DESISTIDO
        </span>
      );
    }
    if (row.isDebtor && hideDebtorGrades) {
      return (
        <span className="pauta-badge inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-300 print:text-black">
          RETIDO
        </span>
      );
    }
    const badgeStyle =
      row.situation === 'APROVADO'
        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 print:text-emerald-800 print:border print:border-emerald-300'
        : row.situation === 'RECURSO'
        ? 'bg-amber-50 text-amber-700 border border-amber-200 print:text-amber-800 print:border print:border-amber-300'
        : row.situation === 'PENDENTE'
        ? 'bg-slate-100 text-slate-600 border border-slate-200 print:text-slate-700 print:border print:border-slate-400'
        : 'bg-rose-50 text-rose-700 border border-rose-200 print:text-rose-800 print:border print:border-rose-300';

    return (
      <span className={`pauta-badge inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeStyle}`}>
        {row.situation}
      </span>
    );
  };

  // Bloco de Assinaturas Oficiais
  const renderSignatures = () => (
    <div className="p-6 bg-slate-50/70 border-t border-slate-200 print:bg-white print:border-black print:p-4 print-break-avoid">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-center text-xs print:grid-cols-3 print:gap-4 print:text-[9px]">
        {/* O Responsável da Turma */}
        <div className="flex flex-col items-center">
          <div className="w-48 border-b border-dashed border-slate-400 mb-2 print:border-black print:w-36" />
          <span className="font-bold text-slate-900 uppercase text-[11px] print:text-[9px] print:text-black">
            O Responsável da Turma
          </span>
          <span className="text-slate-600 print:text-black text-xs">
            {activeClass?.headTeacherName || 'Director de Turma'}
          </span>
        </div>

        {/* O Director Pedagógico */}
        <div className="flex flex-col items-center">
          <div className="w-48 border-b border-dashed border-slate-400 mb-2 print:border-black print:w-36" />
          <span className="font-bold text-slate-900 uppercase text-[11px] print:text-[9px] print:text-black">
            O/A Subdirector/a Pedagógico/a
          </span>
          <span className="text-slate-600 print:text-black text-xs">
            {institution.directorPedagogico || 'A definir em Configurações'}
          </span>
        </div>

        {/* O Director Geral */}
        <div className="flex flex-col items-center">
          <div className="w-48 border-b border-dashed border-slate-400 mb-2 print:border-black print:w-36" />
          <span className="font-bold text-slate-900 uppercase text-[11px] print:text-[9px] print:text-black">
            O Director Geral
          </span>
          <span className="text-slate-600 print:text-black text-xs">
            {institution.directorGeral || 'A definir em Configurações'}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="w-full bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden print:overflow-visible print:border-none print:rounded-none print:shadow-none">
      {/* Estilos de Impressão: SEMPRE uma única folha A4 Paisagem, qualquer que seja o
          número de disciplinas — o conteúdo é reduzido via transform: scale (ver
          printScale acima) em vez de ser dividido em folhas separadas. */}
      <style>{`
        @media print {
          @page {
            size: A4 landscape !important;
            margin: 4mm 5mm !important;
          }
          .pauta-print-page {
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          table {
            border-collapse: collapse !important;
          }
          th, td {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          /* Sem bordas de sistema em nenhum "quadrado" da tabela (linhas, colunas,
             moldura exterior) e sem contorno nas etiquetas da coluna Situação —
             mantém-se apenas a cor de fundo/texto para leitura clara. */
          .pauta-print-page table,
          .pauta-print-page thead,
          .pauta-print-page tbody,
          .pauta-print-page tr,
          .pauta-print-page th,
          .pauta-print-page td {
            border: none !important;
            outline: none !important;
          }
          .pauta-print-page .pauta-badge {
            border: none !important;
          }
        }
      `}</style>

      {/* Barra informativa (apenas na tela) */}
      <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs print:hidden">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[#0b1f3a] text-[20px]">table_chart</span>
          <span className="font-bold text-slate-800">
            Pauta Final • {subjects.length} Disciplinas
          </span>
        </div>
      </div>

      {/* Tabela Única: mesma tabela usada na tela (com rolagem) e na impressão (reduzida
          por escala para caber numa única folha, sem divisão em "Folha 1/2/3"). */}
      <div className="pauta-print-page">
        <PautaOfficialHeader header={header} />

        <div className="overflow-x-auto print:overflow-visible shadow-inner print:shadow-none">
          <div
            style={
              printScale < 1
                ? ({ ['--pauta-print-zoom' as any]: printScale } as React.CSSProperties)
                : undefined
            }
            className={printScale < 1 ? 'print:[zoom:var(--pauta-print-zoom)]' : undefined}
          >
            <table
              data-no-table-style
              className="w-full text-center text-xs border-collapse border border-slate-300"
              style={{ minWidth: `${naturalTableWidth}px` }}
            >
              <thead>
                <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[11px] tracking-wider border-b border-slate-700/80">
                  <th rowSpan={2} className="py-2.5 px-2 w-10 border-r border-slate-600 text-center sticky left-0 z-10 bg-[#0b1f3a] print:static">
                    N.º
                  </th>
                  <th rowSpan={2} className="py-2.5 px-3 min-w-[170px] text-left border-r border-slate-600 sticky left-10 z-10 bg-[#0b1f3a] print:static">
                    Nome do Aluno
                  </th>
                  <th rowSpan={2} className="py-2.5 px-1 w-10 border-r border-slate-600 text-center">
                    Sexo
                  </th>
                  <th rowSpan={2} className="py-2.5 px-1 w-11 border-r border-slate-600 text-center">
                    Idade
                  </th>

                  {subjects.map((subj) => (
                    <th
                      key={subj.id}
                      colSpan={effectiveDisciplineSubCols}
                      className="py-2 px-1 border-r border-slate-600 bg-[#12335e] text-amber-300 font-extrabold tracking-wider text-[10px]"
                      style={fullNames ? { minWidth: `${perSubjectWidth}px` } : undefined}
                    >
                      <span
                        className={`block mx-auto ${fullNames ? 'whitespace-normal break-words leading-tight' : 'whitespace-nowrap'}`}
                        title={
                          isExame && isKeySubjectFor(subj, activeClass?.grade, classCtx?.courseName)
                            ? `${subj.name} — disciplina chave (sem Recurso)`
                            : subj.name
                        }
                      >
                        {subjectLabel(subj.name)}
                        {isExame && isKeySubjectFor(subj, activeClass?.grade, classCtx?.courseName) ? ' 🗝️' : ''}
                      </span>
                    </th>
                  ))}

                  {showMF && (
                    <th rowSpan={2} className="py-2.5 px-2 w-12 border-r border-slate-600 bg-[#7a0c0c] text-amber-300 font-extrabold text-center">
                      MF
                    </th>
                  )}
                  <th rowSpan={2} className="py-2.5 px-3 min-w-[85px] bg-[#0b1f3a] text-white font-extrabold text-center">
                    Situação
                  </th>
                </tr>

                <tr className="bg-[#183c6b] text-slate-200 font-bold uppercase text-[9.5px] tracking-wide border-b border-slate-700">
                  {subjects.map((subj) => (
                    <React.Fragment key={`sub-${subj.id}`}>
                      {showMT1 && <th className="py-1 px-1 border-r border-slate-600 w-8 text-slate-200">MT1</th>}
                      {showMT2 && <th className="py-1 px-1 border-r border-slate-600 w-8 text-slate-200">MT2</th>}
                      {showMT3 && <th className="py-1 px-1 border-r border-slate-600 w-8 text-slate-200">MT3</th>}
                      {showMFD && <th className="py-1 px-1 border-r border-slate-600 w-9 bg-[#0f2849] text-amber-300 font-black">MFD</th>}
                      {showSubjMF && <th className="py-1 px-1 border-r border-slate-600 w-9 bg-[#5c0909] text-amber-300 font-black" title="MF = MFD×60% + Exame×40%">MF</th>}
                      {showSubjNER && <th className="py-1 px-1 border-r border-slate-600 w-8 text-rose-300 font-black" title="Nota do Exame de Recurso">NER</th>}
                      {!showMT1 && !showMT2 && !showMT3 && !showMFD && !showSubjMF && !showSubjNER && (
                        <th className="py-1 px-1 border-r border-slate-600 w-9 bg-[#0f2849] text-amber-300 font-black">MFD</th>
                      )}
                    </React.Fragment>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200">
                {shownRows.length === 0 && (
                  <tr>
                    <td colSpan={40} className="py-8 text-center text-slate-400 text-xs">Nenhum aluno para mostrar com os filtros actuais.</td>
                  </tr>
                )}
                {shownRows.map(({ row, displayNum }, idx) => {
                  const isDesistente = row.isDesistente;
                  const isDebtor = row.isDebtor;

                  return (
                    <tr
                      key={row.id || idx}
                      className={`border-b border-slate-200 transition-colors ${
                        isDesistente
                          ? 'bg-slate-100/80 text-slate-400 italic'
                          : row.isTransferido
                          ? 'bg-violet-50/50'
                          : idx % 2 === 1
                          ? 'bg-[#f8fafc] hover:bg-sky-50/40'
                          : 'bg-white hover:bg-sky-50/40'
                      }`}
                    >
                      <td className="py-1.5 px-2 font-mono font-bold text-slate-600 border-r border-slate-200 text-center sticky left-0 z-5 bg-inherit print:static">
                        {displayNum}
                      </td>
                      <td className="py-1.5 px-3 text-left border-r border-slate-200 sticky left-10 z-5 bg-inherit print:static">
                        <span className="font-semibold text-slate-900 tracking-tight text-xs">
                          {row?.name || 'Aluno'}
                        </span>
                      </td>
                      <td className="py-1.5 px-1 font-bold text-slate-700 border-r border-slate-200 text-center">
                        {row.gender}
                      </td>
                      <td className="py-1.5 px-1 font-mono font-bold text-slate-700 border-r border-slate-200 text-center">
                        {row.age}
                      </td>

                      {subjects.map((subj) => {
                        const grades = row.subjectGrades[subj.id] || { mt1: '', mt2: '', mt3: '', mfd: '', mf: '', ner: '' };
                        return (
                          <React.Fragment key={`${subj.id}-${row.id}`}>
                            {showMT1 && (
                              <td className="py-1 px-1 border-r border-slate-200 text-center">
                                {renderGrade(grades.mt1, isDebtor, isDesistente)}
                              </td>
                            )}
                            {showMT2 && (
                              <td className="py-1 px-1 border-r border-slate-200 text-center">
                                {renderGrade(grades.mt2, isDebtor, isDesistente)}
                              </td>
                            )}
                            {showMT3 && (
                              <td className="py-1 px-1 border-r border-slate-200 text-center">
                                {renderGrade(grades.mt3, isDebtor, isDesistente)}
                              </td>
                            )}
                            {showMFD && (
                              <td className="py-1 px-1 border-r border-slate-200 font-mono font-bold text-center">
                                {renderGrade(grades.mfd, isDebtor, isDesistente, true)}
                              </td>
                            )}
                            {showSubjMF && (
                              <td className="py-1 px-1 border-r border-slate-200 bg-rose-50/60 font-mono font-bold text-center">
                                {renderGrade(grades.mf ?? '', isDebtor, isDesistente, true)}
                              </td>
                            )}
                            {showSubjNER && (
                              <td className="py-1 px-1 border-r border-slate-200 font-mono font-bold text-center">
                                {isKeySubjectFor(subj, activeClass?.grade, classCtx?.courseName)
                                  ? <span className="text-slate-300 font-mono select-none">-</span>
                                  : renderGrade(grades.ner ?? '', isDebtor, isDesistente)}
                              </td>
                            )}
                            {!showMT1 && !showMT2 && !showMT3 && !showMFD && !showSubjMF && !showSubjNER && (
                              <td className="py-1 px-1 border-r border-slate-200 font-mono font-bold text-center">
                                {renderGrade(grades.mfd, isDebtor, isDesistente, true)}
                              </td>
                            )}
                          </React.Fragment>
                        );
                      })}

                      {showMF && (
                        <td className="py-1.5 px-2 border-r border-slate-200 bg-rose-50/60 font-mono font-black text-center">
                          {isDesistente ? (
                            <span className="text-slate-300 font-mono">-</span>
                          ) : isDebtor && hideDebtorGrades ? (
                            <span className="text-slate-400 font-mono font-bold text-xs select-none">
                              -
                            </span>
                          ) : (
                            <span
                              className={`font-mono text-xs font-black ${
                                typeof row.mf === 'number' && row.mf < 10 ? 'text-rose-600' : 'text-slate-900'
                              }`}
                            >
                              {row.mf !== '' ? row.mf : '-'}
                            </span>
                          )}
                        </td>
                      )}

                      <td className="py-1.5 px-2 text-center">
                        {renderSituationBadge(row)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Legenda das abreviaturas das disciplinas */}
        {subjects.length > 0 && !fullNames && (
          <div className="mt-2 border border-slate-300 bg-slate-50 px-2 py-1.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-0.5">
              Legenda das Disciplinas
            </span>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-slate-700">
              {subjects.map((subj) => (
                <span key={`leg-${subj.id}`} className="whitespace-nowrap">
                  <strong className="font-mono font-bold text-[#0b1f3a]">
                    {subjectAbbreviations.get(subj.name) || subj.name}
                  </strong>
                  {' = '}
                  {subj.name}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="text-center text-xs font-bold pt-3 print:text-[10px]">{header.placeAndDate}</div>
        {renderSignatures()}
      </div>
    </div>
  );
};
