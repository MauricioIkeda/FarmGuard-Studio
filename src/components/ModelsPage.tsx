import { useEffect, useMemo, useState } from 'react';
import { Check, CircleAlert, Crown, FlaskConical, LoaderCircle, Search, SlidersHorizontal, X } from 'lucide-react';
import { api } from '../api';
import { inferenceSourceLabel } from '../types';
import type { Job, Model, Overview } from '../types';

const pct = (value: number) => `${(value * 100).toFixed(1).replace('.', ',')}%`;
const mb = (value: number) => `${(value / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;

export function ModelsPage({ data, onRefresh, onOperations, onCalibrate }: {
  data: Overview; onRefresh: () => Promise<void>; onOperations: () => void; onCalibrate: (modelId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState<Model | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const visible = useMemo(() => data.models.filter((model) => model.name.toLowerCase().includes(query.toLowerCase()) || model.id.toLowerCase().includes(query.toLowerCase())), [data.models, query]);
  const activeJob = jobs.find((job) => job.status === 'queued' || job.status === 'running');

  useEffect(() => {
    void api.jobs().then(setJobs).catch(() => {});
    const stream = new EventSource('/api/jobs-stream');
    stream.onmessage = (event) => {
      const changed = JSON.parse(event.data) as Job;
      setJobs((current) => [changed, ...current.filter((job) => job.id !== changed.id)]);
      if (['completed', 'failed', 'interrupted'].includes(changed.status)) void onRefresh();
    };
    return () => stream.close();
  }, [onRefresh]);

  async function promote() {
    if (!confirm || confirmText !== 'PROMOVER') return;
    setBusy(true); setMessage('');
    try {
      const result = await api.promoteModel(confirm.id);
      setMessage(`${result.name} é agora o modelo principal. Configuração: confiança ${result.confidence.toFixed(2)}, IoU ${result.nmsIou.toFixed(2)}. O modelo anterior foi salvo em backup.${result.iaApiWarning ? ` Atenção: ${result.iaApiWarning}` : ''}`);
      setConfirm(null); setConfirmText('');
      await onRefresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Falha ao promover modelo.'); }
    finally { setBusy(false); }
  }

  return <>
    <div className="page-title"><div><span className="eyebrow">Catálogo de pesos</span><h1>Modelos</h1><p>Veja os ajustes salvos e promova o peso escolhido. Para testar ou mudar confiança e NMS IoU, abra a bancada de Calibração.</p></div></div>
    <section className="panel promoted-model-panel"><div><span className="eyebrow">Modelo principal</span><h2><Crown size={20} />{data.promoted?.name || 'Nenhum modelo principal'}</h2><p>O FarmGuard usa uma cópia deste checkpoint em “Sugerir com IA”. Recalibrar o checkpoint não muda o ajuste em uso; confirme “Atualizar principal” para aplicar os novos valores.</p></div><span className="status-pill success">{data.promoted?.sourceModelId ? 'Promovido pelo Studio' : 'Configuração existente'}</span></section>
    <div className="model-catalog-toolbar"><label className="model-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrar por modelo ou execução" /></label><span>{visible.length} de {data.models.length} pesos</span></div>
    {message && <div className="model-notice"><CircleAlert size={17} />{message}{activeJob && <button onClick={onOperations}>Ver operação</button>}</div>}
    {activeJob?.type === 'tune' && <div className="model-calibration-progress"><LoaderCircle className="spin" size={18} /><span>Calibração em andamento. O resultado será salvo automaticamente neste catálogo.</span><button onClick={onOperations}>Abrir terminal</button></div>}
    <div className="model-catalog-grid">{visible.map((model) => {
      const calibration = model.calibration;
      const ready = calibration && !calibration.stale;
      return <article key={model.id} className={`model-card ${model.isPromoted ? 'promoted' : ''}`}>
        <div className="model-card-top"><div className="model-card-icon"><FlaskConical size={20} /></div><span className={`status-pill ${model.isPromoted ? 'success' : ready ? 'warning' : 'neutral'}`}>{model.isPromoted ? 'Principal' : model.group === 'run' ? 'Experimento' : 'Models'}</span></div>
        <h3 title={model.name}>{model.name}</h3><div className="model-card-meta"><span>{mb(model.size)}</span><span>{new Date(model.modifiedAt).toLocaleDateString('pt-BR')}</span></div>
        <p>{inferenceSourceLabel(model.inference.source)} em uso: confiança {model.inference.confidence.toFixed(2)} · NMS IoU {model.inference.nmsIou.toFixed(2)} · resolução {model.inference.imgsz} · até {model.inference.maxDet} detecções.</p>
        {ready && <strong>Resultado da calibração experimental</strong>}
        {ready ? <div className="model-thresholds"><div><span>Confiança</span><strong>{calibration.best.confidence.toFixed(2)}</strong></div><div><span>NMS IoU</span><strong>{calibration.best.nms_iou.toFixed(2)}</strong></div><div><span>F1</span><strong>{pct(calibration.best.f1)}</strong></div><div><span>Correções estimadas</span><strong>{calibration.best.edit_proxy}</strong></div></div>
          : <div className="model-uncalibrated"><SlidersHorizontal size={18} /><div><strong>{calibration?.stale ? 'Calibração desatualizada' : 'Ainda não calibrado'}</strong><span>{calibration?.stale ? 'O peso ou o conjunto de validação mudou.' : 'Teste os limiares para este peso.'}</span></div></div>}
        {ready && <p className="model-calibration-date">{calibration.mode === 'manual' ? 'Ajuste manual' : calibration.testedPairs ? `Calibração automática · ${calibration.testedPairs.toLocaleString('pt-BR')} pares` : 'Calibração automática · grade anterior'} em {new Date(calibration.calibratedAt).toLocaleString('pt-BR')} · {calibration.best.ground_truth} boxes na validação</p>}
        <div className="model-card-actions"><button className="secondary-button" onClick={() => onCalibrate(model.id)}><SlidersHorizontal size={16} />Abrir calibração</button><button className="primary-button" disabled={!data.operationsEnabled || !ready || model.id === 'model:insect-detector.pt' || busy || Boolean(activeJob)} onClick={() => { setConfirm(model); setConfirmText(''); }}><Crown size={16} />{model.isPromoted ? 'Atualizar principal' : 'Promover'}</button></div>
      </article>;
    })}</div>
    {confirm && <div className="modal-backdrop" onMouseDown={() => setConfirm(null)}><div className="model-confirm-modal" role="dialog" aria-modal="true" aria-label="Confirmar promoção" onMouseDown={(event) => event.stopPropagation()}><div className="panel-head"><div><span className="eyebrow">Troca controlada</span><h2>{confirm.isPromoted ? 'Atualizar principal' : 'Promover'} {confirm.name}?</h2></div><button className="icon-button" onClick={() => setConfirm(null)} aria-label="Fechar"><X /></button></div><p>Isso substituirá <strong>Models/insect-detector.pt</strong> e seu JSON de configuração. O peso e o JSON atuais serão guardados em backup no Studio. Nenhum treino será apagado.</p><div className="model-confirm-values"><span>Confiança <strong>{confirm.calibration?.best.confidence.toFixed(2)}</strong></span><span>NMS IoU <strong>{confirm.calibration?.best.nms_iou.toFixed(2)}</strong></span></div><label>Digite <strong>PROMOVER</strong> para confirmar<input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} autoComplete="off" /></label><div className="model-confirm-actions"><button className="secondary-button" onClick={() => setConfirm(null)}>Cancelar</button><button className="primary-button" disabled={confirmText !== 'PROMOVER' || busy} onClick={() => void promote()}><Check size={17} />Confirmar promoção</button></div></div></div>}
  </>;
}
