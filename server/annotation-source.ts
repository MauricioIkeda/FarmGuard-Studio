import fs from 'node:fs/promises';
import path from 'node:path';
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';
import { imageSize } from 'image-size';
import { config, farmPaths } from './config.js';
import { shareImageWork, writeImageCache } from './image-cache.js';

export type SourceImage = {
  key: string;
  image: string;
  url: string;
  metadata: Record<string, string | number>;
};

const sourceFile = path.join(config.dataRoot, 'sources', 'traps_events.parquet');
const imageCache = path.join(config.dataRoot, 'image-cache');
const allowedHost = 'otmis-armadilha-papel.s3.amazonaws.com';
let cached: { mtimeMs: number; records: SourceImage[] } | null = null;
const sourceWork = shareImageWork<SourceImage[]>();
const imageWork = shareImageWork<string>();

function value(input: unknown) {
  return input == null ? '' : String(input).trim();
}

function validImageUrl(input: string) {
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && url.hostname === allowedHost && /\.(jpe?g|png|webp)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export async function sourceImages(): Promise<SourceImage[]> {
  let stat;
  try { stat = await fs.stat(sourceFile); } catch { return []; }
  if (cached?.mtimeMs === stat.mtimeMs) return cached.records;
  return sourceWork(String(stat.mtimeMs), async () => {
    const file = await asyncBufferFromFile(sourceFile);
    const rows = await parquetReadObjects({
      file,
      columns: ['id', 'code', 'createdAt', 'data', 'farm', 'harvest', 'trapId', 'trapCode', 'pestCount', 'type'],
    });
    const grouped = new Map<string, { row: Record<string, unknown>; count: number }>();
    for (const row of rows as Record<string, unknown>[]) {
      const url = value(row.data);
      if (value(row.type).toUpperCase() !== 'IMAGE' || !validImageUrl(url)) continue;
      const current = grouped.get(url);
      if (!current) grouped.set(url, { row, count: 1 });
      else {
        current.count += 1;
        if (`${value(row.createdAt)}|${value(row.id)}` < `${value(current.row.createdAt)}|${value(current.row.id)}`) current.row = row;
      }
    }
    const ordered = [...grouped.entries()].sort((a, b) =>
      `${value(a[1].row.createdAt)}|${value(a[1].row.id)}`.localeCompare(`${value(b[1].row.createdAt)}|${value(b[1].row.id)}`),
    );
    const keys = new Set<string>();
    const records = ordered.map(([url, { row, count }], index) => {
      const image = path.posix.basename(new URL(url).pathname);
      const base = path.posix.parse(image).name || value(row.id) || `image_${index + 1}`;
      let key = base;
      for (let suffix = 2; keys.has(key); suffix += 1) key = `${base}_${suffix}`;
      keys.add(key);
      const metadata: Record<string, string | number> = {};
      for (const [name, field] of Object.entries({
        event_id: 'id', code: 'code', created_at: 'createdAt', farm: 'farm', harvest: 'harvest',
        trap_id: 'trapId', trap_code: 'trapCode', pest_count: 'pestCount',
      })) {
        const item = value(row[field]);
        if (item) metadata[name] = item;
      }
      metadata.duplicate_event_count = count;
      metadata.parquet_file = 'traps_events.parquet';
      metadata.source_host = allowedHost;
      return { key, image, url, metadata };
    });
    cached = { mtimeMs: stat.mtimeMs, records };
    return records;
  });
}

export async function sourceImage(key: string) {
  return (await sourceImages()).find((item) => item.key === key) || null;
}

export async function importSource(buffer: Buffer) {
  if (buffer.length < 8 || buffer.toString('ascii', 0, 4) !== 'PAR1' || buffer.toString('ascii', buffer.length - 4) !== 'PAR1') {
    throw new Error('Arquivo Parquet inválido.');
  }
  const root = path.dirname(sourceFile);
  await fs.mkdir(root, { recursive: true });
  const temporary = path.join(root, `upload-${Date.now()}.parquet`);
  try {
    await fs.writeFile(temporary, buffer);
    const file = await asyncBufferFromFile(temporary);
    await parquetReadObjects({ file, columns: ['data', 'type'], rowStart: 0, rowEnd: 1 });
    try {
      await fs.access(sourceFile);
      await fs.mkdir(path.join(root, 'archive'), { recursive: true });
      await fs.copyFile(sourceFile, path.join(root, 'archive', `traps_events-${Date.now()}.parquet`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await fs.rename(temporary, sourceFile);
    cached = null;
    return { count: (await sourceImages()).length };
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function imageFor(source: SourceImage) {
  return imageWork(source.key, async () => {
    const original = path.join(farmPaths.annotationRoot, 'images', source.image);
    try { await fs.access(original); return original; } catch {}
    const target = path.join(imageCache, `${source.key}${path.extname(source.image).toLowerCase()}`);
    try { await fs.access(target); return target; } catch {}
    const response = await fetch(source.url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Imagem indisponível na fonte (${response.status}).`);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > 25 * 1024 * 1024) throw new Error('Imagem maior que 25 MB.');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 25 * 1024 * 1024 || !imageSize(buffer).width) throw new Error('Imagem inválida.');
    await fs.mkdir(imageCache, { recursive: true });
    await writeImageCache(target, buffer);
    return target;
  });
}

export async function dimensions(target: string) {
  const { width, height } = imageSize(await fs.readFile(target));
  if (!width || !height) throw new Error('Não foi possível ler as dimensões da imagem.');
  return { width, height };
}
