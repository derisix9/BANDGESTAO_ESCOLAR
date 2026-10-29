# Plano de resposta a incidentes (rascunho para a equipa preencher e ensaiar)

Serve para três situações: **indisponibilidade**, **perda ou corrupção de dados** e **violação de dados pessoais**
(acesso indevido, fuga, conta comprometida). Os campos entre [colchetes] têm de ser preenchidos antes de ir para produção.
Um plano que ninguém ensaiou não funciona: faça um simulacro por semestre (secção 6).

## 1. Quem faz o quê
| Papel | Pessoa | Contacto (telemóvel e e-mail) | Suplente |
|---|---|---|---|
| Responsável pelo incidente (decide e coordena) | [nome] | [ ] | [ ] |
| Responsável técnico (Supabase, Vercel, código) | [nome] | [ ] | [ ] |
| Responsável pelas comunicações às escolas | [nome] | [ ] | [ ] |
| Contacto jurídico (protecção de dados) | [nome] | [ ] | [ ] |
| Encarregado de protecção de dados | [nome] | [ ] | [ ] |

## 2. Gravidade
| Nível | Exemplo | Resposta |
|---|---|---|
| 1 — crítico | Dados de escolas expostos a outros; conta de administrador comprometida; perda de dados; app em baixo para todos | Imediata, a qualquer hora. Avisa o responsável pelo incidente em minutos |
| 2 — alto | Uma escola sem acesso; sincronização a falhar em muitas escolas; erro novo e frequente depois de uma publicação | No mesmo dia útil, o mais cedo possível |
| 3 — médio | Erro isolado, funcionalidade lenta, falha de um workflow de backup | Dentro de 2 dias úteis |

## 3. Violação de dados pessoais (preencher com o jurista)
O jurista confirma **se há obrigação de notificar, a quem (por exemplo a Agência de Protecção de Dados e os titulares), em que prazo e com que conteúdo**. Não assumir prazos: escreva aqui o que ele confirmar.
- Obrigação de notificar a APD: [sim/não, prazo, canal, formulário]
- Obrigação de informar os titulares: [condições, prazo, texto-modelo]
- Registo interno de todos os incidentes (mesmo os que não obrigam a notificar): [onde]

Conteúdo mínimo a reunir desde o início: o que aconteceu, quando começou e foi detectado, que escolas e que tipos de dados (menores,
saúde, financeiros, documentos), quantas pessoas, o que já foi contido e quem é o contacto.

## 4. Passos (por esta ordem)
### 4.1 Detectar e registar
- Fontes: resumo de erros (`select * from public.platform_client_errors_summary(24);`, ver `docs/MONITORIZACAO_ERROS.md`), falhas dos workflows de backup, relatos das escolas, auditoria da app.
- Abra o registo do incidente: hora, quem detectou, sintoma, escola(s) afectada(s), nível. **Registe cada acção com hora.**

### 4.2 Conter
Escolha só o que o caso exige; cada medida tem custo para as escolas.
- **Conta comprometida:** repor a palavra-passe e terminar as sessões do utilizador no Supabase (Authentication → Users); confirmar o 2FA; rever o que essa conta fez na auditoria.
- **Acesso a partir de sítios inesperados:** restringir por IP (`docs/IP_AUTORIZADOS.md`).
- **Registo aberto a ser abusado:** reforçar o captcha (`docs/CAPTCHA_SUPABASE.md`) ou fechar temporariamente o registo.
- **Chaves expostas:** rodar as chaves no painel do Supabase e actualizar as variáveis no Vercel e nos segredos das Edge Functions e do GitHub; nunca pôr a `service_role` no site.
- **Código novo a causar o problema:** voltar à publicação anterior no Vercel (rollback) antes de investigar.
- Guardar provas (registos, capturas) **antes** de apagar ou repor seja o que for.

### 4.3 Avaliar
- Que dados, de que escolas, por quanto tempo? Foram lidos, alterados ou apagados?
- Há dados de menores ou de saúde? (agrava a gravidade e as obrigações da secção 3.)
- A causa está contida? Pode repetir-se hoje?

### 4.4 Comunicar
- **Escolas afectadas:** mensagem curta e factual: o que se passa, o que afecta, o que devem fazer, quando haverá novidades. Não especular sobre a causa.
- Notificações legais: só como o jurista determinou na secção 3.
- Escrever uma única versão dos factos e usá-la em todos os canais.

### 4.5 Recuperar
- **Dados perdidos ou corrompidos de uma escola:** restaurar o backup dessa escola (`school_backup_restore`, ver `docs/BACKUPS_SUPABASE.md`). O restauro é atómico (tudo ou nada); o estado actual deve ser descarregado antes, para se poder desfazer.
- **Projecto inteiro:** restaurar a cópia diária do workflow `backup.yml` num projecto novo; o `restore-test.yml` é o ensaio mensal desse caminho.
- Depois de restaurar: conferir contagens (alunos, matrículas, faturas, folha) com a escola e só então reabrir o acesso.
- Dados feitos offline ainda não sincronizados continuam nos aparelhos; antes de limpar a cache local, avise a escola.

### 4.6 Fechar e aprender (até 5 dias úteis depois)
Revisão sem culpados: cronologia, causa raiz, o que correu bem e mal, acções com dono e data (ex.: novo teste, novo alerta, correcção no código).
Actualizar `docs/CHECKLIST_LEGAL_OPERACIONAL.md` se faltava algum controlo.

## 5. Modelo de mensagem às escolas
> Assunto: [BandMed] Incidente [indisponibilidade/segurança] — actualização [n]
> Às [hora] detectámos [o que se passa, em linguagem simples]. Afecta [o quê e quem]. Neste momento [estado: a investigar / contido / resolvido].
> O que deve fazer: [instrução concreta, ou «nada por agora»]. Próxima actualização até às [hora]. Contacto: [nome e telemóvel].

## 6. Simulacros (um por semestre)
1. Perda de dados: restaurar o backup de uma escola de teste e medir o tempo.
2. Conta comprometida: simular o relato e percorrer 4.1 a 4.4 sem executar nada em produção.
3. Publicação com erro: fazer rollback no Vercel numa pré-visualização.
Anotar o que falhou e corrigir este plano.

## 7. O que este plano não cobre
Pentest independente, alertas automáticos e teste de carga estão listados em `docs/CHECKLIST_LEGAL_OPERACIONAL.md` como pendentes.
