import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, farmPaths } from './config.js';
import { backupDraft, driveStatus } from './drive.js';
import { dimensions, imageFor, sourceImage, sourceImages } from './annotation-source.js';
import { calibrationForModels, inferenceSettingsForModel, isPromotedCopy, promotedModel } from './model-management.js';

export type AnnotationBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type IgnoreRegion = AnnotationBox & { kind?: 'unknown' | 'crowd' };
export class DraftInputError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export type Annotation = {
  schema_version: number;
  key: string;
  image: string;
  width: number;
  height: number;
  reviewed: boolean;
  excluded: boolean;
  class: string;
  source?: {
    type?: string;
    url?: string;
    metadata?: Record<string, unknown>;
  };
  boxes: AnnotationBox[];
  ignore_regions?: IgnoreRegion[];
  studioDraft?: boolean;
};

type RunMetric = Record<string, string | number>;

async function exists(target: string) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function dirs(target: string) {
  if (!(await exists(target))) return [];
  return (await fs.readdir(target, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

async function files(target: string) {
  if (!(await exists(target))) return [];
  return (await fs.readdir(target, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) {
      values.push(value.trim());
      value = '';
    } else value += character;
  }
  values.push(value.trim());
  return values;
}

async function readCsv(target: string): Promise<RunMetric[]> {
  if (!(await exists(target))) return [];
  const lines = (await fs.readFile(target, 'utf8'))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(
      headers.map((header, index) => {
        const raw = values[index] ?? '';
        const numeric = Number(raw);
        return [header, raw !== '' && Number.isFinite(numeric) ? numeric : raw];
      }),
    );
  });
}

async function listRuns() {
  const names = await dirs(farmPaths.runs);
  const trainingNames = (await Promise.all(names.map(async (name) =>
    await exists(path.join(farmPaths.runs, name, 'results.csv')) ? name : null)))
    .filter((name): name is string => name !== null);
  return Promise.all(
    trainingNames.map(async (name) => {
      const runRoot = path.join(farmPaths.runs, name);
      const history = await readCsv(path.join(runRoot, 'results.csv'));
      const latest = history.at(-1) || {};
      const bestPath = path.join(runRoot, 'weights', 'best.pt');
      const lastPath = path.join(runRoot, 'weights', 'last.pt');
      const statTarget = (await exists(bestPath)) ? bestPath : runRoot;
      const stat = await fs.stat(statTarget);
      return {
        name,
        epochs: history.length,
        modifiedAt: stat.mtime.toISOString(),
        hasBest: await exists(bestPath),
        hasLast: await exists(lastPath),
        bestPath: (await exists(bestPath)) ? bestPath : null,
        metrics: {
          precision: Number(latest['metrics/precision(B)'] || 0),
          recall: Number(latest['metrics/recall(B)'] || 0),
          map50: Number(latest['metrics/mAP50(B)'] || 0),
          map5095: Number(latest['metrics/mAP50-95(B)'] || 0),
          boxLoss: Number(latest['val/box_loss'] || 0),
        },
        history,
      };
    }),
  );
}

async function walkWeights(root: string, group: 'model' | 'run') {
  if (!(await exists(root))) return [];
  const found: Array<{
    id: string;
    name: string;
    path: string;
    group: string;
    size: number;
    modifiedAt: string;
  }> = [];
  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.pt')) {
        const stat = await fs.stat(full);
        const relative = path.relative(root, full);
        found.push({
          id: `${group}:${relative.replaceAll('\\', '/')}`,
          name:
            group === 'run'
              ? `${relative.split(path.sep)[0]} / ${entry.name}`
              : entry.name,
          path: full,
          group,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      }
    }
  }
  await walk(root);
  return found;
}

async function listPredictions() {
  const groups = await dirs(farmPaths.predictions);
  return Promise.all(
    groups.map(async (name) => {
      const root = path.join(farmPaths.predictions, name);
      const imageNames = (await files(root)).filter((file) =>
        /\.(jpe?g|png|webp)$/i.test(file),
      );
      const stat = await fs.stat(root);
      return {
        name,
        count: imageNames.length,
        modifiedAt: stat.mtime.toISOString(),
        preview: imageNames[0] || null,
      };
    }),
  );
}

export async function listAnnotations(): Promise<Annotation[]> {
  const annotationDir = path.join(farmPaths.annotationRoot, 'annotations');
  const names = (await files(annotationDir)).filter((name) =>
    name.endsWith('.json'),
  );
  return Promise.all(
    names.map(async (name) =>
      JSON.parse(await fs.readFile(path.join(annotationDir, name), 'utf8')),
    ),
  );
}

export async function getAnnotation(key: string): Promise<Annotation | null> {
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) return null;
  const draft = path.join(config.dataRoot, 'annotation-drafts', `${key}.json`);
  const original = path.join(
    farmPaths.annotationRoot,
    'annotations',
    `${key}.json`,
  );
  const target = (await exists(draft)) ? draft : original;
  if (!(await exists(target))) {
    const source = await sourceImage(key);
    if (!source) return null;
    const { width, height } = await dimensions(await imageFor(source));
    return {
      schema_version: 4, key, image: source.image, width, height,
      reviewed: false, excluded: false, class: 'insect', boxes: [], ignore_regions: [],
      source: { type: 'parquet', url: source.url, metadata: source.metadata },
      studioDraft: false,
    };
  }
  const annotation = JSON.parse(await fs.readFile(target, 'utf8')) as Annotation;
  annotation.studioDraft = target === draft;
  return annotation;
}

export async function saveDraft(key: string, input: Annotation) {
  if (!/^[a-zA-Z0-9_-]+$/.test(key) || key !== input.key) {
    throw new DraftInputError('Identificador de anotação inválido.');
  }
  const original = await getAnnotation(key);
  if (!original) throw new DraftInputError('Imagem não encontrada na fonte de dados.', 404);
  if ((input.ignore_regions || []).some((region) => region.kind !== undefined && region.kind !== 'unknown' && region.kind !== 'crowd')) {
    throw new DraftInputError('Tipo de área incerta inválido.');
  }
  const clean: Annotation = {
    ...input,
    schema_version: Math.max(input.schema_version || 4, 5),
    key,
    image: original.image,
    width: original.width,
    height: original.height,
    source: original.source,
    boxes: input.boxes.map((box) => ({
      x: Number(box.x),
      y: Number(box.y),
      width: Number(box.width),
      height: Number(box.height),
    })),
    ignore_regions: (input.ignore_regions || []).map((region) => ({
      x: Number(region.x), y: Number(region.y),
      width: Number(region.width), height: Number(region.height),
      kind: region.kind || 'unknown',
    })),
  };
  if ([...clean.boxes, ...(clean.ignore_regions || [])].some((box) =>
    ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
    box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0 ||
    box.x + box.width > clean.width || box.y + box.height > clean.height)) {
    throw new DraftInputError('Box ou região incerta fora dos limites da imagem.');
  }
  delete clean.studioDraft;
  const draftDir = path.join(config.dataRoot, 'annotation-drafts');
  await fs.mkdir(draftDir, { recursive: true });
  const target = path.join(draftDir, `${key}.json`);
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, target);
  } finally { await fs.rm(temporary, { force: true }); }
  void backupDraft(target).catch((error) =>
    console.error('Falha ao enviar rascunho ao Drive:', error),
  );
  return { ...clean, studioDraft: true };
}

export async function overview() {
  const [annotations, runs, directModels, runModels, predictions, drive] =
    await Promise.all([
      annotationSummaries(),
      listRuns(),
      walkWeights(farmPaths.models, 'model'),
      walkWeights(farmPaths.runs, 'run'),
      listPredictions(),
      driveStatus(),
    ]);
  const drafts = await files(path.join(config.dataRoot, 'annotation-drafts'));
  const traps = new Map<string, number>();
  let boxes = 0;
  for (const item of annotations) {
    boxes += item.boxes;
    const trap = item.trap || 'Sem armadilha';
    traps.set(trap, (traps.get(trap) || 0) + 1);
  }
  const thresholdRows = await readCsv(
    path.join(farmPaths.runs, 'threshold-sweep.csv'),
  );
  const promoted = await promotedModel();
  const allModels = [...directModels, ...runModels];
  const source = allModels.find((model) => model.id === promoted?.sourceModelId);
  const hideCopy = source && await isPromotedCopy(source.path);
  const models = allModels.filter((model) => !(hideCopy && model.id === 'model:insect-detector.pt'))
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  const calibrations = models.length ? await calibrationForModels(models) : [];
  const promotedId = hideCopy ? source.id : 'model:insect-detector.pt';
  const inference = await Promise.all(models.map((model, index) => inferenceSettingsForModel(model.id, calibrations[index])));
  return {
    connected: await exists(config.farmGuardRoot),
    farmGuardRoot: config.farmGuardRoot,
    operationsEnabled: config.allowFarmGuardJobs,
    dataset: {
      total: annotations.length,
      reviewed: annotations.filter((item) => item.reviewed).length,
      pending: annotations.filter((item) => !item.reviewed && !item.excluded)
        .length,
      excluded: annotations.filter((item) => item.excluded).length,
      boxes,
      drafts: drafts.filter((name) => name.endsWith('.json')).length,
      traps: [...traps.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    },
    runs: runs.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)),
    models: models.map((model, index) => ({ ...model, calibration: calibrations[index] || null, inference: inference[index],
      isPromoted: Boolean(promoted) && model.id === promotedId })),
    promoted,
    predictions: predictions.sort((a, b) =>
      b.modifiedAt.localeCompare(a.modifiedAt),
    ),
    thresholds: thresholdRows.slice(0, 24),
    drive,
  };
}

export async function resolveAnnotationImage(annotation: Annotation) {
  const source = await sourceImage(annotation.key);
  if (source) return imageFor(source);
  return path.join(farmPaths.annotationRoot, 'images', annotation.image);
}

export async function annotationSummaries() {
  const [originals, sources, draftNames] = await Promise.all([
    listAnnotations(), sourceImages(), files(path.join(config.dataRoot, 'annotation-drafts')),
  ]);
  const originalsByKey = new Map(originals.map((item) => [item.key, item]));
  const drafts = new Map<string, Annotation>();
  for (const name of draftNames.filter((item) => item.endsWith('.json'))) {
    try { drafts.set(name.slice(0, -5), JSON.parse(await fs.readFile(path.join(config.dataRoot, 'annotation-drafts', name), 'utf8'))); }
    catch { /* Ignore a damaged draft, keeping the source record available. */ }
  }
  const byKey = new Map(sources.map((item) => [item.key, item]));
  const entries = [...sources, ...originals.filter((item) => !byKey.has(item.key)).map((item) => ({
    key: item.key, image: item.image, metadata: item.source?.metadata || {}, url: item.source?.url || '',
  }))];
  const summaries = entries.map((source) => {
    const item = drafts.get(source.key) || originalsByKey.get(source.key);
    return {
      key: source.key, image: source.image, reviewed: item?.reviewed || false,
      excluded: item?.excluded || false, boxes: item?.boxes.length || 0,
      width: item?.width || 0, height: item?.height || 0,
      trap: String(source.metadata?.trap_code || item?.source?.metadata?.trap_code || '') || null,
      createdAt: String(source.metadata?.created_at || item?.source?.metadata?.created_at || '') || null,
      cached: Boolean(item),
    };
  });
  return summaries.sort((a, b) => {
    const priority = (item: typeof a) => item.excluded ? 3 : item.reviewed ? 2 : item.trap?.toUpperCase().startsWith('FARMLAB') ? 0 : 1;
    return priority(a) - priority(b);
  });
}

export function resolvePredictionImage(group: string, file: string) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(group) || !/^[a-zA-Z0-9_.-]+$/.test(file) ||
    group === '.' || group === '..' || file === '.' || file === '..') {
    return null;
  }
  return path.join(farmPaths.predictions, group, file);
}

export async function predictionDetections(group: string, file: string) {
  if (!resolvePredictionImage(group, file)) return null;
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(farmPaths.predictions, group, 'detections.json'), 'utf8')) as {
      images?: Record<string, { width: number; height: number; boxes: Array<{
        x1: number; y1: number; x2: number; y2: number; confidence: number;
      }> }>;
    };
    return manifest.images?.[file] || null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function resolvePredictionOriginal(group: string, file: string) {
  if (!resolvePredictionImage(group, file)) return null;
  return path.join(farmPaths.predictions, group, '_originals', file);
}

export async function predictionFiles(group: string) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(group) || group === '.' || group === '..') return [];
  return (await files(path.join(farmPaths.predictions, group))).filter((file) =>
    /\.(jpe?g|png|webp)$/i.test(file),
  );
}
