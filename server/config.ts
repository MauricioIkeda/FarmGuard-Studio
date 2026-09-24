import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
export const studioRoot = serverDir.includes(`${path.sep}dist-server${path.sep}`)
  ? path.resolve(serverDir, '..', '..')
  : path.resolve(serverDir, '..');

try {
  process.loadEnvFile(path.join(studioRoot, '.env'));
} catch {
  // O arquivo .env e opcional; os defaults mantem o Studio seguro.
}

export const config = {
  port: Number(process.env.PORT || 4310),
  farmGuardRoot:
    process.env.FARMGUARD_ROOT ||
    path.resolve(studioRoot, '..', 'FarmGuard'),
  dataRoot: path.join(studioRoot, 'data'),
  allowFarmGuardJobs:
    String(process.env.ALLOW_FARMGUARD_JOBS).toLowerCase() === 'true',
};

export const farmPaths = {
  ia: path.join(config.farmGuardRoot, 'Iazinha'),
  training: path.join(config.farmGuardRoot, 'Iazinha', 'Training'),
  runs: path.join(config.farmGuardRoot, 'Iazinha', 'Training', 'runs'),
  predictions: path.join(
    config.farmGuardRoot,
    'Iazinha',
    'Training',
    'predictions',
  ),
  models: path.join(config.farmGuardRoot, 'Iazinha', 'Models'),
  yolo: path.join(config.farmGuardRoot, 'Iazinha', 'DatasetYolo'),
  annotationRoot: path.join(
    config.farmGuardRoot,
    'Iazinha',
    'DatasetCreator',
    'Insect AI Datasets',
    'traps_events',
  ),
};
