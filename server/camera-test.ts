import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, farmPaths, studioRoot } from './config.js';
import { promotedModel, readCalibration, resolveModel } from './model-management.js';
import { getPromotedModel, iaApiConfigured, predictPromotedImage } from './ia-api.js';

const root = path.join(config.dataRoot, 'camera-tests');
const maxAgeMs = 24 * 60 * 60 * 1000;
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let busy = false;
export class CameraInputError extends Error {}

function extension(body: Buffer, contentType: string) {
  if (contentType === 'image/jpeg' && body.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return '.jpg';
  if (contentType === 'image/png' && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return '.png';
  if (contentType === 'image/webp' && body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  throw new CameraInputError('Use uma foto JPEG, PNG ou WebP. Formato não reconhecido.');
}

function directory(id: string) {
  if (!idPattern.test(id)) throw new Error('Teste de câmera inválido.');
  return path.join(root, id);
}

export async function cleanupCameraTests() {
  await fs.mkdir(root, { recursive: true });
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !idPattern.test(entry.name)) continue;
    const target = directory(entry.name);
    if (Date.now() - (await fs.stat(target)).mtimeMs > maxAgeMs) {
      await fs.rm(target, { recursive: true, force: true });
    }
  }
}

function runInference(args: string[], scriptName = 'test_image.py') {
  const python = process.platform === 'win32'
    ? path.join(farmPaths.ia, '.venv', 'Scripts', 'python.exe')
    : path.join(farmPaths.ia, '.venv', 'bin', 'python');
  const script = path.join(studioRoot, 'server', 'python', scriptName);
  return new Promise<{ width: number; height: number; detections: number }>((resolve, reject) => {
    const child = spawn(python, [script, ...args], { cwd: farmPaths.training, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => { child.kill(); finish(new Error('A inferência excedeu 120 segundos.')); }, 120_000);
    function finish(error?: Error, result?: { width: number; height: number; detections: number }) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(result!);
    }
    child.stdout.on('data', (chunk: Buffer) => { stdout = `${stdout}${chunk.toString()}`.slice(-100_000); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-3000); });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0) return finish(new Error(stderr.trim() || `Inferência falhou (código ${code}).`));
      try {
        const result = JSON.parse(stdout.trim().split(/\r?\n/).at(-1) || '') as { width: number; height: number; detections: number };
        if (![result.width, result.height, result.detections].every(Number.isFinite)) throw new Error('Resposta inválida da IA.');
        finish(undefined, result);
      } catch (error) { finish(error as Error); }
    });
  });
}

export async function createCameraTest(modelId: string, body: Buffer, contentType: string) {
  if (busy) throw new Error('A IA já está analisando uma foto. Aguarde a conclusão.');
  if (!Buffer.isBuffer(body) || body.length < 100 || body.length > 15 * 1024 * 1024) {
    throw new CameraInputError('A foto deve ter até 15 MB.');
  }
  const ext = extension(body, contentType);
  busy = true;
  const id = crypto.randomUUID();
  const testDir = directory(id);
  try {
    const model = await resolveModel(modelId);
    const principal = iaApiConfigured() && modelId === (await promotedModel())?.sourceModelId;
    const calibration = await readCalibration(modelId);
    const best = calibration && !calibration.stale ? calibration.best : null;
    const apiModel = principal ? await getPromotedModel() : null;
    const confidence = apiModel?.confidence ?? best?.confidence ?? 0.2;
    const iou = apiModel?.nms_iou ?? best?.nms_iou ?? 0.4;
    await fs.mkdir(testDir, { recursive: true });
    const original = path.join(testDir, `original${ext}`);
    const annotated = path.join(testDir, 'annotated.jpg');
    await fs.writeFile(original, body);
    let result: { width: number; height: number; detections: number };
    if (principal) {
      const prediction = await predictPromotedImage(original);
      if (prediction.model.sha256.toLowerCase() !== apiModel?.sha256.toLowerCase()) throw new Error('O modelo da IA API mudou durante o teste; tente novamente.');
      const predictionFile = path.join(testDir, 'prediction.json');
      await fs.writeFile(predictionFile, JSON.stringify(prediction), 'utf8');
      result = await runInference([ '--image', original, '--prediction', predictionFile, '--output', annotated ],
        'render_api_prediction.py');
      await fs.unlink(predictionFile);
    } else {
      result = await runInference(['--model', model.path, '--image', original, '--output', annotated,
        '--confidence', String(confidence), '--iou', String(iou)]);
    }
    const metadata = { id, modelId, modelName: modelId.replace(/^(run|model):/, ''),
      confidence, nmsIou: iou, calibrated: Boolean(apiModel || best), ...result,
      originalUrl: `/api/camera-test/${id}/original`, annotatedUrl: `/api/camera-test/${id}/annotated` };
    await fs.writeFile(path.join(testDir, 'result.json'), `${JSON.stringify(metadata)}\n`, 'utf8');
    return metadata;
  } catch (error) {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally { busy = false; }
}

export async function cameraTestImage(id: string, kind: string) {
  const targetDir = directory(id);
  if (kind === 'annotated') return path.join(targetDir, 'annotated.jpg');
  if (kind === 'original') {
    const name = (await fs.readdir(targetDir)).find((file) => /^original\.(jpg|png|webp)$/.test(file));
    if (name) return path.join(targetDir, name);
  }
  throw new Error('Imagem de teste não encontrada.');
}

export async function discardCameraTest(id: string) {
  await fs.rm(directory(id), { recursive: true, force: true });
}
