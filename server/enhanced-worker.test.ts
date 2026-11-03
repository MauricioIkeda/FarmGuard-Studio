import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { EnhancedWorker } from './enhanced-worker.js';
import type { InferenceSettings } from './model-management.js';

const settings = { modelSha256: 'fixture', imgsz: 1280, confidence: .33, nmsIou: .17, maxDet: 1000 } as InferenceSettings;

async function fixture(t: TestContext, timeout = 1500, idle = 10_000) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-worker-'));
  const script = path.join(directory, 'worker.mjs');
  await fs.writeFile(script, `import readline from 'node:readline';
for await (const line of readline.createInterface({input:process.stdin})) {
  const request=JSON.parse(line);
  if(request.image==='stall') continue;
  const response=request.image==='error' ? {ok:false,error:'fixture failure'} :
    {ok:true,result:{model:String(process.pid),width:100,height:100,detections:[]}};
  console.log(JSON.stringify({id:request.id,...response}));
}
`);
  const worker = new EnhancedWorker(process.execPath, script, directory, timeout, idle);
  t.after(async () => {
    worker.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return worker;
}

test('reuses the worker between successful requests', async (t) => {
  const worker = await fixture(t);
  const first = await worker.run('first', settings);
  const second = await worker.run('second', settings);
  assert.equal(first.model, second.model);
  assert.deepEqual(first.detections, second.detections);
});

test('kills stalled work and recovers on the next request', async (t) => {
  const worker = await fixture(t);
  const first = await worker.run('first', settings);
  await assert.rejects(worker.run('stall', settings), /tempo limite/);
  const second = await worker.run('second', settings);
  assert.notEqual(first.model, second.model);
});

test('releases idle processes and loads again when needed', async (t) => {
  const worker = await fixture(t, 1500, 60);
  const first = await worker.run('first', settings);
  await delay(160);
  const second = await worker.run('second', settings);
  assert.notEqual(first.model, second.model);
});

test('recovers after prediction failures and rejects simultaneous work', async (t) => {
  const worker = await fixture(t);
  await assert.rejects(worker.run('error', settings), /fixture failure/);
  const request = worker.run('first', settings);
  await assert.rejects(worker.run('second', settings), /já está analisando/);
  assert.equal((await request).width, 100);
});
