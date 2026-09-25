import assert from 'node:assert/strict';
import test from 'node:test';
import type { Job } from './types';
import { mergeJobs } from './job-sync';

const base: Job = { id: 'one', type: 'predict', status: 'queued', createdAt: '2026-09-25T04:15:09Z',
  command: ['python', 'predict.py'], logs: [], logCount: 0 };

test('an old creation response cannot replace a completed streamed job', () => {
  const complete: Job = { ...base, status: 'completed', finishedAt: '2026-09-25T04:15:15Z',
    logs: ['12 images', 'Total: 726 deteccoes'], logCount: 2, exitCode: 0 };
  const merged = mergeJobs([complete], [base]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, 'completed');
  assert.equal(merged[0].logs.length, 2);
});

test('newer progress wins, including when saved logs are capped', () => {
  const old: Job = { ...base, status: 'running', logs: ['old'], logCount: 1500 };
  const next: Job = { ...base, status: 'running', logs: ['new'], logCount: 1501 };
  assert.deepEqual(mergeJobs([old], [next])[0].logs, ['new']);
  assert.deepEqual(mergeJobs([next], [old])[0].logs, ['new']);
});
