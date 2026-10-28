import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, farmPaths, studioRoot } from './config.js';
import { imageFor, sourceImage } from './annotation-source.js';
import { getAnnotation, resolveAnnotationImage } from './farmguard.js';
import { limitImageWork, shareImageWork } from './image-cache.js';

const thumbnails = shareImageWork<string>();
const slots = limitImageWork(2);

export async function annotationThumbnailPath(key: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error('Imagem inválida.');
  return thumbnails(key, () => slots(async () => {
    const source = await sourceImage(key);
    const annotation = source ? null : await getAnnotation(key);
    if (!source && !annotation) throw new Error('Imagem não encontrada.');
    const original = source ? await imageFor(source) : await resolveAnnotationImage(annotation!);
    const stat = await fs.stat(original);
    const fingerprint = crypto.createHash('sha256').update(`${original}:${stat.size}:${stat.mtimeMs}`).digest('hex').slice(0, 16);
    const directory = path.join(config.dataRoot, 'annotation-thumbnails');
    const target = path.join(directory, `${key}-${fingerprint}.jpg`);
    try { await fs.access(target); return target; } catch {}
    await fs.mkdir(directory, { recursive: true });
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    const python = path.join(farmPaths.ia, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(python, [path.join(studioRoot, 'server', 'python', 'thumbnail.py'), original, temporary], { windowsHide: true, timeout: 30_000 });
        let stderr = '';
        child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
        child.on('error', reject);
        child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr || `Falha ao criar miniatura (${code}).`)));
      });
      await fs.rename(temporary, target);
      return target;
    } finally { await fs.rm(temporary, { force: true }); }
  }));
}
