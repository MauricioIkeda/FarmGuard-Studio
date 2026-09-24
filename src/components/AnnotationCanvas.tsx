import { useEffect, useRef, useState } from 'react';
import type { Box } from '../types';

type Props = {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  boxes: Box[];
  selected: number | null;
  onSelected: (index: number | null) => void;
  onChange: (boxes: Box[]) => void;
  onHistoryPoint: () => void;
};

type Point = { x: number; y: number };
type Gesture =
  | { type: 'draw'; start: Point; current: Point }
  | { type: 'pan'; start: Point; originX: number; originY: number }
  | { type: 'move'; start: Point; original: Box; index: number }
  | { type: 'resize'; start: Point; original: Box; index: number };

export function AnnotationCanvas({
  imageUrl,
  imageWidth,
  imageHeight,
  boxes,
  selected,
  onSelected,
  onChange,
  onHistoryPoint,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [view, setView] = useState({ scale: 0.25, x: 20, y: 20 });
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);

  const screenToImage = (point: Point) => ({
    x: (point.x - view.x) / view.scale,
    y: (point.y - view.y) / view.scale,
  });

  const fit = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scale = Math.min((canvas.width - 40) / imageWidth, (canvas.height - 40) / imageHeight);
    setView({
      scale: Math.max(0.03, scale),
      x: (canvas.width - imageWidth * scale) / 2,
      y: (canvas.height - imageHeight * scale) / 2,
    });
  };

  useEffect(() => {
    const image = new Image();
    image.src = imageUrl;
    image.onload = () => {
      imageRef.current = image;
      fit();
    };
    return () => {
      imageRef.current = null;
    };
  }, [imageUrl, imageWidth, imageHeight]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceDown(event.type === 'keydown');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#050806';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.translate(view.x, view.y);
    context.scale(view.scale, view.scale);
    if (image) context.drawImage(image, 0, 0, imageWidth, imageHeight);
    boxes.forEach((box, index) => {
      context.strokeStyle = index === selected ? '#ffbd52' : '#78f0cc';
      context.lineWidth = (index === selected ? 4 : 2) / view.scale;
      context.strokeRect(box.x, box.y, box.width, box.height);
      if (index === selected) {
        const size = 12 / view.scale;
        context.fillStyle = '#ffbd52';
        context.fillRect(box.x + box.width - size / 2, box.y + box.height - size / 2, size, size);
      }
    });
    if (gesture?.type === 'draw') {
      const left = Math.min(gesture.start.x, gesture.current.x);
      const top = Math.min(gesture.start.y, gesture.current.y);
      context.setLineDash([10 / view.scale, 7 / view.scale]);
      context.strokeStyle = '#b9f35a';
      context.lineWidth = 3 / view.scale;
      context.strokeRect(left, top, Math.abs(gesture.current.x - gesture.start.x), Math.abs(gesture.current.y - gesture.start.y));
    }
    context.restore();
  }, [boxes, selected, view, gesture, imageWidth, imageHeight]);

  const point = (
    event: React.PointerEvent<HTMLCanvasElement> | React.WheelEvent<HTMLCanvasElement>,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const hitIndex = (imagePoint: Point) => {
    for (let index = boxes.length - 1; index >= 0; index -= 1) {
      const box = boxes[index];
      if (
        imagePoint.x >= box.x && imagePoint.x <= box.x + box.width &&
        imagePoint.y >= box.y && imagePoint.y <= box.y + box.height
      ) return index;
    }
    return null;
  };

  const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const screen = point(event);
    const image = screenToImage(screen);
    if (event.button === 1 || event.button === 2 || spaceDown) {
      setGesture({ type: 'pan', start: screen, originX: view.x, originY: view.y });
      return;
    }
    const hit = hitIndex(image);
    if (hit !== null) {
      onSelected(hit);
      onHistoryPoint();
      const box = boxes[hit];
      const handle = Math.hypot(image.x - (box.x + box.width), image.y - (box.y + box.height)) < 22 / view.scale;
      setGesture({ type: handle ? 'resize' : 'move', start: image, original: { ...box }, index: hit });
      return;
    }
    onSelected(null);
    onHistoryPoint();
    setGesture({ type: 'draw', start: image, current: image });
  };

  const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!gesture) return;
    const screen = point(event);
    const image = screenToImage(screen);
    if (gesture.type === 'pan') {
      setView((current) => ({ ...current, x: gesture.originX + screen.x - gesture.start.x, y: gesture.originY + screen.y - gesture.start.y }));
      return;
    }
    if (gesture.type === 'draw') {
      setGesture({ ...gesture, current: image });
      return;
    }
    const dx = image.x - gesture.start.x;
    const dy = image.y - gesture.start.y;
    const updated = [...boxes];
    if (gesture.type === 'move') {
      updated[gesture.index] = {
        ...gesture.original,
        x: Math.max(0, Math.min(imageWidth - gesture.original.width, gesture.original.x + dx)),
        y: Math.max(0, Math.min(imageHeight - gesture.original.height, gesture.original.y + dy)),
      };
    } else {
      updated[gesture.index] = {
        ...gesture.original,
        width: Math.max(4, Math.min(imageWidth - gesture.original.x, gesture.original.width + dx)),
        height: Math.max(4, Math.min(imageHeight - gesture.original.y, gesture.original.height + dy)),
      };
    }
    onChange(updated);
  };

  const pointerUp = () => {
    if (gesture?.type === 'draw') {
      const x = Math.max(0, Math.min(gesture.start.x, gesture.current.x));
      const y = Math.max(0, Math.min(gesture.start.y, gesture.current.y));
      const width = Math.min(imageWidth - x, Math.abs(gesture.current.x - gesture.start.x));
      const height = Math.min(imageHeight - y, Math.abs(gesture.current.y - gesture.start.y));
      if (width >= 4 && height >= 4) {
        onChange([...boxes, { x, y, width, height }]);
        onSelected(boxes.length);
      }
    }
    setGesture(null);
  };

  const wheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const cursor = point(event);
    const before = screenToImage(cursor);
    const nextScale = Math.max(0.03, Math.min(12, view.scale * Math.exp(-event.deltaY * 0.001)));
    setView({ scale: nextScale, x: cursor.x - before.x * nextScale, y: cursor.y - before.y * nextScale });
  };

  return (
    <div className="canvas-shell">
      <canvas
        ref={canvasRef}
        width={1280}
        height={820}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onWheel={wheel}
      />
      <button type="button" className="canvas-fit" onClick={fit}>Ajustar imagem</button>
      <div className="canvas-hint">Arraste para marcar · Clique e arraste uma box para mover · canto para redimensionar · botão direito para navegar · roda para zoom</div>
    </div>
  );
}
