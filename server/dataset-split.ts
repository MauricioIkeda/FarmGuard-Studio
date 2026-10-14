import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config, farmPaths, studioRoot } from './config.js';

export type DatasetSplit = 'train' | 'val';
export type DatasetImage = {
  image: string;
  split: DatasetSplit;
  desiredSplit: DatasetSplit;
  trap: string;
  boxes: number;
  ignoreRegions: number;
};

const OVERRIDES_PATH = path.join(config.dataRoot, 'dataset-split-overrides.json');
const IMAGE_NAME = /^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/i;
let mutationQueue: Promise<void> = Promise.resolve();

function imageDir(split: DatasetSplit) { return path.join(farmPaths.yolo, 'images', split); }
function labelDir(split: DatasetSplit) { return path.join(farmPaths.yolo, 'labels', split); }

function assertSplit(value: unknown): asserts value is DatasetSplit {
  if (value !== 'train' && value !== 'val') throw new Error('Destino deve ser treino ou validação.');
}

async function exists(target: string) {
  try { await fs.access(target); return true; } catch { return false; }
}

async function serialized<T>(task: () => Promise<T>): Promise<T> {
  const previous = mutationQueue;
  let release = () => {};
  mutationQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try { return await task(); } finally { release(); }
}

type SplitOverrides = { traps: Record<string, DatasetSplit>; images: Record<string, DatasetSplit> };

async function readOverrides(): Promise<SplitOverrides> {
  if (!(await exists(OVERRIDES_PATH))) return { traps: {}, images: {} };
  const parsed = JSON.parse(await fs.readFile(OVERRIDES_PATH, 'utf8')) as {
    version?: number; traps?: Record<string, unknown>; images?: Record<string, unknown>;
  };
  if (![1, 2].includes(parsed.version || 0) || !parsed.traps || typeof parsed.traps !== 'object') {
    throw new Error('Plano de divisão salvo é inválido.');
  }
  const result: SplitOverrides = { traps: {}, images: {} };
  for (const [trap, split] of Object.entries(parsed.traps)) {
    assertSplit(split);
    result.traps[trap] = split;
  }
  for (const [image, split] of Object.entries(parsed.images || {})) {
    if (!IMAGE_NAME.test(image) || path.basename(image) !== image) throw new Error('Imagem inválida no plano de divisão.');
    assertSplit(split);
    result.images[image] = split;
  }
  return result;
}

async function writeOverrides(overrides: SplitOverrides) {
  await fs.mkdir(config.dataRoot, { recursive: true });
  const temporary = `${OVERRIDES_PATH}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify({ version: 2, ...overrides }, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, OVERRIDES_PATH);
  } finally { await fs.rm(temporary, { force: true }); }
}

export async function listDatasetImages(): Promise<DatasetImage[]> {
  const overrides = await readOverrides();
  const images: DatasetImage[] = [];
  for (const split of ['train', 'val'] as const) {
    const directory = imageDir(split);
    if (!(await exists(directory))) continue;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !IMAGE_NAME.test(entry.name)) continue;
      const annotationPath = path.join(farmPaths.annotationRoot, 'annotations', `${path.parse(entry.name).name}.json`);
      const labelPath = path.join(labelDir(split), `${path.parse(entry.name).name}.txt`);
      if (!(await exists(annotationPath)) || !(await exists(labelPath))) throw new Error(`Fonte ou label ausente para ${entry.name}. Reconstrua o DatasetYolo antes de reorganizar.`);
      const annotation = JSON.parse(await fs.readFile(annotationPath, 'utf8')) as {
        source?: { metadata?: { trap_code?: string } };
        ignore_regions?: unknown[];
      };
      const trap = annotation.source?.metadata?.trap_code;
      if (!trap) throw new Error(`Armadilha ausente na anotação ${entry.name}.`);
      const boxes = (await fs.readFile(labelPath, 'utf8')).split(/\r?\n/).filter(Boolean).length;
      images.push({ image: entry.name, split, desiredSplit: overrides.images[entry.name] || overrides.traps[trap] || split, trap,
        boxes, ignoreRegions: annotation.ignore_regions?.length || 0 });
    }
  }
  images.sort((a, b) => a.split.localeCompare(b.split) || a.trap.localeCompare(b.trap) || a.image.localeCompare(b.image));
  const imageNames = new Set(images.map((item) => item.image));
  if (imageNames.size !== images.length) throw new Error('A mesma imagem está nos dois conjuntos do DatasetYolo.');
  return images;
}

export async function datasetImagePath(split: string, image: string): Promise<string> {
  assertSplit(split);
  if (!IMAGE_NAME.test(image) || path.basename(image) !== image) throw new Error('Nome da imagem inválido.');
  const target = path.join(imageDir(split), image);
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error('Imagem não encontrada.');
  return target;
}

export async function datasetThumbnailPath(split: string, image: string): Promise<string> {
  const source = await datasetImagePath(split, image);
  const sourceStat = await fs.stat(source);
  const directory = path.join(config.dataRoot, 'dataset-thumbnails', split);
  const target = path.join(directory, `${path.parse(image).name}.jpg`);
  if (await exists(target) && (await fs.stat(target)).mtimeMs >= sourceStat.mtimeMs) return target;
  await fs.mkdir(directory, { recursive: true });
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  const python = process.platform === 'win32'
    ? path.join(farmPaths.ia, '.venv', 'Scripts', 'python.exe')
    : path.join(farmPaths.ia, '.venv', 'bin', 'python');
  const script = path.join(studioRoot, 'server', 'python', 'thumbnail.py');
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(python, [script, source, temporary], { windowsHide: true });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr || `Falha ao criar miniatura (${code}).`)));
    });
    await fs.rename(temporary, target);
    return target;
  } finally { await fs.rm(temporary, { force: true }); }
}

async function moveImageUnlocked(image: string, destination: DatasetSplit, persist: boolean) {
  const images = await listDatasetImages();
  const item = images.find((entry) => entry.image === image);
  if (!item) throw new Error(`Imagem ${image} não está no DatasetYolo atual.`);
  const source = item.split;
  if (source === destination) return images;
  const remaining = images.filter((entry) => entry.split === source).length - 1;
  if (remaining <= 0) throw new Error(`A mudança deixaria ${source === 'train' ? 'treino' : 'validação'} sem imagens.`);
  const moves: Array<{ from: string; to: string }> = [];
  for (const [directory, name] of [[imageDir, item.image], [labelDir, `${path.parse(item.image).name}.txt`]] as const) {
    const from = path.join(directory(source), name);
    const to = path.join(directory(destination), name);
    if (!(await exists(from)) || await exists(to)) throw new Error(`Conflito ao mover ${name}; nenhum arquivo foi alterado.`);
    moves.push({ from, to });
  }
  const overrides = persist ? await readOverrides() : null;
  const completed: typeof moves = [];
  try {
    for (const move of moves) { await fs.rename(move.from, move.to); completed.push(move); }
    if (overrides) { overrides.images[image] = destination; await writeOverrides(overrides); }
  } catch (error) {
    for (const move of completed.reverse()) await fs.rename(move.to, move.from);
    throw error;
  }
  return listDatasetImages();
}

export async function moveImage(image: string, split: unknown) {
  if (!config.allowFarmGuardJobs) throw new Error('Alterações no DatasetYolo estão desativadas.');
  assertSplit(split);
  if (typeof image !== 'string' || !IMAGE_NAME.test(image) || path.basename(image) !== image) throw new Error('Imagem inválida.');
  return serialized(() => moveImageUnlocked(image, split, true));
}

export async function reapplySplitOverrides() {
  if (!config.allowFarmGuardJobs) throw new Error('Alterações no DatasetYolo estão desativadas.');
  return serialized(async () => {
    const images = await listDatasetImages();
    for (const image of images.filter((item) => item.desiredSplit !== item.split)) {
      await moveImageUnlocked(image.image, image.desiredSplit, false);
    }
    return listDatasetImages();
  });
}
