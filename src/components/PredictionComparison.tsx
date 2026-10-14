import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, Minus, Plus, RefreshCw, X } from 'lucide-react';
import { api } from '../api';
import type { Prediction, PredictionDetections } from '../types';

type View = { zoom: number; x: number; y: number };
const imageUrl = (group: string, file: string) => `/api/predictions/${encodeURIComponent(group)}/${encodeURIComponent(file)}`;
const thumbUrl = (group: string, file: string) => `/api/prediction-thumbnails/${encodeURIComponent(group)}/${encodeURIComponent(file)}`;
const uncertainImage = '4cdb44d3-01be-11f1-bfd8-714d57fb7ac5.jpg';

export function PredictionComparison({ predictions }: { predictions: Prediction[] }) {
  const names = predictions.map((item) => item.name);
  const initialLeft = names.find((name) => name === 'detector-v3-yellow-sticky-ignore-predict') || names[0] || '';
  const initialRight = names.find((name) => name === 'detector-v3-yellow-sticky-normal-predict') || names.find((name) => name !== initialLeft) || '';
  const [left, setLeft] = useState(initialLeft);
  const [right, setRight] = useState(initialRight);
  const [leftFiles, setLeftFiles] = useState<string[]>([]);
  const [rightFiles, setRightFiles] = useState<string[]>([]);
  const [file, setFile] = useState('');
  const [detectionLayers, setDetectionLayers] = useState<Array<PredictionDetections | null> | null>(null);
  const [cleanBoxes, setCleanBoxes] = useState(false);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDistance = useRef<number | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const common = useMemo(() => {
    const rightSet = new Set(rightFiles);
    return leftFiles.filter((item) => rightSet.has(item)).sort((a, b) =>
      Number(b === uncertainImage) - Number(a === uncertainImage) || a.localeCompare(b));
  }, [leftFiles, rightFiles]);

  useEffect(() => {
    let cancelled = false;
    if (!left || !right || left === right) { setLeftFiles([]); setRightFiles([]); return; }
    setLoading(true); setError('');
    void Promise.all([api.predictionFiles(left), api.predictionFiles(right)])
      .then(([a, b]) => { if (!cancelled) { setLeftFiles(a); setRightFiles(b); } })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Falha ao ler as galerias.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [left, right]);

  useEffect(() => {
    if (!common.length) { setFile(''); return; }
    if (!common.includes(file)) setFile(common[0]);
  }, [common, file]);
  useEffect(() => { setView({ zoom: 1, x: 0, y: 0 }); }, [file]);
  useEffect(() => {
    let current = true;
    setDetectionLayers(null);
    setCleanBoxes(false);
    if (!file || !left || !right || left === right) return;
    void Promise.all([left, right].map((group) => api.predictionDetections(group, file).catch(() => null)))
      .then((layers) => { if (current) { setDetectionLayers(layers); setCleanBoxes(layers.every(Boolean)); } });
    return () => { current = false; };
  }, [left, right, file]);
  useEffect(() => {
    if (!expanded) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
      if (event.key === 'ArrowRight') changeFile(1);
      if (event.key === 'ArrowLeft') changeFile(-1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * .001), event.clientX - rect.left, event.clientY - rect.top);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    const stopPageGesture = (event: Event) => event.preventDefault();
    element.addEventListener('gesturestart', stopPageGesture, { passive: false });
    element.addEventListener('gesturechange', stopPageGesture, { passive: false });
    return () => {
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('gesturestart', stopPageGesture);
      element.removeEventListener('gesturechange', stopPageGesture);
    };
  }, [expanded, file]);

  function changeFile(step: number) {
    const index = common.indexOf(file);
    if (index >= 0) setFile(common[(index + step + common.length) % common.length]);
  }
  function zoomAt(factor: number, x?: number, y?: number) {
    const rect = stage.current?.getBoundingClientRect();
    const stacked = window.matchMedia('(max-width: 700px)').matches;
    const panelWidth = (rect?.width || 0) / (stacked ? 1 : 2);
    const panelHeight = (rect?.height || 0) / (stacked ? 2 : 1);
    const cx = x === undefined ? panelWidth / 2 : x % panelWidth;
    const cy = y === undefined ? panelHeight / 2 : y % panelHeight;
    setView((current) => {
      const zoom = Math.max(1, Math.min(64, current.zoom * factor));
      const ratio = zoom / current.zoom;
      return { zoom, x: current.x + (1 - ratio) * (cx - panelWidth / 2 - current.x),
        y: current.y + (1 - ratio) * (cy - panelHeight / 2 - current.y) };
    });
  }
  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchDistance.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const next = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDistance.current) {
        const rect = stage.current?.getBoundingClientRect();
        zoomAt(next / pinchDistance.current,
          (a.x + b.x) / 2 - (rect?.left || 0), (a.y + b.y) / 2 - (rect?.top || 0));
      }
      pinchDistance.current = next;
    } else setView((current) => ({ ...current, x: current.x + event.clientX - previous.x, y: current.y + event.clientY - previous.y }));
  };
  const pointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchDistance.current = null;
  };

  if (names.length < 2) return null;
  return <section className="panel prediction-compare-panel">
    <div className="panel-head"><div><span className="eyebrow">Inspeção pareada</span><h2>Comparar predições, foto por foto</h2></div><span className="status-pill neutral">{common.length} fotos em comum</span></div>
    <div className="prediction-compare-selectors"><label>Modelo A<select value={left} onChange={(event) => setLeft(event.target.value)}>{names.map((name) => <option key={name} value={name}>{name}</option>)}</select></label><label>Modelo B<select value={right} onChange={(event) => setRight(event.target.value)}>{names.map((name) => <option key={name} value={name}>{name}</option>)}</select></label></div>
    {left === right && <p className="prediction-compare-hint">Escolha duas galerias diferentes.</p>}
    {error && <p className="prediction-compare-hint">{error}</p>}
    {loading && <p className="prediction-compare-hint">Carregando galerias…</p>}
    {!loading && left !== right && !common.length && !error && <p className="prediction-compare-hint">Essas galerias não têm fotos com o mesmo nome.</p>}
    {file && <><div className="prediction-compare-strip">{common.map((item) => <button key={item} className={item === file ? 'active' : ''} onClick={() => setFile(item)} title={item}><img src={thumbUrl(left, item)} alt="" loading="lazy" />{item === uncertainImage && <span>Áreas incertas</span>}</button>)}</div>
      <div className="prediction-compare-toolbar"><div><button className="icon-button" onClick={() => changeFile(-1)} aria-label="Foto anterior"><ChevronLeft /></button><button className="icon-button" onClick={() => changeFile(1)} aria-label="Próxima foto"><ChevronRight /></button><span title={file}>{file}</span></div><div>{detectionLayers?.every(Boolean) && <button className="prediction-clean-button" onClick={() => setCleanBoxes((value) => !value)}>{cleanBoxes ? 'Boxes limpas' : 'IA original'}</button>}<button className="icon-button" onClick={() => zoomAt(1 / 1.4)} aria-label="Diminuir zoom"><Minus /></button><span>{Math.round(view.zoom * 100)}%</span><button className="icon-button" onClick={() => zoomAt(1.4)} aria-label="Aumentar zoom"><Plus /></button><button className="icon-button" onClick={() => setView({ zoom: 1, x: 0, y: 0 })} aria-label="Reajustar imagens"><RefreshCw /></button><button className="icon-button" onClick={() => setExpanded((value) => !value)} aria-label={expanded ? 'Fechar tela cheia' : 'Abrir tela cheia'}>{expanded ? <X /> : <Maximize2 />}</button></div></div>
      <div className={expanded ? 'prediction-compare-fullscreen' : ''}>
        {expanded && <div className="prediction-compare-fullscreen-head"><strong>{file}</strong><div>{detectionLayers?.every(Boolean) && <button className="prediction-clean-button" onClick={() => setCleanBoxes((value) => !value)}>{cleanBoxes ? 'Boxes limpas' : 'IA original'}</button>}<button className="icon-button" onClick={() => changeFile(-1)} aria-label="Foto anterior"><ChevronLeft /></button><button className="icon-button" onClick={() => changeFile(1)} aria-label="Próxima foto"><ChevronRight /></button><button className="icon-button" onClick={() => zoomAt(1 / 1.4)} aria-label="Diminuir zoom"><Minus /></button><span>{Math.round(view.zoom * 100)}%</span><button className="icon-button" onClick={() => zoomAt(1.4)} aria-label="Aumentar zoom"><Plus /></button><button className="icon-button" onClick={() => setView({ zoom: 1, x: 0, y: 0 })} aria-label="Reajustar imagens"><RefreshCw /></button><button className="icon-button" onClick={() => setExpanded(false)} aria-label="Fechar tela cheia"><X /></button></div></div>}
        <div ref={stage} className="prediction-compare-stage" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
          {!detectionLayers && <div className="prediction-compare-loading">Preparando visualização…</div>}
          {detectionLayers && [left, right].map((group, index) => {
            const layer = cleanBoxes ? detectionLayers[index] : null;
            return <div className="prediction-compare-side" key={group}><div className="prediction-compare-label">{index === 0 ? 'A' : 'B'} · {group}</div><div className="prediction-compare-image"><div className="prediction-compare-layer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}><img src={layer ? `${imageUrl(group, file)}/original` : imageUrl(group, file)} alt={`Predição de ${group}`} draggable={false} />{layer && <svg className="prediction-box-layer" viewBox={`0 0 ${layer.width} ${layer.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">{layer.boxes.map((box, boxIndex) => <rect key={boxIndex} x={box.x1} y={box.y1} width={box.x2 - box.x1} height={box.y2 - box.y1} fill="none" stroke="#78f0cc" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />)}</svg>}</div></div></div>;
          })}
        </div>
      </div>
      <p className="prediction-compare-hint">Zoom e arrasto sincronizados. Na foto com áreas incertas, a amálgama não deve ser julgada como insetos individuais identificáveis.</p>
    </>}
  </section>;
}
