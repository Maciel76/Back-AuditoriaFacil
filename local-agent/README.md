# Agente local do Flashub

O painel em `/automacao` cria uma chave por loja. O agente Windows abre somente
conexões de saída para a API HTTPS e para o RUB configurado localmente. Não há
servidor HTTP local nem necessidade de abrir portas na loja.

## Entrega e publicação

- Publicar as alterações de `backend/src` e o build do frontend juntos.
- Copiar `backend/releases/FlashubAgente-windows-x64.zip` para `releases/` no
  diretório do backend da VPS. O ZIP é um artefato de release, fora do Git.
- O botão de download usa a API autenticada, respeitando a loja do administrador.
- O backend usa três novas coleções Mongoose: `automacaos`, `automacaojobs` e
  `importacaolocks`. Os índices são criados no boot, incluindo a unicidade da tarefa ativa por loja.
- O proxy da VPS deve permitir uploads com o limite configurado em `UPLOAD_MAX_MB`
  e tempo suficiente para receber o arquivo. O processamento retorna HTTP 202.
- As credenciais do RUB ficam apenas no computador da loja, protegidas com DPAPI.
  O banco guarda SHA-256 da chave aleatória de 256 bits, nunca a chave original.

## Uso

1. Em Automação, selecione a loja (super admin) e gere a chave.
2. Baixe e extraia o ZIP inteiro. Execute `FlashubAgente.exe` no Windows x64.
3. Informe a API **incluindo `/api`**, a chave e as credenciais/endereço do RUB.
4. Escolha Edge ou Chrome já instalado e clique em **Salvar e conectar**.
5. Confira o estado Online no painel. Páginas e filtros podem ser definidos depois.

O agente fica na bandeja. A opção de inicialização automática usa HKCU Run e
começa após o login do usuário; não é um serviço que inicia antes do login.
Uma chave fica vinculada à primeira instalação que se apresenta. Para trocar
de instalação, gere uma chave nova. Revogar cancela tarefas ainda não importadas;
uma importação já aceita termina no servidor.

## Rotina, filtros e limites desta versão

Existe uma rotina por loja: tipo de auditoria, caminho da página dentro do RUB,
seletores de login, elemento de página pronta, etapas ordenadas e botão de exportar.
Etapas aceitas: clicar, preencher, selecionar por valor, aguardar elemento visível,
marcar e desmarcar. Valores admitem `{{data}}` (AAAA-MM-DD) e `{{dataBR}}` (DD/MM/AAAA).
Não se executa JavaScript ou comandos de shell recebidos do servidor.

O RUB deve baixar Excel/CSV/ODS por um download da página atual. A navegação real
de auditorias **ainda não foi configurada nem validada**. A integração de PDF do
SistemaRUB serviu de referência, mas suas credenciais e código não foram copiados.
SSO em outro domínio, downloads por pop-up e certificados internos exigem ajuste
específico. Não há bypass de CAPTCHA ou autenticação em duas etapas.

O agente só acessa a origem do RUB informada na instalação, inclusive os recursos
de página. Se o sistema usar outros domínios para scripts/SSO/exportação, será
necessário definir uma lista explícita de origens confiáveis no agente.

A frequência é um intervalo de 5 minutos a 7 dias. O dia de referência usa São
Paulo. Uma máquina que ficou offline retoma com uma execução, sem acumular períodos
perdidos. Tarefas manuais expiram após 30 minutos na fila; execução local tem prazo
de 8 minutos, e a concessão no servidor expira em 10 minutos. O batimento é enviado
a cada 20 segundos; após 90 segundos sem contato o painel mostra Offline.

A importação rejeita planilhas sem SKU ou cuja data oficial (dia mais frequente de
"Auditado em") não corresponde ao dia pedido. A exportação precisa representar a
auditoria inteira que se deseja manter: reimportar substitui os itens da mesma
loja, tipo e dia. Não há atualização incremental por SKU. CSV UTF-8 sem BOM também
é aceito, preservando zeros iniciais no código.

O upload automático atualiza dados; não dispara o compartilhamento de imagens no
WhatsApp, que hoje depende da renderização do frontend.

## Concorrência e recuperação

A fila é persistida no MongoDB. Um índice único admite somente uma tarefa ativa
por loja, e a retirada pelo agente é atômica. Cada retirada tem um token próprio.
Um upload aceito muda para `importando` antes de processar, impedindo reenvios.
Uploads manuais e automáticos compartilham um bloqueio por loja no processador.

Após falha abrupta do servidor, um bloqueio de importação pode permanecer. Ele
**não expira automaticamente**, pois o processador legado escreve métricas em
várias etapas e não usa transação. Para recuperação operacional:

1. Pause a integração/revogue a chave e pare todas as instâncias do backend que
   possam importar nessa loja; confirme que não há importação em execução.
2. Inspecione e faça backup da auditoria e métricas da loja. Se houve escrita
   parcial, reconcilie/reprocesse os dados antes de liberar novas importações.
3. Com os processos parados, remova apenas o documento de `importacaolocks` cujo
   `_id` é o ID da loja. Encerre como `erro`, `ativa: false`, qualquer job dessa
   loja que tenha ficado em `importando`; registre a revisão em `mensagem`.
4. Reinicie o backend e valide uma importação manual antes de reativar o agente.

Não se deve liberar esse bloqueio apenas por ter passado algum tempo.

## Desenvolvimento e testes

Requisitos: Node 22+, pnpm, Edge instalado, backend com suas dependências.

```powershell
cd backend/local-agent
pnpm install --frozen-lockfile
node --test test/*.test.js
powershell -NoProfile -ExecutionPolicy Bypass -File build-windows.ps1
```

O teste da API inicia um MongoDB temporário com `mongodb-memory-server`; no primeiro
uso baixa o binário. Não usa a conexão MongoDB do projeto. O teste do navegador usa
uma página RUB simulada em localhost. Para o teste visual, rode o preview do build
do frontend em `127.0.0.1:4176` e depois `node test/ui-smoke.mjs`; toda a API é simulada.

O build Windows compila um launcher WinForms com o compilador .NET Framework do
Windows, inclui o **runtime real** de Node e somente `playwright-core`, sem as
dependências de teste. Edge/Chrome é usado pelo Playwright como navegador local.
Fontes oficiais: https://playwright.dev/docs/library e https://playwright.dev/docs/browsers.

O executável não é assinado digitalmente. Para distribuição corporativa definitiva,
assinar o launcher e publicar o ZIP em `releases/` pelo processo de deploy da equipe.
