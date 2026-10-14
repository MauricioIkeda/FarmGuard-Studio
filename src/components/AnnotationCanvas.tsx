import { useEffect, useRef, useState } from 'react';
import { Hand, Maximize, Minus, MousePointer2, Pencil, Plus, Scan } from 'lucide-react';
import type { Box } from '../types';
import { resizeHandleAt, resizeFromHandle, smallestBoxAt, type Point, type ResizeHandle } from '../annotation-geometry';

type Props = {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  boxes: Box[];
  ignoreRegions: Box[];
  selected: number | null;
  selectedIgnore: number | null;
  onSelected: (index: number | null) => void;
  onSelectedIgnore: (index: number | null) => void;
  onChange: (boxes: Box[]) => void;
  onIgnoreChange: (regions: Box[]) => void;
  onHistoryPoint: () => void;
};

type Gesture =
  | { type: 'draw'; start: Point; current: Point; screenStart: Point; kind: 'box' | 'ignore' }
  | { type: 'pan'; start: Point; originX: number; originY: number }
  | { type: 'move'; start: Point; original: Box; index: number; kind: 'box' | 'ignore' }
  | { type: 'resize'; start: Point; original: Box; index: number; kind: 'box' | 'ignore'; handle: ResizeHandle };

export function AnnotationCanvas({
  imageUrl,
  imageWidth,
  imageHeight,
  boxes,
  ignoreRegions,
  selected,
  selectedIgnore,
  onSelected,
  onSelectedIgnore,
  onChange,
  onIgnoreChange,
  onHistoryPoint,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1280, height: 820 });
  const [view, setView] = useState({ scale: 0.25, x: 20, y: 20 });
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [mode, setMode] = useState<'draw' | 'ignore' | 'edit' | 'pan'>(() => window.matchMedia('(pointer: coarse)').matches ? 'pan' : 'draw');
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ distance: number; scale: number; anchor: Point } | null>(null);
  const gestureEdited = useRef(false);

  const screenToImage = (point: Point) => ({
    x: (point.x - view.x) / view.scale,
    y: (point.y - view.y) / view.scale,
  });

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const observer = new ResizeObserver(() => {
      const bounds = shell.getBoundingClientRect();
      setCanvasSize({ width: Math.max(1, Math.round(bounds.width)), height: Math.max(1, Math.round(bounds.height)) });
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

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

  useEffect(() => { if (imageRef.current) fit(); }, [canvasSize.width, canvasSize.height, imageWidth, imageHeight]);

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
    const drawHandles = (box: Box, color: string) => {
      const size = 10 / view.scale;
      context.fillStyle = color;
      context.strokeStyle = '#06100b';
      context.lineWidth = 2 / view.scale;
      const handles = [
        [box.x, box.y], [box.x + box.width, box.y],
        [box.x, box.y + box.height], [box.x + box.width, box.y + box.height],
      ];
      if (box.width * view.scale >= 44 && box.height * view.scale >= 44) {
        handles.push([box.x + box.width / 2, box.y], [box.x + box.width / 2, box.y + box.height],
          [box.x, box.y + box.height / 2], [box.x + box.width, box.y + box.height / 2]);
      }
      for (const [x, y] of handles) {
        context.fillRect(x - size / 2, y - size / 2, size, size);
        context.strokeRect(x - size / 2, y - size / 2, size, size);
      }
    };
    boxes.forEach((box, index) => {
      context.strokeStyle = index === selected ? '#ffbd52' : '#78f0cc';
      context.lineWidth = (index === selected ? 4 : 2) / view.scale;
      context.strokeRect(box.x, box.y, box.width, box.height);
      if (index === selected) drawHandles(box, '#ffbd52');
    });
    ignoreRegions.forEach((region, index) => {
      context.fillStyle = 'rgba(244, 83, 83, 0.23)';
      context.fillRect(region.x, region.y, region.width, region.height);
      context.strokeStyle = index === selectedIgnore ? '#ffd36e' : '#ff6666';
      context.lineWidth = (index === selectedIgnore ? 4 : 2) / view.scale;
      context.strokeRect(region.x, region.y, region.width, region.height);
      if (index === selectedIgnore) drawHandles(region, '#ffd36e');
    });
    if (gesture?.type === 'draw') {
      const left = Math.min(gesture.start.x, gesture.current.x);
      const top = Math.min(gesture.start.y, gesture.current.y);
      context.setLineDash([10 / view.scale, 7 / view.scale]);
      context.strokeStyle = gesture.kind === 'ignore' ? '#ff6666' : '#b9f35a';
      context.lineWidth = 3 / view.scale;
      context.strokeRect(left, top, Math.abs(gesture.current.x - gesture.start.x), Math.abs(gesture.current.y - gesture.start.y));
    }
    context.restore();
  }, [boxes, ignoreRegions, selected, selectedIgnore, view, gesture, imageWidth, imageHeight, canvasSize]);

  const point = (
    event: React.PointerEvent<HTMLCanvasElement> | React.WheelEvent<HTMLCanvasElement>,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * event.currentTarget.width / rect.width,
      y: (event.clientY - rect.top) * event.currentTarget.height / rect.height,
    };
  };

  const zoom = (factor: number, cursor = { x: canvasSize.width / 2, y: canvasSize.height / 2 }) => {
    setView((current) => {
      const anchor = { x: (cursor.x - current.x) / current.scale, y: (cursor.y - current.y) / current.scale };
      const scale = Math.max(0.03, Math.min(64, current.scale * factor));
      return { scale, x: cursor.x - anchor.x * scale, y: cursor.y - anchor.y * scale };
    });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = canvas.getBoundingClientRect();
      const cursor = {
        x: (event.clientX - rect.left) * canvas.width / rect.width,
        y: (event.clientY - rect.top) * canvas.height / rect.height,
      };
      zoom(Math.exp(-event.deltaY * 0.001), cursor);
    };
    const stopPageGesture = (event: Event) => event.preventDefault();
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('gesturestart', stopPageGesture, { passive: false });
    canvas.addEventListener('gesturechange', stopPageGesture, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('gesturestart', stopPageGesture);
      canvas.removeEventListener('gesturechange', stopPageGesture);
    };
  }, [canvasSize]);

  const selectedHandle = (screen: Point, pointerType: string) => {
    const radius = pointerType === 'touch' ? 25 : 15;
    if (selected !== null && boxes[selected] && (mode === 'draw' || mode === 'edit')) {
      const handle = resizeHandleAt(screen, boxes[selected], view, radius);
      if (handle) return { kind: 'box' as const, index: selected, handle };
    }
    if (selectedIgnore !== null && ignoreRegions[selectedIgnore] && (mode === 'ignore' || mode === 'edit')) {
      const handle = resizeHandleAt(screen, ignoreRegions[selectedIgnore], view, radius);
      if (handle) return { kind: 'ignore' as const, index: selectedIgnore, handle };
    }
    return null;
  };

  const selectHit = (kind: 'box' | 'ignore', index: number | null) => {
    if (kind === 'box') { onSelected(index); onSelectedIgnore(null); }
    else { onSelectedIgnore(index); onSelected(null); }
  };

  const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const screen = point(event);
    pointers.current.set(event.pointerId, screen);
    if (event.pointerType === 'touch' && pointers.current.size === 2) {
      const [first, second] = [...pointers.current.values()];
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      pinch.current = { distance: Math.hypot(first.x - second.x, first.y - second.y), scale: view.scale, anchor: screenToImage(midpoint) };
      setGesture(null);
      gestureEdited.current = false;
      return;
    }
    if (pointers.current.size > 1) return;
    gestureEdited.current = false;
    const image = screenToImage(screen);
    if (mode === 'pan' || event.button === 1 || event.button === 2 || spaceDown) {
      setGesture({ type: 'pan', start: screen, originX: view.x, originY: view.y });
      return;
    }
    const handle = event.shiftKey && mode !== 'edit' ? null : selectedHandle(screen, event.pointerType);
    if (handle) {
      const original = handle.kind === 'box' ? boxes[handle.index] : ignoreRegions[handle.index];
      setGesture({ type: 'resize', start: image, original: { ...original },
        index: handle.index, kind: handle.kind, handle: handle.handle });
      return;
    }
    if (mode === 'edit') {
      const boxHit = smallestBoxAt(image, boxes);
      const ignoreHit = boxHit === null ? smallestBoxAt(image, ignoreRegions) : null;
      if (boxHit !== null || ignoreHit !== null) {
        const kind = boxHit !== null ? 'box' : 'ignore';
        const index = (boxHit ?? ignoreHit)!;
        selectHit(kind, index);
        const original = kind === 'box' ? boxes[index] : ignoreRegions[index];
        setGesture({ type: 'move', start: image, original: { ...original }, index, kind });
      } else { onSelected(null); onSelectedIgnore(null); setGesture(null); }
      return;
    }
    const kind = mode === 'ignore' ? 'ignore' : 'box';
    const items = kind === 'ignore' ? ignoreRegions : boxes;
    const active = kind === 'ignore' ? selectedIgnore : selected;
    if (!event.shiftKey && active !== null && smallestBoxAt(image, items) === active) {
      setGesture({ type: 'move', start: image, original: { ...items[active] }, index: active, kind });
      return;
    }
    setGesture({ type: 'draw', start: image, current: image, screenStart: screen, kind });
  };

  const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(event.pointerId)) {
      if (event.pointerType === 'mouse') {
        const screen = point(event);
        const handle = selectedHandle(screen, event.pointerType);
        const image = screenToImage(screen);
        const active = mode === 'ignore' ? selectedIgnore : selected;
        const items = mode === 'ignore' ? ignoreRegions : boxes;
        const overActive = active !== null && smallestBoxAt(image, items) === active;
        const overAny = smallestBoxAt(image, boxes) !== null || smallestBoxAt(image, ignoreRegions) !== null;
        event.currentTarget.style.cursor = handle
          ? (handle.handle === 'left' || handle.handle === 'right' ? 'ew-resize'
            : handle.handle === 'top' || handle.handle === 'bottom' ? 'ns-resize'
              : handle.handle === 'top-left' || handle.handle === 'bottom-right' ? 'nwse-resize' : 'nesw-resize')
          : mode === 'pan' ? 'grab' : (mode === 'edit' && overAny) || overActive ? 'move' : 'crosshair';
      }
      return;
    }
    const screen = point(event);
    pointers.current.set(event.pointerId, screen);
    if (pinch.current && pointers.current.size >= 2) {
      const [first, second] = [...pointers.current.values()];
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const scale = Math.max(0.03, Math.min(64, pinch.current.scale * Math.hypot(first.x - second.x, first.y - second.y) / Math.max(1, pinch.current.distance)));
      setView({ scale, x: midpoint.x - pinch.current.anchor.x * scale, y: midpoint.y - pinch.current.anchor.y * scale });
      return;
    }
    if (!gesture) return;
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
    if (!gestureEdited.current && Math.hypot(dx, dy) * view.scale < (event.pointerType === 'touch' ? 8 : 4)) return;
    const updated = [...(gesture.kind === 'ignore' ? ignoreRegions : boxes)];
    if (gesture.type === 'move') {
      updated[gesture.index] = {
        ...gesture.original,
        x: Math.max(0, Math.min(imageWidth - gesture.original.width, gesture.original.x + dx)),
        y: Math.max(0, Math.min(imageHeight - gesture.original.height, gesture.original.y + dy)),
      };
    } else {
      updated[gesture.index] = resizeFromHandle(gesture.original, gesture.handle, dx, dy, imageWidth, imageHeight);
    }
    if (updated[gesture.index].x === (gesture.kind === 'ignore' ? ignoreRegions : boxes)[gesture.index].x &&
      updated[gesture.index].y === (gesture.kind === 'ignore' ? ignoreRegions : boxes)[gesture.index].y &&
      updated[gesture.index].width === (gesture.kind === 'ignore' ? ignoreRegions : boxes)[gesture.index].width &&
      updated[gesture.index].height === (gesture.kind === 'ignore' ? ignoreRegions : boxes)[gesture.index].height) return;
    if (!gestureEdited.current) { onHistoryPoint(); gestureEdited.current = true; }
    if (gesture.kind === 'ignore') onIgnoreChange(updated);
    else onChange(updated);
  };

  const pointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(event.pointerId);
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null;
      setGesture(null);
      return;
    }
    if (gesture?.type === 'draw') {
      const screen = point(event);
      const items = gesture.kind === 'ignore' ? ignoreRegions : boxes;
      if (Math.hypot(screen.x - gesture.screenStart.x, screen.y - gesture.screenStart.y) < (event.pointerType === 'touch' ? 10 : 5)) {
        selectHit(gesture.kind, smallestBoxAt(screenToImage(screen), items));
        setGesture(null);
        return;
      }
      const end = screenToImage(screen);
      const startX = Math.max(0, Math.min(imageWidth, gesture.start.x));
      const startY = Math.max(0, Math.min(imageHeight, gesture.start.y));
      const endX = Math.max(0, Math.min(imageWidth, end.x));
      const endY = Math.max(0, Math.min(imageHeight, end.y));
      const x = Math.min(startX, endX);
      const y = Math.min(startY, endY);
      const width = Math.abs(endX - startX);
      const height = Math.abs(endY - startY);
      if (width >= 4 && height >= 4) {
        onHistoryPoint();
        if (gesture.kind === 'ignore') {
          onIgnoreChange([...ignoreRegions, { x, y, width, height }]);
          onSelectedIgnore(ignoreRegions.length); onSelected(null);
        } else {
          onChange([...boxes, { x, y, width, height }]);
          onSelected(boxes.length); onSelectedIgnore(null);
        }
      }
    }
    setGesture(null);
  };

  return (
    <div className="canvas-frame">
      <div className="canvas-tools" aria-label="Ferramentas de anotação">
        <div className="canvas-modes">
          <button type="button" className={mode === 'draw' ? 'active' : ''} aria-pressed={mode === 'draw'} onClick={() => setMode('draw')}><Pencil size={17} />Marcar</button>
          <button type="button" className={mode === 'ignore' ? 'active' : ''} aria-pressed={mode === 'ignore'} onClick={() => setMode('ignore')}><Scan size={17} />Ignorar área</button>
          <button type="button" className={mode === 'edit' ? 'active' : ''} aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}><MousePointer2 size={17} />Editar boxes</button>
          <button type="button" className={mode === 'pan' ? 'active' : ''} aria-pressed={mode === 'pan'} onClick={() => setMode('pan')}><Hand size={17} />Mover</button>
        </div>
        <div className="canvas-zoom">
          <button type="button" aria-label="Diminuir zoom" onClick={() => zoom(1 / 1.4)}><Minus size={18} /></button>
          <button type="button" aria-label="Ajustar imagem" onClick={fit}><Maximize size={17} /></button>
          <button type="button" aria-label="Aumentar zoom" onClick={() => zoom(1.4)}><Plus size={18} /></button>
        </div>
      </div>
      <div className="canvas-shell" ref={shellRef}>
      <canvas
        ref={canvasRef}
        width={canvasSize.width}
        height={canvasSize.height}
        aria-label="Imagem para marcação de insetos"
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={(event) => { pointers.current.delete(event.pointerId); pinch.current = null; setGesture(null); }}
      />
      </div>
      <div className="canvas-instructions">Toque numa box para selecioná-la. Arraste seu interior para mover, ou qualquer ponto da borda para redimensionar. Em Marcar, arraste fora da box selecionada para criar outra; Shift + arrastar força uma nova box por cima. Dois dedos aproximam e arrastam a foto.</div>
    </div>
  );
}
