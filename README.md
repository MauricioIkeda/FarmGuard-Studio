# FarmGuard Studio

Bancada web local para acompanhar o dataset, comparar experimentos YOLO, inspecionar predições, executar a pipeline e revisar bounding boxes do FarmGuard.

O Studio é um repositório independente. Por padrão, ele acessa o FarmGuard somente para leitura e grava seus próprios dados em `data/`.

## O que já está integrado

- panorama do dataset de anotações, boxes e armadilhas;
- catálogo automático de pesos `.pt`, incluindo `best.pt` e `last.pt` dos runs;
- leitura dos históricos `results.csv` e comparação de curvas por época;
- tabela de calibração do `threshold-sweep.csv`;
- galeria das predições existentes;
- central de operações para `train.py`, `val.py`, `predict.py` e `tune_thresholds.py`;
- reconstrução do `DatasetYolo` e backup do dataset fonte no Google Drive;
- anotador web com criação, seleção, movimento, redimensionamento e exclusão de boxes, zoom, pan e desfazer;
- publicação controlada de rascunhos, com diff, backup local e reconstrução do YOLO;
- autenticação por sessão, limitação de tentativas e cookies seguros para acesso remoto.

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

“Importar novos arquivos” usa `--ignore-existing`: baixa imagens e anotações que ainda não existem localmente sem substituir trabalho local. “Fazer backup agora” envia o estado local de forma não destrutiva.

## Cloudflare Tunnel

Com o Studio em execução, o tunnel deve encaminhar o domínio escolhido para `http://localhost:4310`. Para um teste rápido:

```powershell
cloudflared tunnel --url http://localhost:4310
```

Para um tunnel nomeado por token:

```powershell
$env:CLOUDFLARE_TUNNEL_TOKEN='token-do-tunnel'
.\scripts\start-cloudflare.ps1
```

O login do Studio continua obrigatório atrás do tunnel. Para uma segunda camada, configure também uma política do Cloudflare Access para o hostname.

## Limite de escrita

- leitura: arquivos do FarmGuard;
- escrita do anotador: `FarmGuard-Studio/data/annotation-drafts`;
- histórico de tarefas: `FarmGuard-Studio/data/jobs`;
- backups antes de publicação: `FarmGuard-Studio/data/publication-backups`;
- publicação autorizada: `FarmGuard/Iazinha/DatasetCreator/.../annotations` e `DatasetYolo`;
- resultados autorizados: `FarmGuard/Iazinha/Training/runs` e `predictions`.

O código-fonte do FarmGuard não é alterado. Somente artefatos de dataset e execução são escritos pelas ações explícitas do Studio.
