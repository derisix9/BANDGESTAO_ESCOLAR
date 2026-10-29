# Reuniões com PDF + convocatória por SMS/WhatsApp, e restantes pedidos

## Reuniões (Comunicação → Reuniões)
- Formulário da reunião: campo **Agenda / Acta em PDF** (máx. 5 MB; substituir/remover) e opção **Convocar depois de guardar**.
- Tabela e modal de participantes: botão **Convocar** (ícone megafone) → `MeetingNoticeModal` (canal, pré-visualização, nº de SMS, envio manual wa.me se o WhatsApp não tiver fornecedor).
- O PDF vai para o Storage (`school-files/{escola}/parentTeacherMeetings/{reunião}/…`), nunca para a base de dados. O registo guarda `agendaFile` (com `token` aleatório) e `noticeLog`.
- **WhatsApp**: o PDF segue directo na conversa se a escola configurar o *modelo com documento* (Meta: `documentTemplateName`; Twilio: `documentContentSid`) em Configurações → Integrações → Notificações. Sem ele segue o texto com o link.
- **SMS**: o texto leva o link público `…/functions/v1/meeting-file?i=&m=&t=`.
- Um destinatário por número de telefone (encarregado com vários educandos recebe uma só mensagem).
- A convocatória conta como aviso crítico (passa a regra «SMS só crítico»); a janela mostra quantos SMS serão enviados.

## Ficheiros novos
- `src/utils/meetingNotice.ts`, `src/components/MeetingNoticeModal.tsx`
- `supabase/functions/meeting-file/index.ts` (+ entrada em `supabase/config.toml`, `verify_jwt = false`)
- `supabase/migrations/0041_reunioes_pdf_whatsapp.sql`
- `tests/meetingNotice.test.ts`

## Ficheiros alterados
`db.ts` (attach/remove/link/dispatchMeetingNotice), `types/index.ts`, `ComunicacaoView.tsx`, `NotificationChannels.tsx`, `notificationGateway.ts`, `_shared/notify.ts`, `_shared/notifyDeliver.ts`, `functions/notifications/index.ts`, `server/notify.ts`.

## Outros pedidos
- **Sincronizar agora** (`SyncStatusPill.tsx`): spinner durante o envio; depois confirmação verde ou erro vermelho com «Tentar novamente».
- **Carregamento entre secções** (`App.tsx`): spinner ≈350 ms (`PAGE_LOADING_MS`) quando «Animação ao abrir páginas» está desligada.
- **Candidatura online → Curso**: a escola publica os cursos ativos no estado do link público; o campo passa a lista (texto livre se não houver cursos). Formulário interno de Admissões com sugestões.
- **Refeitório**: alerta de alergénios passou para dentro do cartão «Ementa do dia», em colunas.

## Deploy
1. Aplicar `0041_reunioes_pdf_whatsapp.sql`.
2. Publicar as funções `meeting-file` e `notifications`.
3. (Opcional) preencher o modelo com documento nas Integrações.
