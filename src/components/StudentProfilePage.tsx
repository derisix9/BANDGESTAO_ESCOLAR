import React, { useMemo, useState } from 'react';
import {
  SchoolDatabase,
  Student,
  UserRole,
  Matricula,
  TuitionInvoice,
  StudentMedicalRecord,
  DisciplinaryIncident
} from '../types';
import { useAccessControl, AccessControl } from '../hooks/useAccessControl';
import { getFallbackAcademicYear } from '../utils/academicYear';
import { resolveStudentSituation } from '../utils/studentSituation';
import {
  SITUACAO_FINANCEIRA_BADGE,
  SITUACAO_FINANCEIRA_LABEL,
  localISODate,
  resolveFinancialSituation
} from '../utils/financialSituation';
import {
  getStudentAcademicYears,
  getStudentRecordsForYear,
  getStudentArchiveForYear,
  findMatriculaForYear,
  getLiveGradesYear
} from '../utils/studentGrades';
import { getStudentYearAcademicReport } from '../utils/studentYearReport';
import { SUBMISSION_STATE_META, submissionState, type Submission } from '../utils/elearning';
import { DOC_LABEL } from '../utils/academicProcesses';
import {
  ALLERGY_SEVERITY_META,
  BLOOD_TYPE_LABELS,
  DISCIPLINARY_MEASURE_LABELS,
  INCIDENT_CATEGORY_LABELS,
  INCIDENT_SEVERITY_META,
  INCIDENT_STATUS_META,
  MEDICAL_OCCURRENCE_TYPE_LABELS,
  PICKUP_AUTH_KIND_META,
  PICKUP_AUTH_STATUS_META,
  PICKUP_REASON_LABELS,
  PICKUP_RELATION_LABELS,
  VACCINATION_STATUS_LABELS
} from '../utils/healthSafety';
import { StudentYearRecordModal } from './StudentYearRecordModal';
import { Notice } from './Notice';
import { safeDownloadHref, safeImageDataUrl } from '../utils/safeFiles';

/* ------------------------------------------------------------------ */
/* Tipos e utilitários                                                  */
/* ------------------------------------------------------------------ */

type TabKey =
  | 'ficha'
  | 'saude'
  | 'encarregado'
  | 'matriculas'
  | 'historicos'
  | 'financeiro'
  | 'documentos'
  | 'trabalhos'
  | 'ocorrencias'
  | 'anexos'
  | 'aulas'
  | 'notas';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'ficha', label: 'Ficha', icon: 'badge' },
  { key: 'saude', label: 'Saúde', icon: 'monitor_heart' },
  { key: 'encarregado', label: 'Encarregado', icon: 'supervisor_account' },
  { key: 'matriculas', label: 'Matrículas', icon: 'assignment_turned_in' },
  { key: 'historicos', label: 'Históricos', icon: 'history_edu' },
  { key: 'financeiro', label: 'Financeiro', icon: 'payments' },
  { key: 'documentos', label: 'Documentos', icon: 'folder_open' },
  { key: 'trabalhos', label: 'Trabalhos', icon: 'menu_book' },
  { key: 'ocorrencias', label: 'Ocorrências', icon: 'report' },
  { key: 'anexos', label: 'Anexos', icon: 'attach_file' },
  { key: 'aulas', label: 'Aulas', icon: 'event_available' },
  { key: 'notas', label: 'Comprovativos de Notas', icon: 'workspace_premium' }
];

interface Ctx {
  db: SchoolDatabase;
  student: Student;
  matriculas: Matricula[];
  currentYear: string;
  acl: AccessControl;
  onOpenReportCard: (student: Student) => void;
}

const DASH = '—';

const txt = (v: unknown): string => {
  if (v === undefined || v === null) return DASH;
  const s = String(v).trim();
  return s === '' ? DASH : s;
};

const parseDate = (v?: string): Date | null => {
  if (!v) return null;
  const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const fmtDate = (v?: string): string => {
  if (!v) return DASH;
  const d = parseDate(v);
  return d ? d.toLocaleDateString('pt-PT') : v;
};

const fmtDateTime = (v?: string): string => {
  if (!v) return DASH;
  const d = parseDate(v);
  return d ? `${d.toLocaleDateString('pt-PT')} ${d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}` : v;
};

const kz = (n?: number): string => `${(Number(n) || 0).toLocaleString('pt-AO')} Kz`;

const ageOf = (birth?: string): string => {
  const d = parseDate(birth);
  if (!d) return DASH;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 ? `${age} anos` : DASH;
};

const formatFileSize = (bytes: number): string => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const num = (v: unknown): number | null => {
  if (v === '' || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const sameId = (a: unknown, b: unknown) => String(a) === String(b);

/* ------------------------------------------------------------------ */
/* Peças visuais                                                        */
/* ------------------------------------------------------------------ */

const Section: React.FC<{ title: string; icon?: string; aside?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  icon,
  aside,
  children
}) => (
  <section className="mt-6 first:mt-0 print-break-avoid">
    <div className="flex items-center justify-between gap-2 pb-1.5 mb-3 border-b-2 border-slate-300">
      <h3 className="flex items-center gap-2 text-[13px] font-extrabold uppercase tracking-wide text-[#0b1f3a]">
        {icon && <span className="material-symbols-outlined text-[18px]">{icon}</span>}
        {title}
      </h3>
      {aside}
    </div>
    {children}
  </section>
);

const Grid: React.FC<{ cols?: 2 | 3 | 4 | 5; children: React.ReactNode }> = ({ cols = 4, children }) => {
  const map: Record<number, string> = {
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-2 md:grid-cols-3',
    4: 'grid-cols-2 md:grid-cols-4',
    5: 'grid-cols-2 md:grid-cols-5'
  };
  return <div className={`grid ${map[cols]} gap-x-6 gap-y-3.5`}>{children}</div>;
};

const Fld: React.FC<{ label: string; children?: React.ReactNode; value?: unknown; mono?: boolean; wide?: boolean }> = ({
  label,
  children,
  value,
  mono,
  wide
}) => (
  <div className={wide ? 'col-span-2' : undefined}>
    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
    <div className={`text-[13px] text-slate-900 font-semibold break-words ${mono ? 'font-mono' : ''}`}>
      {children !== undefined ? children : txt(value)}
    </div>
  </div>
);

const Badge: React.FC<{ cls?: string; children: React.ReactNode }> = ({
  cls = 'bg-slate-100 text-slate-700 border-slate-300',
  children
}) => (
  <span className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase border ${cls}`}>{children}</span>
);

/** Para os mapas de rótulos do sistema (`badge: 'bg-x text-y'`), sem moldura. */
const Pill: React.FC<{ cls?: string; children: React.ReactNode }> = ({ cls = 'bg-slate-100 text-slate-700', children }) => (
  <span className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase ${cls}`}>{children}</span>
);

const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: 'navy' | 'green' | 'red' | 'amber' | 'blue' }> = ({
  label,
  value,
  tone = 'navy'
}) => {
  const tones: Record<string, string> = {
    navy: 'border-l-[#0b1f3a] text-[#0b1f3a]',
    green: 'border-l-emerald-600 text-emerald-700',
    red: 'border-l-red-600 text-red-700',
    amber: 'border-l-amber-500 text-amber-700',
    blue: 'border-l-blue-600 text-blue-700'
  };
  return (
    <div className={`bg-slate-50 border border-slate-300 border-l-4 ${tones[tone]} px-3 py-2.5`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-lg font-black leading-tight mt-0.5">{value}</div>
    </div>
  );
};

const Stats: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">{children}</div>
);

const Empty: React.FC<{ icon?: string; children: React.ReactNode }> = ({ icon = 'inbox', children }) => (
  <div className="flex flex-col items-center justify-center gap-1.5 py-8 border border-dashed border-slate-300 bg-slate-50/60 text-slate-500 text-xs text-center px-4">
    <span className="material-symbols-outlined text-[28px] text-slate-300">{icon}</span>
    <span>{children}</span>
  </div>
);

const Restricted: React.FC<{ rule: string; what: string }> = ({ rule, what }) => (
  <Notice tone="warn" icon="lock">
    <span>
      Sem permissão para ver {what} (regra <code className="font-mono font-bold">{rule}</code>). Peça ao Administrador
      para ajustar a matriz em Configurações → Perfis &amp; Permissões.
    </span>
  </Notice>
);

const Table: React.FC<{ head: string[]; children: React.ReactNode }> = ({ head, children }) => (
  <div className="overflow-x-auto border border-slate-300">
    <table className="w-full text-left text-xs border-collapse">
      <thead>
        <tr className="bg-[#0b1f3a] text-white font-bold uppercase text-[10px] tracking-wider">
          {head.map((h) => (
            <th key={h} className="py-2.5 px-3 border-r border-slate-800/40 last:border-r-0 whitespace-nowrap">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-200 bg-white">{children}</tbody>
    </table>
  </div>
);

const Td: React.FC<{ children?: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <td className={`py-2.5 px-3 align-top border-r border-slate-100 last:border-r-0 ${className}`}>{children}</td>
);

const ChipList: React.FC<{ items: React.ReactNode[]; empty: string }> = ({ items, empty }) =>
  items.length === 0 ? (
    <span className="text-xs text-slate-400 italic">{empty}</span>
  ) : (
    <div className="flex flex-wrap gap-1.5">{items}</div>
  );

/* ------------------------------------------------------------------ */
/* 1. FICHA                                                             */
/* ------------------------------------------------------------------ */

const FichaTab: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { student: s, matriculas, acl, db } = ctx;
  const sensitive = acl.can('alunos.sensitive');
  const fil = s.filiation;
  const res = s.residence;
  const prev = s.previousSchoolDetails;
  const nee = s.specialNeeds;
  const photo = s.docPassPhoto || s.avatar || '/avatar-padrao.png';
  const local =
    [s.naturalidade || s.birthPlace || s.placeOfBirth, s.birthMunicipality, s.birthProvince].filter(Boolean).join(' / ') ||
    DASH;
  const situacao = resolveStudentSituation(s, db.matriculas);
  const detailedParents = !!fil?.parentsDetailedInfo;

  return (
    <div>
      {/* Identificação */}
      <div className="flex flex-col sm:flex-row gap-6">
        <div className="shrink-0">
          <img
            src={photo}
            alt={s.name}
            className="w-32 h-40 object-cover border-2 border-[#0b1f3a] bg-slate-100"
          />
          <div className="mt-2 text-center">
            <Badge cls="bg-emerald-50 text-emerald-800 border-emerald-300">{situacao}</Badge>
          </div>
        </div>

        <div className="flex-1 space-y-4">
          <Grid cols={3}>
            <Fld label="Número">
              <span className="font-mono text-lg font-black text-[#0b1f3a]">{txt(s.procNumber)}</span>
            </Fld>
            <Fld label="Nome" wide>
              <span className="text-lg font-black text-[#0b1f3a]">{s.name}</span>
            </Fld>
            <Fld label="Apelido / Nome Social" value={s.socialName} />
          </Grid>
          <Grid cols={4}>
            <Fld label="Sexo" value={s.gender === 'M' ? 'Masculino' : s.gender === 'F' ? 'Feminino' : s.gender} />
            <Fld label="Estado Civil" value={s.maritalStatus} />
            <Fld label="Data de Nascimento" value={fmtDate(s.birthDate)} />
            <Fld label="Idade" value={ageOf(s.birthDate)} />
            <Fld label="Local de Nascimento" value={local} wide />
            <Fld
              label="Nacionalidade"
              value={[s.nationality, s.birthCountry].filter(Boolean).join(' / ') || DASH}
            />
            <Fld label="Grupo Sanguíneo" value={s.bloodType} />
            <Fld label="Necessidades Especiais">
              {!sensitive ? (
                <span className="text-slate-400 italic">Acesso restrito</span>
              ) : nee?.hasNeeds ? (
                <span className="text-amber-700">Sim{nee.type ? ` — ${nee.type}` : ''}</span>
              ) : (
                'Não'
              )}
            </Fld>
          </Grid>
          <Grid cols={4}>
            <Fld label="Tipo de Documento" value={s.docType || 'B.I. / Passaporte'} />
            <Fld label="N.º do Documento" value={s.biNumber || s.citizenCard} mono />
            <Fld label="Válido até" value={fmtDate(s.docValidUntil)} />
            <Fld label="NIF" value={s.nif} mono />
          </Grid>
        </div>
      </div>

      {/* Filiação */}
      <Section title="Filiação" icon="family_restroom">
        {!sensitive ? (
          <Restricted rule="alunos.sensitive" what="a filiação do aluno" />
        ) : (
          <>
            <Grid cols={2}>
              <Fld label="Nome da Mãe" value={fil?.mother?.name} />
              <Fld label="Nome do Pai" value={fil?.father?.name} />
            </Grid>
            {detailedParents && (
              <div className="mt-3.5">
                <Grid cols={4}>
                  <Fld label="B.I. da Mãe" value={fil?.mother?.bi} mono />
                  <Fld label="Telefone da Mãe" value={fil?.mother?.phone} mono />
                  <Fld label="Profissão da Mãe" value={fil?.mother?.profession} />
                  <Fld label="Residência da Mãe" value={fil?.mother?.residence} />
                  <Fld label="B.I. do Pai" value={fil?.father?.bi} mono />
                  <Fld label="Telefone do Pai" value={fil?.father?.phone} mono />
                  <Fld label="Profissão do Pai" value={fil?.father?.profession} />
                  <Fld label="Residência do Pai" value={fil?.father?.residence} />
                </Grid>
              </div>
            )}
          </>
        )}
      </Section>

      {/* Contacto */}
      <Section title="Contacto" icon="call">
        <Grid cols={4}>
          <Fld label="Celular" value={s.studentPhone} mono />
          <Fld label="Telefone Residencial" value={res?.phone} mono />
          <Fld label="E-mail Pessoal" value={s.email || res?.email} />
          <Fld label="Telefone do Encarregado" value={s.guardianPhone} mono />
        </Grid>
      </Section>

      {/* Residência */}
      <Section title="Residência" icon="home">
        <Grid cols={4}>
          <Fld
            label="Logradouro"
            value={[res?.street, res?.houseNumber ? `n.º ${res.houseNumber}` : ''].filter(Boolean).join(', ') || s.address}
            wide
          />
          <Fld label="Ponto de Referência" value={res?.referencePoint} />
          <Fld label="Bairro" value={res?.neighborhood} />
          <Fld label="Distrito Urbano" value={res?.urbanDistrict} />
          <Fld label="Comuna" value={res?.commune} />
          <Fld label="Município" value={res?.municipality} />
          <Fld label="Província" value={res?.province} />
        </Grid>
      </Section>

      {/* Proveniência escolar */}
      <Section title="Proveniência Escolar" icon="school">
        <Grid cols={4}>
          <Fld label="Escola de Origem" value={prev?.school || s.previousSchool} wide />
          <Fld label="Município / Província" value={[prev?.municipality, prev?.province].filter(Boolean).join(' / ') || DASH} />
          <Fld label="Ano Lectivo" value={prev?.academicYear} />
          <Fld label="Última Classe Concluída" value={prev?.completedGrade || prev?.lastGrade || s.lastCompletedGrade} />
          <Fld label="Média Final" value={prev?.finalAverage !== undefined ? `${prev.finalAverage} valores` : DASH} />
          <Fld label="Resultado" value={prev?.result || s.academicSituation} />
          <Fld
            label="Certificado / Declaração"
            value={
              [prev?.certificateNumber && `Cert. n.º ${prev.certificateNumber}`, prev?.declarationNumber && `Decl. n.º ${prev.declarationNumber}`]
                .filter(Boolean)
                .join(' · ') || DASH
            }
          />
        </Grid>
      </Section>

      {/* Situação académica */}
      <Section title="Situação Académica" icon="info">
        <Grid cols={4}>
          <Fld label="Situação do Aluno" value={situacao} />
          <Fld label="Classe / Turma actual" value={`${txt(matriculas[0]?.grade || s.grade)} — ${txt(matriculas[0]?.className || s.className)}`} />
          <Fld label="Turno / Sala" value={`${txt(matriculas[0]?.shift || s.shift)} / ${txt(matriculas[0]?.classroomRoom || s.classroomRoom)}`} />
          <Fld label="Código Interno" value={s.code} mono />
        </Grid>
        {sensitive && nee?.hasNeeds && (
          <div className="mt-3.5 px-3.5 py-2.5 border border-amber-300 bg-amber-50 text-xs text-amber-900">
            <strong>Necessidades Educativas Especiais:</strong> {txt(nee.type)}
            {nee.needsSupport ? ' · Requer apoio especializado' : ''}
            {nee.observations ? ` — ${nee.observations}` : ''}
          </div>
        )}
      </Section>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* 2. SAÚDE                                                             */
/* ------------------------------------------------------------------ */

const SaudeTab: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { db, student, acl } = ctx;
  const allowed = acl.can('saude.ficha_medica.view');

  const rec: StudentMedicalRecord | undefined = useMemo(() => {
    const own = (db.medicalRecords || []).filter((r) => sameId(r.studentId, student.id));
    return own.sort((a, b) =>
      String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))
    )[0];
  }, [db.medicalRecords, student.id]);

  if (!allowed) return <Restricted rule="saude.ficha_medica.view" what="a ficha médica (dado de saúde confidencial)" />;
  if (!rec) {
    return (
      <Empty icon="medical_information">
        Este aluno ainda não tem Ficha Médica registada. Pode criá-la em Saúde &amp; Segurança → Ficha Médica.
        {student.bloodType ? ` Grupo sanguíneo na ficha de cadastro: ${student.bloodType}.` : ''}
      </Empty>
    );
  }

  const occ = [...(rec.occurrences || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return (
    <div>
      <Stats>
        <Stat label="Grupo Sanguíneo" value={BLOOD_TYPE_LABELS[rec.bloodType] || rec.bloodType} tone="red" />
        <Stat label="Vacinação" value={VACCINATION_STATUS_LABELS[rec.vaccinationStatus] || txt(rec.vaccinationStatus)} tone="green" />
        <Stat label="Alergias" value={(rec.allergies || []).length} tone="amber" />
        <Stat label="Ocorrências de Saúde" value={occ.length} tone="blue" />
      </Stats>

      <Section title="Ficha Médica" icon="medical_information" aside={<span className="font-mono text-[11px] text-slate-500">{rec.code}</span>}>
        <div className="space-y-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Alergias</div>
            <ChipList
              empty="Nenhuma alergia registada"
              items={(rec.allergies || []).map((a, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 border border-slate-300 bg-white px-2 py-1 text-xs">
                  <strong>{a.substance}</strong>
                  <Pill cls={ALLERGY_SEVERITY_META[a.severity]?.badge}>{ALLERGY_SEVERITY_META[a.severity]?.label || a.severity}</Pill>
                  {a.reaction && <span className="text-slate-500">· {a.reaction}</span>}
                </span>
              ))}
            />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Condições Crónicas / Médicas</div>
            <ChipList
              empty="Nenhuma condição registada"
              items={(rec.conditions || []).map((c, i) => (
                <span key={i} className="border border-slate-300 bg-white px-2 py-1 text-xs">
                  <strong>{c.name}</strong>
                  {c.notes ? <span className="text-slate-500"> · {c.notes}</span> : null}
                </span>
              ))}
            />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Medicação</div>
            <ChipList
              empty="Sem medicação registada"
              items={(rec.medications || []).map((m, i) => (
                <span key={i} className="border border-slate-300 bg-white px-2 py-1 text-xs">
                  <strong>{m.name}</strong>
                  <span className="text-slate-500">
                    {m.dosage ? ` · ${m.dosage}` : ''}
                    {m.schedule ? ` · ${m.schedule}` : ''}
                    {m.administeredAtSchool ? ' · administrada na escola' : ''}
                  </span>
                </span>
              ))}
            />
          </div>
          {rec.vaccinationNotes && (
            <Fld label="Notas de Vacinação" value={rec.vaccinationNotes} />
          )}
        </div>
      </Section>

      <Section title="Assistência e Contactos de Emergência" icon="emergency">
        <Grid cols={4}>
          <Fld label="Médico Assistente" value={rec.physicianName} />
          <Fld label="Telefone do Médico" value={rec.physicianPhone} mono />
          <Fld label="Unidade de Saúde" value={rec.preferredHealthUnit} />
          <Fld label="Seguro de Saúde" value={[rec.healthInsurance, rec.healthInsurancePolicy].filter(Boolean).join(' · ') || DASH} />
          <Fld
            label="Autorização de Tratamento de Urgência"
            value={rec.emergencyTreatmentConsent ? `Concedida${rec.consentGivenBy ? ` por ${rec.consentGivenBy}` : ''}` : 'Não concedida'}
            wide
          />
        </Grid>
        <div className="mt-4">
          {(rec.emergencyContacts || []).length === 0 ? (
            <Empty icon="contact_phone">Sem contactos de emergência registados.</Empty>
          ) : (
            <Table head={['Contacto', 'Parentesco', 'Telefone']}>
              {rec.emergencyContacts.map((c, i) => (
                <tr key={i}>
                  <Td className="font-bold">{c.name}</Td>
                  <Td>{c.relation}</Td>
                  <Td className="font-mono">{c.phone}</Td>
                </tr>
              ))}
            </Table>
          )}
        </div>
        {rec.notes && (
          <div className="mt-3 px-3 py-2 border border-slate-300 bg-slate-50 text-xs text-slate-700">
            <strong>Observações:</strong> {rec.notes}
          </div>
        )}
      </Section>

      <Section title="Ocorrências de Saúde" icon="vaccines">
        {occ.length === 0 ? (
          <Empty icon="health_and_safety">Nenhuma ocorrência de saúde registada para este aluno.</Empty>
        ) : (
          <Table head={['Data / Hora', 'Tipo', 'Descrição', 'Acção Tomada', 'Encarregado Avisado', 'Encaminhado', 'Registado por']}>
            {occ.map((o) => (
              <tr key={o.id}>
                <Td className="whitespace-nowrap font-mono">
                  {fmtDate(o.date)}
                  {o.time ? ` ${o.time}` : ''}
                </Td>
                <Td>{MEDICAL_OCCURRENCE_TYPE_LABELS[o.type] || o.type}</Td>
                <Td className="max-w-xs">{o.description}</Td>
                <Td className="max-w-xs">{txt(o.actionTaken)}</Td>
                <Td>{o.guardianNotified ? <Badge cls="bg-emerald-50 text-emerald-800 border-emerald-300">Sim</Badge> : <Badge>Não</Badge>}</Td>
                <Td>{o.referredToHealthUnit ? <Badge cls="bg-amber-50 text-amber-800 border-amber-300">Sim</Badge> : <Badge>Não</Badge>}</Td>
                <Td>{o.recordedBy}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* 3. ENCARREGADO                                                       */
/* ------------------------------------------------------------------ */

const PersonCard: React.FC<{
  title: string;
  icon: string;
  rows: { label: string; value?: unknown; mono?: boolean }[];
}> = ({ title, icon, rows }) => (
  <div className="border border-slate-300 bg-slate-50/50 p-4">
    <div className="flex items-center gap-2 pb-2 mb-3 border-b border-slate-200 text-[#0b1f3a]">
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
      <h4 className="font-bold text-xs uppercase tracking-wider">{title}</h4>
    </div>
    <div className="grid grid-cols-2 gap-x-5 gap-y-3">
      {rows.map((r) => (
        <Fld key={r.label} label={r.label} value={r.value} mono={r.mono} />
      ))}
    </div>
  </div>
);

const EncarregadoTab: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { db, student: s, matriculas, acl } = ctx;
  const sensitive = acl.can('alunos.sensitive');
  const fil = s.filiation;
  const g = fil?.guardian;
  const fin = fil?.financialResponsible;
  const last = matriculas[0];

  const links = (db.guardianLinks || []).filter((l) => sameId(l.studentId, s.id));
  const meetings = (db.parentTeacherMeetings || [])
    .map((m) => ({ m, p: (m.participants || []).find((p) => sameId(p.studentId, s.id)) }))
    .filter((x) => !!x.p)
    .sort((a, b) => String(b.m.date).localeCompare(String(a.m.date)));

  return (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PersonCard
          title="Encarregado de Educação"
          icon="supervisor_account"
          rows={[
            { label: 'Nome', value: s.guardianName || g?.name },
            { label: 'Parentesco', value: s.guardianRelation || g?.relation },
            { label: 'Telefone', value: s.guardianPhone || g?.phone, mono: true },
            { label: 'E-mail', value: s.guardianEmail || g?.email },
            { label: 'NIF', value: s.guardianNif, mono: true },
            { label: 'B.I.', value: g?.bi, mono: true },
            { label: 'Profissão', value: g?.profession },
            { label: 'Residência', value: g?.residence }
          ]}
        />
        <PersonCard
          title="Responsável Financeiro"
          icon="account_balance_wallet"
          rows={
            fil?.financialResponsibleIsDifferent && fin
              ? [
                  { label: 'Nome', value: fin.name },
                  { label: 'Telefone', value: fin.phone, mono: true },
                  { label: 'E-mail', value: fin.email },
                  { label: 'B.I.', value: fin.bi, mono: true },
                  { label: 'Profissão', value: fin.profession },
                  { label: 'Residência', value: fin.residence }
                ]
              : [
                  { label: 'Nome', value: last?.responsavelFinanceiroNome || s.guardianName },
                  { label: 'Telefone', value: last?.responsavelFinanceiroTelefone || s.guardianPhone, mono: true },
                  { label: 'Situação', value: 'O próprio Encarregado de Educação' },
                  { label: 'Forma de Pagamento', value: last?.formaPagamento }
                ]
          }
        />
      </div>

      <Section title="Pai e Mãe" icon="family_restroom">
        {!sensitive ? (
          <Restricted rule="alunos.sensitive" what="os dados do Pai e da Mãe" />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <PersonCard
              title="Mãe"
              icon="woman"
              rows={[
                { label: 'Nome', value: fil?.mother?.name },
                { label: 'Telefone', value: fil?.mother?.phone, mono: true },
                { label: 'E-mail', value: fil?.mother?.email },
                { label: 'Profissão', value: fil?.mother?.profession }
              ]}
            />
            <PersonCard
              title="Pai"
              icon="man"
              rows={[
                { label: 'Nome', value: fil?.father?.name },
                { label: 'Telefone', value: fil?.father?.phone, mono: true },
                { label: 'E-mail', value: fil?.father?.email },
                { label: 'Profissão', value: fil?.father?.profession }
              ]}
            />
          </div>
        )}
      </Section>

      <Section title="Contas do Portal do Encarregado Vinculadas" icon="link">
        {links.length === 0 ? (
          <Empty icon="link_off">
            Nenhuma conta de Encarregado vinculada a este aluno em Secretaria → Vínculos de Filhos.
          </Empty>
        ) : (
          <Table head={['Encarregado', 'E-mail', 'Parentesco', 'Resp. Financeiro', 'Estado', 'Vinculado em']}>
            {links.map((l) => (
              <tr key={l.id}>
                <Td className="font-bold">{l.guardianName}</Td>
                <Td>{l.guardianEmail}</Td>
                <Td className="capitalize">{l.relationOther || l.relation}</Td>
                <Td>{l.financialResponsible ? <Badge cls="bg-sky-50 text-sky-800 border-sky-300">Sim</Badge> : 'Não'}</Td>
                <Td>
                  <Badge cls={l.status === 'ativo' ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 'bg-slate-100 text-slate-600 border-slate-300'}>
                    {String(l.status)}
                  </Badge>
                </Td>
                <Td className="whitespace-nowrap">{fmtDate(l.linkedAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Reuniões Pais-Professores" icon="groups">
        {meetings.length === 0 ? (
          <Empty icon="event_busy">Este encarregado ainda não foi convocado para nenhuma reunião.</Empty>
        ) : (
          <Table head={['Data', 'Reunião', 'Professor', 'Tipo', 'Estado', 'Presença do Encarregado']}>
            {meetings.map(({ m, p }) => (
              <tr key={m.id}>
                <Td className="whitespace-nowrap font-mono">
                  {fmtDate(m.date)} {m.startTime}
                </Td>
                <Td className="font-bold">{m.title}</Td>
                <Td>{m.teacherName}</Td>
                <Td className="capitalize">{m.type}</Td>
                <Td className="capitalize">{m.status}</Td>
                <Td className="capitalize">{txt(p?.status)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* 4. MATRÍCULAS                                                        */
/* ------------------------------------------------------------------ */

const ESTADO_MATRICULA_CLS: Record<string, string> = {
  matriculado: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  confirmada: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  concluida: 'bg-sky-50 text-sky-800 border-sky-300',
  pendente: 'bg-blue-50 text-blue-800 border-blue-300',
  cancelada: 'bg-red-50 text-red-800 border-red-300',
  transferida: 'bg-red-50 text-red-800 border-red-300'
};

const MatriculasTab: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { matriculas } = ctx;
  if (matriculas.length === 0) {
    return <Empty icon="assignment_late">Este aluno ainda não tem nenhuma matrícula registada. Faça-a em Secretaria → Matrículas.</Empty>;
  }
  const activas = matriculas.filter((m) => m.estado === 'matriculado' || m.estado === 'confirmada').length;
  const totalPropina = matriculas[0]?.valorPropinaKz || 0;

  return (
    <div>
      <Stats>
        <Stat label="Total de Matrículas" value={matriculas.length} />
        <Stat label="Activas / Confirmadas" value={activas} tone="green" />
        <Stat label="Primeira Matrícula" value={fmtDate(matriculas[matriculas.length - 1]?.dataMatricula)} tone="blue" />
        <Stat label="Propina Actual" value={kz(totalPropina)} tone="amber" />
      </Stats>
      <Table
        head={[
          'N.º Matrícula',
          'Ano Lectivo',
          'Classe',
          'Curso',
          'Turma',
          'Turno / Sala',
          'Data',
          'Tipo',
          'Estado',
          'Tipo de Aluno',
          'Taxa de Matrícula',
          'Propina',
          'Desconto',
          'Pagamento'
        ]}
      >
        {matriculas.map((m) => (
          <tr key={m.id} className="hover:bg-slate-50">
            <Td className="font-mono font-bold whitespace-nowrap">{m.numeroMatricula}</Td>
            <Td className="whitespace-nowrap font-semibold">{m.academicYear}</Td>
            <Td>{m.grade}</Td>
            <Td>{txt(m.courseName)}</Td>
            <Td className="font-semibold">{m.className}</Td>
            <Td className="whitespace-nowrap">
              {txt(m.shift)}
              {m.classroomRoom ? ` · Sala ${m.classroomRoom}` : ''}
            </Td>
            <Td className="whitespace-nowrap">{fmtDate(m.dataMatricula)}</Td>
            <Td className="capitalize">{m.tipo}</Td>
            <Td>
              <Badge cls={ESTADO_MATRICULA_CLS[m.estado]}>{m.estado}</Badge>
            </Td>
            <Td className="capitalize">{m.tipoAluno}</Td>
            <Td className="font-mono whitespace-nowrap">{kz(m.valorMatriculaKz)}</Td>
            <Td className="font-mono whitespace-nowrap">{kz(m.valorPropinaKz)}/mês</Td>
            <Td className="font-mono whitespace-nowrap">
              {m.descontoPercent ? `${m.descontoPercent}%` : m.descontoKz ? kz(m.descontoKz) : DASH}
            </Td>
            <Td>
              {txt(m.formaPagamento)}
              {m.diaVencimento ? ` · dia ${m.diaVencimento}` : ''}
              {m.numeroParcelas ? ` · ${m.numeroParcelas}x` : ''}
            </Td>
          </tr>
        ))}
      </Table>
      {matriculas.some((m) => m.observacoes || m.escolaOrigem) && (
        <div className="mt-4 space-y-1.5 text-xs text-slate-700">
          {matriculas
            .filter((m) => m.observacoes || m.escolaOrigem)
            .map((m) => (
              <div key={m.id} className="px-3 py-2 border border-slate-300 bg-slate-50">
                <strong className="font-mono">{m.numeroMatricula}</strong>
                {m.escolaOrigem ? ` · Veio de ${m.escolaOrigem}${m.guiaTransferenciaNumero ? ` (Guia n.º ${m.guiaTransferenciaNumero})` : ''}` : ''}
                {m.observacoes ? ` · ${m.observacoes}` : ''}
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Notas — cálculo comum a Históricos e Comprovativos                    */
/* ------------------------------------------------------------------ */

const meanOf = (values: Array<number | null>): number | null => {
  const v = values.filter((x): x is number => x !== null && x > 0);
  if (v.length === 0) return null;
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
};

const SITUACAO_CLS: Record<string, string> = {
  Aprovado: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  'Não Aprovado': 'bg-red-50 text-red-800 border-red-300',
  'Exame de Recurso': 'bg-amber-50 text-amber-800 border-amber-300',
  'Em Curso': 'bg-blue-50 text-blue-800 border-blue-300',
  'Sem Notas': 'bg-slate-100 text-slate-500 border-slate-300',
  Desistente: 'bg-slate-100 text-slate-600 border-slate-300',
  Transferido: 'bg-slate-100 text-slate-600 border-slate-300'
};

/* ------------------------------------------------------------------ */
/* 5. HISTÓRICOS                                                        */
/* ------------------------------------------------------------------ */

const HistoricosTab: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { db, student: s, currentYear } = ctx;

  const years = useMemo(() => getStudentAcademicYears(s, db.matriculas, currentYear), [s, db.matriculas, currentYear]);

  const rows = useMemo(
    () =>
      years.map((year) => {
        const mat = findMatriculaForYear(db.matriculas, s.id, year);
        const recs = getStudentRecordsForYear(s, year, currentYear);
        const archive = getStudentArchiveForYear(s, year);
        const isLive = year === getLiveGradesYear(s, currentYear);
        const report = mat ? getStudentYearAcademicReport(db, s, mat) : null;
        const avg =
          archive?.finalAverage ??
          (isLive && s.currentAverage > 0 ? s.currentAverage : meanOf(recs.map((r) => num(r.ca) ?? num(r.mfd))));
        const faltas = (report?.assiduidade || []).reduce((n, a) => n + a.faltasJustificadas + a.faltasInjustificadas, 0);
        return { year, mat, recs, archive, report, avg, faltas };
      }),
    [years, db, s, currentYear]
  );

  const transfers = (db.studentTransfers || []).filter((t) => sameId(t.studentId, s.id));
  const deps = (db.studentDependencies || []).filter((d) => sameId(d.studentId, s.id));
  const recov = (db.recoveryRecords || []).filter((r) => sameId(r.studentId, s.id));
  const descr = (db.descriptiveAssessments || []).filter((d) => sameId(d.studentId, s.id));
  const councils = (db.classCouncils || [])
    .map((c) => ({ c, e: (c.entries || []).find((e) => sameId(e.studentId, s.id)) }))
    .filter((x) => !!x.e);
  const prev = s.previousSchoolDetails;

  return (
    <div>
      <Section title="Histórico Académico nesta Instituição" icon="history_edu">
        {rows.length === 0 ? (
          <Empty icon="school">Ainda não há anos lectivos com registos para este aluno.</Empty>
        ) : (
          <Table head={['Ano Lectivo', 'Classe / Turma', 'Disciplinas', 'Média Final', 'Faltas', 'Resultado', 'Matrícula']}>
            {rows.map((r) => {
              const situ = r.report?.situacaoGeral || (r.recs.length ? 'Em Curso' : 'Sem Notas');
              return (
                <tr key={r.year}>
                  <Td className="font-bold whitespace-nowrap">{r.year}</Td>
                  <Td>
                    {r.mat ? `${r.mat.grade} — ${r.mat.className}` : r.archive ? `${txt(r.archive.grade)} — ${txt(r.archive.className)}` : DASH}
                  </Td>
                  <Td>{r.recs.length || DASH}</Td>
                  <Td className="font-mono font-bold">{r.avg ? `${r.avg} val.` : DASH}</Td>
                  <Td>{r.report ? r.faltas : DASH}</Td>
                  <Td>
                    <Badge cls={SITUACAO_CLS[situ]}>{situ}</Badge>
                  </Td>
                  <Td className="font-mono">{r.mat?.numeroMatricula || DASH}</Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Section>

      <Section title="Proveniência Escolar Anterior" icon="north_west">
        {prev || s.previousSchool ? (
          <Grid cols={4}>
            <Fld label="Escola" value={prev?.school || s.previousSchool} wide />
            <Fld label="Última Classe" value={prev?.completedGrade || prev?.lastGrade || s.lastCompletedGrade} />
            <Fld label="Ano Lectivo" value={prev?.academicYear} />
            <Fld label="Média Final" value={prev?.finalAverage !== undefined ? `${prev.finalAverage} val.` : DASH} />
            <Fld label="Resultado" value={prev?.result || s.academicSituation} />
            <Fld label="Certificado" value={prev?.certificateNumber} mono />
            <Fld label="Declaração" value={prev?.declarationNumber} mono />
          </Grid>
        ) : (
          <Empty icon="school">Sem dados da escola de proveniência.</Empty>
        )}
      </Section>

      <Section title="Percurso Pedagógico" icon="psychology">
        <div className="space-y-4">
          <div className="border border-slate-300 bg-slate-50/60 px-4 py-3 text-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Apreciação do Conselho de Turma
            </div>
            {s.councilAppreciation ? (
              <>
                <p className="text-slate-800 leading-relaxed">{s.councilAppreciation}</p>
                <p className="text-[10px] text-slate-500 mt-1.5">
                  {s.councilAppreciationUpdatedBy ? `Por ${s.councilAppreciationUpdatedBy}` : ''}
                  {s.councilAppreciationUpdatedAt ? ` · ${fmtDateTime(s.councilAppreciationUpdatedAt)}` : ''}
                </p>
              </>
            ) : (
              <span className="text-slate-400 italic">Ainda sem apreciação registada pelo Director de Turma.</span>
            )}
          </div>

          {councils.length > 0 && (
            <Table head={['Ano Lectivo', 'Turma', 'Data do Conselho', 'Negativas', 'Decisão', 'Justificação', 'Estado']}>
              {councils.map(({ c, e }) => (
                <tr key={c.id}>
                  <Td className="font-semibold">{c.academicYear}</Td>
                  <Td>{c.className}</Td>
                  <Td className="whitespace-nowrap">{fmtDate(c.date)}</Td>
                  <Td>{e?.negativeCount ?? e?.negatives?.length ?? 0}</Td>
                  <Td className="font-bold capitalize">{txt(e?.decision).replace(/_/g, ' ')}</Td>
                  <Td className="max-w-xs">{txt(e?.justification)}</Td>
                  <Td className="capitalize">{c.status}</Td>
                </tr>
              ))}
            </Table>
          )}

          {deps.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Disciplinas em Atraso (Regime de Dependência)</div>
              <Table head={['Disciplina', 'Classe de Origem', 'Ano Lectivo', 'Origem', 'Estado']}>
                {deps.map((d) => (
                  <tr key={d.id}>
                    <Td className="font-bold">{d.subjectName}</Td>
                    <Td>{d.fromGrade}</Td>
                    <Td>{d.academicYear}</Td>
                    <Td className="capitalize">{d.origin}</Td>
                    <Td>
                      <Badge cls={d.status === 'regularizada' ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 'bg-amber-50 text-amber-800 border-amber-300'}>
                        {d.status}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}

          {recov.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Recuperação e Exame de Recurso</div>
              <Table head={['Ano Lectivo', 'Disciplina', 'Nota Original', 'Fase', 'Nota Recuperação', 'Nota Recurso', 'Resultado']}>
                {recov.map((r) => (
                  <tr key={r.id}>
                    <Td>{r.academicYear}</Td>
                    <Td className="font-bold">{r.subjectName}</Td>
                    <Td className="font-mono">{r.originalGrade}</Td>
                    <Td className="capitalize">{String(r.stage).replace(/_/g, ' ')}</Td>
                    <Td className="font-mono">{txt(r.recoveryGrade)}</Td>
                    <Td className="font-mono">{txt(r.appealExamGrade)}</Td>
                    <Td className="capitalize">{String(r.outcome).replace(/_/g, ' ')}</Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}

          {descr.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Avaliação Descritiva (Pré-escolar / Primário)</div>
              <Table head={['Ano Lectivo', 'Trimestre', 'Pontos Fortes', 'Dificuldades', 'Recomendações', 'Professor']}>
                {descr.map((d) => (
                  <tr key={d.id}>
                    <Td>{d.academicYear}</Td>
                    <Td>{d.trimester}.º</Td>
                    <Td className="max-w-xs">{txt(d.strengths)}</Td>
                    <Td className="max-w-xs">{txt(d.needs)}</Td>
                    <Td className="max-w-xs">{txt(d.recommendations)}</Td>
                    <Td>{d.teacherName}</Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </div>
      </Section>

      <Section title="Transferências e Equivalências" icon="swap_horiz">
        {transfers.length === 0 ? (
          <Empty icon="swap_horiz">Sem processos de transferência ou equivalência para este aluno.</Empty>
        ) : (
          <Table head={['Código', 'Tipo', 'Data', 'Outra Escola', 'Motivo']}>
            {transfers.map((t) => (
              <tr key={t.id}>
                <Td className="font-mono font-bold">{t.code}</Td>
                <Td className="capitalize">{String(t.kind).replace(/_/g, ' ')}</Td>
                <Td className="whitespace-nowrap">{fmtDate(t.date)}</Td>
                <Td>{txt(t.otherSchool)}</Td>
                <Td className="max-w-xs">{t.reason}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* 6. FINANCEIRO                                                        */
/* ------------------------------------------------------------------ */

const INVOICE_CLS: Record<string, string> = {
  pago: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  pendente: 'bg-amber-50 text-amber-800 border-amber-300',
  atraso: 'bg-red-50 text-red-800 border-red-300',
  isento: 'bg-sky-50 text-sky-800 border-sky-300'
};

const FinanceiroTab: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { db, student: s, matriculas } = ctx;
  const last = matriculas[0];

  const invoices: TuitionInvoice[] = useMemo(
    () =>
      (db.invoices || [])
        .filter((i) => sameId(i.studentId, s.id))
        .sort((a, b) => String(b.dueDate || '').localeCompare(String(a.dueDate || ''))),
    [db.invoices, s.id]
  );

  const situacao = resolveFinancialSituation(last, invoices, localISODate());
  const sum = (st: string) => invoices.filter((i) => i.status === st).reduce((n, i) => n + (Number(i.totalAmountKz) || 0), 0);
  const pago = invoices.filter((i) => i.status === 'pago').reduce((n, i) => n + (Number(i.totalPaidKz) || Number(i.totalAmountKz) || 0), 0);

  return (
    <div>
      <Stats>
        <Stat
          label="Situação Financeira"
          value={<Badge cls={SITUACAO_FINANCEIRA_BADGE[situacao]}>{SITUACAO_FINANCEIRA_LABEL[situacao]}</Badge>}
        />
        <Stat label="Total Pago" value={kz(pago)} tone="green" />
        <Stat label="Pendente" value={kz(sum('pendente'))} tone="amber" />
        <Stat label="Em Atraso" value={kz(sum('atraso'))} tone="red" />
      </Stats>

      <Section title="Plano Financeiro Actual" icon="request_quote">
        {last ? (
          <Grid cols={4}>
            <Fld label="Propina Mensal" value={kz(last.valorPropinaKz)} mono />
            <Fld label="Taxa de Matrícula" value={kz(last.valorMatriculaKz)} mono />
            <Fld label="Tipo de Aluno" value={last.tipoAluno} />
            <Fld
              label="Desconto"
              value={last.descontoPercent ? `${last.descontoPercent}%` : last.descontoKz ? kz(last.descontoKz) : 'Sem desconto'}
            />
            <Fld label="Forma de Pagamento" value={last.formaPagamento} />
            <Fld label="Dia de Vencimento" value={last.diaVencimento} />
            <Fld label="N.º de Parcelas" value={last.numeroParcelas} />
            <Fld label="Ano Lectivo" value={last.academicYear} />
          </Grid>
        ) : (
          <Empty icon="request_quote">Sem matrícula: o plano financeiro é definido ao matricular o aluno.</Empty>
        )}
      </Section>

      <Section title="Facturas e Pagamentos" icon="receipt_long">
        {invoices.length === 0 ? (
          <Empty icon="receipt_long">Este aluno ainda não tem facturas emitidas.</Empty>
        ) : (
          <Table head={['Factura', 'Ano', 'Período', 'Descrição', 'Valor', 'Vencimento', 'Pago em', 'Método', 'Recibo', 'Estado']}>
            {invoices.map((i) => (
              <tr key={i.id} className="hover:bg-slate-50">
                <Td className="font-mono font-bold whitespace-nowrap">{i.invoiceNumber}</Td>
                <Td>{txt(i.academicYear)}</Td>
                <Td className="whitespace-nowrap">{txt(i.period)}</Td>
                <Td className="max-w-xs">{txt(i.description)}</Td>
                <Td className="font-mono font-bold whitespace-nowrap">{kz(i.totalAmountKz)}</Td>
                <Td className="whitespace-nowrap">{fmtDate(i.dueDate)}</Td>
                <Td className="whitespace-nowrap">{fmtDate(i.paymentDate)}</Td>
                <Td>{txt(i.methodLabel || i.method)}</Td>
                <Td className="font-mono">{txt(i.receiptNumber)}</Td>
                <Td>
                  <Badge cls={INVOICE_CLS[i.status]}>{i.status}</Badge>
                  {i.status === 'atraso' && i.daysLate ? <div className="text-[10px] text-red-700 mt-0.5">{i.daysLate} dias</div> : null}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* 7. DOCUMENTOS                                                        */
/* ------------------------------------------------------------------ */

const DOC_STATUS_CLS = (v?: string) =>
  v === 'Entregue'
    ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
    : v === 'Declaração Provisória'
    ? 'bg-blue-50 text-blue-800 border-blue-300'
    : v === 'Dispensado'
    ? 'bg-slate-100 text-slate-600 border-slate-300'
    : 'bg-amber-50 text-amber-800 border-amber-300';

const FileLink: React.FC<{ file?: { name: string; dataUrl: string } }> = ({ file }) =>
  safeDownloadHref(file?.dataUrl) ? (
    <a
      href={safeDownloadHref(file?.dataUrl)}
      download={file.name}
      className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 hover:underline"
    >
      <span className="material-symbols-outlined text-[15px]">download</span>
      Descarregar
    </a>
  ) : (
    <span className="text-[11px] text-slate-400 italic">Sem ficheiro digitalizado</span>
  );

const DocumentosTab: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { db, student: s } = ctx;
  const emitted = (db.academicDocuments || [])
    .filter((d) => sameId(d.studentId, s.id))
    .sort((a, b) => String(b.issuedAt).localeCompare(String(a.issuedAt)));

  return (
    <div>
      <Section title="Documentos Entregues pelo Aluno" icon="folder_shared">
        <Table head={['Documento', 'Estado', 'Ficheiro', 'Carregado em']}>
          <tr>
            <Td className="font-bold">Cópia do B.I. / Passaporte</Td>
            <Td>
              <Badge cls={DOC_STATUS_CLS(s.docBiCopy)}>{s.docBiCopy || 'Pendente'}</Badge>
            </Td>
            <Td>
              <FileLink file={s.docBiFile} />
              {s.docBiFile && <div className="text-[10px] text-slate-500">{s.docBiFile.name} · {formatFileSize(s.docBiFile.size)}</div>}
            </Td>
            <Td>{fmtDate(s.docBiFile?.uploadDate || s.docBiFile?.uploadedAt)}</Td>
          </tr>
          <tr>
            <Td className="font-bold">Certificado / Declaração de Habilitações</Td>
            <Td>
              <Badge cls={DOC_STATUS_CLS(s.docCertificate)}>{s.docCertificate || 'Pendente'}</Badge>
            </Td>
            <Td>
              <FileLink file={s.docCertificateFile} />
              {s.docCertificateFile && (
                <div className="text-[10px] text-slate-500">{s.docCertificateFile.name} · {formatFileSize(s.docCertificateFile.size)}</div>
              )}
            </Td>
            <Td>{fmtDate(s.docCertificateFile?.uploadDate || s.docCertificateFile?.uploadedAt)}</Td>
          </tr>
          <tr>
            <Td className="font-bold">Fotografia Tipo Passe</Td>
            <Td>
              <Badge cls={DOC_STATUS_CLS(s.docPassPhoto || s.avatar ? 'Entregue' : 'Pendente')}>
                {s.docPassPhoto || s.avatar ? 'Entregue' : 'Pendente'}
              </Badge>
            </Td>
            <Td>
              {s.docPassPhoto || s.avatar ? (
                <img src={s.docPassPhoto || s.avatar} alt="" className="w-9 h-11 object-cover border border-slate-300" />
              ) : (
                <span className="text-[11px] text-slate-400 italic">Sem fotografia</span>
              )}
            </Td>
            <Td>{DASH}</Td>
          </tr>
        </Table>
      </Section>

      <Section title="Documentos Emitidos pela Escola" icon="workspace_premium">
        {emitted.length === 0 ? (
          <Empty icon="description">Nenhum documento oficial foi emitido para este aluno (Documentos → Emissão).</Empty>
        ) : (
          <Table head={['N.º', 'Tipo', 'Ano Lectivo', 'Finalidade', 'Emitido em', 'Emitido por', 'Código de Verificação', 'Estado']}>
            {emitted.map((d) => (
              <tr key={d.id}>
                <Td className="font-mono font-bold whitespace-nowrap">{d.number}</Td>
                <Td className="font-semibold">{DOC_LABEL[d.type] || d.type}</Td>
                <Td>{txt(d.academicYear)}</Td>
                <Td className="max-w-xs">{txt(d.purpose)}</Td>
                <Td className="whitespace-nowrap">{fmtDateTime(d.issuedAt)}</Td>
                <Td>{d.issuedBy}</Td>
                <Td className="font-mono">{d.verificationCode}</Td>
                <Td>
                  <Badge cls={d.status === 'emitido' ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 'bg-red-50 text-red-800 border-red-300'}>
                    {d.status}
                  </Badge>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* 8. TRABALHOS                                                         */
/* ------------------------------------------------------------------ */

const TrabalhosTab: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { db, student: s, matriculas } = ctx;
  const now = Date.now();

  const rows = useMemo(() => {
    const classIds = new Set([String(s.classId), ...matriculas.map((m) => String(m.classId))].filter(Boolean));
    const subs = (db.assignmentSubmissions || []).filter((x) => sameId(x.studentId, s.id));
    const byAssignment = new Map<string, Submission>(subs.map((x) => [x.assignmentId, x] as [string, Submission]));
    return (db.assignments || [])
      .filter((a) => a.status !== 'rascunho' && (classIds.has(String(a.classId)) || byAssignment.has(a.id)))
      .sort((a, b) => String(b.dueAt).localeCompare(String(a.dueAt)))
      .map((a) => {
        const sub = byAssignment.get(a.id);
        return { a, sub, state: submissionState(a, sub, now) };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.assignments, db.assignmentSubmissions, s.id, s.classId, matriculas]);

  if (rows.length === 0) {
    return <Empty icon="menu_book">Ainda não há trabalhos online publicados para a(s) turma(s) deste aluno.</Empty>;
  }

  const entregues = rows.filter((r) => !!r.sub).length;
  const corrigidos = rows.filter((r) => r.state === 'corrigido').length;
  const emFalta = rows.filter((r) => r.state === 'em_falta').length;
  const graded = rows.filter((r) => r.sub?.grade !== undefined);
  const pct = graded.length
    ? Math.round((graded.reduce((n, r) => n + ((r.sub!.grade as number) / (r.a.maxGrade || 1)) * 100, 0) / graded.length) * 10) / 10
    : null;

  return (
    <div>
      <Stats>
        <Stat label="Trabalhos Atribuídos" value={rows.length} />
        <Stat label="Entregues" value={`${entregues}/${rows.length}`} tone="blue" />
        <Stat label="Corrigidos" value={corrigidos} tone="green" />
        <Stat label={pct !== null ? 'Aproveitamento Médio' : 'Em Falta'} value={pct !== null ? `${pct}%` : emFalta} tone={pct !== null ? 'green' : 'red'} />
      </Stats>
      <Table head={['Trabalho', 'Disciplina', 'Professor', 'Prazo', 'Estado', 'Entregue em', 'Nota', 'Comentário do Professor']}>
        {rows.map(({ a, sub, state }) => (
          <tr key={a.id} className="hover:bg-slate-50">
            <Td className="font-bold max-w-xs">
              {a.title}
              <div className="text-[10px] text-slate-500 font-normal">{a.academicYear} · {a.className}</div>
            </Td>
            <Td>{a.subjectName}</Td>
            <Td>{a.teacherName}</Td>
            <Td className="whitespace-nowrap">{fmtDateTime(a.dueAt)}</Td>
            <Td>
              <Pill cls={SUBMISSION_STATE_META[state].badge}>{SUBMISSION_STATE_META[state].label}</Pill>
            </Td>
            <Td className="whitespace-nowrap">{fmtDateTime(sub?.submittedAt)}</Td>
            <Td className="font-mono font-bold whitespace-nowrap">{sub?.grade !== undefined ? `${sub.grade}/${a.maxGrade}` : DASH}</Td>
            <Td className="max-w-xs">{txt(sub?.feedback)}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* 9. OCORRÊNCIAS                                                       */
/* ------------------------------------------------------------------ */

const OcorrenciasTab: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { db, student: s } = ctx;

  const incidents = useMemo(
    () =>
      (db.disciplinaryIncidents || [])
        .filter((inc) => (inc.participants || []).some((p) => sameId(p.studentId, s.id)))
        .sort((a, b) => String(b.date).localeCompare(String(a.date))),
    [db.disciplinaryIncidents, s.id]
  );
  const auths = (db.pickupAuthorizations || []).filter((a) => sameId(a.studentId, s.id));
  const pickups = (db.pickupRecords || [])
    .filter((r) => sameId(r.studentId, s.id))
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));

  const roleOf = (inc: DisciplinaryIncident) => (inc.participants || []).find((p) => sameId(p.studentId, s.id))?.role;
  const graves = incidents.filter((i) => i.severity !== 'leve').length;

  return (
    <div>
      <Stats>
        <Stat label="Incidentes Disciplinares" value={incidents.length} tone={incidents.length ? 'amber' : 'navy'} />
        <Stat label="Graves / Muito Graves" value={graves} tone={graves ? 'red' : 'navy'} />
        <Stat label="Autorizações de Recolha" value={auths.length} tone="blue" />
        <Stat label="Saídas Registadas" value={pickups.length} tone="green" />
      </Stats>

      <Section title="Incidentes Disciplinares" icon="gavel">
        {incidents.length === 0 ? (
          <Empty icon="verified_user">Nenhum incidente disciplinar registado para este aluno.</Empty>
        ) : (
          <Table head={['Código', 'Data', 'Categoria', 'Gravidade', 'Papel', 'Descrição', 'Medida', 'Encarregado Avisado', 'Estado']}>
            {incidents.map((inc) => (
              <tr key={inc.id} className="hover:bg-slate-50">
                <Td className="font-mono font-bold whitespace-nowrap">{inc.code}</Td>
                <Td className="whitespace-nowrap">
                  {fmtDate(inc.date)}
                  {inc.time ? ` ${inc.time}` : ''}
                </Td>
                <Td>{INCIDENT_CATEGORY_LABELS[inc.category] || inc.category}</Td>
                <Td>
                  <Pill cls={INCIDENT_SEVERITY_META[inc.severity]?.badge}>{INCIDENT_SEVERITY_META[inc.severity]?.label || inc.severity}</Pill>
                </Td>
                <Td className="capitalize">{txt(roleOf(inc))}</Td>
                <Td className="max-w-xs">{inc.description}</Td>
                <Td>
                  {inc.measure ? DISCIPLINARY_MEASURE_LABELS[inc.measure.type] || inc.measure.type : DASH}
                  {inc.measure?.type === 'suspensao' && inc.measure.suspensionDays ? ` (${inc.measure.suspensionDays} dias)` : ''}
                </Td>
                <Td>{inc.guardianNotification?.notified ? `Sim · ${fmtDate(inc.guardianNotification.date)}` : 'Não'}</Td>
                <Td>
                  <Pill cls={INCIDENT_STATUS_META[inc.status]?.badge}>{INCIDENT_STATUS_META[inc.status]?.label || inc.status}</Pill>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Autorizações de Recolha do Aluno" icon="how_to_reg">
        {auths.length === 0 ? (
          <Empty icon="person_off">Sem pessoas autorizadas (ou proibidas) de recolher este aluno.</Empty>
        ) : (
          <Table head={['Pessoa', 'Parentesco', 'Telefone', 'Documento', 'Tipo', 'Válida', 'Concedida por', 'Estado']}>
            {auths.map((a) => (
              <tr key={a.id}>
                <Td className="font-bold">{a.personName}</Td>
                <Td>{a.relation === 'outro' && a.relationOther ? a.relationOther : PICKUP_RELATION_LABELS[a.relation] || a.relation}</Td>
                <Td className="font-mono">{a.phone}</Td>
                <Td className="font-mono">{a.documentNumber}</Td>
                <Td>
                  <Pill cls={PICKUP_AUTH_KIND_META[a.kind]?.badge}>{PICKUP_AUTH_KIND_META[a.kind]?.label || a.kind}</Pill>
                </Td>
                <Td className="whitespace-nowrap">
                  {fmtDate(a.validFrom)} → {a.validUntil ? fmtDate(a.validUntil) : 'sem fim'}
                </Td>
                <Td className="capitalize">{a.grantedVia}</Td>
                <Td>
                  <Pill cls={PICKUP_AUTH_STATUS_META[a.status]?.badge}>{PICKUP_AUTH_STATUS_META[a.status]?.label || a.status}</Pill>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Saídas / Recolhas Registadas" icon="logout">
        {pickups.length === 0 ? (
          <Empty icon="door_front">Nenhuma saída antecipada ou recolha à porta registada.</Empty>
        ) : (
          <Table head={['Data / Hora', 'Pessoa', 'Parentesco', 'Documento', 'Motivo', 'Resultado', 'Registado por']}>
            {pickups.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap font-mono">
                  {fmtDate(r.date)} {r.time}
                </Td>
                <Td className="font-bold">{r.personName}</Td>
                <Td>{r.personRelation}</Td>
                <Td className="font-mono">{r.personDocument}</Td>
                <Td>{PICKUP_REASON_LABELS[r.reason] || r.reason}</Td>
                <Td>
                  <Badge cls={r.outcome === 'entregue' ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 'bg-red-50 text-red-800 border-red-300'}>
                    {r.outcome}
                  </Badge>
                  {r.refusalReason && <div className="text-[10px] text-red-700 mt-0.5">{r.refusalReason}</div>}
                </Td>
                <Td>{r.registeredBy}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* 10. ANEXOS                                                           */
/* ------------------------------------------------------------------ */

const AnexosTab: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const docs = ctx.student.additionalDocs || [];
  if (docs.length === 0) {
    return <Empty icon="attach_file">Este aluno não tem anexos adicionais. Podem ser carregados ao editar o cadastro (até 3 ficheiros PDF/imagem).</Empty>;
  }
  return (
    <div>
      <Stats>
        <Stat label="Ficheiros Anexados" value={docs.length} />
        <Stat label="Tamanho Total" value={formatFileSize(docs.reduce((n, d) => n + (d.size || 0), 0))} tone="blue" />
      </Stats>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {docs.map((d) => {
          const isImage = (d.type || '').startsWith('image/');
          return (
            <div key={d.id} className="border border-slate-300 bg-white flex gap-3 p-3 print-break-avoid">
              <div className="w-16 h-20 shrink-0 border border-slate-300 bg-slate-100 flex items-center justify-center overflow-hidden">
                {isImage && safeImageDataUrl(d.dataUrl) ? (
                  <img src={safeImageDataUrl(d.dataUrl)!} alt={d.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="material-symbols-outlined text-[30px] text-slate-400">picture_as_pdf</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-xs text-[#0b1f3a] break-words">{d.name}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  {formatFileSize(d.size)} · {fmtDate(d.uploadDate || d.uploadedAt)}
                </div>
                <div className="mt-2 no-print">
                  <FileLink file={d} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* 11. AULAS                                                            */
/* ------------------------------------------------------------------ */

const STATUS_AULA: Record<string, { label: string; cls: string }> = {
  P: { label: 'Presente', cls: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
  A: { label: 'Atraso', cls: 'bg-blue-50 text-blue-800 border-blue-300' },
  FJ: { label: 'Falta Justificada', cls: 'bg-amber-50 text-amber-800 border-amber-300' },
  FI: { label: 'Falta Injustificada', cls: 'bg-red-50 text-red-800 border-red-300' }
};

const AulasTab: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { db, student: s } = ctx;

  const records = useMemo(() => {
    const sheets = [...(db.attendanceSheets || [])];
    if (db.attendance && !sheets.some((x) => x.id === db.attendance.id)) sheets.push(db.attendance);
    const out: Array<{ sheet: (typeof sheets)[number]; status: string }> = [];
    for (const sh of sheets) {
      const rec = (sh.students || []).find((st) => sameId(st.studentId, s.id));
      if (rec) out.push({ sheet: sh, status: rec.status });
    }
    return out.sort((a, b) => String(b.sheet.date).localeCompare(String(a.sheet.date)));
  }, [db.attendanceSheets, db.attendance, s.id]);

  const total = records.length;
  const count = (st: string) => records.filter((r) => r.status === st).length;
  const P = count('P'), A = count('A'), FJ = count('FJ'), FI = count('FI');
  const assistidas = P + A;
  const taxa = total ? Math.round((assistidas / total) * 1000) / 10 : null;

  const bySubject = useMemo(() => {
    const map = new Map<string, { name: string; teacher: string; P: number; A: number; FJ: number; FI: number }>();
    for (const r of records) {
      const key = String(r.sheet.subjectId || r.sheet.subjectName);
      if (!map.has(key)) map.set(key, { name: r.sheet.subjectName, teacher: r.sheet.teacherName, P: 0, A: 0, FJ: 0, FI: 0 });
      const e = map.get(key)!;
      if (r.status === 'P') e.P++;
      else if (r.status === 'A') e.A++;
      else if (r.status === 'FJ') e.FJ++;
      else if (r.status === 'FI') e.FI++;
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [records]);

  return (
    <div>
      <Stats>
        <Stat label="Aulas Registadas" value={total} />
        <Stat label="Aulas Assistidas" value={assistidas} tone="green" />
        <Stat label="Faltas (Just. / Injust.)" value={`${FJ} / ${FI}`} tone={FI ? 'red' : 'amber'} />
        <Stat
          label="Assiduidade"
          value={taxa !== null ? `${taxa}%` : typeof s.attendanceRate === 'number' ? `${s.attendanceRate}%` : DASH}
          tone={taxa !== null && taxa < 75 ? 'red' : 'green'}
        />
      </Stats>

      {total === 0 ? (
        <Empty icon="event_available">
          Ainda não há cadernetas de presenças com este aluno.
          {typeof s.attendanceRate === 'number'
            ? ` Na ficha constam ${s.unexcusedAbsences || 0} faltas injustificadas e ${s.excusedAbsences || 0} justificadas.`
            : ''}
        </Empty>
      ) : (
        <>
          <Section title="Resumo por Disciplina" icon="menu_book">
            <Table head={['Disciplina', 'Professor', 'Aulas', 'Presenças', 'Atrasos', 'Faltas Just.', 'Faltas Injust.', 'Assiduidade']}>
              {bySubject.map((r) => {
                const n = r.P + r.A + r.FJ + r.FI;
                const pc = n ? Math.round(((r.P + r.A) / n) * 100) : 0;
                return (
                  <tr key={r.name}>
                    <Td className="font-bold">{r.name}</Td>
                    <Td>{txt(r.teacher)}</Td>
                    <Td>{n}</Td>
                    <Td>{r.P}</Td>
                    <Td>{r.A}</Td>
                    <Td>{r.FJ}</Td>
                    <Td className={r.FI ? 'text-red-700 font-bold' : ''}>{r.FI}</Td>
                    <Td className="font-mono font-bold">{pc}%</Td>
                  </tr>
                );
              })}
            </Table>
          </Section>

          <Section title="Registo de Aulas" icon="event_note">
            <Table head={['Data', 'Disciplina', 'Professor', 'Horário', 'Sala', 'Sumário da Aula', 'Presença']}>
              {records.map((r) => (
                <tr key={r.sheet.id}>
                  <Td className="whitespace-nowrap font-mono">{fmtDate(r.sheet.date)}</Td>
                  <Td className="font-bold">{r.sheet.subjectName}</Td>
                  <Td>{r.sheet.teacherName}</Td>
                  <Td className="whitespace-nowrap">{txt(r.sheet.timeSlot)}</Td>
                  <Td>{txt(r.sheet.room)}</Td>
                  <Td className="max-w-xs">{txt(r.sheet.lessonSummary)}</Td>
                  <Td>
                    <Badge cls={STATUS_AULA[r.status]?.cls}>{STATUS_AULA[r.status]?.label || r.status}</Badge>
                  </Td>
                </tr>
              ))}
            </Table>
          </Section>
        </>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* 12. COMPROVATIVOS DE NOTAS                                           */
/* ------------------------------------------------------------------ */

const NotasTab: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { db, student: s, matriculas, currentYear, onOpenReportCard } = ctx;
  const years = useMemo(() => getStudentAcademicYears(s, db.matriculas, currentYear), [s, db.matriculas, currentYear]);
  const [year, setYear] = useState<string>(years.includes(currentYear) ? currentYear : years[0] || currentYear);
  const [yearRecord, setYearRecord] = useState<Matricula | null>(null);

  const liveYear = getLiveGradesYear(s, currentYear);
  const isLive = year === liveYear;
  const mat = findMatriculaForYear(matriculas, s.id, year);
  const recs = getStudentRecordsForYear(s, year, currentYear);
  const archive = getStudentArchiveForYear(s, year);
  const report = mat ? getStudentYearAcademicReport(db, s, mat) : null;
  const media = archive?.finalAverage ?? (isLive && s.currentAverage > 0 ? s.currentAverage : meanOf(recs.map((r) => num(r.ca) ?? num(r.mfd))));
  const situacao = report?.situacaoGeral || (recs.length ? 'Em Curso' : 'Sem Notas');

  const docs = (db.academicDocuments || [])
    .filter(
      (d) =>
        sameId(d.studentId, s.id) &&
        (d.type === 'declaracao_com_notas' || d.type === 'historico_academico' || d.type === 'certificado' || d.type === 'diploma') &&
        (!d.academicYear || d.academicYear === year)
    )
    .sort((a, b) => String(b.issuedAt).localeCompare(String(a.issuedAt)));

  // 0 é o valor por omissão de uma nota ainda não lançada → mostra "—".
  const cell = (v: unknown) => {
    const n = num(v);
    return n === null || n <= 0 ? DASH : String(n);
  };
  const negative = (v: unknown) => {
    const n = num(v);
    return n !== null && n > 0 && n < 10;
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5 no-print">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Ano Lectivo</label>
          <select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="h-9 px-3 bg-white border border-slate-300 text-xs font-bold text-[#0b1f3a] focus:border-[#0b1f3a]"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
                {y === currentYear ? ' (actual)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          {isLive && (
            <button
              type="button"
              onClick={() => ctx.acl.guard('alunos.print_docs', () => onOpenReportCard(s))}
              {...ctx.acl.buttonProps('alunos.print_docs')}
              className="flex items-center gap-1.5 px-3.5 h-9 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white text-xs font-bold border border-[#0b1f3a] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[16px]">assignment</span>
              Abrir / Imprimir Boletim Oficial
            </button>
          )}
          {mat && (
            <button
              type="button"
              onClick={() => setYearRecord(mat)}
              className="flex items-center gap-1.5 px-3.5 h-9 bg-white hover:bg-slate-100 text-[#0b1f3a] text-xs font-bold border border-slate-400 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">folder_open</span>
              Registo completo do ano
            </button>
          )}
        </div>
      </div>

      <Stats>
        <Stat label="Ano Lectivo" value={year} />
        <Stat label="Turma" value={mat ? mat.className : archive?.className || DASH} tone="blue" />
        <Stat label="Média Final" value={media ? `${media} val.` : DASH} tone="green" />
        <Stat label="Resultado" value={<Badge cls={SITUACAO_CLS[situacao]}>{situacao}</Badge>} tone="amber" />
      </Stats>

      <Section title={`Boletim de Notas — ${year}`} icon="workspace_premium">
        {recs.length === 0 ? (
          <Empty icon="grading">Sem notas lançadas neste ano lectivo — o boletim fica disponível quando houver avaliações reais.</Empty>
        ) : (
          <Table head={['Disciplina', '1.º Trim.', '2.º Trim.', '3.º Trim.', 'MFD', 'Nota Final (CA)', 'Situação']}>
            {recs.map((r) => (
              <tr key={r.subjectId || r.subjectName}>
                <Td className="font-bold">
                  {r.subjectName}
                  {r.origemNota && <div className="text-[10px] text-slate-500 font-normal">{r.origemNota}{r.origemDetalhe ? ` — ${r.origemDetalhe}` : ''}</div>}
                </Td>
                <Td className={`font-mono ${negative(r.mt1) ? 'text-red-700 font-bold' : ''}`}>{cell(r.mt1)}</Td>
                <Td className={`font-mono ${negative(r.mt2) ? 'text-red-700 font-bold' : ''}`}>{cell(r.mt2)}</Td>
                <Td className={`font-mono ${negative(r.mt3) ? 'text-red-700 font-bold' : ''}`}>{cell(r.mt3)}</Td>
                <Td className={`font-mono ${negative(r.mfd) ? 'text-red-700 font-bold' : ''}`}>{cell(r.mfd)}</Td>
                <Td className={`font-mono font-bold ${negative(r.ca) ? 'text-red-700' : 'text-[#0b1f3a]'}`}>{cell(r.mf ?? r.ca)}</Td>
                <Td>
                  <Badge cls={SITUACAO_CLS[r.situation]}>{r.situation}</Badge>
                </Td>
              </tr>
            ))}
          </Table>
        )}
        {isLive && s.boletimEnviadoAoEncarregado && (
          <p className="mt-3 text-[11px] text-emerald-800 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px]">mark_email_read</span>
            Boletim enviado ao encarregado em {fmtDateTime(s.boletimEnviadoEm)}.
          </p>
        )}
      </Section>

      <Section title="Comprovativos Emitidos com Notas" icon="verified">
        {docs.length === 0 ? (
          <Empty icon="description">
            Nenhuma declaração com notas, histórico ou certificado foi emitido para {year}. O boletim acima é gerado a partir das notas lançadas.
          </Empty>
        ) : (
          <Table head={['N.º', 'Tipo', 'Finalidade', 'Emitido em', 'Emitido por', 'Código de Verificação', 'Estado']}>
            {docs.map((d) => (
              <tr key={d.id}>
                <Td className="font-mono font-bold whitespace-nowrap">{d.number}</Td>
                <Td className="font-semibold">{DOC_LABEL[d.type] || d.type}</Td>
                <Td className="max-w-xs">{txt(d.purpose)}</Td>
                <Td className="whitespace-nowrap">{fmtDateTime(d.issuedAt)}</Td>
                <Td>{d.issuedBy}</Td>
                <Td className="font-mono">{d.verificationCode}</Td>
                <Td>
                  <Badge cls={d.status === 'emitido' ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 'bg-red-50 text-red-800 border-red-300'}>
                    {d.status}
                  </Badge>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {yearRecord && <StudentYearRecordModal db={db} student={s} matricula={yearRecord} onClose={() => setYearRecord(null)} />}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Página principal                                                     */
/* ------------------------------------------------------------------ */

interface StudentProfilePageProps {
  db: SchoolDatabase;
  student: Student;
  currentUserRole: UserRole;
  onBack: () => void;
  onOpenReportCard: (student: Student) => void;
}

export const StudentProfilePage: React.FC<StudentProfilePageProps> = ({
  db,
  student,
  currentUserRole,
  onBack,
  onOpenReportCard
}) => {
  const acl = useAccessControl(currentUserRole);
  const [tab, setTab] = useState<TabKey>('ficha');

  const currentYear = db.settings?.currentAcademicYear || getFallbackAcademicYear();

  const matriculas = useMemo(
    () =>
      (db.matriculas || [])
        .filter((m) => sameId(m.studentId, student.id))
        .sort(
          (a, b) =>
            String(b.academicYear || '').localeCompare(String(a.academicYear || '')) ||
            String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
        ),
    [db.matriculas, student.id]
  );

  const last = matriculas[0];
  const curso = last?.courseName || student.courseName || last?.grade || student.grade || DASH;
  const turma = last?.className || student.className || 'Sem turma';
  const periodo = last?.academicYear || currentYear;
  const situacao = resolveStudentSituation(student, db.matriculas);
  const activeTab = TABS.find((t) => t.key === tab) || TABS[0];

  const ctx: Ctx = { db, student, matriculas, currentYear, acl, onOpenReportCard };

  const handlePrint = () => acl.guard('alunos.print_docs', () => window.print());

  return (
    <div className="printable-modal-overlay bm-live-page w-full">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 8mm; }
          .student-profile-print .no-print { display: none !important; }
          .student-profile-print .overflow-x-auto { overflow: visible !important; }
          .student-profile-print table { width: 100% !important; table-layout: auto; font-size: 9px; }
          .student-profile-print th { padding: 3px 5px !important; white-space: normal !important; }
          .student-profile-print td { padding: 3px 5px !important; white-space: normal !important; overflow-wrap: anywhere; }
          .student-profile-print tr { break-inside: avoid; page-break-inside: avoid; }
          .student-profile-print .print-container { border: none !important; padding: 0 !important; }
        }
      `}</style>

      <div className="student-profile-print printable-document flex flex-col gap-4 pb-12">
        {/* ====== CABEÇALHO FIXO (botão Imprimir + dados do aluno) ====== */}
        <div className="no-print sticky top-[var(--bm-nav-top,4rem)] z-20 bg-white border border-slate-300 shadow-sm">
          <div className="flex flex-wrap items-stretch gap-x-6 gap-y-3 px-4 py-3">
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={onBack}
                className="w-20 flex flex-col items-center justify-center gap-0.5 border border-slate-300 bg-slate-50 hover:bg-slate-200 text-slate-700 cursor-pointer transition-colors py-1.5"
                title="Voltar à lista de alunos"
              >
                <span className="material-symbols-outlined text-[26px]">arrow_back</span>
                <span className="text-[11px] font-semibold">Voltar</span>
              </button>
              <button
                type="button"
                onClick={handlePrint}
                {...acl.buttonProps('alunos.print_docs')}
                className="w-20 flex flex-col items-center justify-center gap-0.5 border border-[#0b1f3a] bg-[#0b1f3a] text-white hover:opacity-90 cursor-pointer transition-opacity py-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
                title={acl.can('alunos.print_docs') ? `Imprimir: ${activeTab.label}` : acl.denyMessage('alunos.print_docs')}
              >
                <span className="material-symbols-outlined text-[26px]">print</span>
                <span className="text-[11px] font-semibold">Imprimir</span>
              </button>
            </div>

            <div className="flex-1 min-w-[260px] grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-0.5 content-center text-[12px]">
              <div>
                <span className="font-bold text-slate-500">Nº Aluno: </span>
                <span className="font-mono font-bold text-[#0b1f3a]">{txt(student.procNumber)}</span>
              </div>
              <div className="min-w-0">
                <span className="font-bold text-slate-500">Nome: </span>
                <span className="font-extrabold text-[#0b1f3a] break-words">{student.name}</span>
              </div>
              <div>
                <span className="font-bold text-slate-500">Curso: </span>
                <span className="font-semibold text-slate-800">{curso}</span>
              </div>
              <div>
                <span className="font-bold text-slate-500">Turma: </span>
                <span className="font-semibold text-slate-800">{turma}</span>
              </div>
              <div>
                <span className="font-bold text-slate-500">Período Lectivo: </span>
                <span className="font-semibold text-slate-800">{periodo}</span>
              </div>
              <div>
                <span className="font-bold text-slate-500">Situação: </span>
                <Badge cls="bg-emerald-50 text-emerald-800 border-emerald-300">{situacao}</Badge>
              </div>
            </div>
          </div>

          {/* Abas */}
          <div className="border-t border-slate-300 bg-slate-100 px-2 pt-2 flex gap-1 overflow-x-auto" role="tablist" aria-label="Secções da ficha do aluno">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold whitespace-nowrap border border-b-0 cursor-pointer transition-colors ${
                  tab === t.key
                    ? 'bg-white text-[#0b1f3a] border-slate-300 border-t-2 border-t-[#0b1f3a] -mb-px'
                    : 'bg-slate-200/70 text-slate-600 border-transparent hover:bg-slate-200 hover:text-slate-900'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ====== CABEÇALHO DE IMPRESSÃO (só aparece ao imprimir) ====== */}
        <div className="hidden print:block border-b-2 border-[#0b1f3a] pb-2 mb-2">
          <div className="flex items-center gap-3">
            <img src={db.settings?.logoUrl || '/school_emblem.png'} alt="" className="w-12 h-12 object-contain" />
            <div className="flex-1">
              <div className="text-base font-black uppercase text-[#0b1f3a]">{db.settings?.schoolName}</div>
              <div className="text-[11px] text-slate-600 font-semibold">
                FICHA DO ALUNO — {activeTab.label.toUpperCase()} · Ano Lectivo {periodo}
              </div>
            </div>
            <div className="text-right text-[11px] text-slate-700">
              <div><strong>Proc. n.º</strong> {txt(student.procNumber)}</div>
              <div><strong>Curso:</strong> {curso} · <strong>Turma:</strong> {turma}</div>
            </div>
          </div>
          <div className="mt-1.5 text-sm font-extrabold text-slate-900">{student.name}</div>
        </div>

        {/* ====== CONTEÚDO DA ABA ====== */}
        <div className="print-container bg-white border border-slate-300 p-5 sm:p-6 text-xs min-h-[320px]" role="tabpanel">
          {tab === 'ficha' && <FichaTab ctx={ctx} />}
          {tab === 'saude' && <SaudeTab ctx={ctx} />}
          {tab === 'encarregado' && <EncarregadoTab ctx={ctx} />}
          {tab === 'matriculas' && <MatriculasTab ctx={ctx} />}
          {tab === 'historicos' && <HistoricosTab ctx={ctx} />}
          {tab === 'financeiro' && <FinanceiroTab ctx={ctx} />}
          {tab === 'documentos' && <DocumentosTab ctx={ctx} />}
          {tab === 'trabalhos' && <TrabalhosTab ctx={ctx} />}
          {tab === 'ocorrencias' && <OcorrenciasTab ctx={ctx} />}
          {tab === 'anexos' && <AnexosTab ctx={ctx} />}
          {tab === 'aulas' && <AulasTab ctx={ctx} />}
          {tab === 'notas' && <NotasTab ctx={ctx} />}
        </div>
      </div>
    </div>
  );
};
