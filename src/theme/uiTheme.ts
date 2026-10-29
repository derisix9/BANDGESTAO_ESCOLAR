/**
 * Tema visual da aplicação.
 *
 * O único tema disponível é o "Laravel": herança visual do Laravel 12 —
 * fundo quase branco, cartões de borda fina, cantos suaves, tipografia
 * Instrument Sans e o laranja-avermelhado da marca Laravel nos destaques.
 *
 * O tema é aplicado através do atributo `data-ui-theme="laravel"` no
 * elemento <html>. As regras que dão o aspeto Laravel vivem todas em
 * src/styles/theme-laravel.css e atuam sobre as próprias classes utilitárias
 * já usadas nos componentes — por isso valem tanto para os ecrãs que já
 * existem como para tudo o que for criado de novo, sem ser preciso tocar em
 * cada ficheiro.
 */

/** Aplica o tema Laravel ao documento. Chamado o mais cedo possível no
 *  arranque (ver main.tsx) para que a página nunca chegue a aparecer com um
 *  visual diferente. */
export function initUiTheme(): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-ui-theme', 'laravel');
  }
}
