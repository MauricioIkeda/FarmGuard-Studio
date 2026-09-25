import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, farmPaths, studioRoot } from './config.js';

export type ThresholdRow = {
  confidence: number; nms_iou: number; match_iou: number;
  ground_truth: number; predictions: number; tp: number; fp: number; fn: number;
  precision: number; recall: number; f1: number; edit_proxy: number;
};

export type Calibration = {
  modelId: string;
  modelFingerprint: string;
  datasetSignature: string;
  calibratedAt: string;
  best: ThresholdRow;
  rows: ThresholdRow[];
};

export type CalibrationContext = {
  modelId: string;
  modelPath: string;
  modelFingerprint: string;
  datasetSignature: string;
  output: string;
};

const calibrationRoot = path.join(config.dataRoot, 'calibrations');
const promotedWeight = path.join(farmPaths.models, 'insect-detector.pt');
const promotedConfig = path.join(farmPaths.models, 'insect-detector.json');
let promotionBusy = false;

function calibrationPath(id: string) {
  return path.join(calibrationRoot, `${crypto.createHash('sha256').update(id).digest('hex')}.json`);
}

function inside(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function resolveModel(id: string) {
  const match = /^(model|run):(.+\.pt)$/i.exec(id);
  if (!match) throw new Error('Modelo inválido. Selecione um peso catalogado pelo Studio.');
  const root = match[1] === 'model' ? farmPaths.models : farmPaths.runs;
  const target = path.resolve(root, match[2]);
  if (!inside(root, target)) throw new Error('Caminho de modelo fora do FarmGuard.');
  const realRoot = await fs.realpath(root);
  const realTarget = await fs.realpath(target);
  if (!inside(realRoot, realTarget)) throw new Error('O peso aponta para fora do FarmGuard.');
  const stat = await fs.stat(realTarget);
  if (!stat.isFile()) throw new Error('Peso não encontrado.');
  return { id, path: realTarget, stat };
}

export function modelIdForPath(modelPath: string) {
  const absolute = path.resolve(modelPath);
  for (const [group, root] of [['model', farmPaths.models], ['run', farmPaths.runs]] as const) {
    if (inside(root, absolute)) return `${group}:${path.relative(root, absolute).replaceAll('\\', '/')}`;
  }
  throw new Error('Selecione um peso do catálogo do Studio.');
}

function fingerprint(stat: { size: number; mtimeMs: number }) {
  return `${stat.size}:${stat.mtimeMs}`;
}

export async function validationDatasetSignature() {
  const hash = crypto.createHash('sha256');
  const imageRoot = path.join(farmPaths.yolo, 'images', 'val');
  const labelRoot = path.join(farmPaths.yolo, 'labels', 'val');
  const names = (await fs.readdir(imageRoot)).filter((name) => /\.(jpe?g|png|webp)$/i.test(name)).sort();
  hash.update(await fs.readFile(path.join(farmPaths.yolo, 'dataset.yaml')));
  for (const name of names) {
    const imageStat = await fs.stat(path.join(imageRoot, name));
    hash.update(`${name}:${imageStat.size}:${imageStat.mtimeMs}\n`);
    hash.update(await fs.readFile(path.join(labelRoot, `${path.parse(name).name}.txt`)));
  }
  return hash.digest('hex');
}

export async function readCalibration(id: string, datasetSignature?: string) {
  try {
    const calibration = JSON.parse(await fs.readFile(calibrationPath(id), 'utf8')) as Calibration;
    const model = await resolveModel(id);
    const currentDataset = datasetSignature || await validationDatasetSignature();
    return {
      ...calibration,
      stale: calibration.modelId !== id || calibration.modelFingerprint !== fingerprint(model.stat) ||
        calibration.datasetSignature !== currentDataset,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function calibrationForModels(models: Array<{ id: string }>) {
  const signature = await validationDatasetSignature();
  return Promise.all(models.map((model) => readCalibration(model.id, signature)));
}

export async function prepareCalibration(modelId: string) {
  const model = await resolveModel(modelId);
  return {
    modelId,
    modelPath: model.path,
    modelFingerprint: fingerprint(model.stat),
    datasetSignature: await validationDatasetSignature(),
    output: path.join(calibrationRoot, 'sweeps', `${crypto.randomUUID()}.csv`),
  } satisfies CalibrationContext;
}

function parseSweep(csv: string): ThresholdRow[] {
  const lines = csv.trim().split(/\r?\n/);
  const headers = lines.shift()?.split(',') || [];
  const expected = ['confidence', 'nms_iou', 'match_iou', 'ground_truth', 'predictions', 'tp', 'fp', 'fn', 'precision', 'recall', 'f1', 'edit_proxy'];
  if (expected.some((field) => !headers.includes(field)) || !lines.length) throw new Error('Resultado de calibração inválido.');
  return lines.map((line) => {
    const columns = line.split(',');
    const row = Object.fromEntries(headers.map((header, index) => [header, Number(columns[index])])) as ThresholdRow;
    if (expected.some((field) => !Number.isFinite(row[field as keyof ThresholdRow]))) throw new Error('Calibração contém valores inválidos.');
    return row;
  });
}

export async function finishCalibration(context: CalibrationContext) {
  const model = await resolveModel(context.modelId);
  if (fingerprint(model.stat) !== context.modelFingerprint ||
      await validationDatasetSignature() !== context.datasetSignature) {
    throw new Error('Modelo ou validação mudou durante a calibração; repita o teste.');
  }
  const rows = parseSweep(await fs.readFile(context.output, 'utf8'));
  rows.sort((a, b) => a.edit_proxy - b.edit_proxy || b.f1 - a.f1 || b.precision - a.precision);
  const record: Calibration = {
    modelId: context.modelId,
    modelFingerprint: context.modelFingerprint,
    datasetSignature: context.datasetSignature,
    calibratedAt: new Date().toISOString(),
    best: rows[0], rows,
  };
  await fs.mkdir(calibrationRoot, { recursive: true });
  const target = calibrationPath(context.modelId);
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, target);
  return record;
}

export async function importCalibration(modelId: string, csvPath: string) {
  const model = await resolveModel(modelId);
  return finishCalibration({ modelId, modelPath: model.path,
    modelFingerprint: fingerprint(model.stat), datasetSignature: await validationDatasetSignature(), output: csvPath });
}

export async function promotedModel() {
  try {
    const document = JSON.parse(await fs.readFile(promotedConfig, 'utf8')) as {
      name?: string; promotion?: { source_model_id?: string };
    };
    return { name: document.name || 'insect-detector', sourceModelId: document.promotion?.source_model_id || null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function sha256(file: string) {
  const hash = crypto.createHash('sha256');
  const handle = await fs.open(file, 'r');
  try {
    for await (const chunk of handle.createReadStream()) hash.update(chunk);
  } finally { await handle.close().catch(() => {}); }
  return hash.digest('hex').toUpperCase();
}

function inspectModel(file: string): Promise<{ architecture: string; class_names: Record<string, string> }> {
  const python = process.platform === 'win32'
    ? path.join(farmPaths.ia, '.venv', 'Scripts', 'python.exe')
    : path.join(farmPaths.ia, '.venv', 'bin', 'python');
  return new Promise((resolve, reject) => {
    const child = spawn(python, [path.join(studioRoot, 'server', 'python', 'model_info.py'), '--model', file],
      { cwd: farmPaths.training, shell: false, windowsHide: true });
    let output = '';
    let errors = '';
    let settled = false;
    const timeout = setTimeout(() => { child.kill(); finish(new Error('Verificação do peso excedeu 30 segundos.')); }, 30_000);
    function finish(error?: Error, result?: { architecture: string; class_names: Record<string, string> }) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(result!);
    }
    child.stdout.on('data', (chunk: Buffer) => { output = `${output}${chunk.toString()}`.slice(-10000); });
    child.stderr.on('data', (chunk: Buffer) => { errors = `${errors}${chunk.toString()}`.slice(-3000); });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0) return finish(new Error(errors.trim() || 'Peso inválido.'));
      try {
        const info = JSON.parse(output.trim().split(/\r?\n/).at(-1) || '') as { architecture: string; class_names: Record<string, string> };
        if (!info.architecture || Object.keys(info.class_names).length !== 1) throw new Error('Peso não compatível.');
        finish(undefined, info);
      } catch (error) { finish(error as Error); }
    });
  });
}

export async function promoteModel(modelId: string) {
  if (!config.allowFarmGuardJobs) throw new Error('Publicação de modelo desativada.');
  if (promotionBusy) throw new Error('Uma promoção já está em andamento.');
  promotionBusy = true;
  let tempWeight = '';
  let tempConfig = '';
  try {
    const model = await resolveModel(modelId);
    if (model.path === await fs.realpath(promotedWeight).catch(() => promotedWeight)) {
      throw new Error('Este já é o arquivo principal.');
    }
    const calibration = await readCalibration(modelId);
    if (!calibration || calibration.stale) throw new Error('Calibre este peso com o dataset atual antes de promovê-lo.');
    const info = await inspectModel(model.path);
    const backupRoot = path.join(config.dataRoot, 'promotions', `${new Date().toISOString().replaceAll(':', '-')}-${crypto.randomUUID()}`);
    await fs.mkdir(backupRoot, { recursive: true });
    await fs.mkdir(farmPaths.models, { recursive: true });
    tempWeight = path.join(farmPaths.models, `.insect-detector-${crypto.randomUUID()}.pt.tmp`);
    tempConfig = path.join(farmPaths.models, `.insect-detector-${crypto.randomUUID()}.json.tmp`);
    await fs.copyFile(model.path, tempWeight);
    const checksum = await sha256(tempWeight);
    const sourceName = modelId.startsWith('run:') ? modelId.slice(4).split('/')[0] : path.basename(model.path, '.pt');
    const document = {
      name: sourceName,
      architecture: info.architecture,
      model_sha256: checksum,
      imgsz: 1280,
      confidence: calibration.best.confidence,
      nms_iou: calibration.best.nms_iou,
      max_det: 1000,
      class_names: info.class_names,
      inference_calibration: {
        purpose: 'preannotation_edit_efficiency',
        match_iou: calibration.best.match_iou,
        selection: 'lowest_fp_plus_fn_then_highest_f1',
        confidence_grid: [...new Set(calibration.rows.map((row) => row.confidence))].sort((a, b) => a - b),
        nms_iou_grid: [...new Set(calibration.rows.map((row) => row.nms_iou))].sort((a, b) => a - b),
        selected: calibration.best,
      },
      promotion: {
        promoted_at: new Date().toISOString(),
        source_model_id: modelId,
        source_checkpoint: path.relative(config.farmGuardRoot, model.path).replaceAll('\\', '/'),
        calibrated_at: calibration.calibratedAt,
        validation_dataset_signature: calibration.datasetSignature,
        backup: path.relative(config.dataRoot, backupRoot).replaceAll('\\', '/'),
      },
    };
    await fs.writeFile(tempConfig, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    try { await fs.copyFile(promotedWeight, path.join(backupRoot, 'insect-detector.pt')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    try { await fs.copyFile(promotedConfig, path.join(backupRoot, 'insect-detector.json')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await fs.rename(tempWeight, promotedWeight);
    tempWeight = '';
    try { await fs.rename(tempConfig, promotedConfig); tempConfig = ''; }
    catch (error) {
      await fs.copyFile(path.join(backupRoot, 'insect-detector.pt'), promotedWeight).catch(() => {});
      throw error;
    }
    return { name: sourceName, modelId, confidence: calibration.best.confidence,
      nmsIou: calibration.best.nms_iou, backupRoot };
  } finally {
    if (tempWeight) await fs.rm(tempWeight, { force: true }).catch(() => {});
    if (tempConfig) await fs.rm(tempConfig, { force: true }).catch(() => {});
    promotionBusy = false;
  }
}
