import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('promotion copies a calibrated checkpoint and backs up the previous main model', async () => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'farmguard-studio-promotion-'));
  const previousRoot = process.env.FARMGUARD_ROOT;
  const previousData = process.env.STUDIO_DATA_ROOT;
  const previousJobs = process.env.ALLOW_FARMGUARD_JOBS;
  const realFarmGuard = previousRoot || path.resolve(process.cwd(), '..', 'FarmGuard');
  try {
    process.env.FARMGUARD_ROOT = path.join(fixture, 'FarmGuard');
    process.env.STUDIO_DATA_ROOT = path.join(fixture, 'studio-data');
    process.env.ALLOW_FARMGUARD_JOBS = 'true';
    const { farmPaths } = await import('./config.js');
    const management = await import('./model-management.js');
    farmPaths.ia = path.join(realFarmGuard, 'Iazinha');
    farmPaths.training = path.join(farmPaths.ia, 'Training');

    const candidate = path.join(farmPaths.runs, 'test-candidate', 'weights', 'best.pt');
    await fs.mkdir(path.dirname(candidate), { recursive: true });
    await fs.copyFile(path.join(realFarmGuard, 'Iazinha', 'Models', 'insect-detector.pt'), candidate);
    const sourceConfig = JSON.parse(await fs.readFile(path.join(realFarmGuard, 'Iazinha', 'Models', 'insect-detector.json'), 'utf8'));
    await fs.mkdir(farmPaths.models, { recursive: true });
    await fs.writeFile(path.join(farmPaths.models, 'insect-detector.pt'), 'previous-model');
    await fs.writeFile(path.join(farmPaths.models, 'insect-detector.json'), '{"name":"previous"}\n');
    await fs.mkdir(path.join(farmPaths.yolo, 'images', 'val'), { recursive: true });
    await fs.mkdir(path.join(farmPaths.yolo, 'labels', 'val'), { recursive: true });
    await fs.writeFile(path.join(farmPaths.yolo, 'dataset.yaml'), 'train: images/train\nval: images/val\n');
    await fs.writeFile(path.join(farmPaths.yolo, 'images', 'val', 'test.jpg'), 'fixture');
    await fs.writeFile(path.join(farmPaths.yolo, 'labels', 'val', 'test.txt'), '0 0.5 0.5 0.1 0.1\n');
    await fs.mkdir(path.join(farmPaths.annotationRoot, 'annotations'), { recursive: true });
    await fs.writeFile(path.join(farmPaths.annotationRoot, 'annotations', 'test.json'), JSON.stringify({ ignore_regions: [] }));
    const sweep = path.join(fixture, 'sweep.csv');
    await fs.writeFile(sweep, 'confidence,nms_iou,match_iou,ground_truth,predictions,tp,fp,fn,precision,recall,f1,edit_proxy,ignored_predictions\n0.25,0.4,0.3,1,1,1,0,0,1,1,1,0,2\n');
    const modelId = 'run:test-candidate/weights/best.pt';
    await management.importCalibration(modelId, sweep);
    const result = await management.promoteModel(modelId);
    const configuration = JSON.parse(await fs.readFile(path.join(farmPaths.models, 'insect-detector.json'), 'utf8'));
    assert.equal(result.modelId, modelId);
    assert.equal(configuration.name, 'test-candidate');
    assert.equal(configuration.architecture, sourceConfig.architecture);
    assert.equal(configuration.confidence, 0.25);
    assert.equal(configuration.nms_iou, 0.4);
    assert.equal(configuration.inference_calibration.protocol, management.calibrationProtocol);
    assert.equal(configuration.inference_calibration.selected.ignored_predictions, 2);
    assert.equal(configuration.promotion.source_model_id, modelId);
    assert.equal(await management.isPromotedCopy(candidate), true);
    assert.equal((await fs.stat(path.join(farmPaths.models, 'insect-detector.pt'))).size, (await fs.stat(candidate)).size);
    assert.equal(await fs.readFile(path.join(result.backupRoot, 'insect-detector.pt'), 'utf8'), 'previous-model');
    assert.equal(JSON.parse(await fs.readFile(path.join(result.backupRoot, 'insect-detector.json'), 'utf8')).name, 'previous');
    const context = await management.prepareCalibration(modelId);
    await fs.mkdir(path.dirname(context.output), { recursive: true });
    const header = 'confidence,nms_iou,match_iou,ground_truth,predictions,tp,fp,fn,precision,recall,f1,edit_proxy,ignored_predictions';
    const sweepRows = Array.from({ length: 30 }, (_, index) =>
      `${((index + 1) / 100).toFixed(2)},0.4,0.3,1,1,1,0,0,1,1,1,0,0`);
    await fs.writeFile(context.output, `${header}\n${sweepRows.join('\n')}\n`);
    const precise = await management.finishCalibration(context);
    assert.equal(precise.testedPairs, 30);
    assert.equal(precise.rows.length, 20);
    assert.equal(precise.confidenceGrid?.length, 30);
    await assert.rejects(fs.access(context.output), { code: 'ENOENT' });
    await fs.writeFile(candidate, 'changed-model');
    assert.equal(await management.isPromotedCopy(candidate), false);
  } finally {
    if (previousRoot === undefined) delete process.env.FARMGUARD_ROOT; else process.env.FARMGUARD_ROOT = previousRoot;
    if (previousData === undefined) delete process.env.STUDIO_DATA_ROOT; else process.env.STUDIO_DATA_ROOT = previousData;
    if (previousJobs === undefined) delete process.env.ALLOW_FARMGUARD_JOBS; else process.env.ALLOW_FARMGUARD_JOBS = previousJobs;
    await fs.rm(fixture, { recursive: true, force: true });
  }
});
