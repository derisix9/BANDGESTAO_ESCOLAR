# Imagem de fundo das páginas

Coloque as imagens na pasta **`public/`** (PNG ou JPG):

| Modo | Ficheiro (`.png`, `.jpg` ou `.jpeg`) |
|---|---|
| Claro  | `public/page-bg-light.*` |
| Escuro | `public/page-bg-dark.*`  |

- Cada modo usa a sua imagem e muda com o botão sol/lua.
- Se o ficheiro de um modo **não existir**, esse modo fica exactamente como estava (sem imagem). Nada a configurar.
- A imagem fica atrás de tudo com opacidade reduzida (claro 16 %, escuro 14 %). Ajuste em `src/styles/page-background.css`
  (`--page-bg-opacity-light` / `--page-bg-opacity-dark`, de 0 a 1).
- Cobre toda a área com sessão iniciada (`cover`, centrada). Use pelo menos 1920×1080 e, de preferência, < 500 KB.
- Não aparece na impressão. Depois de trocar um ficheiro, recarregue (Ctrl+F5).
