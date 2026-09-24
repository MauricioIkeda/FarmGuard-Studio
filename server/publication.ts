import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { backupPublishedAnnotation } from './drive.js';
import { config, farmPaths } from './config.js';
import type { Annotation } from './farmguard.js';

export type PublicationChange = {
  key: string;
  image: string;
  trap: string | null;
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
  const published: string[] = [];
  for (const key of selected) {
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) continue;
    const fileName = `${key}.json`;
    const draftPath = path.join(config.dataRoot, 'annotation-drafts', fileName);
    const targetPath = path.join(farmPaths.annotationRoot, 'annotations', fileName);
    if (!(await exists(draftPath))) continue;
    if (await exists(targetPath)) await fs.copyFile(targetPath, path.join(backupRoot, fileName));
    const contents = await fs.readFile(draftPath, 'utf8');
    JSON.parse(contents);
    const tempPath = `${targetPath}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tempPath, contents, 'utf8');
    await fs.rename(tempPath, targetPath);
    published.push(key);
    void backupPublishedAnnotation(targetPath).catch((error) =>
      console.error('Falha ao enviar anotacao publicada ao Drive:', error),
    );
  }
  await fs.writeFile(
    path.join(backupRoot, 'manifest.json'),
    `${JSON.stringify({ publishedAt: new Date().toISOString(), published }, null, 2)}\n`,
    'utf8',
  );
  return { published, backupRoot };
}
