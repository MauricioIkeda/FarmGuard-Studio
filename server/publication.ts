import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { backupPublishedAnnotation, backupPublishedImage } from './drive.js';
import { config, farmPaths } from './config.js';
import type { Annotation } from './farmguard.js';
import { imageFor, sourceImage } from './annotation-source.js';

export type PublicationChange = {
  key: string;
  image: string;
  trap: string | null;
  publishedBefore: boolean;
  boxesBefore: number;
  boxesAfter: number;
  reviewedBefore: boolean;
  reviewedAfter: boolean;
  excludedBefore: boolean;
  excludedAfter: boolean;
  changed: boolean;
};

async function exists(target: string) {
  try { await fs.access(target); return true; } catch { return false; }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== 'studioDraft')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
}

async function readAnnotation(target: string): Promise<Annotation> {
  return JSON.parse(await fs.readFile(target, 'utf8')) as Annotation;
}

export async function publicationPlan(): Promise<PublicationChange[]> {
  const draftsRoot = path.join(config.dataRoot, 'annotation-drafts');
  if (!(await exists(draftsRoot))) return [];
  const names = (await fs.readdir(draftsRoot)).filter((name) => name.endsWith('.json'));
  const changes: PublicationChange[] = [];
  for (const name of names) {
    const draft = await readAnnotation(path.join(draftsRoot, name));
    const originalPath = path.join(farmPaths.annotationRoot, 'annotations', name);
    const original = (await exists(originalPath)) ? await readAnnotation(originalPath) : null;
    changes.push({
      key: draft.key,
      image: draft.image,
      trap: String(draft.source?.metadata?.trap_code || '') || null,
      publishedBefore: Boolean(original),
      boxesBefore: original?.boxes.length || 0,
      boxesAfter: draft.boxes.length,
      reviewedBefore: original?.reviewed || false,
      reviewedAfter: draft.reviewed,
      excludedBefore: original?.excluded || false,
      excludedAfter: draft.excluded,
      changed: JSON.stringify(canonical(original)) !== JSON.stringify(canonical(draft)),
    });
  }
  return changes.sort((a, b) => a.trap?.localeCompare(b.trap || '') || a.key.localeCompare(b.key));
}

export async function publishDrafts(keys: string[]) {
  const allowed = new Set(
    (await publicationPlan()).filter((item) => item.changed).map((item) => item.key),
  );
  const selected = [...new Set(keys)].filter((key) => allowed.has(key));
  if (!selected.length) throw new Error('Nenhum rascunho alterado foi selecionado.');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupRoot = path.join(config.dataRoot, 'publication-backups', timestamp);
  await fs.mkdir(backupRoot, { recursive: true });
  const entries: Array<{ key: string; fileName: string; contents: string; targetPath: string; imagePath: string; sourcePath: string | null }> = [];
  for (const key of selected) {
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) continue;
    const fileName = `${key}.json`;
    const draftPath = path.join(config.dataRoot, 'annotation-drafts', fileName);
    if (!(await exists(draftPath))) continue;
    const contents = await fs.readFile(draftPath, 'utf8');
    const draft = JSON.parse(contents) as Annotation;
    if (draft.key !== key || !draft.image || path.basename(draft.image) !== draft.image || !/\.(jpe?g|png|webp)$/i.test(draft.image)) {
      throw new Error(`Imagem inválida no rascunho ${key}.`);
    }
    const imagePath = path.join(farmPaths.annotationRoot, 'images', draft.image);
    let sourcePath: string | null = null;
    if (!(await exists(imagePath))) {
      const source = await sourceImage(key);
      if (!source || source.image !== draft.image) throw new Error(`Imagem ${draft.image} indisponível para publicação.`);
      sourcePath = await imageFor(source);
    }
    entries.push({ key, fileName, contents, targetPath: path.join(farmPaths.annotationRoot, 'annotations', fileName), imagePath, sourcePath });
  }
  const published: string[] = [];
  const imagesAdded: string[] = [];
  for (const entry of entries) {
    if (entry.sourcePath && !(await exists(entry.imagePath))) {
      const imageTemp = `${entry.imagePath}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.copyFile(entry.sourcePath, imageTemp);
        await fs.rename(imageTemp, entry.imagePath);
      } finally { await fs.rm(imageTemp, { force: true }); }
      imagesAdded.push(path.basename(entry.imagePath));
    }
    if (await exists(entry.targetPath)) await fs.copyFile(entry.targetPath, path.join(backupRoot, entry.fileName));
    const tempPath = `${entry.targetPath}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(tempPath, entry.contents, 'utf8');
      await fs.rename(tempPath, entry.targetPath);
    } finally { await fs.rm(tempPath, { force: true }); }
    published.push(entry.key);
  }
  const driveErrors: string[] = [];
  let driveBackedUp = 0;
  for (const entry of entries.filter((item) => published.includes(item.key))) {
    try {
      const [annotationSaved, imageSaved] = await Promise.all([
        backupPublishedAnnotation(entry.targetPath), backupPublishedImage(entry.imagePath),
      ]);
      if (annotationSaved && imageSaved) driveBackedUp += 1;
      else driveErrors.push(`${entry.key}: Google Drive não configurado.`);
    } catch (error) {
      driveErrors.push(`${entry.key}: ${error instanceof Error ? error.message : 'falha no Drive'}`);
    }
  }
  await fs.writeFile(
    path.join(backupRoot, 'manifest.json'),
    `${JSON.stringify({ publishedAt: new Date().toISOString(), published, imagesAdded, driveBackedUp, driveErrors }, null, 2)}\n`,
    'utf8',
  );
  return { published, imagesAdded, driveBackedUp, driveErrors, backupRoot };
}
