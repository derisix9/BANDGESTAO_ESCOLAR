import React, { useMemo } from 'react';
import { SchoolDepartment, DepartmentKind } from '../types';

interface DepartmentSelectProps {
  /** Lista completa de departamentos cadastrados (db.departments). */
  departments: SchoolDepartment[];
  /** Curricular → professores; profissional → funcionários. */
  kind: DepartmentKind;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  required?: boolean;
}

/**
 * Seletor de departamento alimentado pelos departamentos cadastrados em
 * Cadastro → Departamentos. Só mostra os ativos da categoria certa; se o
 * registo já tiver um valor que não está (ou já não está ativo) na lista, esse
 * valor continua visível como opção, para nunca se perder ao editar.
 */
export const DepartmentSelect: React.FC<DepartmentSelectProps> = ({
  departments,
  kind,
  value,
  onChange,
  className = '',
  required
}) => {
  const options = useMemo(
    () =>
      departments
        .filter((d) => d.kind === kind && d.status === 'ativo')
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b, 'pt')),
    [departments, kind]
  );

  const valueIsMissing = !!value && !options.some((o) => o.toLowerCase() === value.trim().toLowerCase());
  const noneRegistered = options.length === 0;

  return (
    <div>
      <select
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className={className}
      >
        <option value="">{noneRegistered && !value ? 'Nenhum departamento cadastrado' : 'Selecione...'}</option>
        {valueIsMissing && <option value={value}>{value} (não cadastrado)</option>}
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      {noneRegistered && (
        <p className="text-[10px] text-amber-700 mt-1">
          Cadastre os departamentos {kind === 'curricular' ? 'curriculares' : 'profissionais'} em Cadastro →
          Departamentos.
        </p>
      )}
    </div>
  );
};
