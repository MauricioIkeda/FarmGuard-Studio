import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('model catalog opens without DatasetYolo and marks saved calibrations stale', async () => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'farmguard-catalog-'));
  const previousRoot = process.env.FARMGUARD_ROOT;
  const previousData = process.env.STUDIO_DATA_ROOT;
  try {
    process.env.FARMGUARD_ROOT = path.join(fixture, 'FarmGuard');
    process.env.STUDIO_DATA_ROOT = path.join(fixture, 'studio-data');
    const { farmPaths } = await import('./config.js');
    const { calibrationForModels } = await import('./model-management.js');
    const modelId = 'model:candidate.pt';
    const weight = path.join(farmPaths.models, 'candidate.pt');
    await fs.mkdir(farmPaths.models, { recursive: true });
    await fs.writeFile(weight, 'catalog-only fixture');
    assert.deepEqual(await calibrationForModels([{ id: modelId }]), [null]);

    const stat = await fs.stat(weight);
    const calibrationRoot = path.join(process.env.STUDIO_DATA_ROOT, 'calibrations');
    await fs.mkdir(calibrationRoot, { recursive: true });
    const filename = `${crypto.createHash('sha256').update(modelId).digest('hex')}.json`;
    await fs.writeFile(path.join(calibrationRoot, filename), JSON.stringify({
      modelId,
      modelFingerprint: `${stat.size}:${stat.mtimeMs}`,
      datasetSignature: 'previous-validation-dataset',
      best: { confidence: 0.33, nms_iou: 0.17 },
    }));
    const [calibration] = await calibrationForModels([{ id: modelId }]);
    assert.equal(calibration?.stale, true);
    assert.equal(calibration?.best.confidence, 0.33);
    await assert.rejects(fs.access(farmPaths.yolo), { code: 'ENOENT' });
  } finally {
    if (previousRoot === undefined) delete process.env.FARMGUARD_ROOT;
    else process.env.FARMGUARD_ROOT = previousRoot;
    if (previousData === undefined) delete process.env.STUDIO_DATA_ROOT;
    else process.env.STUDIO_DATA_ROOT = previousData;
    await fs.rm(fixture, { recursive: true, force: true });
  }
});
