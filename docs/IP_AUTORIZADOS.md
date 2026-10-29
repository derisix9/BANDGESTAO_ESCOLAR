# Lista de IPs autorizados (aplicada no servidor)

**Migração:** `0043_ip_allowlist.sql` · **Testes:** `supabase/tests/ip_allowlist.test.sql` (`npm run test:db`)

## Como funciona
1. O administrador grava a lista em Configurações → Segurança & Backups → *Sub-redes Autorizadas* (botão **Aplicar lista de IPs**).
2. O IP do utilizador é o que o **servidor** vê no cabeçalho `cf-connecting-ip` (acrescentado pelo Cloudflare/Supabase; o navegador não o consegue forjar).
   O início de `x-forwarded-for` **não** é usado, porque o cliente pode escrevê-lo.
3. A decisão está em `app.current_institution()`: fora da lista, o utilizador fica sem escola activa e a RLS recusa tudo (leitura e escrita).
   As Edge Functions `create-user`, `delete-user`, `school-backups`, `payments` e `notifications` fazem a mesma verificação (`public.edge_ip_allowed`).
4. **Falha fechada:** com lista activa e IP indeterminável, o acesso é recusado.

## Âmbito
- Por omissão restringe **admin, director, secretaria, financeiro**. O administrador pode acrescentar professor e funcionário.
- **Alunos e encarregados nunca** são restringidos (ligam-se de casa, com IP móvel).
- Escolas sem lista não têm qualquer custo adicional de desempenho. Uma filial sem lista própria herda a da escola mãe.

## Formatos aceites (um por linha)
`197.218.10.4` · `197.218.10.0/24` · `10.20.30.1-10.20.30.60` · `197.218.10.` (prefixo /24; `197.218.` = /16). IPv6 aceite em IP exacto, CIDR e intervalo.

## Proteções contra bloqueio acidental
- Só se grava a lista se o **IP actual do administrador estiver nela**.
- O campo não pode ser alterado por UPDATE directo (trigger `institutions_ip_guard`), só por `set_ip_policy`.
- Chave de emergência: a equipa da plataforma executa `select public.platform_clear_ip_ranges('<id_da_escola>');` (fica na auditoria).

## Limites conhecidos
- Dados móveis em Angola partilham IP (CGNAT) e mudam: use a lista só para redes fixas da escola.
- Quem estiver fora da lista consegue autenticar-se (obtém sessão) mas não recebe dados; para bloquear o próprio login por IP seria preciso um proxy à frente do Supabase.
- RPCs de agregados do grupo (visão geral de filiais e plano) leem o perfil directamente e não passam por esta verificação; não expõem dados de alunos.
- Se o seu plano Supabase não passar `cf-connecting-ip` ao PostgREST, o IP aparece como *desconhecido* e, com lista activa, todos os perfis restringidos são recusados: teste com **Adicionar o meu IP** antes de activar em produção.
