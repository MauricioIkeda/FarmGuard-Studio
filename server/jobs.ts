import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { config, farmPaths } from './config.js';
import { discoverDrive, remoteProjectRoot } from './drive.js';
import { studioRoot } from './config.js';
import { reapplySplitOverrides } from './dataset-split.js';

export type JobType = 'train' | 'validate' | 'predict' | 'tune' | 'dataset' | 'drive' | 'drive-pull';
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

async function buildCommand(type: JobType, options: Record<string, unknown>) {
  const python = pythonExecutable();
  if (type === 'train') {
    const ignoreRegions = options.ignoreRegions === true;
    const args = [path.join(farmPaths.training, ignoreRegions ? 'train_ignore.py' : 'train.py')];
    if (options.model) args.push('--model', String(options.model));
    args.push('--name', safeName(options.name, `${ignoreRegions ? 'studio-ignore' : 'studio'}-${Date.now()}`));
    return [python, ...args];
  }
  if (type === 'validate') {
    const ignoreRegions = options.ignoreRegions === true;
    const args = [path.join(farmPaths.training, ignoreRegions ? 'val_ignore.py' : 'val.py')];
    if (options.model || ignoreRegions) args.push('--model', String(options.model || path.join(farmPaths.models, 'insect-detector.pt')));
    if (ignoreRegions && options.name) args.push('--name', safeName(options.name, `studio-ignore-validation-${Date.now()}`));
    return [python, ...args];
  }
  if (type === 'tune') {
    const args = [path.join(farmPaths.training, 'tune_thresholds.py')];
    if (options.model) args.push('--model', String(options.model));
    return [python, ...args];
  }
  if (type === 'predict') {
    const args = [path.join(studioRoot, 'server', 'python', 'predict.py')];
    if (options.model) args.push('--model', String(options.model));
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
  if (type === 'drive-pull') {
    return [
      drive.executable,
      'copy',
      remoteProjectRoot(drive),
      farmPaths.annotationRoot,
      '--config',
      drive.configFile,
      '--ignore-existing',
      '--create-empty-src-dirs',
      '--stats-one-line',
      '--stats',
      '5s',
    ];
  }
  return [
    drive.executable,
    'copy',
    farmPaths.annotationRoot,
    remoteProjectRoot(drive),
    '--config',
    drive.configFile,
    '--checksum',
    '--create-empty-src-dirs',
    '--stats-one-line',
    '--stats',
    '5s',
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
  try { command = await buildCommand(type, options); }
  finally { creatingJob = false; }
  const job: Job = {
    id: crypto.randomUUID(),
    type,
    status: 'queued',
    createdAt: new Date().toISOString(),
    command,
    logs: [],
    logCount: 0,
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
      .map((line) => (channel === 'stderr' ? `[erro] ${line}` : line));
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
          job.logs.push('Divisão por armadilha do Studio reaplicada após a reconstrução YOLO.');
          job.logCount += 1;
        } catch (error) {
          job.logs.push(`Falha ao reaplicar a divisão salva: ${error instanceof Error ? error.message : String(error)}`);
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
