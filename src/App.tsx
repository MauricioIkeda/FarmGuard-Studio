import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnnotationThumbnail } from './components/AnnotationThumbnail';
import {
  Activity,
  Bug,
  Check,
  Cloud,
  Camera,
  Crown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Database,
  FlaskConical,
  Gauge,
  Image as ImageIcon,
  Layers3,
  LockKeyhole,
  LogOut,
  LoaderCircle,
  Maximize2,
  Menu,
  Minus,
  Play,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  TerminalSquare,
  Trash2,
  Undo2,
  Redo2,
  UploadCloud,
  X,
} from 'lucide-react';
import { api } from './api';
import { annotationMatchesStatus, annotationQueueCounts, annotationQueueFilters, type AnnotationQueueStatus } from './annotation-queue';
import { mergeJobs } from './job-sync';
import { AnnotationCanvas } from './components/AnnotationCanvas';
import { DatasetSplitPage } from './components/DatasetSplitPage';
import { CalibrationPage } from './components/CalibrationPage';
import { MetricChart } from './components/MetricChart';
import { ModelsPage } from './components/ModelsPage';
import { CameraTestPage } from './components/CameraTestPage';
import type { Annotation, AnnotationSummary, Job, Overview, PredictionDetections, PublicationChange, Run } from './types';

type Page = 'overview' | 'experiments' | 'models' | 'calibration' | 'camera' | 'operations' | 'dataset' | 'annotator';

const number = new Intl.NumberFormat('pt-BR');
const percent = (value: number) => `${(value * 100).toFixed(1).replace('.', ',')}%`;
const date = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const size = (value: number) => `${(value / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
const yolo11Bases = [
  ['yolo11n.pt', 'Nano'],
  ['yolo11s.pt', 'Small'],
  ['yolo11m.pt', 'Medium'],
  ['yolo11l.pt', 'Large'],
  ['yolo11x.pt', 'XLarge'],
] as const;

function StatusPill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty-state"><CircleAlert size={22} />{children}</div>;
}

function StudioApp({ onLogout }: { onLogout: () => void }) {
  const [annotationTarget, setAnnotationTarget] = useState<string | null>(() => {
    const key = new URLSearchParams(window.location.search).get('annotation');
    return key && /^[a-f0-9-]{36}$/i.test(key) ? key : null;
  });
  const [page, setPage] = useState<Page>(annotationTarget ? 'annotator' : 'overview');
  const [calibrationModelId, setCalibrationModelId] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOverview(await api.overview());
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar o FarmGuard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const navigate = (next: Page) => {
    setAnnotationTarget(null);
    setPage(next);
    setMobileNav(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openAnnotation = (key: string) => {
    setAnnotationTarget(key);
    setPage('annotator');
    setMobileNav(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openCalibration = (modelId: string) => {
    setCalibrationModelId(modelId);
    navigate('calibration');
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><ShieldCheck size={25} /></div>
          <div><strong>FarmGuard</strong><span>Studio</span></div>
          <button className="mobile-close icon-button" onClick={() => setMobileNav(false)} aria-label="Fechar menu"><X /></button>
        </div>
        <nav>
          <button className={page === 'overview' ? 'active' : ''} onClick={() => navigate('overview')}><Gauge />Visão geral</button>
          <button className={page === 'experiments' ? 'active' : ''} onClick={() => navigate('experiments')}><FlaskConical />Experimentos</button>
          <button className={page === 'models' ? 'active' : ''} onClick={() => navigate('models')}><Crown />Modelos</button>
          <button className={page === 'calibration' ? 'active' : ''} onClick={() => navigate('calibration')}><SlidersHorizontal />Calibração</button>
          <button className={page === 'camera' ? 'active' : ''} onClick={() => navigate('camera')}><Camera />Teste com câmera</button>
          <button className={page === 'operations' ? 'active' : ''} onClick={() => navigate('operations')}><TerminalSquare />Operações</button>
          <button className={page === 'dataset' ? 'active' : ''} onClick={() => navigate('dataset')}><Database />Dataset</button>
          <button className={page === 'annotator' ? 'active' : ''} onClick={() => navigate('annotator')}><Maximize2 />Anotador</button>
        </nav>
        <div className="sidebar-foot">
          <div className="connection"><i className={overview?.connected ? 'online' : ''} /><div><strong>{overview?.connected ? 'FarmGuard conectado' : 'Sem conexão'}</strong><span>código-fonte preservado</span></div></div>
          <div className="root-path" title={overview?.farmGuardRoot}>{overview?.farmGuardRoot || 'Localizando projeto…'}</div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <button className="menu-button icon-button" onClick={() => setMobileNav(true)} aria-label="Abrir menu"><Menu /></button>
          <div className="breadcrumb"><Bug size={17} /> Laboratório de visão computacional</div>
          <div className="top-actions">
            {overview && <StatusPill tone={overview.operationsEnabled ? 'success' : 'warning'}>{overview.operationsEnabled ? 'Execução liberada' : 'Execução protegida'}</StatusPill>}
            <button className="icon-button" onClick={() => void load()} aria-label="Atualizar"><RefreshCw className={loading ? 'spin' : ''} /></button>
            <button className="icon-button" onClick={onLogout} aria-label="Sair"><LogOut /></button>
          </div>
        </header>

        <div className="page-wrap">
          {error && <div className="error-banner"><CircleAlert /> <span>{error}</span><button onClick={() => void load()}>Tentar novamente</button></div>}
          {loading && !overview ? <div className="loading-page"><LoaderCircle className="spin" />Lendo o laboratório…</div> : null}
          {overview && page === 'overview' && <OverviewPage data={overview} onNavigate={navigate} />}
          {overview && page === 'experiments' && <ExperimentsPage data={overview} />}
          {overview && page === 'models' && <ModelsPage data={overview} onRefresh={load} onOperations={() => navigate('operations')} onCalibrate={openCalibration} />}
          {overview && page === 'calibration' && <CalibrationPage data={overview} initialModelId={calibrationModelId} onRefresh={load} onOperations={() => navigate('operations')} />}
          {overview && page === 'camera' && <CameraTestPage data={overview} />}
          {overview && page === 'operations' && <OperationsPage data={overview} onRefresh={load} onOpenAnnotation={openAnnotation} />}
          {overview && page === 'dataset' && <DatasetSplitPage operationsEnabled={overview.operationsEnabled} onUpdated={load} />}
          {page === 'annotator' && <AnnotatorPage onSaved={load} targetKey={annotationTarget} />}
        </div>
      </main>
    </div>
  );
}

function PageTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-title"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function OverviewPage({ data, onNavigate }: { data: Overview; onNavigate: (page: Page) => void }) {
  const completion = data.dataset.total ? data.dataset.reviewed / data.dataset.total : 0;
  const best = [...data.runs].sort((a, b) => b.metrics.map50 - a.metrics.map50)[0];
  return <>
    <PageTitle eyebrow="Estado atual" title="Uma leitura clara do seu laboratório" description="Dataset, modelos e resultados reunidos sem alterar o projeto de origem." action={<button className="primary-button" onClick={() => onNavigate('operations')}><Play size={17} /> Nova operação</button>} />

    <section className="kpi-grid">
      <article className="kpi-card accent-lime"><div className="kpi-icon"><ImageIcon /></div><span>Imagens revisadas</span><strong>{data.dataset.reviewed}<small> / {data.dataset.total}</small></strong><div className="progress"><i style={{ width: `${completion * 100}%` }} /></div><p>{data.dataset.pending ? `${data.dataset.pending} ainda aguardam revisão` : 'Fila de revisão concluída'}</p></article>
      <article className="kpi-card"><div className="kpi-icon"><Square /></div><span>Insetos anotados</span><strong>{number.format(data.dataset.boxes)}</strong><p>{data.dataset.total ? Math.round(data.dataset.boxes / data.dataset.total) : 0} boxes por imagem, em média</p></article>
      <article className="kpi-card"><div className="kpi-icon"><Layers3 /></div><span>Pesos disponíveis</span><strong>{data.models.length}</strong><p>{data.runs.length} experimentos registrados</p></article>
      <article className="kpi-card"><div className="kpi-icon"><Sparkles /></div><span>Melhor mAP50</span><strong>{best ? percent(best.metrics.map50) : '—'}</strong><p>{best?.name || 'Nenhum treinamento encontrado'}</p></article>
    </section>

    <section className="overview-grid">
      <article className="panel wide">
        <div className="panel-head"><div><span className="eyebrow">Comparativo</span><h2>Evolução dos melhores modelos</h2></div><button className="text-button" onClick={() => onNavigate('experiments')}>Abrir bancada <ChevronRight /></button></div>
        <MetricChart runs={[...data.runs].sort((a, b) => b.metrics.map50 - a.metrics.map50).slice(0, 3)} />
      </article>
      <article className="panel">
        <div className="panel-head"><div><span className="eyebrow">Cobertura</span><h2>Imagens por armadilha</h2></div></div>
        <div className="trap-list">
          {data.dataset.traps.map((trap) => { const max = data.dataset.traps[0]?.count || 1; return <div key={trap.name}><div><span>{trap.name}</span><strong>{trap.count}</strong></div><i><b style={{ width: `${trap.count / max * 100}%` }} /></i></div>; })}
        </div>
      </article>
    </section>

    <section className="panel">
      <div className="panel-head"><div><span className="eyebrow">Registro de treino</span><h2>Experimentos recentes</h2></div><StatusPill>{data.runs.length} execuções</StatusPill></div>
      <div className="table-wrap"><table><thead><tr><th>Experimento</th><th>Épocas</th><th>Precisão</th><th>Recall</th><th>mAP50</th><th>Atualizado</th><th>Pesos</th></tr></thead><tbody>
        {data.runs.slice(0, 6).map((run) => <tr key={run.name}><td><strong>{run.name}</strong></td><td>{run.epochs}</td><td>{percent(run.metrics.precision)}</td><td>{percent(run.metrics.recall)}</td><td><span className="metric-value">{percent(run.metrics.map50)}</span></td><td>{date(run.modifiedAt)}</td><td>{run.hasBest ? <StatusPill tone="success">best.pt</StatusPill> : <StatusPill>—</StatusPill>}</td></tr>)}
      </tbody></table></div>
    </section>
  </>;
}

function ExperimentsPage({ data }: { data: Overview }) {
  const [selected, setSelected] = useState<string[]>(data.runs.slice(0, 2).map((run) => run.name));
  const [metric, setMetric] = useState<keyof Run['metrics']>('map50');
  const [gallery, setGallery] = useState<string | null>(null);
  const [galleryFiles, setGalleryFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const compared = selected.map((name) => data.runs.find((run) => run.name === name)).filter(Boolean) as Run[];
  const toggle = (name: string) => setSelected((current) => current.includes(name) ? current.filter((item) => item !== name) : current.length < 4 ? [...current, name] : [...current.slice(1), name]);
  const openGallery = async (name: string) => { setGallery(name); setGalleryFiles(await api.predictionFiles(name)); };
  return <>
    <PageTitle eyebrow="Bancada de modelos" title="Compare decisões, não só arquivos" description="Coloque até quatro treinamentos lado a lado e acompanhe o que mudou ao longo das épocas." />
    <section className="panel compare-panel">
      <div className="panel-head"><div><span className="eyebrow">Curvas de validação</span><h2>Desempenho por época</h2></div><div className="segmented">
        {(['map50', 'map5095', 'precision', 'recall'] as const).map((item) => <button key={item} className={metric === item ? 'active' : ''} onClick={() => setMetric(item)}>{item === 'map5095' ? 'mAP50–95' : item}</button>)}
      </div></div>
      {compared.length ? <MetricChart runs={compared} metric={metric} height={280} /> : <Empty>Selecione ao menos um experimento abaixo.</Empty>}
    </section>
    <section className="experiment-grid">
      {data.runs.map((run) => <article key={run.name} className={`run-card ${selected.includes(run.name) ? 'selected' : ''}`} onClick={() => toggle(run.name)}>
        <div className="run-check">{selected.includes(run.name) && <Check size={15} />}</div>
        <div className="run-card-head"><div><span>{run.epochs} épocas</span><h3>{run.name}</h3></div><StatusPill tone={run.metrics.map50 > .7 ? 'success' : run.metrics.map50 > .3 ? 'warning' : 'neutral'}>{percent(run.metrics.map50)} mAP50</StatusPill></div>
        <div className="run-metrics"><div><span>Precisão</span><strong>{percent(run.metrics.precision)}</strong></div><div><span>Recall</span><strong>{percent(run.metrics.recall)}</strong></div><div><span>mAP50–95</span><strong>{percent(run.metrics.map5095)}</strong></div></div>
        <div className="run-foot"><span>{date(run.modifiedAt)}</span><span>{run.hasBest ? 'best.pt disponível' : 'sem best.pt'}</span></div>
      </article>)}
    </section>
    <section className="panel">
      <div className="panel-head"><div><span className="eyebrow">Inspeção visual</span><h2>Galerias de predição</h2></div><StatusPill>{data.predictions.length} lotes</StatusPill></div>
      <div className="prediction-grid">{data.predictions.map((prediction) => <button key={prediction.name} className="prediction-card" onClick={() => void openGallery(prediction.name)}>
        <div className="prediction-preview">{prediction.preview ? <img src={`/api/predictions/${encodeURIComponent(prediction.name)}/${encodeURIComponent(prediction.preview)}`} alt="" /> : <ImageIcon />}</div><div><strong>{prediction.name}</strong><span>{prediction.count} imagens · {date(prediction.modifiedAt)}</span></div><ChevronRight />
      </button>)}</div>
    </section>
    {gallery && <div className="modal-backdrop" onMouseDown={() => setGallery(null)}><div className="gallery-modal" onMouseDown={(event) => event.stopPropagation()}><div className="panel-head"><div><span className="eyebrow">Predições</span><h2>{gallery}</h2></div><button className="icon-button" onClick={() => setGallery(null)} aria-label="Fechar galeria"><X /></button></div><div className="gallery-grid">{galleryFiles.map((file) => <button className="gallery-image-button" key={file} onClick={() => setActiveFile(file)}><img src={`/api/predictions/${encodeURIComponent(gallery)}/${encodeURIComponent(file)}`} alt={file} loading="lazy" /><span>{file}</span></button>)}</div></div></div>}
    {gallery && activeFile && <PredictionViewer group={gallery} file={activeFile} onClose={() => setActiveFile(null)} />}
  </>;
}

function PredictionViewer({ group, file, onClose }: { group: string; file: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(0);
  const [detections, setDetections] = useState<PredictionDetections | null | undefined>(undefined);
  const [cleanBoxes, setCleanBoxes] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; x: number; y: number } | null>(null);
  const zoomAnchor = useRef<{ x: number; y: number; imageX: number; imageY: number } | null>(null);
  useEffect(() => {
    let current = true;
    setDetections(undefined);
    setCleanBoxes(false);
    void api.predictionDetections(group, file).then((result) => {
      if (current) { setDetections(result); setCleanBoxes(true); }
    }).catch(() => { if (current) setDetections(null); });
    return () => { current = false; };
  }, [group, file]);
  const zoomAt = (factor: number, x?: number, y?: number) => {
    const element = viewport.current;
    const img = image.current;
    if (!element || !img) return;
    const bounds = element.getBoundingClientRect();
    const imageBounds = img.getBoundingClientRect();
    const cursorX = x ?? bounds.left + bounds.width / 2;
    const cursorY = y ?? bounds.top + bounds.height / 2;
    zoomAnchor.current = {
      x: cursorX, y: cursorY,
      imageX: Math.max(0, Math.min(1, (cursorX - imageBounds.left) / imageBounds.width)),
      imageY: Math.max(0, Math.min(1, (cursorY - imageBounds.top) / imageBounds.height)),
    };
    setZoom((value) => {
      const next = Math.max(1, Math.min(64, value * factor));
      if (next === value) zoomAnchor.current = null;
      return next;
    });
  };
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    const element = viewport.current;
    const img = image.current;
    if (!anchor || !element || !img) return;
    const bounds = img.getBoundingClientRect();
    element.scrollLeft += bounds.left + anchor.imageX * bounds.width - anchor.x;
    element.scrollTop += bounds.top + anchor.imageY * bounds.height - anchor.y;
    zoomAnchor.current = null;
  }, [zoom, fitWidth]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); event.stopPropagation();
      zoomAt(Math.exp(-event.deltaY * 0.001), event.clientX, event.clientY);
    };
    const stopPageGesture = (event: Event) => event.preventDefault();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('gesturestart', stopPageGesture, { passive: false });
    element.addEventListener('gesturechange', stopPageGesture, { passive: false });
    window.addEventListener('keydown', key);
    return () => {
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('gesturestart', stopPageGesture);
      element.removeEventListener('gesturechange', stopPageGesture);
      window.removeEventListener('keydown', key);
    };
  }, [onClose, detections]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const fit = () => {
      const img = image.current;
      if (!img?.naturalWidth || !img.naturalHeight) return;
      setFitWidth(Math.min(element.clientWidth / img.naturalWidth, element.clientHeight / img.naturalHeight) * img.naturalWidth);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    fit();
    return () => observer.disconnect();
  }, [detections]);
  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      drag.current = null;
    } else if (pointers.current.size === 1) {
      drag.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
    }
  };
  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const element = event.currentTarget;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const x = (a.x + b.x) / 2;
      const y = (a.y + b.y) / 2;
      if (pinch.current) {
        element.scrollLeft -= x - pinch.current.x;
        element.scrollTop -= y - pinch.current.y;
        zoomAt(distance / Math.max(1, pinch.current.distance), x, y);
      }
      pinch.current = { distance, x, y };
    } else if (drag.current) {
      element.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
      element.scrollTop = drag.current.top - (event.clientY - drag.current.y);
    }
  };
  const pointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    pinch.current = null;
    const remaining = [...pointers.current.values()][0];
    drag.current = remaining ? { x: remaining.x, y: remaining.y,
      left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop } : null;
  };
  const baseUrl = `/api/predictions/${encodeURIComponent(group)}/${encodeURIComponent(file)}`;
  return <div className="prediction-viewer" role="dialog" aria-modal="true" aria-label={`Predição ${file}`}>
    <div className="prediction-viewer-toolbar"><strong>{file}</strong><div>{detections && <div className="prediction-layer-toggle" role="group" aria-label="Visualização de boxes"><button className={!cleanBoxes ? 'active' : ''} onClick={() => setCleanBoxes(false)}>IA original</button><button className={cleanBoxes ? 'active' : ''} onClick={() => setCleanBoxes(true)}>Boxes limpas</button></div>}<button className="icon-button" aria-label="Diminuir zoom" onClick={() => zoomAt(1 / 1.4)}><Minus /></button><span>{Math.round(zoom * 100)}%</span><button className="icon-button" aria-label="Aumentar zoom" onClick={() => zoomAt(1.4)}><Plus /></button><button className="icon-button" aria-label="Fechar imagem" onClick={onClose}><X /></button></div></div>
    {detections === undefined && <div className="prediction-viewer-loading"><LoaderCircle className="spin" />Preparando visualização…</div>}
    {detections === null && <div className="prediction-viewer-note">Esta galeria antiga tem apenas a imagem renderizada. Faça uma nova predição para alternar as boxes.</div>}
    {detections !== undefined && <div className="prediction-viewer-image" ref={viewport} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}><div className="prediction-viewer-content" style={{ width: fitWidth ? `${fitWidth * zoom}px` : 'auto' }}><img ref={image} onLoad={() => { const element = viewport.current; const img = image.current; if (element && img) setFitWidth(Math.min(element.clientWidth / img.naturalWidth, element.clientHeight / img.naturalHeight) * img.naturalWidth); }} src={cleanBoxes && detections ? `${baseUrl}/original` : baseUrl} alt={`Predição ${file}`} />{cleanBoxes && detections && <svg className="prediction-box-layer" viewBox={`0 0 ${detections.width} ${detections.height}`} preserveAspectRatio="none" aria-hidden="true">{detections.boxes.map((box, index) => <rect key={index} x={box.x1} y={box.y1} width={box.x2 - box.x1} height={box.y2 - box.y1} fill="none" stroke="#78f0cc" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />)}</svg>}</div></div>}
  </div>;
}

function OperationTerminal({ job }: { job?: Job }) {
  const output = useRef<HTMLPreElement>(null);
  const pinned = useRef(true);
  const previousJob = useRef<string | undefined>(undefined);
  const [cleared, setCleared] = useState<{ jobId: string; through: number } | null>(null);
  const count = job?.logCount ?? job?.logs.length ?? 0;
  const offset = count - (job?.logs.length ?? 0);
  const hidden = cleared?.jobId === job?.id ? Math.max(0, (cleared?.through ?? 0) - offset) : 0;
  const visibleLogs = job?.logs.slice(hidden) || [];
  const emptyOutput = !job ? 'As mensagens de treino e avaliação aparecerão aqui.'
    : cleared?.jobId === job.id ? 'Terminal limpo. Novas mensagens aparecerão aqui.'
    : `$ ${job.command.join(' ')}\n\n${job.status === 'completed' ? 'Operação concluída com sucesso. Nenhuma saída adicional foi produzida.'
      : job.status === 'failed' ? 'Operação encerrada com erro. Consulte o histórico desta tarefa.'
      : job.status === 'cancelled' ? 'Operação cancelada.'
      : job.status === 'interrupted' ? 'Acompanhamento interrompido.'
      : 'Operação em andamento; aguardando a primeira atualização…'}`;
  useLayoutEffect(() => {
    if (previousJob.current !== job?.id) {
      previousJob.current = job?.id;
      pinned.current = true;
    }
    if (pinned.current && output.current) output.current.scrollTop = output.current.scrollHeight;
  }, [job?.id, count, cleared]);
  return <article className="panel terminal-panel">
    <div className="panel-head"><div><span className="eyebrow">Saída em tempo real</span><h2>{job ? `${job.type} · ${job.status}` : 'Nenhuma tarefa nesta sessão'}</h2></div><div className="terminal-actions">{job && <button className="secondary-button" onClick={() => { setCleared({ jobId: job.id, through: count }); pinned.current = true; }} disabled={!job.logs.length}>Limpar terminal</button>}{job && <StatusPill tone={job.status === 'completed' ? 'success' : job.status === 'failed' ? 'danger' : job.status === 'running' ? 'warning' : 'neutral'}>{job.status}</StatusPill>}</div></div>
    <div className="terminal"><div className="terminal-chrome"><i /><i /><i /></div><pre ref={output} onScroll={(event) => { const element = event.currentTarget; pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 28; }}>{visibleLogs.length ? visibleLogs.join('\n') : emptyOutput}</pre></div>
  </article>;
}

function OperationsPage({ data, onRefresh, onOpenAnnotation }: { data: Overview; onRefresh: () => Promise<void>; onOpenAnnotation: (key: string) => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [type, setType] = useState<Job['type']>('validate');
  const [model, setModel] = useState(data.models[0]?.path || '');
  const [trainingModel, setTrainingModel] = useState(data.models[0]?.path || 'yolo11s.pt');
  const [dataset, setDataset] = useState('unimar');
  const [name, setName] = useState('');
  const [ignoreRegions, setIgnoreRegions] = useState(false);
  const [message, setMessage] = useState('');
  const loadJobs = useCallback(async () => {
    const loaded = await api.jobs();
    setJobs((current) => mergeJobs(current, loaded));
  }, []);
  useEffect(() => {
    void loadJobs().catch(() => {});
    const events = new EventSource('/api/jobs-stream');
    events.onopen = () => { void loadJobs().catch(() => {}); };
    events.onmessage = (event) => {
      const changed = JSON.parse(event.data) as Job;
      setJobs((current) => mergeJobs(current, [changed]));
      if (['completed', 'failed'].includes(changed.status)) void onRefresh();
    };
    return () => events.close();
  }, [loadJobs, onRefresh]);
  const submit = async () => {
    if (submitting || jobs.some((job) => job.status === 'queued' || job.status === 'running')) return;
    setSubmitting(true);
    setMessage('');
    try {
      const job = await api.createJob(type, { model: type === 'train' ? trainingModel : model, name, dataset, ignoreRegions: (type === 'train' || type === 'validate') && ignoreRegions });
      setJobs((current) => mergeJobs(current, [job]));
      setSelectedJobId(job.id);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Não foi possível iniciar.'); }
    finally { setSubmitting(false); }
  };
  const busy = submitting || jobs.some((job) => job.status === 'queued' || job.status === 'running');
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => { void loadJobs().catch(() => {}); }, 2500);
    return () => window.clearInterval(timer);
  }, [busy, loadJobs]);
  const active = jobs.find((job) => job.id === selectedJobId) || jobs.find((job) => job.status === 'running') || jobs[0];
  return <>
    <PageTitle eyebrow="Central de execução" title="Do clique ao log, sem trocar de tela" description="Prepare treinos, validações, predições e calibrações com os pesos catalogados." />
    {!data.operationsEnabled && <div className="safety-banner"><ShieldCheck /><div><strong>Proteção de escrita ativa</strong><p>Os comandos estão montados, mas não serão executados enquanto a autorização de escrita no FarmGuard estiver desativada.</p></div></div>}
    <section className="operations-grid">
      <article className="panel operation-form">
        <div className="panel-head"><div><span className="eyebrow">Nova tarefa</span><h2>Configurar operação</h2></div></div>
        <label>Tipo de operação</label>
        <div className="operation-types">{([
          ['train', 'Treinar', Activity], ['validate', 'Validar', Check], ['predict', 'Predizer', ImageIcon], ['tune', 'Calibrar automático', SlidersHorizontal], ['dataset', 'Gerar YOLO', Database], ['drive', 'Backup Unimar', Cloud], ['drive-datasets', 'Backup datasets', UploadCloud],
        ] as const).map(([value, label, Icon]) => <button key={value} className={type === value ? 'active' : ''} disabled={busy} onClick={() => setType(value)}><Icon />{label}</button>)}</div>
        {['train', 'validate', 'predict', 'tune'].includes(type) && <><label htmlFor="model">{type === 'train' ? 'Base / checkpoint inicial' : 'Pesos / checkpoint'}</label>
        <select id="model" value={type === 'train' ? trainingModel : model} disabled={busy} onChange={(event) => type === 'train' ? setTrainingModel(event.target.value) : setModel(event.target.value)}>
          {type === 'train' && <optgroup label="Bases oficiais YOLO11 · pré-treinadas">{yolo11Bases.map(([path, label]) => <option key={path} value={path}>YOLO11 {label} · {path}</option>)}</optgroup>}
          <optgroup label="Checkpoints do FarmGuard">{data.models.map((item) => <option key={item.id} value={item.path}>{item.name} · {size(item.size)}</option>)}</optgroup>
        </select>
        {type === 'train' && <div className="operation-note"><CircleAlert /><span>As bases YOLO11 .pt já vêm pré-treinadas; cada treino cria uma nova execução para o dataset escolhido. No primeiro uso, o peso pode ser baixado. Medium, Large e XLarge podem exceder os 6 GB de VRAM desta máquina com o lote e a resolução atuais.</span></div>}</>}
        {(type === 'train' || type === 'validate') && <><label htmlFor="training-dataset">Dataset</label><select id="training-dataset" value={dataset} disabled={busy} onChange={(event) => { setDataset(event.target.value); if (event.target.value !== 'unimar') setIgnoreRegions(false); }}><option value="unimar">Unimar · fotos da faculdade</option><option value="yellow">Yellow · armadilhas amarelas (externo)</option><option value="stickyPi">Sticky Pi · armadilhas adesivas (externo)</option></select></>}
        {(type === 'train' || type === 'predict' || (type === 'validate' && ignoreRegions)) && <><label htmlFor="name">Nome da execução (opcional)</label><input id="name" placeholder="Gerado automaticamente se ficar vazio" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></>}
        {(type === 'train' || type === 'validate') && <><label className="publication-rebuild-option"><input type="checkbox" checked={ignoreRegions} disabled={busy || dataset !== 'unimar'} onChange={(event) => setIgnoreRegions(event.target.checked)} /><span>Considerar áreas incertas (experimental)<small>Disponível somente para o Unimar. Usa {type === 'train' ? 'train_ignore.py' : 'val_ignore.py'}; as áreas precisam estar publicadas e o YOLO atualizado.</small></span></label>{ignoreRegions && <div className="operation-note"><CircleAlert /><span>O treino com ignore mantém a aumentação padrão e transforma a máscara junto com a imagem. Requer Ultralytics 8.4.161 e não promove o modelo automaticamente.</span></div>}</>}
        {type === 'tune' && <div className="operation-note"><SlidersHorizontal /><span>O Studio testa 9.801 combinações de confiança e NMS IoU, em passos de 0,01, nas imagens de validação Unimar. O melhor ajuste fica salvo no catálogo deste peso; o modelo principal não muda até ser promovido novamente.</span></div>}
        {type === 'predict' && <div className="operation-note"><ImageIcon /><span>O modelo selecionado gera imagens com boxes para a <strong>validação YOLO atual</strong>, usando sua calibração salva quando existir; caso contrário, confiança 0,20 e NMS IoU 0,40. O lote aparecerá em Experimentos.</span></div>}
        <div className="operation-note"><Database /><span>{type === 'drive-datasets' ? 'Espelha a pasta Datasets inteira no Drive, com Yellow, Sticky Pi e Unimar. Arquivos remotos substituídos ou removidos ficam em Datasets-history para recuperação.' : dataset === 'unimar' || !['train', 'validate'].includes(type) ? <>Dataset Unimar atual: <strong>{data.dataset.reviewed} imagens</strong> e <strong>{number.format(data.dataset.boxes)} boxes</strong>.</> : 'Dataset externo selecionado: use-o para pré-treino; compare o modelo final nas fotos Unimar antes de promovê-lo.'}</span></div>
        {message && <div className="inline-error"><CircleAlert />{message}</div>}
        <button className="primary-button full" onClick={() => void submit()} disabled={!data.operationsEnabled || busy}><Play />{busy ? 'Operação em andamento' : data.operationsEnabled ? 'Iniciar operação' : 'Aguardando autorização'}</button>
      </article>
      <OperationTerminal job={active} />
    </section>
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">Registros salvos</span><h2>Histórico de operações</h2></div></div>{jobs.length ? <div className="job-list">{jobs.map((job) => <button key={job.id} className={active?.id === job.id ? 'selected' : ''} onClick={() => setSelectedJobId(job.id)}><span className={`job-status ${job.status}`} /> <strong>{job.type}</strong><span>{date(job.createdAt)}</span><StatusPill>{job.status}</StatusPill></button>)}</div> : <Empty>Nenhuma operação foi iniciada ainda.</Empty>}</section>
    <PublicationPanel data={data} onUpdated={async () => { await loadJobs(); await onRefresh(); }} onOpenAnnotation={onOpenAnnotation} />
  </>;
}

function publicationKind(item: PublicationChange) {
  if (item.excludedAfter && !item.excludedBefore) return { label: 'Exclusão', tone: 'danger' };
  if (item.excludedBefore && !item.excludedAfter) return { label: 'Restauração', tone: 'success' };
  if (!item.publishedBefore) return { label: 'Adição', tone: 'success' };
  if (item.boxesBefore === item.boxesAfter && item.reviewedBefore === item.reviewedAfter && item.ignoreBefore !== item.ignoreAfter) return { label: 'Áreas incertas', tone: 'warning' };
  return { label: 'Atualização', tone: 'warning' };
}

function PublicationPanel({ data, onUpdated, onOpenAnnotation }: { data: Overview; onUpdated: () => Promise<void>; onOpenAnnotation: (key: string) => void }) {
  const [plan, setPlan] = useState<PublicationChange[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [rebuildAfterPublish, setRebuildAfterPublish] = useState(false);
  const [message, setMessage] = useState('');
  const [publicationWarning, setPublicationWarning] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api.publicationPlan();
      setPlan(next);
      setSelected(next.filter((item) => item.changed).map((item) => item.key));
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Falha ao montar plano.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const startDriveJob = async (type: 'drive' | 'drive-pull' | 'drive-datasets') => {
    setMessage(''); setPublicationWarning(false);
    try {
      await api.createJob(type, {});
      setMessage(type === 'drive-datasets'
        ? 'Backup completo de Yellow, Sticky Pi e Unimar iniciado. Acompanhe o progresso no terminal acima.'
        : type === 'drive' ? 'Backup das anotações Unimar iniciado. Acompanhe o terminal acima.'
          : 'Importação das anotações Unimar iniciada. Acompanhe o terminal acima.');
      await onUpdated();
    } catch (cause) {
      setPublicationWarning(true);
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível iniciar a operação no Drive.');
    }
  };
  const changed = plan.filter((item) => item.changed);
  const publish = async () => {
    setPublishing(true); setMessage(''); setPublicationWarning(false);
    try {
      const result = await api.publishDrafts(selected, rebuildAfterPublish);
      const backup = result.driveErrors.length
        ? `Backup no Drive incompleto (${result.driveBackedUp}/${result.published.length}); confira a conexão e use “Backup Unimar agora”.`
        : `Backup das anotações e imagens confirmado no Drive (${result.driveBackedUp}/${result.published.length}).`;
      setPublicationWarning(Boolean(result.driveErrors.length));
      setMessage(`${result.published.length} anotação(ões) publicadas, ${result.imagesAdded.length} imagem(ns) adicionadas ao FarmGuard. ${result.job ? 'Reconstrução YOLO iniciada.' : 'Dataset YOLO mantido como está; você pode reconstruí-lo depois em Operações → Gerar YOLO.'} ${backup}`);
      await refresh(); await onUpdated();
    } catch (cause) { setPublicationWarning(true); setMessage(cause instanceof Error ? cause.message : 'Falha na publicação.'); }
    finally { setPublishing(false); }
  };
  return <section className="publish-grid">
    <article className="panel drive-card">
      <div className="panel-head"><div><span className="eyebrow">Google Drive</span><h2>Backup dos datasets</h2></div><StatusPill tone={data.drive.connected ? 'success' : 'danger'}>{data.drive.connected ? 'Conectado' : 'Indisponível'}</StatusPill></div>
      <div className="drive-visual"><Cloud /><div><strong>{data.drive.remote || 'Sem remote'}</strong><span>{data.drive.projectRoot || 'Configure o rclone para habilitar.'}</span></div></div>
      <p>Na publicação, a imagem e o JSON da Unimar são copiados para <code>Datasets/datasetUnimar/source/traps_events</code>. O backup completo espelha Yellow, Sticky Pi e Unimar; versões remotas substituídas vão para <code>Datasets-history</code>. Rascunhos continuam no backup separado <code>studio-drafts</code>.</p>
      <div className="drive-actions"><button className="secondary-button" disabled={!data.drive.connected} onClick={() => void startDriveJob('drive-pull')}><Cloud />Importar anotações Unimar</button><button className="secondary-button" disabled={!data.drive.connected} onClick={() => void startDriveJob('drive')}><UploadCloud />Backup Unimar agora</button><button className="secondary-button drive-datasets-button" disabled={!data.drive.connected} onClick={() => void startDriveJob('drive-datasets')}><UploadCloud />Backup completo dos datasets</button></div>
    </article>
    <article className="panel publication-card">
      <div className="panel-head"><div><span className="eyebrow">Publicação controlada</span><h2>Rascunhos → FarmGuard</h2></div><StatusPill tone={changed.length ? 'warning' : 'success'}>{changed.length} alteração(ões)</StatusPill></div>
      <p className="publication-help">Clique numa imagem para conferir ou restaurar no anotador. Publicar uma exclusão marca o JSON como excluído; não apaga a foto original. Ela sai do YOLO na próxima reconstrução.</p>
      {loading ? <div className="mini-loading"><LoaderCircle className="spin" />Comparando arquivos…</div> : changed.length ? <div className="publication-list">{changed.map((item) => { const kind = publicationKind(item); return <div className="publication-item" key={item.key}><input type="checkbox" aria-label={`Selecionar ${item.image} para publicação`} checked={selected.includes(item.key)} onChange={() => setSelected((current) => current.includes(item.key) ? current.filter((key) => key !== item.key) : [...current, item.key])} /><button type="button" className="publication-open" onClick={() => onOpenAnnotation(item.key)} title={`Abrir ${item.image} no anotador`}><span className="publication-item-title"><strong>{item.trap || item.image}</strong><span className={`publication-kind ${kind.tone}`}>{kind.label}</span></span><small>{item.image} · {item.boxesBefore} → {item.boxesAfter} boxes · {item.ignoreBefore} → {item.ignoreAfter} áreas incertas{item.excludedAfter ? ' · ficará fora do YOLO' : item.reviewedAfter ? ' · revisada' : ' · pendente de revisão'}</small></button><ChevronRight size={16} aria-hidden="true" /></div>; })}</div> : <Empty>Nenhum rascunho diferente do FarmGuard.</Empty>}
      {message && <div className={publicationWarning ? 'inline-error' : 'inline-success'}>{message}</div>}
      <label className="publication-rebuild-option"><input type="checkbox" checked={rebuildAfterPublish} onChange={(event) => setRebuildAfterPublish(event.target.checked)} disabled={publishing} /><span>Reconstruir DatasetYolo logo após publicar<small>Desmarcado: publica e faz backup sem alterar o dataset YOLO. Você pode gerar o YOLO mais tarde em Operações.</small></span></label>
      <button className="primary-button full" disabled={!selected.length || publishing} onClick={() => void publish()}><UploadCloud />{publishing ? 'Publicando…' : rebuildAfterPublish ? 'Publicar, fazer backup e gerar YOLO' : 'Publicar e fazer backup'}</button>
    </article>
  </section>;
}

function AnnotatorPage({ onSaved, targetKey }: { onSaved: () => Promise<void>; targetKey: string | null }) {
  const [list, setList] = useState<AnnotationSummary[]>([]);
  const [index, setIndex] = useState(targetKey ? -1 : 0);
  const targetApplied = useRef(false);
  const [annotation, setAnnotation] = useState<Annotation | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [selectedIgnore, setSelectedIgnore] = useState<number | null>(null);
  type Markings = Pick<Annotation, 'boxes' | 'ignore_regions'>;
  const [history, setHistory] = useState<Markings[]>([]);
  const [future, setFuture] = useState<Markings[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [confirmSuggestion, setConfirmSuggestion] = useState(false);
  const [aiNotice, setAiNotice] = useState('');
  const [confirmExclude, setConfirmExclude] = useState(false);
  const cancelExcludeRef = useRef<HTMLButtonElement>(null);
  const cancelSuggestionRef = useRef<HTMLButtonElement>(null);
  const currentAnnotationKey = useRef<string | null>(null);
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState<AnnotationQueueStatus>(targetKey ? 'all' : 'pending');
  const [message, setMessage] = useState('');
  const [queueExpanded, setQueueExpanded] = useState(true);
  useEffect(() => {
    if (confirmExclude) cancelExcludeRef.current?.focus();
  }, [confirmExclude]);
  useEffect(() => {
    if (confirmSuggestion) cancelSuggestionRef.current?.focus();
  }, [confirmSuggestion]);
  useEffect(() => () => { currentAnnotationKey.current = null; }, []);
  const queueCounts = useMemo(() => annotationQueueCounts(list), [list]);
  const visible = useMemo(() => list.filter((item) => {
    const matchesStatus = annotationMatchesStatus(item, status);
    const query = filter.toLocaleLowerCase();
    return matchesStatus && (!query || item.trap?.toLocaleLowerCase().includes(query) || item.image.toLocaleLowerCase().includes(query));
  }), [list, filter, status]);
  useEffect(() => {
    if (visible.length && index >= visible.length) setIndex(visible.length - 1);
  }, [visible.length, index]);
  useEffect(() => { api.annotations().then(setList).catch((error) => setMessage(error.message)); }, []);
  useEffect(() => {
    if (!targetKey || !list.length || targetApplied.current) return;
    targetApplied.current = true;
    const targetIndex = list.findIndex((item) => item.key === targetKey);
    if (targetIndex >= 0) setIndex(targetIndex);
    else setMessage('A imagem selecionada não foi encontrada na fila do anotador.');
  }, [list, targetKey]);
  const activeKey = visible[index]?.key;
  currentAnnotationKey.current = activeKey || null;
  useEffect(() => {
    if (!activeKey) { setAnnotation(null); return; }
    const controller = new AbortController();
    setAnnotation(null);
    setMessage('');
    api.annotation(activeKey, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setAnnotation(value); setHistory([]); setFuture([]); setSelected(null); setSelectedIgnore(null); setDirty(false); setMessage(''); setAiNotice('');
    }).catch((error) => { if (!controller.signal.aborted) setMessage(error.message); });
    return () => controller.abort();
  }, [activeKey, loadAttempt]);
  const nextImageKey = visible[index + 1]?.key;
  useEffect(() => {
    if (!annotation || annotation.key !== activeKey || !nextImageKey) return;
    const controller = new AbortController();
    const image = new Image();
    image.fetchPriority = 'low';
    const timer = window.setTimeout(() => {
      void api.annotation(nextImageKey, controller.signal).then(() => {
        if (!controller.signal.aborted) image.src = `/api/annotations/${nextImageKey}/image`;
      }).catch(() => {});
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); image.src = ''; };
  }, [activeKey, annotation?.key, nextImageKey]);
  const persist = async (reviewed: boolean, changes: Partial<Annotation> = {}) => {
    if (!annotation || saving) return false;
    setSaving(true); setMessage('');
    try {
      const saved = await api.saveAnnotation({ ...annotation, ...changes, reviewed });
      setAnnotation(saved); setDirty(false);
      setList((items) => items.map((item) => item.key === saved.key ? {
        ...item, reviewed: saved.reviewed, excluded: saved.excluded, boxes: saved.boxes.length, cached: true,
      } : item));
      void onSaved().catch((error) => console.warn('Rascunho salvo, mas falhou a atualização do painel:', error));
      return true;
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Falha ao salvar.');
      return false;
    } finally { setSaving(false); }
  };
  const goTo = async (next: number) => {
    if (next < 0 || next >= visible.length || next === index) return;
    if (dirty && !(await persist(annotation?.reviewed || false))) return;
    setIndex(next);
    if (window.matchMedia('(max-width: 570px)').matches) setQueueExpanded(false);
  };
  const changeStatus = async (next: typeof status) => {
    if (dirty && !(await persist(annotation?.reviewed || false))) return;
    setStatus(next); setIndex(0);
    if (window.matchMedia('(max-width: 570px)').matches) setQueueExpanded(true);
  };
  const changeFilter = async (next: string) => {
    if (dirty && !(await persist(annotation?.reviewed || false))) return;
    setFilter(next); setIndex(0);
  };
  const prioritizeTrap = async () => {
    const current = visible[index];
    if (!current?.trap) return;
    if (dirty && !(await persist(annotation?.reviewed || false))) return;
    setList((items) => {
      const currentIndex = items.findIndex((item) => item.key === current.key);
      const head = items.slice(0, currentIndex + 1);
      const tail = items.slice(currentIndex + 1);
      const sameTrap = tail.filter((item) => !item.reviewed && !item.excluded && item.trap?.toUpperCase() === current.trap?.toUpperCase());
      const keys = new Set(sameTrap.map((item) => item.key));
      return [...head, ...sameTrap, ...tail.filter((item) => !keys.has(item.key))];
    });
  };
  const historyPoint = () => {
    if (!annotation) return;
    setHistory((items) => [...items.slice(-39), { boxes: annotation.boxes.map((box) => ({ ...box })), ignore_regions: (annotation.ignore_regions || []).map((region) => ({ ...region })) }]);
    setFuture([]);
  };
  const undo = () => {
    if (!annotation || !history.length) return;
    setFuture((items) => [...items, { boxes: annotation.boxes.map((box) => ({ ...box })), ignore_regions: (annotation.ignore_regions || []).map((region) => ({ ...region })) }]);
    setAnnotation({ ...annotation, ...history.at(-1)! });
    setHistory((items) => items.slice(0, -1)); setDirty(true); setSelected(null); setSelectedIgnore(null);
  };
  const redo = () => {
    if (!annotation || !future.length) return;
    setHistory((items) => [...items, { boxes: annotation.boxes.map((box) => ({ ...box })), ignore_regions: (annotation.ignore_regions || []).map((region) => ({ ...region })) }]);
    setAnnotation({ ...annotation, ...future.at(-1)! });
    setFuture((items) => items.slice(0, -1)); setDirty(true); setSelected(null); setSelectedIgnore(null);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (confirmSuggestion) {
        if (event.key === 'Escape' && !aiBusy) setConfirmSuggestion(false);
        return;
      }
      if (confirmExclude) {
        if (event.key === 'Escape' && !saving) setConfirmExclude(false);
        return;
      }
      if (!annotation) return;
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected !== null && !typing) {
        historyPoint();
        setAnnotation({ ...annotation, boxes: annotation.boxes.filter((_, boxIndex) => boxIndex !== selected) });
        setSelected(null); setDirty(true);
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIgnore !== null && !typing) {
        historyPoint();
        setAnnotation({ ...annotation, ignore_regions: (annotation.ignore_regions || []).filter((_, regionIndex) => regionIndex !== selectedIgnore) });
        setSelectedIgnore(null); setDirty(true);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void persist(annotation.reviewed); }
      if (!typing && event.key === 'ArrowLeft') void goTo(index - 1);
      if (!typing && event.key === 'ArrowRight') void goTo(index + 1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const updateBoxes = (boxes: Annotation['boxes']) => { if (annotation) { setAnnotation({ ...annotation, boxes }); setDirty(true); } };
  const updateIgnoreRegions = (ignore_regions: NonNullable<Annotation['ignore_regions']>) => { if (annotation) { setAnnotation({ ...annotation, ignore_regions }); setDirty(true); } };
  const finish = async () => {
    if (!annotation) return;
    const nextKey = [...visible.slice(index + 1), ...visible.slice(0, index)]
      .find((item) => item.key !== annotation.key && !item.reviewed && !item.excluded)?.key;
    if (!(await persist(true))) return;
    if (nextKey) {
      const nextIndex = visible.findIndex((item) => item.key === nextKey);
      if (status === 'pending' || status === 'started') setIndex(0);
      else if (nextIndex >= 0) setIndex(nextIndex);
    } else setMessage('Revisão concluída: não há mais imagens pendentes nesta fila.');
  };
  const exclude = () => {
    if (!annotation || saving || aiBusy) return;
    if (annotation.excluded) { void persist(annotation.reviewed, { excluded: false }); return; }
    setMessage('');
    setConfirmExclude(true);
  };
  const confirmExclusion = async () => {
    if (annotation && await persist(annotation.reviewed, { excluded: true })) {
      setConfirmExclude(false);
      setSelected(null);
    }
  };
  const suggestWithAi = async () => {
    const current = annotation;
    if (!current || current.excluded || aiBusy || saving) return;
    setConfirmSuggestion(false);
    setAiNotice(''); setMessage(''); setAiBusy(true);
    try {
      const suggestion = await api.suggestAnnotation(current.key);
      if (currentAnnotationKey.current !== current.key) return;
      historyPoint();
      setAnnotation({ ...current, boxes: suggestion.boxes, reviewed: false });
      setSelected(null); setDirty(true);
      if (status === 'reviewed') {
        setStatus('all');
        const allIndex = list.findIndex((item) => item.key === current.key);
        if (allIndex >= 0) setIndex(allIndex);
      }
      if (await persist(false, { boxes: suggestion.boxes })) {
        setAiNotice(`IA sugeriu ${suggestion.boxes.length} box(es) com ${suggestion.model}. Revise as marcações antes de concluir.`);
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Falha ao analisar a imagem com IA.');
    } finally { setAiBusy(false); }
  };
  const requestSuggestion = () => {
    if (!annotation || annotation.excluded || aiBusy || saving) return;
    if (annotation.boxes.length || annotation.reviewed) setConfirmSuggestion(true);
    else void suggestWithAi();
  };
  const uploadParquet = async (file?: File) => {
    if (!file) return;
    if (dirty && !(await persist(annotation?.reviewed || false))) return;
    try {
      const result = await api.uploadParquet(file);
      setList(await api.annotations()); setIndex(0);
      setMessage(`Fonte atualizada: ${result.count} imagens únicas.`);
      await onSaved();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Falha ao importar Parquet.'); }
  };
  return <>
    <PageTitle eyebrow="Anotação integrada" title="Fila de revisão" description="Fotos para revisar primeiro, com prioridade para as armadilhas FARMLAB. As edições ficam em rascunhos do Studio até a publicação controlada." action={<div className="annotator-actions"><label className="secondary-button file-upload"><UploadCloud />Atualizar Parquet<input type="file" accept=".parquet" onChange={(event) => { void uploadParquet(event.target.files?.[0]); event.target.value = ''; }} /></label><button className="secondary-button ai-suggest-button" onClick={requestSuggestion} disabled={!annotation || annotation.excluded || saving || aiBusy} title="Usa o modelo promovido do FarmGuard para pré-marcar esta foto"><Sparkles />{aiBusy ? 'IA analisando…' : 'Sugerir com IA'}</button><button className="secondary-button" onClick={exclude} disabled={!annotation || saving || aiBusy}><Trash2 />{annotation?.excluded ? 'Restaurar imagem' : 'Excluir imagem'}</button><button className="primary-button" onClick={() => void persist(annotation?.reviewed || false)} disabled={!annotation || saving || aiBusy || !dirty}><Save />{saving ? 'Salvando…' : 'Salvar rascunho'}</button></div>} />
    {message && <div className="error-banner"><CircleAlert />{message}</div>}
    {aiNotice && <div className="inline-success annotation-ai-notice"><Sparkles size={17} />{aiNotice}</div>}
    <section className="annotator-layout">
      <aside className={`annotation-queue panel ${queueExpanded ? '' : 'compact'}`}>
        <div className="queue-head"><div><span className="eyebrow">Fila</span><h2>{visible.length} imagens · {Math.max(0, index + 1)} / {visible.length}</h2></div><button type="button" className="queue-toggle" aria-expanded={queueExpanded} onClick={() => setQueueExpanded((open) => !open)}>{queueExpanded ? 'Ocultar fila' : 'Escolher imagem'}</button></div>
        <div className="queue-filters-mobile" aria-label="Filtrar imagens por estado">{annotationQueueFilters.map(({ value, label }) => <button key={value} type="button" className={status === value ? 'active' : ''} aria-pressed={status === value} onClick={() => void changeStatus(value)}>{label}<span>{queueCounts[value]}</span></button>)}</div>
        <select aria-label="Estado das imagens" value={status} onChange={(event) => void changeStatus(event.target.value as AnnotationQueueStatus)}>{annotationQueueFilters.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select>
        {status === 'started' && <p className="queue-filter-hint">Revisão ainda não concluída, com pelo menos uma caixa salva.</p>}
        <input placeholder="Filtrar armadilha ou arquivo" value={filter} onChange={(event) => void changeFilter(event.target.value)} />
        <button className="queue-prioritize" type="button" disabled={!visible[index]?.trap} onClick={() => void prioritizeTrap()}>Priorizar esta armadilha</button>
        <div className="queue-list">{visible.map((item, itemIndex) => <button key={item.key} className={itemIndex === index ? 'active' : ''} onClick={() => void goTo(itemIndex)}><AnnotationThumbnail annotationKey={item.key} /><span><strong>{item.trap || 'Sem armadilha'}</strong><small>{item.boxes} boxes · {item.excluded ? 'excluída' : item.reviewed ? 'revisada' : item.boxes > 0 ? 'em andamento' : 'para revisar'}</small></span></button>)}</div>
      </aside>
      <div className="annotation-workspace">
        {aiBusy && <div className="annotation-ai-overlay"><LoaderCircle className="spin" />A IA está analisando a imagem…</div>}
        {annotation ? <>
          <div className="annotation-toolbar"><div><StatusPill tone={annotation.studioDraft ? 'warning' : 'neutral'}>{annotation.studioDraft ? 'Rascunho do Studio' : annotation.reviewed ? 'Revisada' : 'Pendente'}</StatusPill><strong>{annotation.source?.metadata?.trap_code as string || annotation.image}</strong><span>{annotation.width} × {annotation.height} · {annotation.boxes.length} boxes · {(annotation.ignore_regions || []).length} áreas incertas{dirty ? ' · alterações não salvas' : ''}</span></div><div><button className="icon-button" aria-label="Desfazer" disabled={!history.length} onClick={undo}><Undo2 /></button><button className="icon-button" aria-label="Refazer" disabled={!future.length} onClick={redo}><Redo2 /></button><button className="icon-button" aria-label="Anterior" disabled={index === 0} onClick={() => void goTo(index - 1)}><ChevronLeft /></button><button className="icon-button" aria-label="Próxima" disabled={index >= visible.length - 1} onClick={() => void goTo(index + 1)}><ChevronRight /></button></div></div>
          <AnnotationCanvas imageUrl={`/api/annotations/${annotation.key}/image`} imageWidth={annotation.width} imageHeight={annotation.height} boxes={annotation.boxes} ignoreRegions={annotation.ignore_regions || []} selected={selected} selectedIgnore={selectedIgnore} onSelected={setSelected} onSelectedIgnore={setSelectedIgnore} onChange={updateBoxes} onIgnoreChange={updateIgnoreRegions} onHistoryPoint={historyPoint} />
          <div className="annotation-bottom"><div><span>Seleção</span><strong>{selectedIgnore !== null ? `Área incerta #${selectedIgnore + 1}` : selected !== null ? `Inseto #${selected + 1}` : 'Nenhuma'}</strong></div>{selected !== null && <button className="secondary-button danger" onClick={() => { historyPoint(); updateBoxes(annotation.boxes.filter((_, boxIndex) => boxIndex !== selected)); setSelected(null); }}><Trash2 />Excluir box</button>}{selectedIgnore !== null && <button className="secondary-button danger" onClick={() => { historyPoint(); updateIgnoreRegions((annotation.ignore_regions || []).filter((_, regionIndex) => regionIndex !== selectedIgnore)); setSelectedIgnore(null); }}><Trash2 />Excluir área incerta</button>}<button className="primary-button" disabled={saving} onClick={() => void finish()}><Check />Concluir + próxima pendente</button></div>
        </> : <div className="loading-page">{visible.length ? message ? <button className="secondary-button" onClick={() => setLoadAttempt((value) => value + 1)}><RefreshCw />Tentar carregar novamente</button> : <><LoaderCircle className="spin" />Carregando imagem…</> : 'Nenhuma imagem neste filtro. Atualize o Parquet ou escolha outro filtro.'}</div>}
      </div>
    </section>
    {confirmSuggestion && annotation && <div className="modal-backdrop" onMouseDown={() => setConfirmSuggestion(false)}><div className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-ai-title" aria-describedby="confirm-ai-description" onMouseDown={(event) => event.stopPropagation()}><div className="confirm-modal-icon ai"><Sparkles /></div><h2 id="confirm-ai-title">Substituir boxes pela IA?</h2><p id="confirm-ai-description">Esta imagem tem {annotation.boxes.length} box(es){annotation.reviewed ? ' e está revisada' : ''}. A IA substituirá as marcações atuais, reabrirá a revisão e salvará um rascunho. Você poderá desfazer a substituição.</p><div className="confirm-modal-actions"><button ref={cancelSuggestionRef} type="button" className="secondary-button" onClick={() => setConfirmSuggestion(false)}>Cancelar</button><button type="button" className="primary-button" onClick={() => void suggestWithAi()}><Sparkles />Usar sugestões</button></div></div></div>}
    {confirmExclude && annotation && <div className="modal-backdrop" onMouseDown={() => { if (!saving) setConfirmExclude(false); }}><div className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-exclude-title" aria-describedby="confirm-exclude-description" onMouseDown={(event) => event.stopPropagation()}><div className="confirm-modal-icon"><Trash2 /></div><h2 id="confirm-exclude-title">Excluir esta imagem?</h2><p id="confirm-exclude-description">Ela ficará no filtro Excluídas e não entrará no DatasetYolo após a publicação. {annotation.boxes.length ? `${annotation.boxes.length} box(es) serão preservadas no rascunho para uma possível restauração.` : 'Você poderá restaurá-la depois.'}</p>{message && <div className="inline-error"><CircleAlert />{message}</div>}<div className="confirm-modal-actions"><button ref={cancelExcludeRef} type="button" className="secondary-button" disabled={saving} onClick={() => setConfirmExclude(false)}>Cancelar</button><button type="button" className="danger-button" disabled={saving} onClick={() => void confirmExclusion()}><Trash2 />{saving ? 'Salvando…' : 'Excluir imagem e salvar'}</button></div></div></div>}
  </>;
}

function LoginPage({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const showInstallHint = /iPhone|iPad|iPod/.test(navigator.userAgent) &&
    !window.matchMedia('(display-mode: standalone)').matches &&
    !('standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError('');
    try { await api.login(username, password); onAuthenticated(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao entrar.'); }
    finally { setLoading(false); }
  };
  return <main className="login-page">
    <div className="login-orbit"><ShieldCheck /></div>
    <form className="login-card" onSubmit={submit}>
      <div className="brand login-brand"><div className="brand-mark"><ShieldCheck size={25} /></div><div><strong>FarmGuard</strong><span>Studio</span></div></div>
      <span className="eyebrow">Acesso ao laboratório</span>
      <h1>Entre para continuar</h1>
      <p>Esta bancada controla arquivos e processos do computador principal.</p>
      <label htmlFor="username">Usuário</label>
      <div className="login-input"><LockKeyhole /><input id="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></div>
      <label htmlFor="password">Senha</label>
      <div className="login-input"><LockKeyhole /><input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus /></div>
      {error && <div className="inline-error"><CircleAlert />{error}</div>}
      <button className="primary-button full" disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <ShieldCheck />}Entrar no Studio</button>
      {showInstallHint && <p className="install-hint">Para usar como app no iPhone: abra no Safari, toque em Compartilhar e escolha “Adicionar à Tela de Início”.</p>}
    </form>
  </main>;
}

function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  useEffect(() => {
    const stopPagePinch = (event: Event) => event.preventDefault();
    document.addEventListener('gesturestart', stopPagePinch, { passive: false });
    document.addEventListener('gesturechange', stopPagePinch, { passive: false });
    return () => {
      document.removeEventListener('gesturestart', stopPagePinch);
      document.removeEventListener('gesturechange', stopPagePinch);
    };
  }, []);
  useEffect(() => { api.authStatus().then((status) => setAuthenticated(status.authenticated)).catch(() => setAuthenticated(false)); }, []);
  useEffect(() => {
    const expired = () => setAuthenticated(false);
    window.addEventListener('farmguard:unauthorized', expired);
    return () => window.removeEventListener('farmguard:unauthorized', expired);
  }, []);
  if (authenticated === null) return <div className="loading-page full-page"><LoaderCircle className="spin" />Verificando acesso…</div>;
  if (!authenticated) return <LoginPage onAuthenticated={() => setAuthenticated(true)} />;
  return <StudioApp onLogout={() => void api.logout().finally(() => setAuthenticated(false))} />;
}

export default App;
