import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateAnnotation, EvaluationInputError } from './annotation-evaluation.js';
import type { Annotation } from './farmguard.js';

const annotation: Annotation = { schema_version: 4, key: 'fixture', image: 'fixture.jpg', width: 100, height: 100,
  reviewed: true, excluded: false, class: 'insect', boxes: [{ x: 0, y: 0, width: 10, height: 10 }],
  ignore_regions: [{ x: 0, y: 0, width: 30, height: 30 }] };
const inference = { modelSha256: 'TEST', imgsz: 1280, confidence: .33, nmsIou: .17, maxDet: 1000, source: 'promoted' as const };
const prediction = { key: 'fixture', model: 'fixture', mode: 'standard' as const,
  inference, boxes: [], detections: [] };

test('read-only evaluation uses the saved reference without replacing boxes or rewriting legacy regions', async () => {
  const before = JSON.stringify(annotation);
  const result = await evaluateAnnotation('fixture', 'standard', {
    read: async () => structuredClone(annotation),
    predict: async () => prediction,
    measure: async (reference, detections) => {
      assert.deepEqual(reference, annotation);
      assert.deepEqual(detections, []);
      return { counts: { tp: 0, fp: 0, fn: 1, ignored: 0 } };
    },
  });
  assert.deepEqual(result.annotation.boxes, annotation.boxes);
  assert.match(result.referenceHash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(annotation), before);
});

test('evaluation rejects unreviewed images before inference and rejects references changed during inference', async () => {
  let calls = 0;
  const dependencies = { read: async () => ({ ...annotation, reviewed: false }),
    predict: async () => { calls += 1; return prediction; }, measure: async () => ({}) };
  await assert.rejects(evaluateAnnotation('fixture', 'standard', dependencies), /Conclua a revisão/);
  assert.equal(calls, 0);
  let reads = 0;
  await assert.rejects(evaluateAnnotation('fixture', 'standard', { ...dependencies,
    read: async () => ({ ...annotation, boxes: reads++ ? [] : annotation.boxes }),
  }), (error) => error instanceof EvaluationInputError && error.status === 409);
});
