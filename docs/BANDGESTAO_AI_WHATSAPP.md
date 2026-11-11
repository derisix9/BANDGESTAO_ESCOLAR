# BANDGESTÃO AI — Assistente de gestão pelo WhatsApp

Assistente que responde no WhatsApp aos colaboradores da escola, dentro das permissões do perfil de cada um.
Funciona com **OpenAI, Google Gemini, Anthropic Claude, Groq e OpenRouter**, incluindo **chaves gratuitas**.

## 1. O que faz nesta versão

| Pedido (exemplos) | O que acontece |
| --- | --- |
| «Quantos alunos temos?», «Ocupação das turmas?» | Consulta indicadores e estatísticas |
| «Resumo financeiro de Outubro», «Despesas por categoria» | Resumo informativo de propinas e despesas |
| «Quais os alunos com mais propinas em atraso?» | Lista de dívidas, filtrável por turma |
| «Pesquisa o aluno com processo 1234» | Pesquisa de registos (campos básicos) |
| «Gera a lista de turmas em PDF», «Envia-me as despesas em Excel» | Gera o ficheiro, **arquiva-o no BANDGESTÃO** e envia-o no WhatsApp |

Relatórios: `school_overview`, `students_list`, `classes_list`, `finance_summary`, `overdue_invoices`, `expenses_list`, `teachers_list`, `staff_list` (PDF ou Excel).

Comandos rápidos (não gastam quota de IA): **AJUDA**, **ESTADO**, **NOVA CONVERSA**.

**Não faz** (de propósito): criar/editar/apagar registos, lançar pagamentos, notas ou faltas, nem emitir declarações, recibos e pautas oficiais. Essas operações exigem confirmação e ligação aos serviços oficiais do sistema (fase seguinte).

## 2. Fornecedores de IA

| Fornecedor | Gratuito? | Onde obter a chave | Modelo por omissão |
| --- | --- | --- | --- |
| Google Gemini | Sim (limites diários) | https://aistudio.google.com/apikey | `gemini-2.5-flash` |
| Groq | Sim (limites por minuto) | https://console.groq.com/keys | `llama-3.3-70b-versatile` |
| OpenRouter | Sim (modelos `:free`) | https://openrouter.ai/keys | `meta-llama/llama-3.3-70b-instruct:free` |
| OpenAI | Não (facturação própria da API) | https://platform.openai.com/api-keys | `gpt-4o-mini` |
| Anthropic Claude | Não (pré-pago) | https://console.anthropic.com/settings/keys | `claude-haiku-5-5` |

- Cada escola: o **Administrador** cola as chaves em **Configurações → Integrações → cartão BANDGESTÃO AI**, escolhe o modelo e a prioridade (1 = primeiro) e carrega em *Guardar e testar*.
- Com várias chaves, o assistente usa a de **menor prioridade** e passa **automaticamente à seguinte** se houver erro, chave inválida ou quota esgotada. Se um relatório já tiver sido enviado antes da falha, não é enviado duas vezes.
- **Chave global (opcional):** definida só no Vercel (`GEMINI_API_KEY`, `OPENAI_API_KEY`, etc.), sem ecrã de configuração. Serve de reserva a todas as escolas: usa-se depois das chaves da escola, ou sozinha se a escola não tiver nenhuma.
- Chaves cifradas (AES-256-GCM) no servidor, ligadas à escola e ao fornecedor; **nunca voltam ao navegador** (só os últimos 4 caracteres).
- A subscrição do ChatGPT/Claude.ai **não** inclui chave de API; a chave da API tem facturação própria.
- Atenção à privacidade: em planos gratuitos, o fornecedor pode usar os dados enviados para melhorar os modelos. Confirme os termos antes de usar dados reais de alunos.

## 3. Arquitectura

```
WhatsApp (Meta Cloud API) → /api/whatsapp/webhook  (assinatura HMAC, idempotência, limite de pedidos)
   → número associado a um utilizador (ligação por código)
   → _ai-assistant: memória curta + escolha do fornecedor (cadeia com alternativa automática)
   → _ai-providers: OpenAI/Groq/OpenRouter (Chat Completions), Gemini (generateContent), Claude (Messages)
   → _ai-tools: ferramentas validadas no servidor (collection_acl, permissões personalizadas, escola activa)
   → _ai-report: PDF/Excel → Storage privado `school-files` + tabela whatsapp_ai_documents → envio por WhatsApp
```

O modelo **nunca acede à base de dados**: só pede ferramentas; o servidor valida o utilizador, a escola activa e as permissões em cada chamada, e regista a auditoria.

## 4. Instalação (por ordem)

1. **Ficheiros**: copie as pastas do pacote para o projecto, mantendo os caminhos (`api/`, `src/components/`, `supabase/migrations/`, `tests/`, `docs/`). Substitui `Navbar.tsx`, `WhatsappAiLinkModal.tsx`, `LoginView.tsx` e `TabIntegracoes.tsx`; acrescenta `AiProviders.tsx` e `public/integracoes/ia.svg`. Não são necessárias dependências novas.
2. **Supabase** — aplique por ordem `0048_whatsapp_ai_assistant.sql` e `0049_whatsapp_ai_providers.sql`. A 0049 cria a tabela das chaves, alarga os tipos de documento e **autoriza `.xlsx` no bucket `school-files`** (sem isto o Excel não seria arquivado).
3. **Vercel** — configure as variáveis do `.env.example` (obrigatórias: Supabase, `AI_KEYS_SECRET`, WhatsApp). Se não definir `AI_KEYS_SECRET`, usa-se a chave service_role como segredo, mas é preferível um segredo próprio. Publique de novo.
4. **Meta** — crie a app, active o WhatsApp Cloud API, obtenha *Phone Number ID*, *token*, *App Secret* e defina o *Verify Token*. Webhook: `https://SEU-DOMINIO/api/whatsapp/webhook`, subscrito ao campo `messages`. Fora da janela de 24 h só se pode escrever com modelos aprovados pela Meta (o assistente responde sempre a mensagens recebidas).
5. **Primeira chave de IA** — como Administrador: Configurações → Integrações → BANDGESTÃO AI → Google Gemini → colar a chave → *Guardar e testar*.
6. **Ligar o número** — BANDGESTÃO AI → Ligação → número → gerar código → enviar `LIGAR 123456` ao número oficial.
7. **Testar permissões** com um director, um professor e um financeiro.

## 5. Segurança

- Só membros da equipa; um número = um utilizador; ligação por código de 10 minutos (hash SHA-256, uso único).
- Permissões por secção e personalizadas, bloqueios de secção da escola e filiais respeitados (espelha `app.can_access`).
- Webhook com assinatura `X-Hub-Signature-256`, deduplicação por `message_id` e limite de pedidos por número.
- Dados pessoais sensíveis (BI, morada, contactos, saúde) não são expostos ao modelo.
- Textos vindos de registos são tratados como dados, nunca como instruções (defesa contra *prompt injection*).
- Documentos em armazenamento privado; ligações assinadas de curta duração; limite de 5 MB por ficheiro.
- Auditoria de consultas, relatórios e alterações de fornecedores.

## 6. Limites conhecidos

- Resumos financeiros usam até 3 000 registos recentes por área: são **informativos**, não fecho contabilístico.
- Só mensagens de texto (áudio e imagens ainda não).
- Modelos gratuitos podem ser mais lentos, menos precisos nas ferramentas e têm quotas diárias; use um pago como primeira opção em produção, com um gratuito de reserva.
- O limite do bucket (5 MB) restringe relatórios muito grandes: peça um período mais curto.
- Impressão automática numa impressora da escola exige integração própria.

## 7. Testes

`tests/aiProviders.test.ts` (Vitest) cobre validação de chaves, cifra, os três protocolos (OpenAI, Gemini, Claude), a alternativa automática entre fornecedores e a não exposição de chaves em erros. Execute `npm test`.
