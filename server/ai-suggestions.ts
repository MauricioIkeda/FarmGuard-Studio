import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { farmPaths } from './config.js';
import { getAnnotation, resolveAnnotationImage, type AnnotationBox } from './farmguard.js';
import { assertApiSettings, getPromotedModel, iaApiConfigured, predictPromotedImage } from './ia-api.js';
import { inferenceSettingsForModel } from './model-management.js';

type WorkerPrediction = {
  model: string;
  width: number;
  height: number;
  detections: Array<AnnotationBox & { confidence: number }>;
};

let busy = false;

function validBox(box: AnnotationBox, width: number, height: number) {
  return [box.x, box.y, box.width, box.height].every((value) => Number.isFinite(value)) &&
    box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0 &&
    box.x + box.width <= width + 1 && box.y + box.height <= height + 1;
}

export async function suggestBoxes(key: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error('Identificador de imagem inválido.');
  if (busy) throw new Error('A IA já está analisando outra imagem. Aguarde alguns instantes.');
  busy = true;
  try {
    const annotation = await getAnnotation(key);
    if (!annotation) throw new Error('Imagem não encontrada.');
    if (annotation.excluded) throw new Error('Restaure a imagem antes de pedir sugestões da IA.');
    const imagePath = await resolveAnnotationImage(annotation);
    await fs.access(imagePath);
    const settings = await inferenceSettingsForModel('model:insect-detector.pt');

    if (iaApiConfigured()) {
      assertApiSettings(await getPromotedModel(), settings);
      const prediction = await predictPromotedImage(imagePath);
      if (prediction.model.sha256.toUpperCase() !== settings.modelSha256)
        throw new Error('O modelo da IA API mudou durante a análise; tente novamente.');
      if (prediction.image.width !== annotation.width || prediction.image.height !== annotation.height) {
        throw new Error('A IA API retornou dimensões diferentes da imagem do anotador.');
      }
      const boxes = prediction.detections.map(({ box_px }) => box_px);
      if (!boxes.every((box) => validBox(box, annotation.width, annotation.height))) {
        throw new Error('A IA API retornou uma box fora dos limites da imagem.');
      }
      return { key, model: prediction.model.name, boxes };
    }

    const python = process.platform === 'win32'
      ? path.join(farmPaths.ia, '.venv', 'Scripts', 'python.exe')
      : path.join(farmPaths.ia, '.venv', 'bin', 'python');
    const worker = path.join(farmPaths.ia, 'Inference', 'worker.py');
    await Promise.all([
      fs.access(python), fs.access(worker),
      fs.access(path.join(farmPaths.models, 'insect-detector.pt')),
      fs.access(path.join(farmPaths.models, 'insect-detector.json')),
    ]);

    const prediction = await runWorker(python, worker, imagePath);
    if (prediction.width !== annotation.width || prediction.height !== annotation.height) {
      throw new Error('A IA retornou dimensões diferentes da imagem do anotador.');
    }
    const boxes = prediction.detections.map(({ x, y, width, height }) => ({ x, y, width, height }));
    if (!boxes.every((box) => validBox(box, annotation.width, annotation.height))) {
      throw new Error('A IA retornou uma box fora dos limites da imagem.');
    }
    return { key, model: prediction.model, boxes };
  } finally {
    busy = false;
  }
}

function runWorker(python: string, worker: string, imagePath: string): Promise<WorkerPrediction> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const child = spawn(python, [worker], {
      cwd: farmPaths.ia,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let settled = false;
    let errorTail = '';
    const timeout = setTimeout(() => {
      finish(new Error('A inferência excedeu 120 segundos.'), true);
    }, 120_000);
    const lines = readline.createInterface({ input: child.stdout });

    function finish(error: Error | null, stop = false, result?: WorkerPrediction) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (stop) child.kill();
      if (error) reject(error);
      else resolve(result!);
    }

    child.stderr.on('data', (chunk: Buffer) => {
      errorTail = `${errorTail}${chunk.toString('utf8')}`.slice(-2000);
    });
    child.stdin.on('error', (error) => finish(error, true));
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      finish(new Error(`Worker de IA encerrou sem resposta (código ${code}). ${errorTail.trim()}`));
    });
    lines.on('line', (line) => {
      let message: Record<string, unknown>;
      try { message = JSON.parse(line) as Record<string, unknown>; }
      catch { return; }
      if (message.id !== requestId) return;
      if (message.ok !== true) {
        finish(new Error(String(message.error || 'Falha na inferência da IA.')), true);
        return;
      }
      const result = message.result as WorkerPrediction | undefined;
      if (!result || !Array.isArray(result.detections) || !Number.isFinite(result.width) || !Number.isFinite(result.height)) {
        finish(new Error('Resposta inválida do worker de IA.'), true);
        return;
      }
      finish(null, false, result);
    });
    child.stdin.end(`${JSON.stringify({ id: requestId, image: imagePath })}\n`);
  });
}
