# Codex Pocket — autonomia

## Estado atual

- OpenAI Responses API com streaming
- Login por email e isolamento RLS
- Histórico pesquisável em Atividade
- Preferências e estado das integrações em Definições
- Manifest e service worker PWA
- Esquema de dados para projetos, jobs, mensagens, aprovações, consumo, etiquetas e push

## Integrações ainda necessárias

### GitHub App

Criar uma GitHub App com permissões mínimas para Contents (read/write), Pull requests
(read/write), Checks (read) e Metadata (read). Guardar o private key e webhook secret
apenas no backend. Nunca guardar tokens GitHub no browser ou em tabelas públicas.

Variáveis futuras:

```env
GITHUB_APP_ID=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=
```

### Worker persistente

Escolher um executor durável (por exemplo Inngest, Trigger.dev ou uma fila/worker
própria). O worker reclama linhas `jobs`, renova um lease, guarda progresso e termina
em `waiting_approval` antes de qualquer escrita externa.

### Execução isolada

Usar um sandbox efémero por job. Clonar apenas o repositório autorizado, aplicar o
patch numa branch nova, executar comandos permitidos com limites de CPU/tempo/rede e
guardar apenas logs, diff e resultado dos testes.

### Aprovações

As ações `apply_patch`, `run_tests`, `push_branch` e `open_pull_request` devem criar uma
linha em `approvals`. O worker só continua depois de `approved`; rejeições encerram a
ação sem escrita externa.

### Notificações

Gerar chaves VAPID no backend, guardar subscrições em `push_subscriptions` e enviar
push quando um job passa para `waiting_approval`, `completed` ou `failed`.
