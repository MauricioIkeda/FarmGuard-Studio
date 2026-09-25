import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('move trap as a group and reapply its saved split after a rebuild', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'farmguard-studio-split-test-'));
  process.env.FARMGUARD_ROOT = path.join(temp, 'farmguard');
  process.env.STUDIO_DATA_ROOT = path.join(temp, 'studio-data');
  process.env.ALLOW_FARMGUARD_JOBS = 'true';
  const root = path.join(process.env.FARMGUARD_ROOT, 'Iazinha');
  const yolo = path.join(root, 'DatasetYolo');
  const annotations = path.join(root, 'DatasetCreator', 'Insect AI Datasets', 'traps_events', 'annotations');
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
    const { listDatasetImages, moveTrap, reapplySplitOverrides } = await import('./dataset-split.js');
    assert.equal((await listDatasetImages()).length, 4);
    await moveTrap('A', 'val');
    assert.equal((await listDatasetImages()).filter((item) => item.trap === 'A' && item.split === 'val').length, 2);
    await fs.rename(imagePath('val', 'a1'), imagePath('train', 'a1'));
    await fs.rename(labelPath('val', 'a1'), labelPath('train', 'a1'));
    await fs.rename(imagePath('val', 'a2'), imagePath('train', 'a2'));
    await fs.rename(labelPath('val', 'a2'), labelPath('train', 'a2'));
    assert.equal((await listDatasetImages()).filter((item) => item.trap === 'A' && item.desiredSplit !== item.split).length, 2);
    await reapplySplitOverrides();
    assert.equal((await listDatasetImages()).filter((item) => item.trap === 'A' && item.split === 'val').length, 2);
    await assert.rejects(() => moveTrap('C', 'val'), /sem imagens/);
    await moveTrap('A', 'train');
    assert.equal((await listDatasetImages()).filter((item) => item.trap === 'A' && item.split === 'train' && item.desiredSplit === 'train').length, 2);
  } finally {
    assert.ok(temp.startsWith(os.tmpdir() + path.sep));
    await fs.rm(temp, { recursive: true, force: true });
  }
});
