import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { config, farmPaths } from './config.js';

const runFile = promisify(execFile);

export type DriveInstallation = {
  executable: string;
  configFile: string;
  remote: string;
  remoteRoot: string;
};

async function exists(target: string) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function findRclone() {
  if (config.rclonePath && (await exists(config.rclonePath))) return config.rclonePath;
  if (process.platform !== 'win32') return 'rclone';
  const root = path.join(
    process.env.LOCALAPPDATA || '',
    'NTE.LocalizationStudio',
    'tools',
    'rclone',
  );
  if (!(await exists(root))) return null;
  const versions = (await fs.readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const version of versions) {
    const candidate = path.join(root, version, 'rclone.exe');
    if (await exists(candidate)) return candidate;
  }
  return null;
}

export async function discoverDrive(): Promise<DriveInstallation | null> {
  const executable = await findRclone();
  const defaultConfig = path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), '.config'),
    'NTE.LocalizationStudio',
    'google-drive',
    'rclone.conf',
  );
  const configFile = config.rcloneConfig || defaultConfig;
  if (!executable || !(await exists(configFile))) return null;
  return {
    executable,
    configFile,
    remote: config.driveRemote,
    remoteRoot: config.driveRoot,
  };
}

function cleanSegment(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'dataset';
}

export function remoteProjectRoot(installation: DriveInstallation) {
  return `${installation.remote}:${installation.remoteRoot}/${cleanSegment(path.basename(farmPaths.annotationRoot))}`;
}

async function rclone(arguments_: string[], timeout = 120_000) {
  const installation = await discoverDrive();
  if (!installation) throw new Error('Configuracao do Google Drive nao encontrada.');
  const { stdout, stderr } = await runFile(
    installation.executable,
    [
      ...arguments_,
      '--config',
      installation.configFile,
      '--retries',
      '2',
      '--low-level-retries',
      '3',
      '--contimeout',
      '10s',
      '--timeout',
      '60s',
    ],
    { timeout, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
  );
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

export async function driveStatus() {
  const installation = await discoverDrive();
  if (!installation) {
    return { configured: false, connected: false, remote: null, projectRoot: null };
  }
  try {
    const result = await rclone(['listremotes']);
    const connected = result.stdout.split(/\r?\n/).includes(`${installation.remote}:`);
    return {
      configured: true,
      connected,
      remote: installation.remote,
      projectRoot: remoteProjectRoot(installation),
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      remote: installation.remote,
      projectRoot: remoteProjectRoot(installation),
      error: error instanceof Error ? error.message : 'Falha ao consultar o Drive.',
    };
  }
}

export async function backupDraft(localFile: string) {
  const installation = await discoverDrive();
  if (!installation) return;
  await rclone([
    'copyto',
    localFile,
    `${remoteProjectRoot(installation)}/studio-drafts/${path.basename(localFile)}`,
    '--checksum',
  ]);
}

export async function backupPublishedAnnotation(localFile: string) {
  const installation = await discoverDrive();
  if (!installation) return;
  await rclone([
    'copyto',
    localFile,
    `${remoteProjectRoot(installation)}/annotations/${path.basename(localFile)}`,
    '--checksum',
  ]);
}

export async function syncDatasetToDrive() {
  const installation = await discoverDrive();
  if (!installation) throw new Error('Google Drive nao configurado.');
  return rclone(
    [
      'copy',
      farmPaths.annotationRoot,
      remoteProjectRoot(installation),
      '--checksum',
      '--create-empty-src-dirs',
      '--stats-one-line',
    ],
    10 * 60_000,
  );
}
