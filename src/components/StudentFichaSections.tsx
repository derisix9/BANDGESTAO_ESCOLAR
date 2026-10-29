import React, { useMemo } from 'react';
import {
  SchoolDatabase,
  Student,
  StudentFiliation,
  StudentResidence,
  PreviousSchoolDetails,
  StudentSpecialNeeds,
  StudentSituation,
  FiliationPerson
} from '../types';
import { SearchableSelect } from './SearchableSelect';
import { institutionAcademicYears } from '../utils/academicYear';
import {
  ANGOLA_PROVINCE_NAMES,
  getMunicipalitiesForProvince,
  getCommunesForMunicipality
} from '../data/angolaDivisions';

// ============================================================
// Dados extra da Ficha do Aluno — Filiação, Residência,
// Proveniência Escolar (detalhada) e Situação/NEE. Vivem sempre
// na secção "Alunos" (cadastro), nunca na Matrícula.
// ============================================================

export interface FichaExtraData {
  socialName: string;
  birthMunicipality: string;
  birthProvince: string;
  birthCountry: string;
  maritalStatus: string;
  docType: string;
  docValidUntil: string;
  naturalidade: string;
  filiation: StudentFiliation;
  residence: StudentResidence;
  previousSchoolDetails: PreviousSchoolDetails;
  studentSituation: StudentSituation;
  specialNeeds: StudentSpecialNeeds;
}

const emptyFiliationPerson = (): FiliationPerson => ({
  name: '',
  bi: '',
  phone: '',
  email: '',
  profession: '',
  residence: ''
});

export const createEmptyFichaExtra = (): FichaExtraData => ({
  socialName: '',
  birthMunicipality: '',
  birthProvince: '',
  birthCountry: 'Angola',
  maritalStatus: '',
  docType: 'Bilhete de Identidade',
  docValidUntil: '',
  naturalidade: '',
  filiation: {
    father: emptyFiliationPerson(),
    mother: emptyFiliationPerson(),
    guardian: { ...emptyFiliationPerson(), relation: '' },
    financialResponsibleIsDifferent: false,
    financialResponsible: emptyFiliationPerson(),
    parentsDetailedInfo: false
  },
  residence: {
    province: '',
    municipality: '',
    commune: '',
    urbanDistrict: '',
    neighborhood: '',
    street: '',
    houseNumber: '',
    referencePoint: '',
    phone: '',
    email: ''
  },
  previousSchoolDetails: {
    school: '',
    province: '',
    municipality: '',
    lastGrade: '',
    completedGrade: '',
    academicYear: '',
    finalAverage: undefined,
    result: 'Aprovado',
    certificateNumber: '',
    declarationNumber: '',
    issueDate: ''
  },
  studentSituation: 'Activo',
  specialNeeds: {
    hasNeeds: false,
    type: '',
    observations: '',
    needsSupport: false
  }
});

/** Extrai a fatia "extra" de um Student já existente, preenchendo com
 *  defaults vazios os campos que ainda não tenham sido gravados. */
export const fichaExtraFromStudent = (student: Student | null): FichaExtraData => {
  const base = createEmptyFichaExtra();
  if (!student) return base;
  return {
    socialName: student.socialName || '',
    birthMunicipality: student.birthMunicipality || '',
    birthProvince: student.birthProvince || '',
    birthCountry: student.birthCountry || 'Angola',
    maritalStatus: student.maritalStatus || '',
    docType: student.docType || 'Bilhete de Identidade',
    docValidUntil: student.docValidUntil || '',
    naturalidade: student.naturalidade || '',
    filiation: student.filiation
      ? {
          father: { ...emptyFiliationPerson(), ...student.filiation.father },
          mother: { ...emptyFiliationPerson(), ...student.filiation.mother },
          guardian: { ...emptyFiliationPerson(), relation: '', ...student.filiation.guardian },
          financialResponsibleIsDifferent: !!student.filiation.financialResponsibleIsDifferent,
          financialResponsible: { ...emptyFiliationPerson(), ...student.filiation.financialResponsible },
          parentsDetailedInfo: !!student.filiation.parentsDetailedInfo
        }
      : base.filiation,
    residence: student.residence ? { ...base.residence, ...student.residence } : base.residence,
    previousSchoolDetails: student.previousSchoolDetails
      ? { ...base.previousSchoolDetails, ...student.previousSchoolDetails }
      : base.previousSchoolDetails,
    studentSituation: student.studentSituation || 'Activo',
    specialNeeds: student.specialNeeds ? { ...base.specialNeeds, ...student.specialNeeds } : base.specialNeeds
  };
};

const inputCls =
  'w-full h-9 px-3 rounded-none bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none';
const labelCls = 'block uppercase font-bold text-slate-700 mb-1';

const RESULTADO_OPTIONS: PreviousSchoolDetails['result'][] = ['Aprovado', 'Reprovado', 'Transferido', 'Desistente'];
const SITUACAO_OPTIONS: StudentSituation[] = [
  'Activo',
  'Inactivo',
  'Transferido',
  'Desistente',
  'Falecido',
  'Concluiu',
  'Suspenso'
];

interface FiliationPersonFieldsProps {
  title: string;
  icon: string;
  value: FiliationPerson;
  onChange: (patch: Partial<FiliationPerson>) => void;
  extraField?: React.ReactNode;
  /** Marca Nome e Telefone como obrigatórios — usado no Responsável Legal /
   *  Encarregado de Educação, que é sempre necessário (comunicação, portal do
   *  aluno, tesouraria), ao contrário de Pai/Mãe que ficam opcionais. */
  required?: boolean;
}

const FiliationPersonFields: React.FC<FiliationPersonFieldsProps> = ({ title, icon, value, onChange, extraField, required }) => (
  <div className="p-3 bg-white border border-slate-300 space-y-3">
    <div className="flex items-center gap-1.5 pb-1.5 border-b border-slate-200">
      <span className="material-symbols-outlined text-[16px] text-[#0b1f3a]">{icon}</span>
      <span className="font-bold text-slate-800 text-[11px] uppercase tracking-wide">{title}</span>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="sm:col-span-2">
        <label className={labelCls}>Nome Completo{required ? ' *' : ''}</label>
        <input type="text" required={required} value={value.name} onChange={(e) => onChange({ name: e.target.value })} className={inputCls} />
      </div>
      {extraField}
      <div>
        <label className={labelCls}>N.º do B.I.</label>
        <input type="text" value={value.bi} onChange={(e) => onChange({ bi: e.target.value })} className={`${inputCls} font-mono`} />
      </div>
      <div>
        <label className={labelCls}>Telefone{required ? ' *' : ''}</label>
        <input type="text" required={required} value={value.phone} onChange={(e) => onChange({ phone: e.target.value })} className={`${inputCls} font-mono`} />
      </div>
      <div>
        <label className={labelCls}>E-mail</label>
        <input type="email" value={value.email} onChange={(e) => onChange({ email: e.target.value })} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Profissão</label>
        <input type="text" value={value.profession} onChange={(e) => onChange({ profession: e.target.value })} className={inputCls} />
      </div>
      <div className="sm:col-span-2">
        <label className={labelCls}>Local de Residência</label>
        <input type="text" value={value.residence} onChange={(e) => onChange({ residence: e.target.value })} className={inputCls} />
      </div>
    </div>
  </div>
);

interface StudentFichaSectionsProps {
  db: SchoolDatabase;
  data: FichaExtraData;
  onChange: (patch: Partial<FichaExtraData>) => void;
  /** Vem de `acl.can('alunos.sensitive')`. Sem esta permissão, Filiação e NEE
   *  ficam ocultas/bloqueadas — só de leitura restrita. */
  canViewSensitive: boolean;
}

export const StudentFichaSections: React.FC<StudentFichaSectionsProps> = ({ db, data, onChange, canViewSensitive }) => {
  // Divisão Político-Administrativa oficial (Lei n.º 14/24): 21 províncias →
  // municípios → comunas, vinda de src/data/angolaDivisions.ts. Ao escolher uma
  // província listam-se os seus municípios; ao escolher o município, as suas
  // comunas (municípios sem comunas próprias têm uma comuna com o seu nome).
  const provinceOptions = useMemo(
    () => ANGOLA_PROVINCE_NAMES.map((name) => ({ value: name, label: name })),
    []
  );

  const municipalityOptionsFor = (provinceName: string) =>
    getMunicipalitiesForProvince(provinceName).map((m) => ({ value: m.name, label: m.name }));

  const residenceMunicipalityOptions = useMemo(
    () => municipalityOptionsFor(data.residence.province),
    [data.residence.province]
  );
  const residenceCommuneOptions = useMemo(
    () =>
      getCommunesForMunicipality(data.residence.province, data.residence.municipality).map((c) => ({
        value: c,
        label: c
      })),
    [data.residence.province, data.residence.municipality]
  );

  const prevMunicipalityOptions = useMemo(
    () => municipalityOptionsFor(data.previousSchoolDetails.province),
    [data.previousSchoolDetails.province]
  );

  const patchFiliation = (patch: Partial<StudentFiliation>) => onChange({ filiation: { ...data.filiation, ...patch } });
  const patchResidence = (patch: Partial<StudentResidence>) => onChange({ residence: { ...data.residence, ...patch } });
  const patchPrevSchool = (patch: Partial<PreviousSchoolDetails>) =>
    onChange({ previousSchoolDetails: { ...data.previousSchoolDetails, ...patch } });
  const patchSpecialNeeds = (patch: Partial<StudentSpecialNeeds>) => onChange({ specialNeeds: { ...data.specialNeeds, ...patch } });

  return (
    <>
      {/* 1B. FILIAÇÃO */}
      <div className="border border-slate-300 p-4 bg-slate-50/50">
        <div className="flex items-center gap-2 pb-2 mb-3 border-b border-slate-200">
          <span className="material-symbols-outlined text-[18px] text-[#0b1f3a]">diversity_3</span>
          <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider">1.1 Dados do Encarregado</h4>
        </div>

        {/* Responsável Legal / Encarregado de Educação — é o contacto essencial
            (comunicados, portal do encarregado, tesouraria, boletins), por isso
            fica sempre visível/editável, independentemente de alunos.sensitive. */}
        <div className="space-y-3">
          <FiliationPersonFields
            title="Responsável Legal / Encarregado de Educação"
            icon="how_to_reg"
            value={data.filiation.guardian}
            onChange={(p) => patchFiliation({ guardian: { ...data.filiation.guardian, ...p } })}
            required
            extraField={
              <div>
                <label className={labelCls}>Grau de Parentesco *</label>
                <input
                  type="text"
                  required
                  value={data.filiation.guardian.relation}
                  onChange={(e) => patchFiliation({ guardian: { ...data.filiation.guardian, relation: e.target.value } })}
                  placeholder="Ex: Pai, Mãe, Tio, Avô, Tutor Legal..."
                  className={inputCls}
                />
              </div>
            }
          />

          <label className="flex items-center gap-2 p-3 bg-white border border-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={data.filiation.financialResponsibleIsDifferent}
              onChange={(e) => patchFiliation({ financialResponsibleIsDifferent: e.target.checked })}
              className="w-4 h-4 accent-[#0b1f3a]"
            />
            <span className="text-[11px] font-bold text-slate-800 uppercase">
              Responsável Financeiro é diferente do Encarregado de Educação
            </span>
          </label>

          {data.filiation.financialResponsibleIsDifferent && (
            <FiliationPersonFields
              title="Responsável Financeiro (Tesouraria / Propinas)"
              icon="payments"
              value={data.filiation.financialResponsible || emptyFiliationPerson()}
              onChange={(p) =>
                patchFiliation({ financialResponsible: { ...(data.filiation.financialResponsible || emptyFiliationPerson()), ...p } })
              }
            />
          )}
        </div>

        {/* Pai & Mãe — dados pessoais mais sensíveis, acesso restrito */}
        <div className="mt-4 pt-3 border-t border-dashed border-slate-300">
          <div className="flex items-center gap-2 mb-2">

          </div>
          {!canViewSensitive ? (
            <div className="flex items-center gap-2 p-4 text-slate-500 bg-white border border-slate-200 text-[11px]">
              <span className="material-symbols-outlined text-[18px]">lock</span>
              Sem permissão para ver ou editar os dados de Pai/Mãe deste aluno (regra <code>alunos.sensitive</code>).
            </div>
          ) : (
            <div className="space-y-3">
              <label className="flex items-center gap-2 p-3 bg-white border border-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!data.filiation.parentsDetailedInfo}
                  onChange={(e) => patchFiliation({ parentsDetailedInfo: e.target.checked })}
                  className="w-4 h-4 accent-[#0b1f3a]"
                />
                <span className="text-[11px] font-bold text-slate-800 uppercase">
                  Adicionar informações dos pais (B.I., telefone, e-mail, profissão, residência)
                </span>
              </label>

              {data.filiation.parentsDetailedInfo ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FiliationPersonFields
                    title="Pai"
                    icon="man"
                    value={data.filiation.father}
                    onChange={(p) => patchFiliation({ father: { ...data.filiation.father, ...p } })}
                  />
                  <FiliationPersonFields
                    title="Mãe"
                    icon="woman"
                    value={data.filiation.mother}
                    onChange={(p) => patchFiliation({ mother: { ...data.filiation.mother, ...p } })}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 bg-white border border-slate-300">
                    <label className={labelCls}>Nome do Pai</label>
                    <input
                      type="text"
                      value={data.filiation.father.name}
                      onChange={(e) => patchFiliation({ father: { ...data.filiation.father, name: e.target.value } })}
                      className={inputCls}
                    />
                  </div>
                  <div className="p-3 bg-white border border-slate-300">
                    <label className={labelCls}>Nome da Mãe</label>
                    <input
                      type="text"
                      value={data.filiation.mother.name}
                      onChange={(e) => patchFiliation({ mother: { ...data.filiation.mother, name: e.target.value } })}
                      className={inputCls}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 2. CONTACTOS E RESIDÊNCIA */}
      <div className="border border-slate-300 p-4 bg-slate-50/50">
        <div className="flex items-center gap-2 pb-2 mb-3 border-b border-slate-200">
          <span className="material-symbols-outlined text-[18px] text-[#0b1f3a]">home_pin</span>
          <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider">2. Contactos e Residência</h4>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SearchableSelect
            label="Província"
            options={provinceOptions}
            value={data.residence.province}
            onChange={(v) => patchResidence({ province: v, municipality: '', commune: '' })}
            placeholder="Selecione a província"
            allowCustom
          />
          <SearchableSelect
            label="Município"
            options={residenceMunicipalityOptions}
            value={data.residence.municipality}
            onChange={(v) => patchResidence({ municipality: v, commune: '' })}
            placeholder="Selecione o município"
            disabled={!data.residence.province}
            allowCustom
          />
          <SearchableSelect
            label="Comuna"
            options={residenceCommuneOptions}
            value={data.residence.commune}
            onChange={(v) => patchResidence({ commune: v })}
            placeholder="Selecione a comuna"
            disabled={!data.residence.municipality}
            allowCustom
          />
          <div>
            <label className={labelCls}>Distrito Urbano (se aplicável)</label>
            <input
              type="text"
              value={data.residence.urbanDistrict || ''}
              onChange={(e) => patchResidence({ urbanDistrict: e.target.value })}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Bairro</label>
            <input
              type="text"
              value={data.residence.neighborhood}
              onChange={(e) => patchResidence({ neighborhood: e.target.value })}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Rua</label>
            <input type="text" value={data.residence.street} onChange={(e) => patchResidence({ street: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>N.º da Casa</label>
            <input
              type="text"
              value={data.residence.houseNumber}
              onChange={(e) => patchResidence({ houseNumber: e.target.value })}
              className={inputCls}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Ponto de Referência</label>
            <input
              type="text"
              value={data.residence.referencePoint || ''}
              onChange={(e) => patchResidence({ referencePoint: e.target.value })}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Telefone (Residência)</label>
            <input type="text" value={data.residence.phone} onChange={(e) => patchResidence({ phone: e.target.value })} className={`${inputCls} font-mono`} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>E-mail (Residência)</label>
            <input type="email" value={data.residence.email} onChange={(e) => patchResidence({ email: e.target.value })} className={inputCls} />
          </div>
        </div>
      </div>

      {/* PROVENIÊNCIA ESCOLAR DETALHADA — escola anterior, fora da instituição */}
      <div className="border border-slate-300 p-4 bg-slate-50/50">
        <div className="flex items-center gap-2 pb-2 mb-3 border-b border-slate-200">
          <span className="material-symbols-outlined text-[18px] text-[#0b1f3a]">school</span>
          <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
            3. Dados Académicos Anteriores
          </h4>
        </div>
     
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-1">
            <label className={labelCls}>Escola Anterior</label>
            <input
              type="text"
              value={data.previousSchoolDetails.school}
              onChange={(e) => patchPrevSchool({ school: e.target.value })}
              className={inputCls}
            />
          </div>
          <SearchableSelect
            label="Província"
            options={provinceOptions}
            value={data.previousSchoolDetails.province}
            onChange={(v) => patchPrevSchool({ province: v, municipality: '' })}
            placeholder="Selecione a província"
            allowCustom
          />
          <SearchableSelect
            label="Município"
            options={prevMunicipalityOptions}
            value={data.previousSchoolDetails.municipality}
            onChange={(v) => patchPrevSchool({ municipality: v })}
            placeholder="Selecione o município"
            disabled={!data.previousSchoolDetails.province}
            allowCustom
          />
          <div>
            <label className={labelCls}>Última Classe Frequentada</label>
            <input
              type="text"
              value={data.previousSchoolDetails.lastGrade}
              onChange={(e) => patchPrevSchool({ lastGrade: e.target.value })}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Classe Concluída</label>
            <input
              type="text"
              value={data.previousSchoolDetails.completedGrade}
              onChange={(e) => patchPrevSchool({ completedGrade: e.target.value })}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Ano Lectivo</label>
            <select
              value={data.previousSchoolDetails.academicYear}
              onChange={(e) => patchPrevSchool({ academicYear: e.target.value })}
              className={`${inputCls} font-mono`}
            >
              <option value="">Seleccionar ano lectivo…</option>
              {institutionAcademicYears(db.settings, [
                data.previousSchoolDetails.academicYear,
                ...(db.matriculas || []).map((m) => m.academicYear)
              ]).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Média Final</label>
            <input
              type="number"
              step="0.1"
              value={data.previousSchoolDetails.finalAverage ?? ''}
              onChange={(e) => patchPrevSchool({ finalAverage: e.target.value ? Number(e.target.value) : undefined })}
              className={`${inputCls} font-mono`}
            />
          </div>
          <div>
            <label className={labelCls}>Resultado</label>
            <select
              value={data.previousSchoolDetails.result}
              onChange={(e) => patchPrevSchool({ result: e.target.value as PreviousSchoolDetails['result'] })}
              className={`${inputCls} font-semibold`}
            >
              {RESULTADO_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>N.º do Certificado</label>
            <input
              type="text"
              value={data.previousSchoolDetails.certificateNumber || ''}
              onChange={(e) => patchPrevSchool({ certificateNumber: e.target.value })}
              className={`${inputCls} font-mono`}
            />
          </div>
          <div>
            <label className={labelCls}>N.º da Declaração</label>
            <input
              type="text"
              value={data.previousSchoolDetails.declarationNumber || ''}
              onChange={(e) => patchPrevSchool({ declarationNumber: e.target.value })}
              className={`${inputCls} font-mono`}
            />
          </div>
          <div>
            <label className={labelCls}>Data de Emissão</label>
            <input
              type="date"
              value={data.previousSchoolDetails.issueDate || ''}
              onChange={(e) => patchPrevSchool({ issueDate: e.target.value })}
              className={`${inputCls} font-mono`}
            />
          </div>
        </div>
      </div>

      {/* SITUAÇÃO DO ALUNO & NECESSIDADES EDUCATIVAS ESPECIAIS — dados sensíveis */}
      <div className="border border-slate-300 p-4 bg-slate-50/50">
        <div className="flex items-center gap-2 pb-2 mb-3 border-b border-slate-200">
          <span className="material-symbols-outlined text-[18px] text-[#0b1f3a]">fact_check</span>
          <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
            4. Informações Adicionais
          </h4>
         
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-3">
          <div>
            <label className={labelCls}>Situação do Aluno</label>
            <select
              value={data.studentSituation}
              onChange={(e) => onChange({ studentSituation: e.target.value as StudentSituation })}
              className={`${inputCls} font-semibold`}
            >
              {SITUACAO_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!canViewSensitive ? (
          <div className="flex items-center gap-2 p-4 text-slate-500 bg-white border border-slate-200 text-[11px]">
            <span className="material-symbols-outlined text-[18px]">lock</span>
            Sem permissão para ver ou editar as Necessidades Educativas Especiais deste aluno (regra{' '}
            <code>alunos.sensitive</code>).
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Necessidade Educativa Especial</label>
              <select
                value={data.specialNeeds.hasNeeds ? 'sim' : 'nao'}
                onChange={(e) => patchSpecialNeeds({ hasNeeds: e.target.value === 'sim' })}
                className={`${inputCls} font-semibold`}
              >
                <option value="nao">Não</option>
                <option value="sim">Sim</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Tipo de Necessidade</label>
              <input
                type="text"
                disabled={!data.specialNeeds.hasNeeds}
                value={data.specialNeeds.type || ''}
                onChange={(e) => patchSpecialNeeds({ type: e.target.value })}
                placeholder={data.specialNeeds.hasNeeds ? 'Ex: Baixa Visão, TEA, Dislexia...' : '—'}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Necessita de Apoio Especial</label>
              <select
                value={data.specialNeeds.needsSupport ? 'sim' : 'nao'}
                onChange={(e) => patchSpecialNeeds({ needsSupport: e.target.value === 'sim' })}
                className={`${inputCls} font-semibold`}
              >
                <option value="nao">Não</option>
                <option value="sim">Sim</option>
              </select>
            </div>
            <div className="sm:col-span-3">
              <label className={labelCls}>Observações</label>
              <textarea
                value={data.specialNeeds.observations || ''}
                onChange={(e) => patchSpecialNeeds({ observations: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 rounded-none bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:ring-1 focus:ring-[#0b1f3a] focus:outline-none"
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
};
