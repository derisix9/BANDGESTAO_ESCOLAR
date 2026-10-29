import React, { useState, useRef } from 'react';
import { Spinner } from './Spinner';
import { Teacher, SchoolDatabase } from '../types';
import { dbService } from '../services/db';
import { compressImageFile } from '../utils/imageCompressor';
import { OperationStatusModal } from './OperationStatusModal';
import { DepartmentSelect } from './DepartmentSelect';
import { guardPlan } from '../utils/planGuard';
import { findDuplicatePerson, duplicateMessage } from '../utils/duplicatePerson';
import { Notice, notify } from './Notice';

interface TeacherFormModalProps {
  db: SchoolDatabase;
  editingTeacher: Teacher | null;
  onClose: () => void;
  onSuccess: () => void;
}

const DEFAULT_TEACHER_PHOTOS = [
  '/avatar-padrao.png',
  '/avatar-padrao.png',
  '/avatar-padrao.png',
  '/avatar-padrao.png',
  '/avatar-padrao.png'
];

export const TeacherFormModal: React.FC<TeacherFormModalProps> = ({
  db,
  editingTeacher,
  onClose,
  onSuccess
}) => {
  const [activeTab, setActiveTab] = useState<'pessoal' | 'academico' | 'contactos' | 'financeiro' | 'observacoes'>('pessoal');
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'loading' | 'success'>('idle');
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  // Form State with ALL fields matching TeacherProfileModal
  const [formData, setFormData] = useState({
    // 1. Dados Pessoais & Identificação
    name: editingTeacher?.name || '',
    agentNumber: editingTeacher?.agentNumber || '',
    // Nunca inventa BI/NIF/INSS: ficam vazios até o utilizador introduzir os
    // números reais do professor no formulário.
    biNumber: editingTeacher?.biNumber || '',
    nif: editingTeacher?.nif || '',
    inssNumber: editingTeacher?.inssNumber || '',
    gender: editingTeacher?.gender || 'Masculino',
    birthDate: editingTeacher?.birthDate || '',
    maritalStatus: editingTeacher?.maritalStatus || '',
    birthPlace: editingTeacher?.birthPlace || '',
    nationality: editingTeacher?.nationality || 'Angolana',
    address: editingTeacher?.address || '',
    avatar: editingTeacher?.avatar || DEFAULT_TEACHER_PHOTOS[0],

    // 2. Dados Académicos & Vínculo
    degree: editingTeacher?.degree || '',
    category: editingTeacher?.category || '',
    department: editingTeacher?.department || '',
    admissionDate: editingTeacher?.admissionDate || '',
    weeklyHours: editingTeacher?.weeklyHours || 0,
    status: editingTeacher?.status || ('ativo' as 'ativo' | 'licenca' | 'contrato_vencer'),

    // 3. Contactos
    phone: editingTeacher?.phone || '',
    emergencyContactPhone: editingTeacher?.emergencyContactPhone || '',
    email: editingTeacher?.email || '',

    // 4. Dados Financeiros & Bancários
    baseSalaryKz: editingTeacher?.baseSalaryKz !== undefined ? editingTeacher.baseSalaryKz : 0,
    allowancesKz: editingTeacher?.allowancesKz !== undefined ? editingTeacher.allowancesKz : 0,
    allowanceDescription: editingTeacher?.allowanceDescription || '',
    retentionTaxKz: editingTeacher?.retentionTaxKz !== undefined ? editingTeacher.retentionTaxKz : 0,
    bankName: editingTeacher?.bankName || '',
    iban: editingTeacher?.iban || '',

    // 5. Nota Pedagógica / Bio
    bio: editingTeacher?.bio || ''
  });

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        notify.warn('A fotografia excede o limite de 10MB.');
        return;
      }
      try {
        const compressed = await compressImageFile(file, 480, 480, 0.82);
        setFormData((prev) => ({ ...prev, avatar: compressed }));
      } catch {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (typeof reader.result === 'string') {
            setFormData((prev) => ({ ...prev, avatar: reader.result as string }));
          }
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      notify.warn('Por favor, informe o nome completo do docente.');
      return;
    }
    if (submitStatus !== 'idle') return;
    if (!editingTeacher && !guardPlan('armazenamento')) return;

    const duplicate = findDuplicatePerson(
      dbService.getDb().teachers,
      { name: formData.name, docs: [formData.biNumber] },
      (t) => ({ id: t.id, name: t.name, docs: [t.biNumber] }),
      editingTeacher?.id
    );
    if (duplicate) {
      notify.warn(duplicateMessage('professor', duplicate.name));
      return;
    }

    setSubmitStatus('loading');
    const autoEmail =
      formData.email.trim() ||
      `${formData.name.toLowerCase().trim().replace(/[^a-z0-9]/g, '.')}@bandmed.ao`;

    setTimeout(() => {
      if (editingTeacher) {
        dbService.updateTeacher(editingTeacher.id, {
          name: formData.name.trim(),
          agentNumber: formData.agentNumber.trim(),
          biNumber: formData.biNumber.trim(),
          nif: formData.nif.trim(),
          inssNumber: formData.inssNumber.trim(),
          gender: formData.gender,
          birthDate: formData.birthDate,
          maritalStatus: formData.maritalStatus,
          birthPlace: formData.birthPlace,
          nationality: formData.nationality,
          address: formData.address,
          avatar: formData.avatar,

          degree: formData.degree.trim(),
          category: formData.category.trim(),
          department: formData.department,
          admissionDate: formData.admissionDate,
          weeklyHours: Number(formData.weeklyHours),
          status: formData.status,

          phone: formData.phone.trim(),
          emergencyContactPhone: formData.emergencyContactPhone.trim(),
          email: autoEmail,

          baseSalaryKz: Number(formData.baseSalaryKz),
          allowancesKz: Number(formData.allowancesKz),
          allowanceDescription: formData.allowanceDescription.trim(),
          retentionTaxKz: Number(formData.retentionTaxKz),
          bankName: formData.bankName,
          iban: formData.iban.trim(),

          bio: formData.bio.trim()
        });
      } else {
        dbService.addTeacher({
          name: formData.name.trim(),
          agentNumber: formData.agentNumber.trim(),
          biNumber: formData.biNumber.trim(),
          nif: formData.nif.trim(),
          inssNumber: formData.inssNumber.trim(),
          gender: formData.gender,
          birthDate: formData.birthDate,
          maritalStatus: formData.maritalStatus,
          birthPlace: formData.birthPlace,
          nationality: formData.nationality,
          address: formData.address,
          avatar: formData.avatar,

          degree: formData.degree.trim(),
          category: formData.category.trim(),
          department: formData.department,
          admissionDate: formData.admissionDate,
          weeklyHours: Number(formData.weeklyHours),
          status: formData.status,

          phone: formData.phone.trim(),
          emergencyContactPhone: formData.emergencyContactPhone.trim(),
          email: autoEmail,

          baseSalaryKz: Number(formData.baseSalaryKz),
          allowancesKz: Number(formData.allowancesKz),
          allowanceDescription: formData.allowanceDescription.trim(),
          retentionTaxKz: Number(formData.retentionTaxKz),
          bankName: formData.bankName,
          iban: formData.iban.trim(),

          bio: formData.bio.trim(),
          allocatedClasses: []
        });
      }

      setSubmitStatus('success');
      setTimeout(() => {
        onSuccess();
      }, 1200);
    }, 500);
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-6 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && submitStatus === 'idle') onClose();
      }}
    >
      <div className="bg-white rounded-none max-w-3xl w-full shadow-2xl border border-slate-400 overflow-hidden flex flex-col max-h-[94vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-[#0b1f3a] text-white flex items-center justify-between border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-none bg-white/10 flex items-center justify-center text-white">
              <span className="material-symbols-outlined text-[22px]">
                {editingTeacher ? 'edit_square' : 'person_add'}
              </span>
            </div>
            <div>
              <h3 className="font-bold text-sm uppercase tracking-wider">
                {editingTeacher ? 'Editar Ficha do Professor' : 'Ficha de Cadastro Oficial do Professor'}
              </h3>
              <p className="text-[11px] text-blue-200">
                Registo de identificação pessoal, vínculos académicos, dados bancários e distribuição
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-300 hover:text-white hover:bg-white/10 p-1 cursor-pointer transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-300 bg-slate-100 text-xs font-bold overflow-x-auto shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('pessoal')}
            className="step-tab px-4 py-2.5 border-b-2 transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5"
            role="tab"
            aria-selected={activeTab === 'pessoal'}
          >
            <span className="material-symbols-outlined text-[16px]">badge</span>
            <span>1. Dados Pessoais & BI</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('academico')}
            className="step-tab px-4 py-2.5 border-b-2 transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5"
            role="tab"
            aria-selected={activeTab === 'academico'}
          >
            <span className="material-symbols-outlined text-[16px]">school</span>
            <span>2. Académico & Vínculo</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('contactos')}
            className="step-tab px-4 py-2.5 border-b-2 transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5"
            role="tab"
            aria-selected={activeTab === 'contactos'}
          >
            <span className="material-symbols-outlined text-[16px]">call</span>
            <span>3. Contactos & Morada</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('financeiro')}
            className="step-tab px-4 py-2.5 border-b-2 transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5"
            role="tab"
            aria-selected={activeTab === 'financeiro'}
          >
            <span className="material-symbols-outlined text-[16px]">account_balance</span>
            <span>4. Salário & IBAN</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('observacoes')}
            className="step-tab px-4 py-2.5 border-b-2 transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5"
            role="tab"
            aria-selected={activeTab === 'observacoes'}
          >
            <span className="material-symbols-outlined text-[16px]">description</span>
            <span>5. Bio & Observações</span>
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 text-xs bg-white space-y-4">
          {/* TAB 1: DADOS PESSOAIS */}
          {activeTab === 'pessoal' && (
            <div className="space-y-4">
              {/* Fotografia Oficial */}
              <div className="p-3.5 bg-slate-50 border border-slate-300 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className="w-24 h-28 bg-white border-2 border-[#0b1f3a] rounded-none flex items-center justify-center overflow-hidden shrink-0 shadow-xs">
                  {formData.avatar ? (
                    <img src={formData.avatar} alt="Foto Docente" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[10px] text-slate-400">Sem Foto</span>
                  )}
                </div>

                <div className="space-y-2 flex-1">
                  <span className="block font-bold text-slate-800 uppercase text-[11px]">
                    Fotografia do Professor (Para Ficha e Cartão)
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="file"
                      ref={photoInputRef}
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => photoInputRef.current?.click()}
                      className="px-3 py-1.5 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[16px]">upload</span>
                      Carregar Foto do Computador
                    </button>
                    
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                    Nome Completo do Professor *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Ex: Prof. Dr. Mateus Francisco Fontes"
                    className="w-full h-9 px-3 bg-white border border-slate-300 font-bold text-slate-900 focus:border-[#0b1f3a] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                    N.º de Agente {editingTeacher ? '*' : ''}
                  </label>
                  <input
                    type="text"
                    required={!!editingTeacher}
                    readOnly={!editingTeacher}
                    value={formData.agentNumber}
                    onChange={(e) => setFormData({ ...formData, agentNumber: e.target.value })}
                    placeholder={!editingTeacher ? 'Gerado automaticamente ao gravar (Ex: AG-0044)' : 'Ex: AG-0044'}
                    className={`w-full h-9 px-3 border border-slate-300 font-mono text-slate-800 focus:border-[#0b1f3a] focus:outline-none ${
                      !editingTeacher ? 'bg-slate-100 text-slate-400 italic cursor-not-allowed' : 'bg-white'
                    }`}
                  />
                </div>

                <div>
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                    Bilhete de Identidade/Passaporte / Outro documento (opcional)
                  </label>
                  <input
                    type="text"
                    value={formData.biNumber}
                    onChange={(e) => setFormData({ ...formData, biNumber: e.target.value })}
                    placeholder="003921890BA031"
                    className="w-full h-9 px-3 bg-white border border-slate-300 font-mono text-slate-800 focus:border-[#0b1f3a] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                    NIF (Número de Identificação Fiscal)
                  </label>
                  <input
                    type="text"
                    value={formData.nif}
                    onChange={(e) => setFormData({ ...formData, nif: e.target.value })}
                    placeholder="5418902401"
                    className="w-full h-9 px-3 bg-white border border-slate-300 font-mono text-slate-800 focus:border-[#0b1f3a] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                    N.º de Segurança Social (INSS)
                  </label>
                  <input
                    type="text"
                    value={formData.inssNumber}
                    onChange={(e) => setFormData({ ...formData, inssNumber: e.target.value })}
                    placeholder="88401924-AO"
                    className="w-full h-9 px-3 bg-white border border-slate-300 font-mono text-slate-800 focus:border-[#0b1f3a] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">Gênero</label>
                  <select
                    value={formData.gender}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                    className="w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none"
                  >
                    <option value="">Selecione...</option>
                    <option value="Masculino">Masculino</option>
                    <option value="Feminino">Feminino</option>
                  </select>
                </div>

                <div>
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">Estado Civil</label>
                  <select
                    value={formData.maritalStatus}
                    onChange={(e) => setFormData({ ...formData, maritalStatus: e.target.value })}
                    className="w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none"
                  >
                    <option value="">Selecione...</option>
                    <option value="Solteiro(a)">Solteiro(a)</option>
                    <option value="Casado(a)">Casado(a)</option>
                    <option value="Divorciado(a)">Divorciado(a)</option>
                    <option value="Viúvo(a)">Viúvo(a)</option>
                  </select>
                </div>

                <div>
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">Data de Nascimento</label>
                  <input
                    type="date"
                    value={formData.birthDate}
                    onChange={(e) => setFormData({ ...formData, birthDate: e.target.value })}
                    className="w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">Naturalidade / Província</label>
                  <input
                    type="text"
                    value={formData.birthPlace}
                    onChange={(e) => setFormData({ ...formData, birthPlace: e.target.value })}
                    placeholder="Luanda, Angola"
                    className="w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: ACADÉMICO & VÍNCULO */}
          {activeTab === 'academico' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                    Grau Académico & Habilitações Literárias *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.degree}
                    onChange={(e) => setFormData({ ...formData, degree: e.target.value })}
                    placeholder="Ex: Mestrado em Ensino da Física (UAN) / Licenciatura em Matemática"
                    className="w-full h-9 px-3 bg-white border border-slate-300 font-semibold text-slate-900 focus:border-[#0b1f3a] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                    Categoria Docente *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    placeholder="Ex: Professor do 1.º Grau (MED) / Titular"
                    className="w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                    Departamento Curricular *
                  </label>
                  <DepartmentSelect
                    departments={db.departments || []}
                    kind="curricular"
                    value={formData.department}
                    onChange={(department) => setFormData({ ...formData, department })}
                    className="w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 font-semibold focus:border-[#0b1f3a] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                    Data de Admissão
                  </label>
                  <input
                    type="date"
                    value={formData.admissionDate}
                    onChange={(e) => setFormData({ ...formData, admissionDate: e.target.value })}
                    className="w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                    Carga Horária Semanal (Horas / Semana) *
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={formData.weeklyHours}
                    onChange={(e) => setFormData({ ...formData, weeklyHours: Number(e.target.value) })}
                    className="w-full h-9 px-3 bg-white border border-slate-300 font-mono text-slate-800 font-bold focus:border-[#0b1f3a] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                    Estado de Vínculo Contratual
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                    className="w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 font-semibold focus:border-[#0b1f3a] focus:outline-none"
                  >
                    <option value="ativo">Ativo no Quadro Efetivo</option>
                    <option value="licenca">Em Licença / Afastamento</option>
                    <option value="contrato_vencer">Contrato a Renovar</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: CONTACTOS & MORADA */}
          {activeTab === 'contactos' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                    Telefone de Contacto Principal *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="+244 923 000 000"
                    className="w-full h-9 px-3 bg-white border border-slate-300 font-mono text-slate-800 font-bold focus:border-[#0b1f3a] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                    Telefone de Emergência / Alternativo
                  </label>
                  <input
                    type="text"
                    value={formData.emergencyContactPhone}
                    onChange={(e) => setFormData({ ...formData, emergencyContactPhone: e.target.value })}
                    placeholder="+244 912 000 000"
                    className="w-full h-9 px-3 bg-white border border-slate-300 font-mono text-slate-800 focus:border-[#0b1f3a] focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                    Email
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="nome.sobrenome@bandmed.ao (gerado automaticamente se vazio)"
                    className="w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none font-mono"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                    Morada
                  </label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    placeholder="Bairro, Rua, Casa/Edifício, Município, Luanda"
                    className="w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: SALÁRIO & DADOS BANCÁRIOS */}
          {activeTab === 'financeiro' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                    Vencimento Base Mensal (Kz)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={formData.baseSalaryKz}
                    onChange={(e) => setFormData({ ...formData, baseSalaryKz: Number(e.target.value) })}
                    className="w-full h-9 px-3 bg-white border border-slate-300 font-mono text-slate-900 font-bold focus:border-[#0b1f3a] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                    Subsídios Acumulados (Kz)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={formData.allowancesKz}
                    onChange={(e) => setFormData({ ...formData, allowancesKz: Number(e.target.value) })}
                    className="w-full h-9 px-3 bg-white border border-slate-300 font-mono text-slate-900 font-bold focus:border-[#0b1f3a] focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                    Descrição / Natureza dos Subsídios
                  </label>
                  <input
                    type="text"
                    value={formData.allowanceDescription}
                    onChange={(e) => setFormData({ ...formData, allowanceDescription: e.target.value })}
                    placeholder="Ex: Coordenação de Disciplina, Elaboração de Provas & Transporte"
                    className="w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                    Retenção Fiscal na Fonte (IRT + INSS Kz)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={500}
                    value={formData.retentionTaxKz}
                    onChange={(e) => setFormData({ ...formData, retentionTaxKz: Number(e.target.value) })}
                    className="w-full h-9 px-3 bg-white border border-slate-300 font-mono text-slate-900 focus:border-[#0b1f3a] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                  Instituição Bancária
                  </label>
                  <select
                    value={formData.bankName}
                    onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                    className="w-full h-9 px-3 bg-white border border-slate-300 text-slate-800 font-semibold focus:border-[#0b1f3a] focus:outline-none"
                  >
                    <option value="">Selecione...</option>
                    <option value="BAI - Banco Angolano de Investimentos">BAI - Banco Angolano de Investimentos</option>
                    <option value="BFA - Banco de Fomento Angola">BFA - Banco de Fomento Angola</option>
                    <option value="BIC - Banco BIC Angola">BIC - Banco BIC Angola</option>
                    <option value="BMA - Banco Millennium Atlântico">BMA - Banco Millennium Atlântico</option>
                    <option value="BPC - Banco de Poupança e Crédito">BPC - Banco de Poupança e Crédito</option>
                    <option value="SOL - Banco Sol">SOL - Banco Sol</option>
                    <option value="KEVE - Banco Keve">KEVE - Banco Keve</option>
                    <option value="Outro Banco">Outro</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                    IBAN*
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.iban}
                    onChange={(e) => setFormData({ ...formData, iban: e.target.value })}
                    placeholder="AO06 0040 0000 0000 0000 0000 0"
                    className="w-full h-9 px-3 bg-white border border-slate-300 font-mono text-slate-900 font-bold focus:border-[#0b1f3a] focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: BIO & NOTAS PEDAGÓGICAS */}
          {activeTab === 'observacoes' && (
            <div className="space-y-3">
              <div>
                <label className="block uppercase font-bold text-slate-700 mb-1 text-[11px]">
                  Resumo Curricular, Especialidade e Notas Pedagógicas
                </label>
                <textarea
                  rows={4}
                  value={formData.bio}
                  onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                  placeholder="Áreas de investigação, experiência no subsistema do ensino secundário, projetos e méritos pedagógicos..."
                  className="w-full p-3 bg-white border border-slate-300 text-slate-800 focus:border-[#0b1f3a] focus:outline-none text-xs"
                />
              </div>

              <Notice tone="info" icon="info">
                <span className="text-[11px]">
                  As turmas e disciplinas atribuídas ao docente são geridas na secção de Distribuição Curricular e
                  Horários do complexo escolar.
                </span>
              </Notice>
            </div>
          )}

          {/* Form Actions Footer */}
          <div className="pt-4 flex items-center justify-between border-t border-slate-300">
            <div className="text-[11px] text-slate-500">
              {activeTab === 'pessoal' && 'Passo 1 de 5'}
              {activeTab === 'academico' && 'Passo 2 de 5'}
              {activeTab === 'contactos' && 'Passo 3 de 5'}
              {activeTab === 'financeiro' && 'Passo 4 de 5'}
              {activeTab === 'observacoes' && 'Passo 5 de 5'}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs cursor-pointer border border-slate-300"
              >
                Cancelar
              </button>

              <button
                type="submit"
                disabled={submitStatus !== 'idle'}
                className="px-5 py-2 bg-[#0b1f3a] hover:bg-[#7a0c0c] text-white font-bold text-xs cursor-pointer transition-colors border border-[#0b1f3a] flex items-center gap-1.5"
              >
                {submitStatus === 'loading' && (
                  <>
                    <Spinner size={14} className="text-white" />
                    <span>A guardar ficha...</span>
                  </>
                )}
                {submitStatus === 'success' && (
                  <>
                    <span className="material-symbols-outlined text-[16px]">check_circle</span>
                    <span>Ficha Guardada!</span>
                  </>
                )}
                {submitStatus === 'idle' && (
                  <>
                    <span className="material-symbols-outlined text-[16px]">save</span>
                    <span>{editingTeacher ? 'SALVAR ALTERAÇÕES' : 'CADASTRAR'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>

        <OperationStatusModal
          isOpen={submitStatus !== 'idle'}
          status={submitStatus === 'loading' ? 'loading' : 'success'}
          loadingMessage={editingTeacher ? 'A salvar alterações do professor...' : 'A cadastrar professor...'}
          successMessage="Operação feita com sucesso!"
        />
      </div>
    </div>
  );
};
