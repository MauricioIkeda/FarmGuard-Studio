import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('published inference, calibration precedence and annotation invalidation', async (t) => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'farmguard-inference-'));
  process.env.FARMGUARD_ROOT = path.join(fixture, 'FarmGuard');
  process.env.STUDIO_DATA_ROOT = path.join(fixture, 'studio');
  const { farmPaths } = await import('./config.js');
  const m = await import('./model-management.js');
  const configFile = path.join(farmPaths.models, 'insect-detector.json');
  const published = { model_sha256: crypto.createHash('sha256').update('principal').digest('hex'),
    confidence: 0.33, nms_iou: 0.17, imgsz: 1280, max_det: 1000 };
  const mainId = 'model:insect-detector.pt';
  const candidateId = 'run:candidate/best.pt';
  async function saveCalibration(id: string, confidence: number, protocol = m.calibrationProtocol) {
    const model = await m.resolveModel(id);
    const calibration = { modelId: id, protocol, modelFingerprint: `${model.stat.size}:${model.stat.mtimeMs}`,
      datasetSignature: await m.validationDatasetSignature(), best: { confidence, nms_iou: 0.65 },
      imgsz: 640, maxDet: 300 };
    const dir = path.join(process.env.STUDIO_DATA_ROOT!, 'calibrations');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${crypto.createHash('sha256').update(id).digest('hex')}.json`), JSON.stringify(calibration));
  }
  try {
    for (const dir of [farmPaths.models, path.join(farmPaths.runs, 'candidate'),
      path.join(farmPaths.yolo, 'images', 'val'), path.join(farmPaths.yolo, 'labels', 'val'),
      path.join(farmPaths.annotationRoot, 'annotations')]) await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(farmPaths.models, 'insect-detector.pt'), 'principal');
    await fs.writeFile(configFile, JSON.stringify(published));
    await fs.writeFile(path.join(farmPaths.runs, 'candidate', 'best.pt'), 'candidate');
    await fs.writeFile(path.join(farmPaths.yolo, 'dataset.yaml'), 'names: [insect]');
    await fs.writeFile(path.join(farmPaths.yolo, 'images', 'val', 'sample.PNG'), 'fixture');
    await fs.writeFile(path.join(farmPaths.yolo, 'labels', 'val', 'sample.txt'), '');
    const annotation = path.join(farmPaths.annotationRoot, 'annotations', 'sample.json');
    await fs.writeFile(annotation, JSON.stringify({ ignore_regions: [] }));

    await t.test('principal resolves without its original training run', async () => {
      const settings = await m.inferenceSettingsForModel(mainId);
      assert.equal(settings.source, 'promoted');
      assert.equal(settings.confidence, 0.33);
      assert.equal(settings.nmsIou, 0.17);
      assert.equal(settings.imgsz, 1280);
    });
    await t.test('experimental calibration cannot change published inference', async () => {
      await saveCalibration(mainId, 0.8);
      assert.equal((await m.inferenceSettingsForModel(mainId)).confidence, 0.33);
      await fs.writeFile(path.join(farmPaths.models, 'copy.pt'), 'principal');
      assert.equal((await m.inferenceSettingsForModel('model:copy.pt')).source, 'promoted');
    });
    await t.test('other weights use defaults or current calibration including geometry', async () => {
      assert.equal((await m.inferenceSettingsForModel(candidateId)).source, 'defaults');
      await saveCalibration(candidateId, 0.7);
      const settings = await m.inferenceSettingsForModel(candidateId);
      assert.equal(settings.source, 'calibration');
      assert.equal(settings.confidence, 0.7);
      assert.equal(settings.imgsz, 640);
      assert.equal(settings.maxDet, 300);
    });
    await t.test('changing uncertain regions invalidates saved calibration', async () => {
      const before = await m.validationDatasetSignature();
      await fs.writeFile(annotation, JSON.stringify({ ignore_regions: [{ x: 0, y: 0, width: 10, height: 10 }] }));
      assert.notEqual(await m.validationDatasetSignature(), before);
      assert.equal((await m.readCalibration(candidateId))?.stale, true);
      assert.equal((await m.inferenceSettingsForModel(candidateId)).source, 'defaults');
    });
    await t.test('older evaluation protocol requires recalibration', async () => {
      await saveCalibration(candidateId, 0.7, 'old');
      assert.equal((await m.readCalibration(candidateId))?.stale, true);
    });
    await t.test('invalid published settings and mismatched hashes fail explicitly', async () => {
      await fs.writeFile(configFile, JSON.stringify({ ...published, confidence: 9 }));
      await assert.rejects(m.inferenceSettingsForModel(mainId), /Parâmetros publicados/);
      await fs.writeFile(configFile, JSON.stringify({ ...published, model_sha256: 'wrong' }));
      await assert.rejects(m.inferenceSettingsForModel(mainId), /diverge/);
    });
    await t.test('API must match published weights and all inference settings', async () => {
      await fs.writeFile(configFile, JSON.stringify(published));
      const settings = await m.inferenceSettingsForModel(mainId);
      const { assertApiSettings } = await import('./ia-api.js');
      const apiModel = { name: 'principal', sha256: published.model_sha256, confidence: .33, nms_iou: .17, imgsz: 1280, max_det: 1000 };
      assert.doesNotThrow(() => assertApiSettings(apiModel, settings));
      for (const change of [{ sha256: 'old' }, { confidence: .2 }, { nms_iou: .4 }, { imgsz: 640 }, { max_det: 300 }])
        assert.throws(() => assertApiSettings({ ...apiModel, ...change }, settings), /Recarregue/);
    });
  } finally { await fs.rm(fixture, { recursive: true, force: true }); }
});
