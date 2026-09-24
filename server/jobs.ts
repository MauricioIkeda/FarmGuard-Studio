import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { config, farmPaths } from './config.js';
import { discoverDrive, remoteProjectRoot } from './drive.js';
import { studioRoot } from './config.js';

export type JobType = 'train' | 'validate' | 'predict' | 'tune' | 'dataset' | 'drive' | 'drive-pull';
export type Job = {
  id: string;
  type: JobType;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  command: string[];
  logs: string[];
  exitCode?: number | null;
};

const jobs = new Map<string, Job>();
const processes = new Map<string, ChildProcessWithoutNullStreams>();
export const jobEvents = new EventEmitter();

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
    const args = [path.join(farmPaths.training, 'train.py')];
    if (options.model) args.push('--model', String(options.model));
    args.push('--name', safeName(options.name, `studio-${Date.now()}`));
    return [python, ...args];
  }
  if (type === 'validate') {
    const args = [path.join(farmPaths.training, 'val.py')];
    if (options.model) args.push('--model', String(options.model));
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
  const command = await buildCommand(type, options);
  const job: Job = {
    id: crypto.randomUUID(),
    type,
    status: 'queued',
    createdAt: new Date().toISOString(),
    command,
    logs: [],
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
    if (job.logs.length > 1500) job.logs.splice(0, job.logs.length - 1500);
    emit(job);
  };
  child.stdout.on('data', (chunk) => capture(chunk, 'stdout'));
  child.stderr.on('data', (chunk) => capture(chunk, 'stderr'));
  child.on('error', (error) => {
    job.logs.push(error.message);
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    processes.delete(job.id);
    emit(job);
  });
  child.on('close', (code) => {
    if (job.status !== 'cancelled') job.status = code === 0 ? 'completed' : 'failed';
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
    processes.delete(job.id);
    emit(job);
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
