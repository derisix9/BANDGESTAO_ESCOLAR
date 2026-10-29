# Ícones que apareciam como texto

Os ícones do sistema são **Material Symbols**: uma fonte onde o nome do ícone ("school", "payments"…) é desenhado como imagem. Não são ficheiros SVG. Se a fonte não carrega, ou se o texto é alterado, vê-se a palavra em vez do desenho.

Duas causas, as duas corrigidas:

1. **CSP (passo 3).** O `public/sw.js` guarda as fontes do Google em cache com `fetch()`; esse pedido obedece ao `connect-src` do service worker, que só permitia a própria origem. O pedido da folha de estilos/fonte era recusado e a fonte nunca chegava. Correcção: `connect-src` passou a incluir `fonts.googleapis.com`, `fonts.gstatic.com` e `cdn.jsdelivr.net`, e `VERSION` do `sw.js` passou a `v3` (o navegador só troca de service worker, e portanto de CSP, quando os bytes do ficheiro mudam).
2. **Tradução do navegador.** O "Traduzir esta página" do Chrome/Edge traduz o nome do ícone ("school" → "escola") e a ligadura deixa de funcionar. `src/utils/noTranslateIcons.ts` marca todos os ícones com `translate="no"` e `class="notranslate"` (também os que o React cria depois). O texto normal continua a ser traduzido.

## Depois de publicar
- Faça **Ctrl+Shift+R** uma vez, ou *DevTools → Application → Service Workers → Unregister*, para o navegador largar o `sw.js` antigo.
- Confirme na consola que não há "Refused to connect ... Content Security Policy".
