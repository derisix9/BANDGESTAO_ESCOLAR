import { useEffect, useState } from 'react';
import { Lang, getLang, onLangChange } from './index';

/** Idioma ativo; o componente volta a desenhar-se quando o utilizador o troca. */
export function useLang(): Lang {
  const [lang, setLangState] = useState<Lang>(() => getLang());
  useEffect(() => onLangChange(setLangState), []);
  return lang;
}
