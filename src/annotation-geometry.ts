import type { Box } from './types';

export type Point = { x: number; y: number };
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type ResizeHandle = Corner | 'top' | 'right' | 'bottom' | 'left';
export type View = { scale: number; x: number; y: number };

export function smallestBoxAt(point: Point, boxes: Box[]): number | null {
  let match: number | null = null;
  let area = Number.POSITIVE_INFINITY;
  boxes.forEach((box, index) => {
    if (point.x < box.x || point.x > box.x + box.width || point.y < box.y || point.y > box.y + box.height) return;
    const candidateArea = box.width * box.height;
    if (candidateArea <= area) { match = index; area = candidateArea; }
  });
  return match;
}

export function resizeHandleAt(screen: Point, box: Box, view: View, radius: number): ResizeHandle | null {
  const left = view.x + box.x * view.scale;
  const top = view.y + box.y * view.scale;
  const right = left + box.width * view.scale;
  const bottom = top + box.height * view.scale;
  const interiorX = Math.min(radius, (right - left) * 0.15);
  const interiorY = Math.min(radius, (bottom - top) * 0.15);
  if (screen.x > left + interiorX && screen.x < right - interiorX &&
      screen.y > top + interiorY && screen.y < bottom - interiorY) return null;
  const corners: Array<[Corner, number, number]> = [
    ['top-left', left, top], ['top-right', right, top],
    ['bottom-left', left, bottom], ['bottom-right', right, bottom],
  ];
  let match: Corner | null = null;
  let distance = radius;
  for (const [corner, x, y] of corners) {
    const candidate = Math.hypot(screen.x - x, screen.y - y);
    if (candidate <= distance) { match = corner; distance = candidate; }
  }
  if (match) return match;
  const edgeRadius = Math.min(radius, Math.max(2, Math.min(right - left, bottom - top) / 4));
  const edges: Array<[ResizeHandle, number]> = [];
  if (screen.y >= top && screen.y <= bottom) {
    edges.push(['left', Math.abs(screen.x - left)], ['right', Math.abs(screen.x - right)]);
  }
  if (screen.x >= left && screen.x <= right) {
    edges.push(['top', Math.abs(screen.y - top)], ['bottom', Math.abs(screen.y - bottom)]);
  }
  edges.sort((a, b) => a[1] - b[1]);
  return edges[0]?.[1] <= edgeRadius ? edges[0][0] : null;
}

export function resizeFromHandle(box: Box, handle: ResizeHandle, dx: number, dy: number, imageWidth: number, imageHeight: number): Box {
  const left = box.x;
  const top = box.y;
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
  const nextLeft = handle.endsWith('left') ? clamp(left + dx, 0, right - 4) : left;
  const nextRight = handle.endsWith('right') ? clamp(right + dx, left + 4, imageWidth) : right;
  const nextTop = handle.startsWith('top') ? clamp(top + dy, 0, bottom - 4) : top;
  const nextBottom = handle.startsWith('bottom') ? clamp(bottom + dy, top + 4, imageHeight) : bottom;
  return { ...box, x: nextLeft, y: nextTop, width: nextRight - nextLeft, height: nextBottom - nextTop };
}
