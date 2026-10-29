# App móvel Bandmed (adaptação do desktop)
Copie as pastas `src/` e `index.html` por cima do projeto (3 ficheiros novos, 3 alterados).
Se o seu App.tsx/main.tsx já mudou, aplique só `alteracoes-existentes.patch` (são ~12 linhas).
Novos: src/components/MobileTabBar.tsx · src/utils/mobileTables.ts · src/styles/mobile-app.css
Alterados: src/App.tsx (import + <MobileTabBar/> + data-app-main no <main>) · src/main.tsx · index.html
Sem novas dependências e sem mexer na base de dados.
