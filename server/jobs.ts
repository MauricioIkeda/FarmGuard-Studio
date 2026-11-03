import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { config, farmPaths } from './config.js';
import { discoverDrive, remoteDatasetHistoryRoot, remoteDatasetsRoot, remoteUnimarSourceRoot } from './drive.js';
import { studioRoot } from './config.js';
import { reapplySplitOverrides } from './dataset-split.js';
import { finishCalibration, modelIdForPath, prepareCalibration, inferenceSettingsForModel, resolveModel, type CalibrationContext } from './model-management.js';

export type JobType = 'train' | 'validate' | 'predict' | 'tune' | 'dataset' | 'drive' | 'drive-pull' | 'drive-datasets';
export type Job = {
  id: string;
  type: JobType;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  command: string[];
  logs: string[];
  logCount: number;
  exitCode?: number | null;
  calibration?: CalibrationContext;
};

const jobs = new Map<string, Job>();
const processes = new Map<string, ChildProcessWithoutNullStreams>();
let creatingJob = false;
export const jobEvents = new EventEmitter();

export async function loadPersistedJobs() {
  const root = path.join(config.dataRoot, 'jobs');
  let files: string[];
  try { files = (await fs.readdir(root)).filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for (const file of files) {
    try {
      const job = JSON.parse(await fs.readFile(path.join(root, file), 'utf8')) as Job;
      if (job.id !== path.basename(file, '.json') || !Array.isArray(job.logs) || !Array.isArray(job.command) || !job.createdAt) throw new Error('Registro inválido');
      job.logCount = Math.max(job.logCount || 0, job.logs.length);
      if (job.status === 'queued' || job.status === 'running') {
        job.status = 'interrupted';
        job.finishedAt = new Date().toISOString();
        job.logs.push('Acompanhamento interrompido pelo reinício do Studio; confira se o processo externo continuou em execução.');
        job.logCount += 1;
        await persist(job);
      }
      jobs.set(job.id, job);
    } catch (error) { console.error(`Não foi possível recuperar o histórico ${file}:`, error); }
  }
}

function pythonExecutable() {
  const windows = path.join(farmPaths.ia, '.venv', 'Scripts', 'python.exe');
  return process.platform === 'win32' ? windows : path.join(farmPaths.ia, '.venv', 'bin', 'python');
}

function safeName(value: unknown, fallback: string) {
  const normalized = String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-');
  return normalized || fallback;
}

async function selectedDataset(options: Record<string, unknown>) {
  const key = String(options.dataset || 'unimar');
  const names: Record<string, string> = {
    unimar: 'datasetUnimar', yellow: 'datasetYellow', stickyPi: 'datasetStickyPi',
  };
  const folder = names[key];
  if (!folder) throw new Error('Dataset inválido. Escolha um dos conjuntos catalogados.');
  const yaml = path.join(farmPaths.ia, 'Datasets', folder, 'DatasetYolo', 'dataset.yaml');
  try { await fs.access(yaml); }
  catch { throw new Error(`Dataset ${folder} ainda não foi preparado neste computador.`); }
  return yaml;
}

export async function buildCommand(type: JobType, options: Record<string, unknown>, calibration?: CalibrationContext) {
  const python = pythonExecutable();
  if (type === 'train') {
    const args = [path.join(farmPaths.training, 'train.py')];
    if (options.model) args.push('--model', String(options.model));
    args.push('--data', await selectedDataset(options));
    args.push('--name', safeName(options.name, `studio-${Date.now()}`));
    return [python, ...args];
  }
  if (type === 'validate') {
    const args = [path.join(farmPaths.training, 'val.py')];
    if (options.model) args.push('--model', String(options.model));
    args.push('--data', await selectedDataset(options));
    if (options.name) args.push('--name', safeName(options.name, `studio-validation-${Date.now()}`));
    return [python, ...args];
  }
  if (type === 'tune') {
    if (!calibration) throw new Error('Modelo de calibração ausente.');
    const manual = options.manualConfidence !== undefined || options.manualIou !== undefined;
    if (manual) {
      const confidence = options.manualConfidence;
      const iou = options.manualIou;
      if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0.01 || confidence > 0.99 ||
          typeof iou !== 'number' || !Number.isFinite(iou) || iou < 0.01 || iou > 0.99) {
        throw new Error('Confiança e NMS IoU manuais devem estar entre 0,01 e 0,99.');
      }
      calibration.mode = 'manual';
      return [python, path.join(studioRoot, 'server', 'python', 'manual_calibration.py'),
        '--model', calibration.modelPath, '--dataset', farmPaths.yolo, '--output', calibration.output,
        '--confidence', String(confidence), '--iou', String(iou),
        '--imgsz', String(calibration.imgsz), '--max-det', String(calibration.maxDet)];
    }
    const args = [path.join(studioRoot, 'server', 'python', 'precise_calibration.py')];
    args.push('--model', calibration.modelPath, '--dataset', farmPaths.yolo, '--output', calibration.output,
      '--imgsz', String(calibration.imgsz), '--max-det', String(calibration.maxDet));
    return [python, ...args];
  }
  if (type === 'predict') {
    const args = [path.join(studioRoot, 'server', 'python', 'predict.py')];
    const modelId = modelIdForPath(String(options.model || path.join(farmPaths.models, 'insect-detector.pt')));
    const model = await resolveModel(modelId);
    const settings = await inferenceSettingsForModel(modelId);
    args.push('--model', model.path);
    args.push('--confidence', String(settings.confidence), '--iou', String(settings.nmsIou),
      '--imgsz', String(settings.imgsz), '--max-det', String(settings.maxDet));
    const name = safeName(options.name, `studio-predict-${Date.now()}`);
    try {
      await fs.access(path.join(farmPaths.predictions, name));
      throw new Error(`Já existe uma galeria chamada ${name}. Escolha outro nome ou deixe o campo vazio.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    args.push('--name', name);
    return [python, ...args];
  }
  if (type === 'dataset') {
    return [python, path.join(farmPaths.ia, 'DatasetCreator', 'dataset.py')];
  }
  const drive = await discoverDrive();
  if (!drive) throw new Error('Google Drive nao configurado.');
  if (type === 'drive-datasets') {
    const history = remoteDatasetHistoryRoot(drive, new Date().toISOString().replace(/[:.]/g, '-'));
    return [drive.executable, 'sync', farmPaths.datasets, remoteDatasetsRoot(drive),
      '--config', drive.configFile, '--checksum', '--create-empty-src-dirs', '--backup-dir', history,
      '--stats-one-line', '--stats', '5s', '--stats-log-level', 'NOTICE'];
  }
  if (type === 'drive-pull') {
    return [
      drive.executable,
      'copy',
      remoteUnimarSourceRoot(drive),
      farmPaths.annotationRoot,
      '--config',
      drive.configFile,
      '--ignore-existing',
      '--create-empty-src-dirs',
      '--stats-one-line',
      '--stats',
      '5s',
      '--stats-log-level',
      'NOTICE',
    ];
  }
  return [
    drive.executable,
    'copy',
    farmPaths.annotationRoot,
    remoteUnimarSourceRoot(drive),
    '--config',
    drive.configFile,
    '--checksum',
    '--create-empty-src-dirs',
    '--stats-one-line',
    '--stats',
    '5s',
    '--stats-log-level',
    'NOTICE',
  ];
}

async function persist(job: Job) {
  const root = path.join(config.dataRoot, 'jobs');
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    path.join(root, `${job.id}.json`),
    `${JSON.stringify(job, null, 2)}\n`,
    'utf8',
  );
}

function emit(job: Job) {
  jobEvents.emit('update', job);
  void persist(job);
}

export function listJobs() {
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getJob(id: string) {
  return jobs.get(id);
}

export async function createJob(type: JobType, options: Record<string, unknown>) {
  if (!config.allowFarmGuardJobs) {
    throw new Error(
      'Operacoes desativadas. Defina ALLOW_FARMGUARD_JOBS=true somente depois de autorizar escritas de resultados no FarmGuard.',
    );
  }
  if (creatingJob || listJobs().some((job) => job.status === 'queued' || job.status === 'running')) {
    throw new Error('Já existe uma operação em andamento. Aguarde a conclusão antes de iniciar outra.');
  }
  creatingJob = true;
  let command: string[];
  let calibration: CalibrationContext | undefined;
  try {
    if (type === 'tune') calibration = await prepareCalibration(modelIdForPath(
      String(options.model || path.join(farmPaths.models, 'insect-detector.pt'))));
    command = await buildCommand(type, options, calibration);
  }
  finally { creatingJob = false; }
  const job: Job = {
    id: crypto.randomUUID(),
    type,
    status: 'queued',
    createdAt: new Date().toISOString(),
    command,
    logs: [],
    logCount: 0,
    calibration,
  };
  jobs.set(job.id, job);
  emit(job);
  queueMicrotask(() => run(job));
  return job;
}

function run(job: Job) {
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  emit(job);
  const [executable, ...args] = job.command;
  const child = spawn(executable, args, {
    cwd: farmPaths.training,
    shell: false,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    },
  });
  processes.set(job.id, child);
  const capture = (chunk: Buffer, channel: string) => {
    const lines = chunk
      .toString()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => (channel === 'stderr' && !/^\s*\d{4}\/\d{2}\/\d{2}.*NOTICE\s*:/.test(line) ? `[erro] ${line}` : line));
    job.logs.push(...lines);
    job.logCount += lines.length;
    if (job.logs.length > 1500) job.logs.splice(0, job.logs.length - 1500);
    emit(job);
  };
  child.stdout.on('data', (chunk) => capture(chunk, 'stdout'));
  child.stderr.on('data', (chunk) => capture(chunk, 'stderr'));
  child.on('error', (error) => {
    job.logs.push(error.message);
    job.logCount += 1;
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    processes.delete(job.id);
    emit(job);
  });
  child.on('close', (code) => {
    void (async () => {
      if (job.status !== 'cancelled' && job.status !== 'failed' && code === 0 && job.type === 'dataset') {
        try {
          await reapplySplitOverrides();
          job.logs.push('Divisão por imagem do Studio reaplicada após a reconstrução YOLO.');
          job.logCount += 1;
        } catch (error) {
          job.logs.push(`Falha ao reaplicar a divisão salva: ${error instanceof Error ? error.message : String(error)}`);
          job.logCount += 1;
          job.status = 'failed';
        }
      }
      if (job.status !== 'cancelled' && job.status !== 'failed' && code === 0 && job.type === 'tune' && job.calibration) {
        try {
          const result = await finishCalibration(job.calibration);
          job.logs.push(`Calibração salva para ${job.calibration.modelId}: confiança ${result.best.confidence}, NMS IoU ${result.best.nms_iou}, ${result.best.edit_proxy} correções estimadas.`);
          job.logCount += 1;
        } catch (error) {
          job.logs.push(`Falha ao salvar calibração: ${error instanceof Error ? error.message : String(error)}`);
          job.logCount += 1;
          job.status = 'failed';
        }
      }
      if (job.status !== 'cancelled' && job.status !== 'failed') job.status = code === 0 ? 'completed' : 'failed';
      job.exitCode = code;
      job.finishedAt = new Date().toISOString();
      processes.delete(job.id);
      emit(job);
    })();
  });
}

export function cancelJob(id: string) {
  const job = jobs.get(id);
  const child = processes.get(id);
  if (!job || !child || job.status !== 'running') return false;
  job.status = 'cancelled';
  job.finishedAt = new Date().toISOString();
  child.kill();
  emit(job);
  return true;
}
