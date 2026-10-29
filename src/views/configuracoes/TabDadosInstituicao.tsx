import React, { useRef, useState } from 'react';
import { EducationLevelId, InstitutionSettings, UserRole } from '../../types';
import { ALL_EDUCATION_SUBSYSTEMS, DEFAULT_SELECTED_SUBSYSTEMS } from '../../utils/educationSubsystems';
import { isEducationSubsystemBlocked } from '../../utils/platformLock';
import { compressImageFile } from '../../utils/imageCompressor';

import { showOperationSuccess } from '../../context/OperationContext';
import { Notice, notify } from '../../components/Notice';

interface TabDadosInstituicaoProps {
  settings: InstitutionSettings;
  currentUserRole?: UserRole;
  onUpdateSettings: (newSettings: Partial<InstitutionSettings>) => void;
  onSaveAll: (options?: { loadingMessage?: string; successMessage?: string; requiredRule?: string }) => void;
  /** Estes separadores propagam as alterações em tempo real; nada há a recolher. */
  registerCommit?: (commit: (() => Partial<InstitutionSettings>) | null) => void;
}

export const TabDadosInstituicao: React.FC<TabDadosInstituicaoProps> = ({
  settings,
  currentUserRole,
  onUpdateSettings,
  onSaveAll
}) => {
  const logoFileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showUrlInput, setShowUrlInput] = useState<boolean>(false);

  // Confirmação do logótipo pelo diálogo global (carregamento → visto animado), sem faixa solta.
  const notifyLogoLoaded = () => {
    void showOperationSuccess('Logótipo carregado com sucesso!', { details: 'Será impresso nos documentos oficiais.' });
  };

  const processImageFile = async (file: File) => {
    setUploadError(null);
    if (!file.type.startsWith('image/')) {
      setUploadError('Por favor, selecione um ficheiro de imagem válido (PNG, JPG, SVG ou WEBP).');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setUploadError('A imagem selecionada excede o limite máximo de 8MB.');
      return;
    }

    try {
      if (file.type === 'image/svg+xml') {
        const reader = new FileReader();
        reader.onload = (e) => {
          const result = e.target?.result as string;
          if (result) {
            onUpdateSettings({ logoUrl: result });
            notifyLogoLoaded();
          }
        };
        reader.readAsDataURL(file);
      } else {
        const compressed = await compressImageFile(file, 512, 512, 0.92);
        onUpdateSettings({ logoUrl: compressed });
        notifyLogoLoaded();
      }
    } catch {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        if (result) {
          onUpdateSettings({ logoUrl: result });
          notifyLogoLoaded();
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processImageFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processImageFile(file);
    }
  };
  // Só os subsistemas de ensino que o Admin Master deixou ativos para esta escola.
  const offeredSubsystems = ALL_EDUCATION_SUBSYSTEMS.filter((s) => !isEducationSubsystemBlocked(s.id));
  const offeredIds = offeredSubsystems.map((s) => s.id) as EducationLevelId[];
  const currentSubsystems: EducationLevelId[] = (
    settings.selectedSubsystems && settings.selectedSubsystems.length > 0
      ? settings.selectedSubsystems
      : DEFAULT_SELECTED_SUBSYSTEMS
  ).filter((id) => offeredIds.includes(id));

  const toggleSubsystem = (id: EducationLevelId) => {
    let updated: EducationLevelId[];
    if (currentSubsystems.includes(id)) {
      if (currentSubsystems.length === 1) {
        notify.warn('Atenção: A instituição deve manter pelo menos um sub-sistema de ensino ativo no sistema.');
        return;
      }
      updated = currentSubsystems.filter((item) => item !== id);
    } else {
      updated = [...currentSubsystems, id];
    }
    onUpdateSettings({ selectedSubsystems: updated });
  };

  const applyPreset = (presetIds: EducationLevelId[]) => {
    const allowed = presetIds.filter((id) => offeredIds.includes(id));
    if (allowed.length === 0) return;
    onUpdateSettings({ selectedSubsystems: allowed });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Top Header */}
      <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center text-[#0b1f3a] shrink-0">
            <span className="material-symbols-outlined text-[26px]">apartment</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-[#ac332b] font-bold">Módulo 01</span>
              <span className="w-1 h-1 rounded-full bg-slate-300" />
              <span className="text-[11px] text-slate-500 font-medium">Identificação da Escola</span>
            </div>
            <h2 className="font-headline text-lg lg:text-xl font-bold text-slate-900">
              DADOS DA INSTITUIÇÃO
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 bg-blue-50 text-[#0b1f3a] font-mono text-xs font-bold rounded-xl border border-blue-100 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]">school</span>
            <span>{currentSubsystems.length} Sub-sistemas Ativos</span>
          </span>
        </div>
      </div>

      {/* BLOCO 1: Identidade Oficial, NIF e Acreditação MED / MESCTI */}
      <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="font-headline text-base lg:text-lg font-bold text-slate-900">
              1. Informações Gerais
            </h3>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
          <div className="lg:col-span-2 flex flex-col gap-1">
            <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
              Nome da Instituição
            </label>
            <input
              type="text"
              value={settings.schoolName}
              onChange={(e) => onUpdateSettings({ schoolName: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs font-semibold"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
              Categoria
            </label>
            <input
              type="text"
              value={settings.subTitle || ''}
              onChange={(e) => onUpdateSettings({ subTitle: e.target.value })}
              placeholder="Ex.: Ensino Primário, Iº e IIº Ciclos do Ensino Secundário"
              className="w-full px-3.5 py-2.5 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs font-semibold"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
              NIF
            </label>
            <input
              type="text"
              value={settings.nif || ''}
              onChange={(e) => onUpdateSettings({ nif: e.target.value })}
              placeholder="NIF da Instituição"
              className="w-full px-3.5 py-2.5 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 font-mono outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs font-bold"
            />
          </div>

          <div className="lg:col-span-2 flex flex-col gap-1">
            <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
              Decreto de Criação
            </label>
            <input
              type="text"
              value={settings.decreeAuthorization}
              onChange={(e) => onUpdateSettings({ decreeAuthorization: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
              Código de Exportação/GEPE
            </label>
            <input
              type="text"
              value={settings.medCode || ''}
              onChange={(e) => onUpdateSettings({ medCode: e.target.value })}
              placeholder="Ex.: ESC-40291"
              className="w-full px-3.5 py-2.5 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 font-mono outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs font-bold"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
              Tipo de Instituição
            </label>
            <select
              value={settings.schoolNature || ''}
              onChange={(e) => onUpdateSettings({ schoolNature: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs font-semibold"
            >
              <option value="">— Selecionar —</option>
              <option value="Pública">Pública</option>
              <option value="Privada">Privada</option>
              <option value="Comparticipada">Comparticipada</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
              Província e Município
            </label>
            <input
              type="text"
              value={`${settings.province}, ${settings.municipality}`}
              onChange={(e) => {
                const parts = e.target.value.split(',');
                onUpdateSettings({
                  province: parts[0]?.trim() || settings.province,
                  municipality: parts[1]?.trim() || settings.municipality
                });
              }}
              className="w-full px-3.5 py-2.5 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
              Comuna / Distrito Urbano
            </label>
            <input
              type="text"
              value={settings.commune || ''}
              onChange={(e) => onUpdateSettings({ commune: e.target.value })}
              placeholder="Ex.: Kilamba"
              className="w-full px-3.5 py-2.5 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs font-semibold"
            />
          </div>

          <div className="lg:col-span-2 flex flex-col gap-1">
            <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
              Endereço
            </label>
            <input
              type="text"
              value={settings.address}
              onChange={(e) => onUpdateSettings({ address: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
              E-mail
            </label>
            <input
              type="email"
              value={settings.email}
              onChange={(e) => onUpdateSettings({ email: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
              Contacto
            </label>
            <input
              type="text"
              value={settings.phone}
              onChange={(e) => onUpdateSettings({ phone: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 font-mono outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
              Diretor Geral
            </label>
            <input
              type="text"
              value={settings.directorGeral || ''}
              onChange={(e) => onUpdateSettings({ directorGeral: e.target.value })}
              placeholder="Nome do Diretor Geral / Presidente"
              className="w-full px-3.5 py-2.5 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs font-semibold"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
              Diretor Pedagógico
            </label>
            <input
              type="text"
              value={settings.directorPedagogico || ''}
              onChange={(e) => onUpdateSettings({ directorPedagogico: e.target.value })}
              placeholder="Nome do Diretor Pedagógico"
              className="w-full px-3.5 py-2.5 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs font-semibold"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
              Secretaria Geral
            </label>
            <input
              type="text"
              value={settings.chefeSecretaria || ''}
              onChange={(e) => onUpdateSettings({ chefeSecretaria: e.target.value })}
              placeholder="Nome do Chefe de Secretaria Geral"
              className="w-full px-3.5 py-2.5 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs font-semibold"
            />
          </div>

          {(settings.selectedSubsystems || []).includes('superior') && !isEducationSubsystemBlocked('superior') && (
            <>
          <div className="flex flex-col gap-1">
            <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
              Reitor(a) — assina o diploma
            </label>
            <input
              type="text"
              value={settings.rectorName || ''}
              onChange={(e) => onUpdateSettings({ rectorName: e.target.value })}
              placeholder="Nome do Reitor(a)"
              className="w-full px-3.5 py-2.5 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs font-semibold"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
              Diretor(a) Académico(a) — assina o diploma
            </label>
            <input
              type="text"
              value={settings.academicDirectorName || ''}
              onChange={(e) => onUpdateSettings({ academicDirectorName: e.target.value })}
              placeholder="Nome do Diretor(a) Académico(a)"
              className="w-full px-3.5 py-2.5 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs font-semibold"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
              Livro de registo de diplomas
            </label>
            <input
              type="text"
              value={settings.diplomaRegistryBook || ''}
              onChange={(e) => onUpdateSettings({ diplomaRegistryBook: e.target.value })}
              placeholder="Ex.: Livro 1"
              className="w-full px-3.5 py-2.5 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs font-semibold"
            />
          </div>

            </>
          )}

          <div className="flex flex-col gap-1">
            <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
              Website
            </label>
            <input
              type="text"
              value={settings.website || ''}
              onChange={(e) => onUpdateSettings({ website: e.target.value })}
              placeholder="Ex.: https://escola.ao"
              className="w-full px-3.5 py-2.5 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
              Bairro
            </label>
            <input
              type="text"
              value={settings.bairro || ''}
              onChange={(e) => onUpdateSettings({ bairro: e.target.value })}
              placeholder="Ex.: Bairro ou Distrito Urbano"
              className="w-full px-3.5 py-2.5 bg-slate-50 text-slate-900 rounded-xl border border-slate-200 outline-none focus:bg-white focus:ring-2 focus:ring-[#0b1f3a] text-xs"
            />
          </div>
        </div>

        {/* LOGÓTIPO & IDENTIDADE VISUAL OFICIAL (UPLOAD COMPUTADOR / MOBILE) */}
        <div className="pt-4 border-t border-slate-100 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h4 className="font-headline font-bold text-slate-900 text-sm flex items-center gap-2">
                <span className="material-symbols-outlined text-[#ac332b] text-[20px]">photo_camera</span>
                <span>Logótipo da Escola</span>
              </h4>
              <p className="text-[11px] text-slate-500">
                Carregue o logótipo em formato PNG, JPG ou SVG a partir do computador ou dispositivo móvel.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowUrlInput(!showUrlInput)}
                className="text-[11px] font-semibold text-slate-500 hover:text-[#0b1f3a] underline cursor-pointer"
              >
                {showUrlInput ? 'Ocultar link' : 'Usar link'}
              </button>
            </div>
          </div>

          {/* Feedback de erro (o sucesso é dado pelo diálogo global) */}
          {uploadError && (
            <Notice tone="error" icon="error">
              <span className="font-semibold">{uploadError}</span>
            </Notice>
          )}

          {/* Área interativa de upload e visualização */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
            {/* Visualizador da Logo Atual */}
            <div className="md:col-span-4 flex flex-col items-center justify-center p-4 bg-slate-50 rounded-xl border border-slate-200 text-center">
              <div className="relative w-28 h-28 bg-white rounded-xl border-2 border-slate-200 p-2 flex items-center justify-center shadow-xs overflow-hidden">
                {settings.logoUrl ? (
                  <img
                    src={settings.logoUrl}
                    alt={settings.schoolName || 'Logótipo da Escola'}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-slate-400">
                    <span className="material-symbols-outlined text-[36px]">image_not_supported</span>
                    <span className="text-[10px] font-bold uppercase mt-1">Sem Logótipo</span>
                  </div>
                )}
              </div>
              <span className="text-[11px] font-bold text-slate-700 mt-2">
                {settings.schoolName || 'Instituição'}
              </span>
              <span className="text-[10px] text-slate-500 font-mono">
                {settings.logoUrl ? 'Logótipo Configurado' : 'Padrão do Sistema'}
              </span>
            </div>

            {/* Zona de Drop & Botões de Ação */}
            <div className="md:col-span-8 flex flex-col gap-3">
              {/* Input de ficheiro nativo (oculto) */}
              <input
                type="file"
                ref={logoFileInputRef}
                accept="image/png, image/jpeg, image/webp, image/svg+xml"
                onChange={handleLogoFileChange}
                className="hidden"
                id="institution-logo-file-input"
              />

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => logoFileInputRef.current?.click()}
                className={`p-6 border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-[#ac332b] bg-red-50/50 scale-[0.99]'
                    : 'border-slate-300 hover:border-[#0b1f3a] bg-slate-50/50 hover:bg-slate-50'
                }`}
              >
                <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-[#0b1f3a] mb-2 shadow-xs">
                  <span className="material-symbols-outlined text-[24px]">upload_file</span>
                </div>
                <div className="font-bold text-xs text-slate-800">
                  Clique para carregar sua logo
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  ou arraste e solte o ficheiro de imagem aqui
                </div>
                <div className="text-[10px] text-slate-400 font-medium mt-1">
                  Formatos aceites: PNG com transparência, JPG, SVG ou WEBP (máx. 8MB)
                </div>
              </div>

              {/* Botões de Ação */}
              {/* Campo opcional de URL manual */}
              {showUrlInput && (
                <div className="mt-1 p-3 bg-slate-100 rounded-xl border border-slate-200 flex flex-col gap-1.5 animate-fade-in">
                  <label className="font-bold text-slate-700 text-[11px] uppercase tracking-wider">
                    Link de URL Direto da Imagem
                  </label>
                  <input
                    type="text"
                    value={settings.logoUrl}
                    onChange={(e) => onUpdateSettings({ logoUrl: e.target.value })}
                    placeholder="https://exemplo.ao/imagens/logo.png"
                    className="w-full px-3 py-2 bg-white text-slate-900 rounded-lg border border-slate-300 outline-none focus:ring-2 focus:ring-[#0b1f3a] text-xs font-mono"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* BLOCO 2: SUB-SISTEMAS DE ENSINO MINISTRADOS NA INSTITUIÇÃO */}
      <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-bold border border-emerald-200">
                activar subsistema de ensino
              </span>
            </div>
            <h3 className="font-headline text-base lg:text-lg font-bold text-slate-900 mt-1">
              2. Sub-sistemas de Ensino
            </h3>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() =>
                applyPreset(['pre_escolar', 'primario', 'secundario_1', 'secundario_2', 'superior'])
              }
              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold transition-colors"
              title="Ativa todos os 5 sub-sistemas de ensino"
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() =>
                applyPreset(['pre_escolar', 'primario', 'secundario_1'])
              }
              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold transition-colors"
              title="Pré-Escolar ao Iº Ciclo"
            >
              Nível 1-3
            </button>
            <button
              type="button"
              onClick={() => applyPreset(['secundario_2'])}
              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold transition-colors"
              title="Apenas 10.ª à 13.ª classe"
            >
              Nível 4
            </button>
            <button
              type="button"
              onClick={() => applyPreset(['superior'])}
              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold transition-colors"
              title="Bacharelato, Licenciatura e Mestrado"
            >
              Nível 5
            </button>
          </div>
        </div>

        {/* 5 CARDS INTERATIVOS DOS SUB-SISTEMAS */}
        <div className="grid grid-cols-1 gap-4">
          {offeredSubsystems.map((subsystem, idx) => {
            const isSelected = currentSubsystems.includes(subsystem.id);
            return (
              <div
                key={subsystem.id}
                onClick={() => toggleSubsystem(subsystem.id)}
                className={`p-5 rounded-2xl border-2 transition-all cursor-pointer flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${
                  isSelected
                    ? 'border-[#0b1f3a] bg-blue-50/20 shadow-xs'
                    : 'border-slate-200 bg-white hover:border-slate-300 opacity-70 hover:opacity-100'
                }`}
              >
                {/* Lado Esquerdo: Identificação do Sub-sistema */}
                <div className="flex items-start gap-4">
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                      isSelected ? 'bg-[#0b1f3a] text-white shadow-xs' : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[26px]">{subsystem.icon}</span>
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-mono uppercase font-bold text-[#ac332b]">
                        Nível 0{idx + 1}
                      </span>
                      <span className="w-1 h-1 rounded-full bg-slate-300" />
                      <h4 className="font-headline font-bold text-sm lg:text-base text-slate-900">
                        {subsystem.fullName}
                      </h4>
                      {isSelected ? (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase tracking-wider">
                          Ativo no Sistema
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold uppercase tracking-wider">
                          Desativado
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-600 max-w-2xl">{subsystem.description}</p>

                    {/* Classes e Regime do Sub-sistema */}
                    <div className="flex items-center gap-3 mt-1 flex-wrap text-xs">
                      <div className="flex items-center gap-1 text-slate-500">
                        <span className="font-semibold text-slate-700">Regime:</span>
                        <span className="bg-slate-100 px-2 py-0.5 rounded text-[11px] text-slate-700 font-medium">
                          {subsystem.regime}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 text-slate-500">
                        <span className="font-semibold text-slate-700">Classes/Anos:</span>
                        <div className="flex items-center gap-1 flex-wrap">
                          {subsystem.grades.map((g) => (
                            <span
                              key={g}
                              className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                                isSelected
                                  ? 'bg-blue-100 text-[#0b1f3a]'
                                  : 'bg-slate-100 text-slate-500'
                              }`}
                            >
                              {g}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Lado Direito: Toggle Switch e Status */}
                <div className="flex items-center justify-between lg:justify-end gap-3 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100">
                  <div className="text-right hidden sm:block">
                    <span className="text-[11px] font-bold text-slate-900 block">
                      {isSelected ? 'Sub-sistema Selecionado' : 'Clique para Ativar'}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {isSelected ? 'Disponível em todos os formulários' : 'Oculto nos formulários'}
                    </span>
                  </div>

                  {/* Toggle Switch */}
                  <div
                    className={`w-12 h-6 rounded-full transition-colors relative flex items-center p-0.5 ${
                      isSelected ? 'bg-[#0b1f3a]' : 'bg-slate-300'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-white transition-transform shadow-xs ${
                        isSelected ? 'translate-x-6' : 'translate-x-0'
                      }`}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Footer com Ações */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-medium">
            Sub-sistemas ativos: <strong>{currentSubsystems.length}</strong> selecionados
          </span>
        </div>
      </div>
    </div>
  );
};
