import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, CircleAlert, GripVertical, Image as ImageIcon, Minus, Plus, RefreshCw, X } from 'lucide-react';
import { api } from '../api';
import type { DatasetImage } from '../types';

type Split = DatasetImage['split'];
type MoveRequest = { trap: string; split: Split; count: number; boxes: number };

const imageUrl = (item: DatasetImage) => `/api/dataset/image/${item.split}/${encodeURIComponent(item.image)}`;
const thumbnailUrl = (item: DatasetImage) => `/api/dataset/thumbnail/${item.split}/${encodeURIComponent(item.image)}`;

export function DatasetSplitPage({ operationsEnabled, onUpdated }: { operationsEnabled: boolean; onUpdated: () => Promise<void> }) {
  const [images, setImages] = useState<DatasetImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState('');
  const [preview, setPreview] = useState<DatasetImage | null>(null);
  const [zoom, setZoom] = useState(1);
  const [move, setMove] = useState<MoveRequest | null>(null);
  const [confirmReapply, setConfirmReapply] = useState(false);
  const [dragOver, setDragOver] = useState<Split | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setImages(await api.datasetSplit()); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao ler o DatasetYolo.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!preview && !move && !confirmReapply) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      setPreview(null); setMove(null); setConfirmReapply(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [preview, move, confirmReapply, busy]);

  const requestMove = (trap: string, split: Split) => {
    if (!operationsEnabled) { setError('Mudanças no DatasetYolo estão desativadas.'); return; }
    const group = images.filter((item) => item.trap === trap);
    if (!group.length || group[0].split === split) return;
    setMove({ trap, split, count: group.length, boxes: group.reduce((sum, item) => sum + item.boxes, 0) });
  };

  const applyMove = async () => {
    if (!move) return;
    setBusy(true); setError(''); setMessage('');
    try {
      setImages(await api.moveDatasetTrap(move.trap, move.split));
      setMessage(`${move.trap}: ${move.count} imagem(ns) e ${move.boxes} boxes movidas para ${move.split === 'train' ? 'treino' : 'validação'}. A escolha será reaplicada nas reconstruções feitas pelo Studio.`);
      setMove(null); setPreview(null);
      await onUpdated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível mover a armadilha.'); }
    finally { setBusy(false); }
  };

  const reapply = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      setImages(await api.reapplyDatasetSplit());
      setMessage('Divisão salva reaplicada ao DatasetYolo atual.');
      setConfirmReapply(false);
      await onUpdated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível reaplicar a divisão.'); }
    finally { setBusy(false); }
  };

  const totals = useMemo(() => Object.fromEntries((['train', 'val'] as const).map((split) => {
    const group = images.filter((item) => item.split === split);
    return [split, { images: group.length, boxes: group.reduce((sum, item) => sum + item.boxes, 0), traps: new Set(group.map((item) => item.trap)).size }];
  })) as Record<Split, { images: number; boxes: number; traps: number }>, [images]);
  const visible = useMemo(() => images.filter((item) => `${item.trap} ${item.image}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase())), [images, filter]);
  const drift = images.filter((item) => item.desiredSplit !== item.split);

  return <>
    <div className="page-title"><div><span className="eyebrow">Curadoria do dataset</span><h1>Treino e validação, imagem por imagem</h1><p>Inspecione as fotos, compare os conjuntos e reorganize sem misturar imagens da mesma armadilha entre eles.</p></div><button className="secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} />Atualizar</button></div>
    <section className="dataset-split-summary">
      <div><span>Treino</span><strong>{totals.train.images} imagens</strong><small>{totals.train.boxes.toLocaleString('pt-BR')} boxes · {totals.train.traps} armadilhas</small></div>
      <div><span>Validação</span><strong>{totals.val.images} imagens</strong><small>{totals.val.boxes.toLocaleString('pt-BR')} boxes · {totals.val.traps} armadilhas</small></div>
    </section>
    <div className="dataset-split-guidance"><CircleAlert size={18} /><span>Arrastar uma miniatura move <strong>todas as imagens da armadilha</strong>, após confirmação. Isso evita vazamento entre treino e validação. O Studio preserva a escolha nas reconstruções YOLO iniciadas por ele; se você rodar <code>dataset.py</code> manualmente, pode reaplicá-la aqui.</span></div>
    {drift.length > 0 && <div className="safety-banner"><CircleAlert /><div><strong>Divisão salva diferente do DatasetYolo atual</strong><p>{drift.length} imagem(ns) foram revertidas por uma reconstrução externa ou alteração manual.</p></div><button className="secondary-button" onClick={() => setConfirmReapply(true)} disabled={busy || !operationsEnabled}>Reaplicar divisão</button></div>}
    {error && <div className="inline-error"><CircleAlert size={16} />{error}</div>}
    {message && <div className="inline-success">{message}</div>}
    <label className="dataset-split-filter">Filtrar armadilha ou arquivo<input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Ex.: FARMLAB3" /></label>
    {loading ? <div className="loading-page">Carregando imagens do DatasetYolo…</div> : <section className="dataset-split-columns">{(['train', 'val'] as const).map((split) => <div key={split} className={`dataset-split-column panel ${dragOver === split ? 'drag-over' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragOver(split); }} onDragLeave={() => setDragOver(null)} onDrop={(event) => { event.preventDefault(); setDragOver(null); requestMove(event.dataTransfer.getData('text/plain'), split); }}><div className="panel-head"><div><span className="eyebrow">{split === 'train' ? 'Aprendizado' : 'Avaliação'}</span><h2>{split === 'train' ? 'Treino' : 'Validação'}</h2></div><span className="status-pill neutral">{totals[split].images} fotos</span></div><div className="dataset-thumbnails">{visible.filter((item) => item.split === split).map((item) => <article key={item.image} className="dataset-thumb" draggable={operationsEnabled} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.trap); }}><button className="dataset-thumb-preview" onClick={() => { setPreview(item); setZoom(1); }} aria-label={`Ampliar ${item.image}`}><img src={thumbnailUrl(item)} loading="lazy" alt={`Armadilha ${item.trap}`} /><span><ImageIcon size={13} />Ampliar</span></button><div className="dataset-thumb-info"><strong>{item.trap}</strong><small>{item.boxes} boxes · {item.ignoreRegions} áreas incertas</small><small title={item.image}>{item.image}</small></div><button className="dataset-thumb-move" onClick={() => requestMove(item.trap, split === 'train' ? 'val' : 'train')} disabled={!operationsEnabled} title={`Mover armadilha ${item.trap}`}><GripVertical size={15} /><span>Mover grupo</span><ArrowRightLeft size={14} /></button></article>)}</div>{!visible.some((item) => item.split === split) && <div className="empty-state">Nenhuma imagem neste filtro.</div>}</div>)}</section>}
    {preview && <div className="modal-backdrop dataset-preview-backdrop" onMouseDown={() => setPreview(null)}><div className="dataset-preview-modal" role="dialog" aria-modal="true" aria-label={`Foto ${preview.image}`} onMouseDown={(event) => event.stopPropagation()}><div className="dataset-preview-header"><div><strong>{preview.trap}</strong><small>{preview.image} · {preview.boxes} boxes · {preview.split === 'train' ? 'treino' : 'validação'}</small></div><div><button className="icon-button" onClick={() => setZoom((value) => Math.max(0.5, value / 1.35))} aria-label="Diminuir zoom"><Minus /></button><button className="icon-button" onClick={() => setZoom((value) => Math.min(5, value * 1.35))} aria-label="Aumentar zoom"><Plus /></button><button className="icon-button" onClick={() => setPreview(null)} aria-label="Fechar"><X /></button></div></div><div className="dataset-preview-stage" onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.max(0.5, Math.min(5, value * Math.exp(-event.deltaY * 0.001)))); }}><img src={imageUrl(preview)} alt={`Foto ${preview.image}`} style={{ height: `${zoom * 72}dvh` }} /></div><div className="dataset-preview-footer"><span>Arraste a miniatura entre as colunas ou mova o grupo pelo botão.</span><button className="secondary-button" disabled={!operationsEnabled} onClick={() => requestMove(preview.trap, preview.split === 'train' ? 'val' : 'train')}><ArrowRightLeft size={16} />Mover armadilha</button></div></div></div>}
    {move && <div className="modal-backdrop"><div className="confirm-modal" role="alertdialog" aria-modal="true" aria-label="Confirmar mudança de conjunto"><h2>Mover a armadilha inteira?</h2><p><strong>{move.trap}</strong> tem {move.count} imagem(ns) e {move.boxes} boxes. Todas irão para <strong>{move.split === 'train' ? 'treino' : 'validação'}</strong>, preservando a separação por armadilha.</p><div className="confirm-modal-actions"><button className="secondary-button" onClick={() => setMove(null)} disabled={busy}>Cancelar</button><button className="primary-button" onClick={() => void applyMove()} disabled={busy}>{busy ? 'Movendo…' : 'Confirmar mudança'}</button></div></div></div>}
    {confirmReapply && <div className="modal-backdrop"><div className="confirm-modal" role="alertdialog" aria-modal="true" aria-label="Reaplicar divisão salva"><h2>Reaplicar divisão salva?</h2><p>{drift.length} imagem(ns) voltarão ao conjunto registrado no Studio. Nenhuma box ou anotação será alterada.</p><div className="confirm-modal-actions"><button className="secondary-button" onClick={() => setConfirmReapply(false)} disabled={busy}>Cancelar</button><button className="primary-button" onClick={() => void reapply()} disabled={busy}>{busy ? 'Reaplicando…' : 'Reaplicar'}</button></div></div></div>}
  </>;
}

