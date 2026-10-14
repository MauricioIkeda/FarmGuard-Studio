import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, farmPaths, studioRoot } from './config.js';
import { datasetImagePath } from './dataset-split.js';
import { resolveModel } from './model-management.js';

const root = path.join(config.dataRoot, 'calibration-previews');
const idPattern = /^[0-9a-f-]{36}$/i;
let queue: Promise<unknown> = Promise.resolve();
export class CalibrationInputError extends Error {}

export type PreviewSelection = { modelId: string; confidence: number; iou: number };

export function validThreshold(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0.01 && value <= 0.99;
}

function runPreview(model: string, image: string, output: string, confidence: number, iou: number) {
  const python = process.platform === 'win32'
    ? path.join(farmPaths.ia, '.venv', 'Scripts', 'python.exe')
    : path.join(farmPaths.ia, '.venv', 'bin', 'python');
  const script = path.join(studioRoot, 'server', 'python', 'test_image.py');
  return new Promise<{ width: number; height: number; detections: number; boxes: Array<{ xyxy: number[]; confidence: number }> }>((resolve, reject) => {
    const child = spawn(python, [script, '--model', model, '--image', image, '--output', output,
      '--confidence', String(confidence), '--iou', String(iou)], { cwd: farmPaths.training, windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => { child.kill(); finish(new Error('A visualização excedeu 120 segundos.')); }, 120_000);
    function finish(error?: Error, result?: { width: number; height: number; detections: number; boxes: Array<{ xyxy: number[]; confidence: number }> }) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(result!);
    }
    child.stdout.on('data', (chunk: Buffer) => { stdout = `${stdout}${chunk.toString()}`.slice(-150_000); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-3000); });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (code !== 0) return finish(new Error(stderr.trim() || `Visualização falhou (código ${code}).`));
      try {
        const result = JSON.parse(stdout.trim().split(/\r?\n/).at(-1) || '');
        if (!Number.isFinite(result.width) || !Number.isFinite(result.height) || !Array.isArray(result.boxes))
          throw new Error('Resultado de visualização inválido.');
        finish(undefined, result);
      } catch (error) { finish(error as Error); }
    });
  });
}

export async function createCalibrationPreview(imageName: string, selections: PreviewSelection[]) {
  if (!Array.isArray(selections) || selections.length < 1 || selections.length > 2 ||
      selections.some((item) => !item || typeof item.modelId !== 'string' ||
        !validThreshold(item.confidence) || !validThreshold(item.iou))) {
    throw new CalibrationInputError('Escolha um ou dois modelos e valores de confiança/IoU entre 0,01 e 0,99.');
  }
  const image = await datasetImagePath('val', imageName);
  const models = await Promise.all(selections.map((item) => resolveModel(item.modelId)));
  const task = async () => {
    const id = crypto.randomUUID();
    const directory = path.join(root, id);
    await fs.mkdir(directory, { recursive: true });
    try {
      const results = [];
      for (let index = 0; index < selections.length; index += 1) {
        const output = path.join(directory, `${index}.jpg`);
        const result = await runPreview(models[index].path, image, output,
          selections[index].confidence, selections[index].iou);
        results.push({ ...result, url: `/api/calibration/preview/${id}/${index}` });
      }
      return { id, image: imageName, results };
    } catch (error) {
      await fs.rm(directory, { recursive: true, force: true });
      throw error;
    }
  };
  const result = queue.then(task, task);
  queue = result.catch(() => {});
  return result;
}

export async function calibrationPreviewImage(id: string, index: string) {
  if (!idPattern.test(id) || !['0', '1'].includes(index)) throw new Error('Visualização inválida.');
  const target = path.join(root, id, `${index}.jpg`);
  if (!(await fs.stat(target)).isFile()) throw new Error('Visualização ausente.');
  return target;
}

export async function cleanupCalibrationPreviews() {
  await fs.mkdir(root, { recursive: true });
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !idPattern.test(entry.name)) continue;
    const target = path.join(root, entry.name);
    if (Date.now() - (await fs.stat(target)).mtimeMs > 60 * 60_000) {
      await fs.rm(target, { recursive: true, force: true });
    }
  }
}
