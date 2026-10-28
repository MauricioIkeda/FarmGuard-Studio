import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('concurrent annotation image readers share a complete download and failed downloads can retry', async () => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-image-loading-'));
  const originalFetch = globalThis.fetch;
  const oldRoot = process.env.FARMGUARD_ROOT;
  const oldData = process.env.STUDIO_DATA_ROOT;
  process.env.FARMGUARD_ROOT = path.join(fixture, 'FarmGuard');
  process.env.STUDIO_DATA_ROOT = path.join(fixture, 'data');
  try {
    const { imageFor } = await import('./annotation-source.js');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1cAAAAASUVORK5CYII=', 'base64');
    const source = { key: 'new-photo', image: 'new-photo.png', url: 'https://example.invalid/photo.png', metadata: {} };
    let downloads = 0;
    let finishDownload!: () => void;
    const hold = new Promise<void>((resolve) => { finishDownload = resolve; });
    globalThis.fetch = async () => {
      downloads += 1;
      await hold;
      return new Response(png);
    };
    const readers = Array.from({ length: 8 }, () => imageFor(source));
    await new Promise((resolve) => setTimeout(resolve, 30));
    await assert.rejects(fs.access(path.join(fixture, 'data', 'image-cache', 'new-photo.png')), { code: 'ENOENT' });
    finishDownload();
    const results = await Promise.all(readers);
    assert.equal(downloads, 1);
    assert.equal(new Set(results).size, 1);
    for (const result of results) assert.deepEqual(await fs.readFile(result), png);
    await imageFor(source);
    assert.equal(downloads, 1);

    const retry = { ...source, key: 'retry', image: 'retry.png' };
    globalThis.fetch = async () => new Response('unavailable', { status: 503 });
    await assert.rejects(imageFor(retry), /503/);
    await assert.rejects(fs.access(path.join(fixture, 'data', 'image-cache', 'retry.png')), { code: 'ENOENT' });
    globalThis.fetch = async () => new Response('invalid image');
    await assert.rejects(imageFor(retry));
    globalThis.fetch = async () => new Response(png);
    assert.deepEqual(await fs.readFile(await imageFor(retry)), png);
    assert.deepEqual((await fs.readdir(path.join(fixture, 'data', 'image-cache'))).sort(), ['new-photo.png', 'retry.png']);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldRoot === undefined) delete process.env.FARMGUARD_ROOT; else process.env.FARMGUARD_ROOT = oldRoot;
    if (oldData === undefined) delete process.env.STUDIO_DATA_ROOT; else process.env.STUDIO_DATA_ROOT = oldData;
    await fs.rm(fixture, { recursive: true, force: true });
  }
});
