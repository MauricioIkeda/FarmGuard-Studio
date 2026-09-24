import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { config, studioRoot } from './config.js';
import {
  getAnnotation,
  annotationSummaries,
  overview,
  predictionFiles,
  resolveAnnotationImage,
  resolvePredictionImage,
  saveDraft,
} from './farmguard.js';
import { importSource } from './annotation-source.js';
import {
  cancelJob,
  createJob,
  getJob,
  jobEvents,
  listJobs,
  type JobType,
} from './jobs.js';
import { authStatus, login, logout, requireAuth } from './auth.js';
import { driveStatus } from './drive.js';
import { publicationPlan, publishDrafts } from './publication.js';
import { suggestBoxes } from './ai-suggestions.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((_request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  const scriptPolicy = process.env.NODE_ENV === 'production'
    ? "script-src 'self'"
    : "script-src 'self' 'unsafe-inline'";
  response.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; ${scriptPolicy}; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
  );
  next();
});
app.use(express.json({ limit: '10mb' }));

app.get('/api/auth/status', authStatus);
app.post('/api/auth/login', login);
app.post('/api/auth/logout', logout);
app.use('/api', requireAuth);

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, operationsEnabled: config.allowFarmGuardJobs });
});

app.get('/api/overview', async (_request, response, next) => {
  try {
    response.json(await overview());
  } catch (error) {
    next(error);
  }
});

app.get('/api/annotations', async (_request, response, next) => {
  try {
    response.json(await annotationSummaries());
  } catch (error) {
    next(error);
  }
});

app.post('/api/sources/parquet', express.raw({ type: 'application/octet-stream', limit: '15mb' }), async (request, response, next) => {
  try { response.json(await importSource(request.body as Buffer)); }
  catch (error) { next(error); }
});

app.get('/api/annotations/:key', async (request, response, next) => {
  try {
    const annotation = await getAnnotation(request.params.key);
    if (!annotation) return response.status(404).json({ error: 'Anotacao nao encontrada.' });
    response.json(annotation);
  } catch (error) {
    next(error);
  }
});

app.put('/api/annotations/:key', async (request, response, next) => {
  try {
    response.json(await saveDraft(request.params.key, request.body));
  } catch (error) {
    next(error);
  }
});

app.post('/api/annotations/:key/suggest', async (request, response, next) => {
  try { response.json(await suggestBoxes(request.params.key)); }
  catch (error) { next(error); }
});

app.get('/api/annotations/:key/image', async (request, response, next) => {
  try {
    const annotation = await getAnnotation(request.params.key);
    if (!annotation) return response.status(404).end();
    response.sendFile(await resolveAnnotationImage(annotation));
  } catch (error) {
    next(error);
  }
});

app.get('/api/predictions/:group', async (request, response, next) => {
  try {
    response.json(await predictionFiles(request.params.group));
  } catch (error) {
    next(error);
  }
});

app.get('/api/predictions/:group/:file', async (request, response) => {
  const target = resolvePredictionImage(request.params.group, request.params.file);
  if (!target) return response.status(400).end();
  try {
    await fs.access(target);
    response.sendFile(target);
  } catch {
    response.status(404).end();
  }
});

app.get('/api/jobs', (_request, response) => response.json(listJobs()));
app.get('/api/jobs/:id', (request, response) => {
  const job = getJob(request.params.id);
  response.status(job ? 200 : 404).json(job || { error: 'Job nao encontrado.' });
});
app.post('/api/jobs', async (request, response, next) => {
  try {
    const type = request.body?.type as JobType;
    if (!['train', 'validate', 'predict', 'tune', 'dataset', 'drive', 'drive-pull'].includes(type)) {
      return response.status(400).json({ error: 'Tipo de operacao invalido.' });
    }
    response.status(202).json(await createJob(type, request.body?.options || {}));
  } catch (error) {
    next(error);
  }
});
app.post('/api/jobs/:id/cancel', (request, response) => {
  response.status(cancelJob(request.params.id) ? 200 : 409).json({ ok: true });
});
app.get('/api/jobs-stream', (request, response) => {
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders();
  const listener = (job: unknown) => response.write(`data: ${JSON.stringify(job)}\n\n`);
  jobEvents.on('update', listener);
  request.on('close', () => jobEvents.off('update', listener));
});

app.get('/api/publication/plan', async (_request, response, next) => {
  try { response.json(await publicationPlan()); } catch (error) { next(error); }
});

app.post('/api/publication/publish', async (request, response, next) => {
  try {
    const keys = Array.isArray(request.body?.keys) ? request.body.keys.map(String) : [];
    const publication = await publishDrafts(keys);
    const rebuild = request.body?.rebuild === true;
    const job = rebuild ? await createJob('dataset', {}) : null;
    response.json({ ...publication, job });
  } catch (error) { next(error); }
});

app.get('/api/drive/status', async (_request, response) => response.json(await driveStatus()));

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Erro inesperado.';
  console.error(error);
  response.status(500).json({ error: message });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(studioRoot, 'dist')));
  app.get('/*splat', (_request, response) =>
    response.sendFile(path.join(studioRoot, 'dist', 'index.html')),
  );
} else {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.listen(config.port, '0.0.0.0', () => {
  console.log(`FarmGuard Studio em http://localhost:${config.port}`);
  console.log(`FarmGuard: ${config.farmGuardRoot}`);
  console.log(`Operacoes: ${config.allowFarmGuardJobs ? 'habilitadas' : 'bloqueadas'}`);
});
