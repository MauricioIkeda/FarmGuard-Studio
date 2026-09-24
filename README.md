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

O Studio detecta automaticamente o `rclone` gerenciado pelo NTE Localization Studio. A fonte de verdade é sincronizada em `Insect AI Datasets/traps_events`; rascunhos ainda não publicados ficam em `studio-drafts`.

Para listar também as imagens sem JSON de anotação, o Studio lê `data/sources/traps_events.parquet`. Use **Anotador → Atualizar Parquet** para substituir essa cópia pela versão mais recente; a cópia anterior é arquivada em `data/sources/archive`. As imagens pendentes são baixadas sob demanda para `data/image-cache`, sem alterar o FarmGuard. A fila coloca pendentes FARMLAB primeiro, depois outras pendentes e, por fim, revisadas. O botão **Salvar rascunho** não marca uma imagem como revisada; **Concluir + próxima pendente** marca e avança. **Excluir imagem** pede confirmação e salva a exclusão imediatamente no rascunho, preservando as boxes para uma possível restauração; **Restaurar imagem** também salva imediatamente.

**Predizer** usa o modelo escolhido no conjunto atual `DatasetYolo/images/val`, gerando imagens com boxes em `Iazinha/Training/predictions`. Portanto ele não usa automaticamente todas as fotos revisadas: a divisão de validação depende da última geração do DatasetYolo. O nome do lote é opcional; quando vazio, o Studio cria um identificador com data/hora para evitar sobrescrever uma galeria anterior.

"Importar novos arquivos" usa `--ignore-existing`: baixa imagens e anotações que ainda não existem localmente sem substituir trabalho local. "Fazer backup agora" envia o estado local de forma não destrutiva. Ao publicar um rascunho, o Studio garante que a imagem também exista em `FarmGuard/.../traps_events/images`, copia o JSON canônico e confirma o backup dos dois arquivos no Drive. Se o Drive falhar, a publicação local permanece e a interface mostra o backup incompleto. Por padrão, **Publicar e fazer backup** não reconstrói o DatasetYolo. Marque **Reconstruir DatasetYolo logo após publicar** para iniciá-lo na mesma ação, ou use **Operações → Gerar YOLO** mais tarde, sem repetir a anotação nem o backup. A reconstrução usa os arquivos publicados localmente no FarmGuard; para recuperá-los apenas do Drive, use **Importar novos arquivos** antes de gerar o YOLO. Confira a conclusão da tarefa no histórico de operações.

## Cloudflare Tunnel

Com o Studio em execução, o tunnel deve encaminhar o domínio escolhido para `http://localhost:4310`. Para um teste rápido:

```powershell
cloudflared tunnel --url http://localhost:4310
```

Para um tunnel nomeado, salve a credencial recebida da Cloudflare em `data/secrets/cloudflare.token` e execute:

```powershell
.\scripts\start-cloudflare.ps1
```

Na instalação local, a credencial fica em `data/secrets/cloudflare.token`, ignorado pelo Git. Para iniciar o servidor e o tunnel em segundo plano, execute `scripts/start-background.ps1` após `npm run build`. O atalho de inicialização do Windows executa esse script ao entrar na conta do usuário.

No iPhone, abra `https://farmguard.dominiofoda.com.br` no Safari, toque em Compartilhar e em **Adicionar à Tela de Início**. O Studio abre em modo de aplicativo. A tela offline informa quando o computador principal ou a internet estiver indisponível; dados e comandos nunca são armazenados no cache do navegador.

O login do Studio continua obrigatório atrás do tunnel. Para uma segunda camada, configure também uma política do Cloudflare Access para o hostname.

## Limite de escrita

- leitura: arquivos do FarmGuard;
- escrita do anotador: `FarmGuard-Studio/data/annotation-drafts`;
- catálogo Parquet e cache de imagens pendentes: `FarmGuard-Studio/data/sources` e `data/image-cache`;
- histórico de tarefas: `FarmGuard-Studio/data/jobs`;
- backups antes de publicação: `FarmGuard-Studio/data/publication-backups`;
- publicação autorizada: `FarmGuard/Iazinha/DatasetCreator/.../annotations` e `DatasetYolo`;
- resultados autorizados: `FarmGuard/Iazinha/Training/runs` e `predictions`.

O código-fonte do FarmGuard não é alterado. Somente artefatos de dataset e execução são escritos pelas ações explícitas do Studio.
