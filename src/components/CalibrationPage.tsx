import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, CircleAlert, Maximize2, Minus, Plus, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import { inferenceSourceLabel } from '../types';
import { api } from '../api';
import { PredictionComparison } from './PredictionComparison';
import type { DatasetImage, Job, Model, Overview } from '../types';

type Settings = { modelId: string; confidence: number; iou: number };
type Preview = { id: string; image: string; results: Array<{
  width: number; height: number; detections: number; boxes: Array<{ xyxy: number[]; confidence: number }>;
  url: string;
}>; requestKey: string };
type View = { zoom: number; x: number; y: number };
const defaultSettings = (model?: Model): Settings => ({ modelId: model?.id || '',
  confidence: model?.inference.confidence ?? 0.2,
  iou: model?.inference.nmsIou ?? 0.4 });
const uncertainImage = '4cdb44d3-01be-11f1-bfd8-714d57fb7ac5.jpg';

function ThresholdControl({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(value.toFixed(2));
  useEffect(() => setDraft(value.toFixed(2)), [value]);
  const commit = () => {
    const next = Number(draft.replace(',', '.'));
    if (Number.isFinite(next) && next >= 0.01 && next <= 0.99) onChange(next);
    else setDraft(value.toFixed(2));
  };
  return <label className="calibration-threshold"><span>{label}</span><div><input type="range" min="0.01" max="0.99" step="0.01" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    <input type="text" inputMode="decimal" value={draft} onChange={(event) => setDraft(event.target.value)}
      onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
      aria-label={`${label}: valor exato de 0,01 a 0,99`} /></div></label>;
}

export function CalibrationPage({ data, initialModelId, onRefresh, onOperations }: {
  data: Overview; initialModelId: string | null; onRefresh: () => Promise<void>; onOperations: () => void;
}) {
  const models = data.models;
  const initial = models.find((model) => model.id === initialModelId) || models.find((model) => model.isPromoted) || models[0];
  const [a, setA] = useState<Settings>(() => defaultSettings(initial));
  const [b, setB] = useState<Settings>(() => defaultSettings(models.find((model) => model.id !== initial?.id) || initial));
  const [compare, setCompare] = useState(false);
  const [images, setImages] = useState<DatasetImage[]>([]);
  const [file, setFile] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [clean, setClean] = useState(true);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [expanded, setExpanded] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [applySavedModelId, setApplySavedModelId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);
  const activeJob = jobs.find((job) => job.status === 'queued' || job.status === 'running');
  const validation = useMemo(() => images.filter((item) => item.split === 'val')
    .sort((left, right) => Number(right.image === uncertainImage) - Number(left.image === uncertainImage) || left.image.localeCompare(right.image)), [images]);
  const selected = validation.find((item) => item.image === file);
  const savedCalibration = models.find((item) => item.id === a.modelId)?.calibration;
  const selections = compare ? [a, b] : [a];
  const previewKey = JSON.stringify({ file, selections });

  useEffect(() => {
    void api.datasetSplit().then(setImages).catch((cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as imagens.'));
    void api.jobs().then(setJobs).catch(() => {});
    const stream = new EventSource('/api/jobs-stream');
    stream.onmessage = (event) => {
      const job = JSON.parse(event.data) as Job;
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      if (job.type === 'tune' && job.status === 'completed') {
        setMessage('Calibração salva no catálogo. O modelo principal não foi alterado.');
        setApplySavedModelId(job.calibration?.modelId || null);
        void onRefresh();
      }
      if (job.type === 'tune' && job.status === 'failed') {
        setMessage('');
        setError(job.logs.at(-1) || 'A calibração falhou. Consulte o terminal.');
      }
    };
    return () => stream.close();
  }, [onRefresh]);
  useEffect(() => { if (validation.length && !validation.some((item) => item.image === file)) setFile(validation[0].image); }, [validation, file]);
  useEffect(() => {
    if (!applySavedModelId || a.modelId !== applySavedModelId) return;
    const updated = models.find((item) => item.id === applySavedModelId);
    if (!updated?.calibration || updated.calibration.stale) return;
    setA({ modelId: updated.id, confidence: updated.calibration.best.confidence, iou: updated.calibration.best.nms_iou });
    setApplySavedModelId(null);
  }, [applySavedModelId, data.models]);
  useEffect(() => { setView({ zoom: 1, x: 0, y: 0 }); }, [file, compare]);
  useEffect(() => {
    if (!initialModelId || !models.some((model) => model.id === initialModelId)) return;
    setA(defaultSettings(models.find((model) => model.id === initialModelId)));
  }, [initialModelId]);
  useEffect(() => {
    if (!file || !a.modelId || (compare && !b.modelId) || activeJob) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPreviewBusy(true); setError('');
      void api.calibrationPreview(file, selections).then((result) => { if (!cancelled) setPreview({ ...result, requestKey: previewKey }); })
        .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Falha na visualização.'); })
        .finally(() => { if (!cancelled) setPreviewBusy(false); });
    }, 650);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [previewKey, activeJob?.id]);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * .001), event.clientX - rect.left, event.clientY - rect.top);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [compare, expanded]);
  useEffect(() => {
    if (!expanded) return;
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
      if (event.key === 'ArrowRight') changeFile(1);
      if (event.key === 'ArrowLeft') changeFile(-1);
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [expanded, file, validation]);

  function changeFile(step: number) {
    const index = validation.findIndex((item) => item.image === file);
    if (index >= 0) setFile(validation[(index + step + validation.length) % validation.length].image);
  }
  function changeModel(side: 'a' | 'b', id: string) {
    const next = defaultSettings(models.find((model) => model.id === id));
    if (side === 'a') setA(next); else setB(next);
  }
  function zoomAt(factor: number, x?: number, y?: number) {
    const rect = stage.current?.getBoundingClientRect();
    const stacked = compare && window.matchMedia('(max-width: 700px)').matches;
    const panelWidth = (rect?.width || 0) / (compare && !stacked ? 2 : 1);
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
      const [left, right] = [...pointers.current.values()];
      pinch.current = Math.hypot(left.x - right.x, left.y - right.y);
    }
  };
  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [left, right] = [...pointers.current.values()];
      const distance = Math.hypot(left.x - right.x, left.y - right.y);
      if (pinch.current) {
        const rect = stage.current?.getBoundingClientRect();
        zoomAt(distance / pinch.current, (left.x + right.x) / 2 - (rect?.left || 0), (left.y + right.y) / 2 - (rect?.top || 0));
      }
      pinch.current = distance;
    } else setView((current) => ({ ...current, x: current.x + event.clientX - previous.x,
      y: current.y + event.clientY - previous.y }));
  };
  const pointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  async function calibrate(manual: boolean) {
    if (!a.modelId || activeJob || saving) return;
    setSaving(true); setMessage(''); setError('');
    try {
      const model = models.find((item) => item.id === a.modelId);
      if (!model) throw new Error('Este modelo não está mais no catálogo. Escolha outro peso.');
      const options: Record<string, unknown> = { model: model.path };
      if (manual) { options.manualConfidence = a.confidence; options.manualIou = a.iou; }
      const job = await api.createJob('tune', options);
      setJobs((current) => [job, ...current]);
      setMessage(manual ? 'Avaliando o ajuste escolhido nas imagens de validação. O modelo principal não será alterado.'
        : 'Calibração automática iniciada. O melhor resultado será salvo no catálogo, sem promover o modelo.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível iniciar a calibração.'); }
    finally { setSaving(false); }
  }

  const stageContent = <div ref={stage} className={`calibration-stage ${compare ? 'paired' : ''}`}
    onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
    {previewBusy && <div className="calibration-stage-loading">Atualizando detecções…</div>}
    {preview && preview.image === file && preview.requestKey === previewKey ? preview.results.map((result, index) => <div className="calibration-side" key={index}>
      <div className="prediction-compare-label">{compare ? `${index === 0 ? 'A' : 'B'} · ` : ''}{models.find((item) => item.id === selections[index]?.modelId)?.name || 'Modelo'} · {result.detections} boxes</div>
      <div className="calibration-image-stage"><div className="calibration-image" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        <img src={clean ? `/api/dataset/image/val/${encodeURIComponent(file)}` : result.url} alt={`Predição ${index + 1}`} draggable={false} />
        {clean && <svg className="prediction-box-layer" viewBox={`0 0 ${result.width} ${result.height}`} preserveAspectRatio="none" aria-hidden="true">
          {result.boxes.map((box, boxIndex) => <rect key={boxIndex} x={box.xyxy[0]} y={box.xyxy[1]}
            width={box.xyxy[2] - box.xyxy[0]} height={box.xyxy[3] - box.xyxy[1]}
            fill="none" stroke="#78f0cc" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />)}
        </svg>}
      </div></div>
    </div>) : <div className="prediction-compare-loading">{file ? 'Atualizando visualização…' : 'Escolha uma foto para visualizar.'}</div>}
  </div>;

  return <>
    <div className="page-title"><div><span className="eyebrow">Bancada visual</span><h1>Calibração</h1><p>Teste confiança e NMS IoU em fotos da validação. Mover os controles só muda esta visualização; salvar uma calibração não promove o peso principal.</p></div></div>
    <section className="panel calibration-controls"><div className="panel-head"><div><span className="eyebrow">Ajuste ao vivo</span><h2>Modelo e limiares</h2></div><label className="calibration-compare-toggle"><input type="checkbox" checked={compare} onChange={(event) => setCompare(event.target.checked)} /> Comparar dois modelos</label></div>
      <div className={`calibration-settings ${compare ? 'paired' : ''}`}>{selections.map((setting, index) => <div className="calibration-setting" key={index}>
        <strong>{compare ? `Modelo ${index === 0 ? 'A' : 'B'}` : 'Modelo'}</strong>
        <select value={setting.modelId} onChange={(event) => changeModel(index === 0 ? 'a' : 'b', event.target.value)}>{models.map((model) => <option key={model.id} value={model.id}>{model.isPromoted ? '★ ' : ''}{model.name}</option>)}</select>
        <small>Valores iniciais: {inferenceSourceLabel(models.find((model) => model.id === setting.modelId)?.inference.source || 'defaults')}. Controles abaixo: ajuste experimental.</small>
        <ThresholdControl label="Confiança" value={setting.confidence} onChange={(value) => index === 0 ? setA({ ...a, confidence: value }) : setB({ ...b, confidence: value })} />
        <ThresholdControl label="NMS IoU" value={setting.iou} onChange={(value) => index === 0 ? setA({ ...a, iou: value }) : setB({ ...b, iou: value })} />
      </div>)}</div>
      <div className="calibration-actions"><button className="secondary-button" disabled={!data.operationsEnabled || Boolean(activeJob) || previewBusy || saving} onClick={() => void calibrate(false)}><SlidersHorizontal />Calibrar automaticamente o modelo A</button>
        <button className="primary-button" disabled={!data.operationsEnabled || Boolean(activeJob) || previewBusy || saving} onClick={() => void calibrate(true)}>Salvar ajuste manual do modelo A</button></div>
      <p className="calibration-explainer">Salvar o ajuste manual avalia a combinação em todas as fotos de validação. A calibração automática testa 9.801 pares, em passos de 0,01 para confiança e NMS IoU; pode levar alguns minutos. Nenhuma das duas altera o modelo publicado sem uma promoção posterior. Ambas aceitam JPEG, PNG e WebP e desconsideram detecções sem correspondência com insetos anotados quando pelo menos 50% da caixa está em áreas incertas. Detecções de insetos anotados e suas duplicatas continuam sendo avaliadas; correspondência usa IoU ≥ 0,30.</p>
      {activeJob?.type === 'tune' && <div className="model-calibration-progress"><SlidersHorizontal size={18} /><span>Calibração em andamento. Os resultados aparecerão no catálogo.</span><button onClick={onOperations}>Abrir terminal</button></div>}
      {message && !activeJob && <div className="model-notice">{message}</div>}
      {error && <div className="inline-error"><CircleAlert />{error}</div>}
    </section>
    <section className="panel calibration-visual"><div className="panel-head"><div><span className="eyebrow">Validação Unimar</span><h2>Inspecionar foto por foto</h2></div><span className="status-pill">{validation.length} imagens</span></div>
      <div className="prediction-compare-strip">{validation.map((item) => <button key={item.image} className={file === item.image ? 'active' : ''} title={`${item.trap} · ${item.boxes} boxes`} onClick={() => setFile(item.image)}><img src={`/api/dataset/thumbnail/val/${encodeURIComponent(item.image)}`} alt="" loading="lazy" /></button>)}</div>
      <div className="prediction-compare-toolbar"><div><button className="icon-button" onClick={() => changeFile(-1)} aria-label="Foto anterior"><ChevronLeft /></button><button className="icon-button" onClick={() => changeFile(1)} aria-label="Próxima foto"><ChevronRight /></button><span title={file}>{selected?.trap || file} · {selected?.boxes ?? 0} boxes anotadas</span></div><div>
        <button className="prediction-clean-button" onClick={() => setClean((value) => !value)}>{clean ? 'Boxes limpas' : 'IA original + confiança'}</button>
        <button className="icon-button" onClick={() => zoomAt(1 / 1.4)} aria-label="Diminuir zoom"><Minus /></button><span>{Math.round(view.zoom * 100)}%</span><button className="icon-button" onClick={() => zoomAt(1.4)} aria-label="Aumentar zoom"><Plus /></button><button className="icon-button" onClick={() => setView({ zoom: 1, x: 0, y: 0 })} aria-label="Reajustar imagem"><RefreshCw /></button><button className="icon-button" onClick={() => setExpanded(true)} aria-label="Abrir tela cheia"><Maximize2 /></button>
      </div></div>
      {expanded ? <div className="prediction-compare-fullscreen"><div className="prediction-compare-fullscreen-head"><strong>{file}</strong><div><button className="prediction-clean-button" onClick={() => setClean((value) => !value)}>{clean ? 'Boxes limpas' : 'IA original + confiança'}</button><button className="icon-button" onClick={() => changeFile(-1)} aria-label="Foto anterior"><ChevronLeft /></button><button className="icon-button" onClick={() => changeFile(1)} aria-label="Próxima foto"><ChevronRight /></button><button className="icon-button" onClick={() => zoomAt(1 / 1.4)} aria-label="Diminuir zoom"><Minus /></button><button className="icon-button" onClick={() => zoomAt(1.4)} aria-label="Aumentar zoom"><Plus /></button><button className="icon-button" onClick={() => setExpanded(false)} aria-label="Fechar tela cheia"><X /></button></div></div>{stageContent}</div> : stageContent}
      <p className="prediction-compare-hint">Arraste ou use dois dedos para mover e ampliar. Ao alterar os limiares, o PC refaz a predição desta foto; pode levar alguns segundos.</p>
    </section>
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">Modelo A</span><h2>Ajustes salvos</h2></div><span className="status-pill">{savedCalibration?.mode === 'manual' ? 'Escolha manual' : 'Varredura automática'}</span></div>
      {savedCalibration && !savedCalibration.stale ? <div className="table-wrap"><table><thead><tr><th>Confiança</th><th>NMS IoU</th><th>Precisão</th><th>Recall</th><th>F1</th><th>TP</th><th>FP</th><th>FN</th><th>Ignoradas</th><th>Correções estimadas</th></tr></thead><tbody>
        {savedCalibration.rows.slice(0, 8).map((row, index) => <tr key={index}><td><strong>{row.confidence.toFixed(2)}</strong></td><td>{row.nms_iou.toFixed(2)}</td><td>{(row.precision * 100).toFixed(1)}%</td><td>{(row.recall * 100).toFixed(1)}%</td><td>{(row.f1 * 100).toFixed(1)}%</td><td>{row.tp}</td><td>{row.fp}</td><td>{row.fn}</td><td>{row.ignored_predictions ?? 0}</td><td>{row.edit_proxy}</td></tr>)}
      </tbody></table></div> : <p className="calibration-explainer">{savedCalibration?.stale ? 'A validação mudou; recalibre para comparar resultados atuais.' : 'Ainda não há ajuste salvo para este modelo.'}</p>}
    </section>
    <PredictionComparison predictions={data.predictions} />
  </>;
}
