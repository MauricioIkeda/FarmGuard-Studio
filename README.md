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

O detector usa uma única classe, `insect`: anote todos os insetos visíveis, independentemente do grupo. Quando a foto não permitir decidir com segurança, marque a região como incerta. Uma sugestão da IA sem correspondência com uma box existente deve ser revisada antes de ser tratada como falso positivo ou incorporada à referência de avaliação.

No anotador, **Para revisar** reúne fotos sem revisão concluída. **Em andamento** mostra apenas as que ainda não foram revisadas, não estão excluídas e já possuem pelo menos uma caixa salva, tanto em rascunhos quanto na fonte publicada. Use **Concluir + próxima pendente** quando terminar a conferência de uma foto; salvar o rascunho preserva seu estado de revisão.

As miniaturas da fila também aparecem nas fotos sem marcações. São JPEGs leves de até 480 × 360, gerados apenas para os itens próximos da área visível e guardados em `data/annotation-thumbnails`, ignorado pelo Git. O servidor compartilha downloads simultâneos da mesma foto e grava o cache completo antes de disponibilizá-lo. A próxima foto da fila é preparada em segundo plano, sem criar rascunho ou mudar seu estado de revisão. O anotador sempre usa a imagem original; se a primeira abertura ainda depender da internet ou ocorrer uma falha, ele mostra o carregamento e permite tentar novamente.

**Predizer** usa o modelo escolhido no conjunto atual `DatasetYolo/images/val`, gerando imagens com boxes em `Iazinha/Training/predictions`. Portanto ele não usa automaticamente todas as fotos revisadas: a divisão de validação depende da última geração do DatasetYolo. O nome do lote é opcional; quando vazio, o Studio cria um identificador com data/hora para evitar sobrescrever uma galeria anterior.

Câmera, predição e os valores iniciais da bancada usam os ajustes publicados para o principal, inclusive quando a execução original não está disponível. Outros pesos usam sua calibração atual ou os padrões de confiança 0,20, NMS IoU 0,40, resolução 1280 e limite de 1000 detecções. O catálogo informa a origem do ajuste. A bancada permite experimentar outros limiares; salvar uma calibração do principal não altera os parâmetros publicados. Se a IA API estiver com um peso ou configuração diferente, o teste solicita sua recarga.

As calibrações manual e automática aceitam JPG/JPEG, PNG e WebP e usam o protocolo `ignore-regions-v1`. Detecções com IoU ≥ 0,30 contra insetos anotados continuam na avaliação, inclusive duplicatas. Das demais, são neutralizadas aquelas com pelo menos 50% da caixa coberta pela união das áreas incertas. O resultado mostra a quantidade ignorada separadamente. Mudanças nas anotações, inclusive `ignore_regions`, invalidam calibrações anteriores; labels e dimensões devem corresponder à fonte publicada. Calibrações do protocolo antigo exigem nova avaliação.

"Importar anotações Unimar" usa `--ignore-existing`: baixa imagens e anotações que ainda não existem localmente sem substituir trabalho local. "Backup Unimar agora" envia a fonte Unimar; "Backup completo dos datasets" espelha também Yellow, Sticky Pi e os arquivos YOLO. Ao publicar um rascunho, o Studio garante que a imagem também exista em `FarmGuard/.../traps_events/images`, copia o JSON canônico e confirma o backup dos dois arquivos na nova árvore do Drive. Se o Drive falhar, a publicação local permanece e a interface mostra o backup incompleto. Por padrão, **Publicar e fazer backup** não reconstrói o DatasetYolo. Marque **Reconstruir DatasetYolo logo após publicar** para iniciá-lo na mesma ação, ou use **Operações → Gerar YOLO** mais tarde. Confira a conclusão da tarefa no histórico de operações.

O plano de publicação identifica **adição**, **atualização**, **exclusão** e **restauração**. Clique no item para abrir sua imagem no anotador, inclusive se estiver excluída. Publicar uma exclusão grava `excluded: true` no JSON; não apaga a foto ou o JSON. A imagem deixa de entrar no DatasetYolo quando ele for reconstruído, e pode ser restaurada depois.

## Publicação com Docker e Cloudflare

A instalação usa os dois Compose completos documentados em `../FarmGuard/DOCKER.md`: frontend oficial, Studio, IA API unificada, backend e PostgreSQL. `compose.dev.yaml` atende somente pelas portas locais e não inicia Cloudflare Tunnel. `compose.production.yaml` acrescenta o túnel para os quatro serviços web; sua credencial fica em `data/secrets/cloudflare.token`, ignorada pelo Git. Não execute os scripts nativos de inicialização em paralelo com o Compose, pois compartilham os mesmos dados.

Para desenvolvimento, execute `docker compose -f compose.dev.yaml up -d --build --remove-orphans` na raiz do FarmGuard e abra `http://127.0.0.1:4311`. Os dois repositórios precisam permanecer em pastas irmãs. Anotações e modelos podem ser consultados antes de gerar o DatasetYolo; calibrações salvas ficam desatualizadas enquanto a validação estiver indisponível. A integração com o Drive pode ficar desativada com `INSECT_AI_DRIVE_ENABLED=false` no `.env` privado do Studio.

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
