import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('move one image, preserve mixed traps, and reapply its saved split after a rebuild', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'farmguard-studio-split-test-'));
  process.env.FARMGUARD_ROOT = path.join(temp, 'farmguard');
  process.env.STUDIO_DATA_ROOT = path.join(temp, 'studio-data');
  process.env.ALLOW_FARMGUARD_JOBS = 'true';
  const root = path.join(process.env.FARMGUARD_ROOT, 'Iazinha');
  const yolo = path.join(root, 'Datasets', 'datasetUnimar', 'DatasetYolo');
  const annotations = path.join(root, 'Datasets', 'datasetUnimar', 'source', 'traps_events', 'annotations');
  const imagePath = (split: string, image: string) => path.join(yolo, 'images', split, `${image}.jpg`);
  const labelPath = (split: string, image: string) => path.join(yolo, 'labels', split, `${image}.txt`);
  async function add(split: string, trap: string, image: string) {
    await fs.mkdir(path.dirname(imagePath(split, image)), { recursive: true });
    await fs.mkdir(path.dirname(labelPath(split, image)), { recursive: true });
    await fs.mkdir(annotations, { recursive: true });
    await fs.writeFile(imagePath(split, image), 'image');
    await fs.writeFile(labelPath(split, image), '0 0.5 0.5 0.1 0.1\n');
    await fs.writeFile(path.join(annotations, `${image}.json`), JSON.stringify({ source: { metadata: { trap_code: trap } } }));
  }
  try {
    await add('train', 'A', 'a1');
    await add('train', 'A', 'a2');
    await add('train', 'C', 'c1');
    await add('val', 'B', 'b1');
    await fs.mkdir(process.env.STUDIO_DATA_ROOT, { recursive: true });
    await fs.writeFile(path.join(process.env.STUDIO_DATA_ROOT, 'dataset-split-overrides.json'),
      JSON.stringify({ version: 1, traps: { A: 'train' } }));
    const { listDatasetImages, moveImage, reapplySplitOverrides } = await import('./dataset-split.js');
    assert.equal((await listDatasetImages()).length, 4);
    await moveImage('a1.jpg', 'val');
    const saved = JSON.parse(await fs.readFile(path.join(process.env.STUDIO_DATA_ROOT, 'dataset-split-overrides.json'), 'utf8'));
    assert.equal(saved.version, 2);
    assert.equal(saved.images['a1.jpg'], 'val');
    assert.equal((await listDatasetImages()).filter((item) => item.trap === 'A' && item.split === 'val').length, 1);
    assert.equal((await listDatasetImages()).find((item) => item.image === 'a2.jpg')?.split, 'train');
    await fs.rename(imagePath('val', 'a1'), imagePath('train', 'a1'));
    await fs.rename(labelPath('val', 'a1'), labelPath('train', 'a1'));
    assert.equal((await listDatasetImages()).filter((item) => item.desiredSplit !== item.split).length, 1);
    await reapplySplitOverrides();
    assert.equal((await listDatasetImages()).find((item) => item.image === 'a1.jpg')?.split, 'val');
    await moveImage('a1.jpg', 'train');
    await assert.rejects(() => moveImage('b1.jpg', 'train'), /sem imagens/);
    assert.equal((await listDatasetImages()).find((item) => item.image === 'a1.jpg')?.desiredSplit, 'train');
  } finally {
    assert.ok(temp.startsWith(os.tmpdir() + path.sep));
    await fs.rm(temp, { recursive: true, force: true });
  }
});
