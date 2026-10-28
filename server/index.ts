import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, studioRoot } from './config.js';
import {
  getAnnotation,
  annotationSummaries,
  overview,
  predictionFiles,
  predictionDetections,
  resolveAnnotationImage,
  resolvePredictionImage,
  resolvePredictionOriginal,
  saveDraft,
} from './farmguard.js';
import { importSource } from './annotation-source.js';
import {
  cancelJob,
  createJob,
  getJob,
  jobEvents,
  listJobs,
  loadPersistedJobs,
  type JobType,
} from './jobs.js';
import { authStatus, login, logout, requireAuth } from './auth.js';
import { driveStatus } from './drive.js';
import { publicationPlan, publishDrafts } from './publication.js';
import { suggestBoxes } from './ai-suggestions.js';
import { datasetImagePath, datasetThumbnailPath, listDatasetImages, moveImage, reapplySplitOverrides } from './dataset-split.js';
import { predictionThumbnailPath } from './prediction-thumbnails.js';
import { annotationThumbnailPath } from './annotation-thumbnails.js';
import { promoteModel } from './model-management.js';
import { reloadPromotedModel } from './ia-api.js';
import { CameraInputError, cameraTestImage, cleanupCameraTests, createCameraTest, discardCameraTest } from './camera-test.js';
import { CalibrationInputError, calibrationPreviewImage, cleanupCalibrationPreviews, createCalibrationPreview } from './calibration-preview.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((_request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
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

app.post('/api/models/promote', async (request, response, next) => {
  if (listJobs().some((job) => job.status === 'running' || job.status === 'queued')) {
    return response.status(409).json({ error: 'Aguarde a operação atual antes de promover um modelo.' });
  }
  if (request.body?.confirmation !== 'PROMOVER') {
    return response.status(400).json({ error: 'Confirme a promoção explicitamente.' });
  }
  try {
    const promoted = await promoteModel(String(request.body?.modelId || ''));
    try {
      await reloadPromotedModel();
      response.json(promoted);
    } catch (error) {
      response.json({ ...promoted, iaApiWarning: `Modelo promovido, mas a IA API ainda não foi atualizada: ${(error as Error).message}` });
    }
  }
  catch (error) { next(error); }
});

app.post('/api/calibration/preview', async (request, response, next) => {
  if (listJobs().some((job) => job.status === 'running' || job.status === 'queued')) {
    return response.status(409).json({ error: 'Aguarde a operação atual antes de visualizar outra calibração.' });
  }
  try {
    response.json(await createCalibrationPreview(String(request.body?.image || ''), request.body?.selections));
  } catch (error) { if (error instanceof CalibrationInputError) response.status(400).json({ error: error.message }); else next(error); }
});
app.get('/api/calibration/preview/:id/:index', async (request, response) => {
  try { response.sendFile(await calibrationPreviewImage(request.params.id, request.params.index)); }
  catch { response.status(404).end(); }
});

app.post('/api/camera-test', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '15mb' }), async (request, response, next) => {
  if (listJobs().some((job) => job.status === 'running' || job.status === 'queued')) {
    return response.status(409).json({ error: 'Aguarde a operação atual antes de testar uma foto.' });
  }
  try {
    response.status(201).json(await createCameraTest(String(request.query.modelId || ''),
      request.body as Buffer, String(request.headers['content-type'] || '').split(';')[0].toLowerCase()));
  } catch (error) { if (error instanceof CameraInputError) response.status(400).json({ error: error.message }); else next(error); }
});
app.get('/api/camera-test/:id/:kind', async (request, response) => {
  try {
    const target = await cameraTestImage(request.params.id, request.params.kind);
    if (request.query.download === '1') response.download(target, request.params.kind === 'annotated' ? 'farmguard-teste.jpg' : path.basename(target));
    else response.sendFile(target);
  } catch { response.status(404).end(); }
});
app.delete('/api/camera-test/:id', async (request, response) => {
  try { await discardCameraTest(request.params.id); response.status(204).end(); }
  catch { response.status(404).end(); }
});

app.get('/api/dataset/split', async (_request, response, next) => {
  try { response.json(await listDatasetImages()); } catch (error) { next(error); }
});

app.get('/api/dataset/image/:split/:image', async (request, response, next) => {
  try { response.sendFile(await datasetImagePath(request.params.split, request.params.image)); }
  catch (error) { next(error); }
});

app.get('/api/dataset/thumbnail/:split/:image', async (request, response, next) => {
  try { response.sendFile(await datasetThumbnailPath(request.params.split, request.params.image)); }
  catch (error) { next(error); }
});

app.post('/api/dataset/split', async (request, response, next) => {
  if (listJobs().some((job) => job.status === 'running' || job.status === 'queued')) {
    return response.status(409).json({ error: 'Aguarde a operação atual terminar antes de alterar o dataset.' });
  }
  try { response.json(await moveImage(request.body?.image, request.body?.split)); }
  catch (error) { next(error); }
});

app.post('/api/dataset/split/reapply', async (_request, response, next) => {
  if (listJobs().some((job) => job.status === 'running' || job.status === 'queued')) {
    return response.status(409).json({ error: 'Aguarde a operação atual terminar antes de alterar o dataset.' });
  }
  try { response.json(await reapplySplitOverrides()); } catch (error) { next(error); }
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
    response.setHeader('Cache-Control', 'private, max-age=60');
    response.sendFile(await resolveAnnotationImage(annotation), { cacheControl: false });
  } catch (error) {
    next(error);
  }
});

app.get('/api/annotations/:key/thumbnail', async (request, response, next) => {
  try {
    response.setHeader('Cache-Control', 'private, max-age=60');
    response.sendFile(await annotationThumbnailPath(request.params.key), { cacheControl: false });
  } catch (error) { next(error); }
});

app.get('/api/predictions/:group', async (request, response, next) => {
  try {
    response.json(await predictionFiles(request.params.group));
  } catch (error) {
    next(error);
  }
});

app.get('/api/predictions/:group/:file/detections', async (request, response, next) => {
  try {
    const detections = await predictionDetections(request.params.group, request.params.file);
    response.status(detections ? 200 : 404).json(detections || { error: 'Boxes não disponíveis nesta galeria antiga.' });
  } catch (error) { next(error); }
});

app.get('/api/predictions/:group/:file/original', async (request, response) => {
  const target = resolvePredictionOriginal(request.params.group, request.params.file);
  if (!target) return response.status(400).end();
  try { await fs.access(target); response.sendFile(target); }
  catch { response.status(404).end(); }
});

app.get('/api/prediction-thumbnails/:group/:file', async (request, response) => {
  try { response.sendFile(await predictionThumbnailPath(request.params.group, request.params.file)); }
  catch { response.status(404).end(); }
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
    if (!['train', 'validate', 'predict', 'tune', 'dataset', 'drive', 'drive-pull', 'drive-datasets'].includes(type)) {
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
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

await loadPersistedJobs();
await cleanupCameraTests();
await cleanupCalibrationPreviews();
setInterval(() => {
  void cleanupCameraTests().catch(console.error);
  void cleanupCalibrationPreviews().catch(console.error);
}, 60 * 60 * 1000).unref();
app.listen(config.port, config.host, () => {
  console.log(`FarmGuard Studio em http://localhost:${config.port}`);
  console.log(`FarmGuard: ${config.farmGuardRoot}`);
  console.log(`Operacoes: ${config.allowFarmGuardJobs ? 'habilitadas' : 'bloqueadas'}`);
});
