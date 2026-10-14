# FarmGuard Studio

Bancada web local para acompanhar o dataset, comparar experimentos YOLO, inspecionar predições, executar a pipeline e revisar bounding boxes do FarmGuard.

O Studio é um repositório independente. Por padrão, ele acessa o FarmGuard somente para leitura e grava seus próprios dados em `data/`.

## O que já está integrado

- panorama do dataset completo (incluindo imagens ainda não revisadas), boxes e armadilhas;
- catálogo automático de pesos `.pt`, incluindo `best.pt` e `last.pt` dos runs;
- leitura dos históricos `results.csv` e comparação de curvas por época;
- tabela de calibração do `threshold-sweep.csv`;
- galeria das predições existentes com visualização em tela cheia e zoom;
- central de operações para `train.py`, `val.py`, `predict.py` e `tune_thresholds.py`;
- reconstrução do `DatasetYolo` e backup do dataset fonte no Google Drive;
- anotador web com fila priorizada como no Flutter, filtros por revisão, criação e edição de boxes, zoom sem rolar a página, gesto de dois dedos, desfazer/refazer e conclusão com avanço para a próxima pendente;
- publicação controlada de rascunhos, com diff, cópia da imagem e do JSON para o FarmGuard, backup local/Drive e reconstrução do YOLO;
- autenticação por sessão, limitação de tentativas e cookies seguros para acesso remoto.
- aplicativo instalável na Tela de Início do iPhone, com interface ajustada para toque e tela segura;
- sessões preservadas por sete dias mesmo após reiniciar o servidor.

## Executar

```powershell
npm install
npm run dev
```

Abra `http://localhost:4310`.

Para validar uma versão de produção:

```powershell
npm run build
$env:NODE_ENV='production'
npm start
```

## Configuração

Copie `.env.example` para `.env` apenas se precisar mudar os defaults.

```env
FARMGUARD_ROOT=C:\caminho\para\FarmGuard
ALLOW_FARMGUARD_JOBS=false
PORT=4310
```

`ALLOW_FARMGUARD_JOBS` libera os scripts que criam saídas dentro de `Iazinha/Training` e a reconstrução de `DatasetYolo`.

`ADMIN_PASSWORD` e `SESSION_SECRET` são obrigatórios quando `AUTH_ENABLED=true`. O arquivo `.env` local é ignorado pelo Git.

O Studio detecta automaticamente o `rclone` gerenciado pelo NTE Localization Studio. Os três datasets são espelhados em `Insect AI Datasets/Datasets`, preservando a estrutura local para restauração em `FarmGuard/Iazinha/Datasets`. Versões remotas substituídas ou removidas pelo backup completo vão para `Insect AI Datasets/Datasets-history`. Rascunhos ainda não publicados continuam no backup separado `Insect AI Datasets/traps_events/studio-drafts`.

Para listar também as imagens sem JSON de anotação, o Studio lê `data/sources/traps_events.parquet`. Use **Anotador → Atualizar Parquet** para substituir essa cópia pela versão mais recente; a cópia anterior é arquivada em `data/sources/archive`. As imagens pendentes são baixadas sob demanda para `data/image-cache`, sem alterar o FarmGuard. A fila coloca pendentes FARMLAB primeiro, depois outras pendentes e, por fim, revisadas. O botão **Salvar rascunho** não marca uma imagem como revisada; **Concluir + próxima pendente** marca e avança. **Excluir imagem** pede confirmação e salva a exclusão imediatamente no rascunho, preservando as boxes para uma possível restauração; **Restaurar imagem** também salva imediatamente.

**Sugerir com IA** usa a IA API no Compose, com o modelo promovido `Iazinha/Models/insect-detector.pt` e a calibração de `insect-detector.json`; na execução nativa sem API configurada, usa o worker local. As boxes sugeridas substituem as atuais (com confirmação quando há boxes ou a foto está revisada), são salvas como rascunho e podem ser desfeitas; depois de desfazer, salve o rascunho novamente. Uma imagem revisada volta a exigir revisão; nenhuma sugestão publica arquivos no FarmGuard nem reconstrói o YOLO automaticamente. Revise as boxes antes de usar **Concluir + próxima pendente**.

**Predizer** usa o modelo escolhido no conjunto atual `DatasetYolo/images/val`, gerando imagens com boxes em `Iazinha/Training/predictions`. Portanto ele não usa automaticamente todas as fotos revisadas: a divisão de validação depende da última geração do DatasetYolo. O nome do lote é opcional; quando vazio, o Studio cria um identificador com data/hora para evitar sobrescrever uma galeria anterior.

"Importar anotações Unimar" usa `--ignore-existing`: baixa imagens e anotações que ainda não existem localmente sem substituir trabalho local. "Backup Unimar agora" envia a fonte Unimar; "Backup completo dos datasets" espelha também Yellow, Sticky Pi e os arquivos YOLO. Ao publicar um rascunho, o Studio garante que a imagem também exista em `FarmGuard/.../traps_events/images`, copia o JSON canônico e confirma o backup dos dois arquivos na nova árvore do Drive. Se o Drive falhar, a publicação local permanece e a interface mostra o backup incompleto. Por padrão, **Publicar e fazer backup** não reconstrói o DatasetYolo. Marque **Reconstruir DatasetYolo logo após publicar** para iniciá-lo na mesma ação, ou use **Operações → Gerar YOLO** mais tarde. Confira a conclusão da tarefa no histórico de operações.

O plano de publicação identifica **adição**, **atualização**, **exclusão** e **restauração**. Clique no item para abrir sua imagem no anotador, inclusive se estiver excluída. Publicar uma exclusão grava `excluded: true` no JSON; não apaga a foto ou o JSON. A imagem deixa de entrar no DatasetYolo quando ele for reconstruído, e pode ser restaurada depois.

## Publicação com Docker e Cloudflare

A instalação atual usa o Compose em `../FarmGuard/DOCKER.md`, com apenas Studio, IA API e tunnel. O lançador `FarmGuard Studio.cmd` na Área de Trabalho controla essa pilha. O tunnel encaminha `farmguardstudio.dominiofoda.com.br` para `http://studio:4310` e `ia.dominiofoda.com.br` para `http://ia-api:4320`. `farmguard.dominiofoda.com.br` fica reservado para o futuro site oficial, fora deste Compose. A credencial do tunnel fica em `data/secrets/cloudflare.token`, ignorada pelo Git. Não execute os scripts nativos de inicialização em paralelo com o Compose, pois compartilham dados e tunnel.

No iPhone, abra `https://farmguardstudio.dominiofoda.com.br` no Safari, toque em Compartilhar e em **Adicionar à Tela de Início**. O Studio abre em modo de aplicativo. A tela offline informa quando o computador principal ou a internet estiver indisponível; dados e comandos nunca são armazenados no cache do navegador.

O login do Studio continua obrigatório atrás do tunnel. Para uma segunda camada, configure também uma política do Cloudflare Access para o hostname.

## Limite de escrita

- leitura: arquivos do FarmGuard;
- escrita do anotador: `FarmGuard-Studio/data/annotation-drafts`;
- catálogo Parquet e cache de imagens pendentes: `FarmGuard-Studio/data/sources` e `data/image-cache`;
- histórico de tarefas: `FarmGuard-Studio/data/jobs`;
- backups antes de publicação: `FarmGuard-Studio/data/publication-backups`;
- publicação autorizada: `FarmGuard/Iazinha/Datasets/datasetUnimar/source/traps_events/annotations` e `datasetUnimar/DatasetYolo`;
- resultados autorizados: `FarmGuard/Iazinha/Training/runs` e `predictions`.

O código-fonte do FarmGuard não é alterado. Somente artefatos de dataset e execução são escritos pelas ações explícitas do Studio.
