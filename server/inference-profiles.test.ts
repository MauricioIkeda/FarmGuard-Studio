import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enhancedSettings } from './inference-profiles.js';
import type { InferenceSettings } from './model-management.js';

const published: InferenceSettings = { confidence: .33, nmsIou: .17, imgsz: 1280, maxDet: 1000,
  source: 'promoted', modelSha256: 'ABC123' };
const profile = { model_sha256: 'abc123', imgsz: 1600, confidence: .25, nms_iou: .4, max_det: 1000, augment: true };

test('legacy enhanced inference retains its original settings', () => {
  assert.deepEqual(enhancedSettings(published, {}), published);
});

test('enhanced profile can use separately validated resolution and thresholds for the same weight', () => {
  const result = enhancedSettings(published, { annotation_profiles: { enhanced: profile } });
  assert.deepEqual(result, { ...published, imgsz: 1600, confidence: .25, nmsIou: .4 });
  assert.equal(published.imgsz, 1280);
});

test('stale weights or invalid enhanced settings are rejected', () => {
  for (const change of [{ model_sha256: 'other' }, { augment: false }, { imgsz: 1601 },
    { confidence: Number.NaN }, { nms_iou: 1.1 }, { max_det: 2000 }]) {
    assert.throws(() => enhancedSettings(published, { annotation_profiles: { enhanced: { ...profile, ...change } } }));
  }
  for (const invalid of [null, [], 'invalid', { enhanced: null }]) {
    assert.throws(() => enhancedSettings(published, { annotation_profiles: invalid }));
  }
});
