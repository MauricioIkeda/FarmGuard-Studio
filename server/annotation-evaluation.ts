import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { farmPaths, studioRoot } from './config.js';
import { getAnnotation, type Annotation } from './farmguard.js';
import { suggestBoxes, type SuggestionMode } from './ai-suggestions.js';

export class EvaluationInputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function referenceHash(annotation: Annotation) {
  return crypto.createHash('sha256').update(JSON.stringify(annotation)).digest('hex');
}

function measure(annotation: Annotation, detections: Awaited<ReturnType<typeof suggestBoxes>>['detections']): Promise<Record<string, unknown>> {
  const python = path.join(farmPaths.ia, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  return new Promise((resolve, reject) => {
    const child = spawn(python, [path.join(studioRoot, 'server', 'python', 'evaluate_annotation.py')], {
      cwd: farmPaths.ia, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let errors = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('A avaliação excedeu 30 segundos.')); }, 30_000);
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { errors = `${errors}${chunk.toString('utf8')}`.slice(-2000); });
    child.stdin.on('error', (error) => { clearTimeout(timer); child.kill(); reject(error); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error(`Não foi possível avaliar as detecções. ${errors.trim()}`)); return; }
      try { resolve(JSON.parse(output) as Record<string, unknown>); }
      catch { reject(new Error('A avaliação retornou dados inválidos.')); }
    });
    child.stdin.end(JSON.stringify({ annotation, detections }));
  });
}

const services = { read: getAnnotation, predict: suggestBoxes, measure };

export async function evaluateAnnotation(key: string, mode: SuggestionMode, dependencies = services) {
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new EvaluationInputError('Identificador de imagem inválido.');
  const reference = await dependencies.read(key);
  if (!reference) throw new EvaluationInputError('Imagem não encontrada.', 404);
  if (!reference.reviewed || reference.excluded) {
    throw new EvaluationInputError('Conclua a revisão da imagem antes de conferir a IA.');
  }
  const hash = referenceHash(reference);
  const prediction = await dependencies.predict(key, mode);
  const result = await dependencies.measure(reference, prediction.detections);
  const current = await dependencies.read(key);
  if (!current || referenceHash(current) !== hash) {
    throw new EvaluationInputError('A anotação mudou durante a análise. Confira novamente com a versão salva.', 409);
  }
  return { ...result, key, model: prediction.model, mode, inference: prediction.inference,
    referenceHash: hash, annotation: reference };
}
