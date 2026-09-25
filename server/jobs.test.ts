import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('restores completed jobs and marks an untracked running job as interrupted', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'farmguard-studio-jobs-test-'));
  process.env.STUDIO_DATA_ROOT = temp;
  const root = path.join(temp, 'jobs');
  await fs.mkdir(root);
  const completed = { id: '11111111-1111-4111-8111-111111111111', type: 'train', status: 'completed',
    createdAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:01:00Z',
    command: ['python', 'train.py'], logs: ['finished'], exitCode: 0 };
  const running = { ...completed, id: '22222222-2222-4222-8222-222222222222', status: 'running',
    finishedAt: undefined, logs: ['epoch 1'] };
  try {
    await fs.writeFile(path.join(root, `${completed.id}.json`), JSON.stringify(completed));
    await fs.writeFile(path.join(root, `${running.id}.json`), JSON.stringify(running));
    const { loadPersistedJobs, listJobs } = await import('./jobs.js');
    await loadPersistedJobs();
    const jobs = listJobs();
    assert.equal(jobs.length, 2);
    assert.equal(jobs.find((job) => job.id === completed.id)?.status, 'completed');
    assert.equal(jobs.find((job) => job.id === running.id)?.status, 'interrupted');
    assert.match(jobs.find((job) => job.id === running.id)?.logs.at(-1) || '', /reinício/);
    assert.equal(JSON.parse(await fs.readFile(path.join(root, `${running.id}.json`), 'utf8')).status, 'interrupted');
  } finally {
    assert.ok(temp.startsWith(os.tmpdir() + path.sep));
    await fs.rm(temp, { recursive: true, force: true });
  }
});
