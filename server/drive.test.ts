import assert from 'node:assert/strict';
import { test } from 'node:test';
import { remoteDatasetHistoryRoot, remoteDatasetsRoot, remoteUnimarSourceRoot, type DriveInstallation } from './drive.js';

test('Drive dataset backup preserves the FarmGuard directory layout', () => {
  const drive: DriveInstallation = {
    executable: 'rclone',
    configFile: 'rclone.conf',
    remote: 'nte-google-drive',
    remoteRoot: 'Insect AI Datasets',
  };
  assert.equal(remoteDatasetsRoot(drive), 'nte-google-drive:Insect AI Datasets/Datasets');
  assert.equal(remoteUnimarSourceRoot(drive),
    'nte-google-drive:Insect AI Datasets/Datasets/datasetUnimar/source/traps_events');
  assert.equal(remoteDatasetHistoryRoot(drive, '2026-09-27T18-00-00-000Z'),
    'nte-google-drive:Insect AI Datasets/Datasets-history/2026-09-27T18-00-00-000Z');
});
