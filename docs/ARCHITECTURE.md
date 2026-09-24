# Arquitetura

## Fluxo

```text
Navegador
   │ HTTP + eventos de log
   ▼
FarmGuard Studio (Node/Express + React)
   ├── leitura ───────► FarmGuard/Iazinha
   │                    ├── DatasetCreator
   │                    ├── DatasetYolo
   │                    ├── Models
   │                    └── Training/runs + predictions
   │
   ├── escrita ───────► FarmGuard-Studio/data
   │                    ├── annotation-drafts
   │                    └── jobs
   │
   └── opcional ──────► Python do Iazinha/.venv
                        └── scripts de Training
```

## Decisões de segurança

1. O caminho do FarmGuard é configurável e nunca é usado como diretório de dados do Studio.
2. O anotador preserva a estrutura JSON existente, mas salva uma cópia editável no repositório novo.
3. A execução de scripts depende de `ALLOW_FARMGUARD_JOBS=true`.
4. Imagens são servidas apenas por identificadores validados; a API não aceita caminhos arbitrários.
5. O Cloudflare Tunnel deve ser acompanhado de uma política de acesso, pois a aplicação controla processos locais.

## Próximas integrações previstas

- publicação controlada dos rascunhos no dataset fonte, com diff e confirmação;
- importação e backup no Google Drive via OAuth/service account;
- parâmetros avançados de treino sem alterar os scripts do FarmGuard;
- fila persistente com retomada após reinicialização;
- camada de embeddings e agrupamento por similaridade.
