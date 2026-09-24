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
- anotador web com criação, seleção, movimento, redimensionamento e exclusão de boxes, zoom, pan e desfazer;
- salvamento de anotações como rascunho isolado, sem alterar os JSONs do FarmGuard.

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

`ALLOW_FARMGUARD_JOBS` fica desativado porque os scripts atuais criam saídas dentro de `Iazinha/Training`. Só altere para `true` depois de autorizar esse comportamento.

## Cloudflare Tunnel

Com o Studio em execução, o tunnel deve encaminhar o domínio escolhido para `http://localhost:4310`. Para um teste rápido:

```powershell
cloudflared tunnel --url http://localhost:4310
```

Para exposição permanente, use um tunnel nomeado e proteja o domínio com Cloudflare Access. O Studio permite iniciar processos locais e não deve ficar público sem autenticação.

## Limite de escrita

- leitura: arquivos do FarmGuard;
- escrita do anotador: `FarmGuard-Studio/data/annotation-drafts`;
- histórico de tarefas: `FarmGuard-Studio/data/jobs`;
- execução dos scripts: bloqueada por padrão.

Nenhum arquivo do FarmGuard é modificado durante a instalação, build ou uso em modo protegido.
