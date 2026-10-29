import React, { useEffect, useRef } from 'react';
import { READ_ONLY_NOTICE } from '../utils/featureModes';
import { Notice } from './Notice';

/**
 * Modo LEITURA de uma área avançada (definido pelo Super Admin no Admin Master):
 * mostra o conteúdo mas nada pode ser alterado nem acionado (campos, botões, testes, cópias).
 */
export const FeatureReadOnly: React.FC<{ readOnly: boolean; children: React.ReactNode }> = ({ readOnly, children }) => {
  const ref = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    const el = ref.current as (HTMLFieldSetElement & { inert?: boolean }) | null;
    if (el) el.inert = readOnly;
  }, [readOnly]);

  if (!readOnly) return <>{children}</>;
  return (
    <div className="flex flex-col gap-3" data-feature-readonly>
      <Notice tone="warn" icon="lock">
        <span>{READ_ONLY_NOTICE}</span>
      </Notice>
      <fieldset ref={ref} disabled style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="opacity-90">
        {children}
      </fieldset>
    </div>
  );
};
