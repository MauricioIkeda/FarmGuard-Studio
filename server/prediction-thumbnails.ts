import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, farmPaths, studioRoot } from './config.js';
import { resolvePredictionImage } from './farmguard.js';

export async function predictionThumbnailPath(group: string, file: string) {
  if (!/\.(jpe?g|png|webp)$/i.test(file) || group === '.' || group === '..' || file === '.' || file === '..') throw new Error('Imagem inválida.');
  const source = resolvePredictionImage(group, file);
  if (!source || !(await fs.stat(source)).isFile()) throw new Error('Predição não encontrada.');
  const directory = path.join(config.dataRoot, 'prediction-thumbnails', group);
  const target = path.join(directory, `${path.parse(file).name}.jpg`);
  const sourceStat = await fs.stat(source);
  try { if ((await fs.stat(target)).mtimeMs >= sourceStat.mtimeMs) return target; } catch { /* gerar abaixo */ }
  await fs.mkdir(directory, { recursive: true });
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  const python = process.platform === 'win32'
    ? path.join(farmPaths.ia, '.venv', 'Scripts', 'python.exe')
    : path.join(farmPaths.ia, '.venv', 'bin', 'python');
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(python, [path.join(studioRoot, 'server', 'python', 'thumbnail.py'), source, temporary], { windowsHide: true });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr || `Falha ao criar miniatura (${code}).`)));
    });
    await fs.rename(temporary, target);
    return target;
  } finally { await fs.rm(temporary, { force: true }); }
}
