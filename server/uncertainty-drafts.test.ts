import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('drafts preserve uncertainty kinds and legacy geometry; commands cannot opt out of Unimar protection', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-uncertainty-'));
  process.env.STUDIO_DATA_ROOT = path.join(temp, 'data');
  process.env.FARMGUARD_ROOT = path.join(temp, 'FarmGuard');
  process.env.INSECT_AI_DRIVE_ENABLED = 'false';
  try {
    const { farmPaths } = await import('./config.js');
    const { saveDraft } = await import('./farmguard.js');
    const { buildCommand } = await import('./jobs.js');
    const annotations = path.join(farmPaths.annotationRoot, 'annotations');
    await fs.mkdir(annotations, { recursive: true });
    const box = { x: 0, y: 0, width: 10, height: 10 };
    const annotation = { schema_version: 4, key: 'fixture', image: 'fixture.jpg', width: 100, height: 100,
      reviewed: true, excluded: false, class: 'insect', boxes: [box], ignore_regions: [box] };
    const source = path.join(annotations, 'fixture.json');
    await fs.writeFile(source, JSON.stringify(annotation));
    const saved = await saveDraft('fixture', { ...annotation, ignore_regions: [box, { ...box, kind: 'crowd' }] });
    assert.deepEqual(saved.ignore_regions?.map((region) => region.kind), ['unknown', 'crowd']);
    assert.deepEqual(saved.boxes, [box]);
    assert.equal(saved.schema_version, 5);
    assert.equal(await fs.readFile(source, 'utf8'), JSON.stringify(annotation));
    await assert.rejects(saveDraft('fixture', { ...annotation, ignore_regions: [{ ...box, kind: 'invalid' as 'crowd' }] }), /Tipo/);
    await fs.mkdir(farmPaths.yolo, { recursive: true });
    await fs.writeFile(path.join(farmPaths.yolo, 'dataset.yaml'), 'fixture');
    for (const flag of [undefined, false, true]) {
      const train = await buildCommand('train', { dataset: 'unimar', ignoreRegions: flag });
      const validate = await buildCommand('validate', { dataset: 'unimar', ignoreRegions: flag });
      assert.equal(path.basename(train[1]), 'train.py');
      assert.equal(path.basename(validate[1]), 'val.py');
      assert.ok(train.includes(path.join(farmPaths.yolo, 'dataset.yaml')));
    }
  } finally {
    const resolved = path.resolve(temp);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});
