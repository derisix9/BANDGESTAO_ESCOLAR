# Caixas de aviso globais (estilo Unitel)

- `src/components/Notice.tsx`: `<Notice tone="error|warn|info|success">` (declarativo, fica enquanto o ecrã existir) e `notify.error(...)` (temporário). `<NoticeHost />` montado em `main.tsx`; estilos em `src/styles/notices.css`.
- Erro = vermelho com texto branco, aviso = amarelo, informação = azul, sucesso = verde; todos com botão de fechar. Ao fechar, só reaparece se a mensagem mudar.
- `Banner` e `ErrorLine` (moduleUi), `Banner` (portalUi), `SyncStatusPill`, avisos do `App.tsx` e ~120 caixas escritas à mão nos ecrãs passaram a usar `Notice`.
- Exportação MED: o resumo "N erro(s) e N aviso(s)" é um `Notice` com botões **CSV** e **Ver lista** (a lista abre por baixo).
- Plano Individual e Exames Nacionais: botões da tabela só com ícones (ver, editar, eliminar, faltou, anular), coloridos pelo `tableEnhancements` (novos ícones: `visibility_off`, `person_alert`).
- Ficaram de fora de propósito: cartões de indicadores, textos de confirmação dentro de modais e blocos de impressão.
