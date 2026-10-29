# Passo 3 — Cabeçalhos de segurança (vercel.json)

Cabeçalhos em todas as respostas: CSP, HSTS (2 anos, preload), X-Frame-Options DENY, nosniff, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy (só a câmara, para o leitor de QR), COOP same-origin-allow-popups (o popup do Google Drive continua a funcionar).

## CSP — o que permite
- Scripts: só a própria origem e `challenges.cloudflare.com` (Turnstile). Sem `unsafe-inline` nem `unsafe-eval`.
- Estilos: própria origem, inline (React usa `style=`), Google Fonts e jsDelivr (Bootstrap CSS/Icons).
- Ligações: própria origem, `*.supabase.co` (https e wss), `translate.googleapis.com`, Turnstile e, **por causa do service worker**, `fonts.googleapis.com`, `fonts.gstatic.com` e `cdn.jsdelivr.net`.
  O `sw.js` guarda estas fontes/folhas de estilo em cache com `fetch()`, e esses pedidos obedecem ao `connect-src` do próprio `sw.js`. Sem estes três domínios os ícones (Material Symbols) apareciam como texto ("dashboard", "school"…) e as letras caíam para Arial.
  Ao mudar a CSP é preciso mudar também os bytes do `sw.js` (ex.: `VERSION`), senão o navegador mantém o service worker antigo com a CSP antiga. `tests/securityHeaders.test.ts` falha se estes domínios saírem do `connect-src`.
- Imagens: própria origem, data:, blob:, https (logótipos externos). Frames: só Turnstile. `frame-ancestors 'none'`.

## Alterações no código
- `index.html`: o script do modo escuro passou para `public/theme-init.js`; removido o JS do Bootstrap (não era usado, só o CSS).
- `public/termos-e-privacidade.html`: o `onclick` passou para `public/termos-voltar.js`.
- `src/utils/printWindow.ts` (`printWhenReady`): a aplicação imprime as janelas abertas com `document.write`; saíram os `<script>`/`onload` de dentro do HTML (transferências, ficha de inscrição, fluxo de caixa, avaliação descritiva, documentos do processo).
- `public/sw.js`: versão v2 (renova a cache) e sem `api.ipify.org`.
- `tests/securityHeaders.test.ts`: falha se alguém voltar a pôr script inline ou enfraquecer a CSP.

## Antes de ir para produção
1. Se usar domínio próprio no Supabase, acrescente-o a `connect-src`.
2. Teste primeiro num deploy de pré-visualização e veja a consola: um bloqueio aparece como "Refused to ... Content Security Policy".
3. Verifique: login com Turnstile, impressão de um PDF/documento, leitor de QR, backup no Drive, tradução.
4. `object-src 'self' blob:` mantém o visualizador de PDF do Chrome a funcionar com ficheiros em blob.
