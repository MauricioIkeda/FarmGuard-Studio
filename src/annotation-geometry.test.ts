import assert from 'node:assert/strict';
import test from 'node:test';
import { resizeHandleAt, resizeFromHandle, smallestBoxAt } from './annotation-geometry';

test('selects the smaller insect box when pre-marked boxes overlap', () => {
  const boxes = [{ x: 10, y: 10, width: 90, height: 90 }, { x: 40, y: 40, width: 12, height: 12 }];
  assert.equal(smallestBoxAt({ x: 45, y: 45 }, boxes), 1);
  assert.equal(smallestBoxAt({ x: 20, y: 20 }, boxes), 0);
});

test('finds a resize handle just outside the selected box', () => {
  const box = { x: 100, y: 100, width: 20, height: 30 };
  const view = { scale: 2, x: 5, y: 10 };
  assert.equal(resizeHandleAt({ x: 205, y: 210 }, box, view, 18), 'top-left');
  assert.equal(resizeHandleAt({ x: 245, y: 270 }, box, view, 18), 'bottom-right');
});

test('finds the entire border while preserving a center area for moving', () => {
  const box = { x: 10, y: 20, width: 100, height: 80 };
  const view = { scale: 1, x: 0, y: 0 };
  assert.equal(resizeHandleAt({ x: 10, y: 60 }, box, view, 12), 'left');
  assert.equal(resizeHandleAt({ x: 110, y: 60 }, box, view, 12), 'right');
  assert.equal(resizeHandleAt({ x: 60, y: 20 }, box, view, 12), 'top');
  assert.equal(resizeHandleAt({ x: 60, y: 100 }, box, view, 12), 'bottom');
  assert.equal(resizeHandleAt({ x: 60, y: 60 }, box, view, 12), null);
  assert.equal(resizeHandleAt({ x: 15, y: 15 }, { x: 10, y: 10, width: 10, height: 10 }, view, 15), null);
});

test('resizes all corners and edges while keeping the opposite side fixed', () => {
  const box = { x: 10, y: 20, width: 30, height: 40 };
  assert.deepEqual(resizeFromHandle(box, 'top-left', 5, 6, 100, 100), { x: 15, y: 26, width: 25, height: 34 });
  assert.deepEqual(resizeFromHandle(box, 'top-right', 5, 6, 100, 100), { x: 10, y: 26, width: 35, height: 34 });
  assert.deepEqual(resizeFromHandle(box, 'bottom-left', 5, 6, 100, 100), { x: 15, y: 20, width: 25, height: 46 });
  assert.deepEqual(resizeFromHandle(box, 'bottom-right', 5, 6, 100, 100), { x: 10, y: 20, width: 35, height: 46 });
  assert.deepEqual(resizeFromHandle(box, 'left', 5, 6, 100, 100), { x: 15, y: 20, width: 25, height: 40 });
  assert.deepEqual(resizeFromHandle(box, 'bottom', 5, 6, 100, 100), { x: 10, y: 20, width: 30, height: 46 });
  assert.equal(resizeFromHandle(box, 'top-left', 200, 200, 100, 100).width, 4);
});
