# Passo 5 — XSS armazenado

## O que foi corrigido
| Ponto | Risco | Correcção |
|---|---|---|
| `studio/ui/FlowPaper.tsx` | texto guardado (`overrides`) injectado cru com `dangerouslySetInnerHTML` | passa sempre por `sanitizeHtml` (reconstrói o HTML só com texto escapado + b/i/u/br/cor) |
| `studio/actions.ts` | título da janela de impressão sem escape | `esc(title)` |
| `utils/studentProcessDocs.ts` | ficheiro do processo aberto com o MIME guardado (HTML/SVG corria na origem da app); `dataUrl` entrava sem escape num `src` | lista fechada de tipos (PDF, png, jpeg, gif, webp); o resto é descarregado como `octet-stream`; imagem só se for data URL raster válido |
| `utils/admissions.ts` (`openAttachment`) | mesmo problema nos anexos de candidaturas | usa `blobFromDataUrl` |
| `StudentProfilePage.tsx`, `PortalProfessorView.tsx` | `href`/`src` com `dataUrl` sem validar (`javascript:`) | `safeDownloadHref` / `safeImageDataUrl` |
| `views/PublicScannerView.tsx` | QR com `https://qualquer-site` redireccionava a página | só endereços da própria origem |
| `components/ComunicadosEmMassaTab.tsx` | número no caminho de `wa.me` sem limpeza | só dígitos |
| `components/FluxoCaixaUi.tsx` | `esc` não escapava `'` | escapa |

## Verificado e sem alteração
- `sanitizeHtml` é seguro: a saída é construída de raiz, nunca reaproveita atributos da entrada.
- Links dos trabalhos online (`MeusTrabalhosView`, `PortalProfessorView`, `TrabalhosOnlineView`) já validam http/https com `isSafeHttpUrl` antes de mostrar o link e ao gravar.
- Os outros `document.write` (guia de transferência, ficha de inscrição, fluxo de caixa, avaliação descritiva) escapam todos os dados que interpolam.
- Os `innerHTML` restantes só recebem constantes da própria aplicação.

## Novo
- `src/utils/safeFiles.ts` e `tests/xssSafe.test.ts` (9 testes).

## Nota
Os `onload`/`<script>` dentro das janelas de impressão continuam como estavam. Serão removidos no Passo 3 (CSP), que proíbe scripts inline.
