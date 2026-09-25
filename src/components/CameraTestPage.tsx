import { useEffect, useRef, useState } from 'react';
import { Camera, CircleAlert, Download, Image as ImageIcon, LoaderCircle, RotateCcw, Share2, Trash2 } from 'lucide-react';
import { api } from '../api';
import type { CameraTest, Overview } from '../types';

async function uploadableImage(file: File) {
  if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.size <= 15 * 1024 * 1024) return file;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Não foi possível preparar a foto.');
    context.drawImage(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) =>
      value ? resolve(value) : reject(new Error('O iPhone não conseguiu converter esta foto.')), 'image/jpeg', 0.9));
    if (blob.size > 15 * 1024 * 1024) throw new Error('A foto convertida excede 15 MB.');
    return new File([blob], 'farmguard-camera.jpg', { type: 'image/jpeg' });
  } finally { URL.revokeObjectURL(url); }
}

export function CameraTestPage({ data }: { data: Overview }) {
  const initial = data.promoted?.sourceModelId || data.models.find((model) => model.id === 'model:insect-detector.pt')?.id || data.models[0]?.id || '';
  const [modelId, setModelId] = useState(initial);
  const [result, setResult] = useState<CameraTest | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(false);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const selectedModel = data.models.find((model) => model.id === modelId);

  useEffect(() => {
    if (!data.models.some((model) => model.id === modelId)) setModelId(initial);
  }, [data.models, modelId, initial]);

  async function discard() {
    const previous = result;
    setResult(null); setZoom(false); setError('');
    if (previous) await api.discardCameraTest(previous.id).catch(() => {});
  }

  async function analyze(file?: File) {
    if (!file || !modelId || busy) return;
    await discard();
    setBusy(true); setError('');
    try { setResult(await api.cameraTest(modelId, await uploadableImage(file))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível analisar a foto.'); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!result || saving) return;
    setSaving(true); setError('');
    try {
      const response = await fetch(result.annotatedUrl);
      if (!response.ok) throw new Error('A imagem de teste expirou. Tire outra foto.');
      const file = new File([await response.blob()], 'farmguard-teste.jpg', { type: 'image/jpeg' });
      if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: 'Teste FarmGuard' });
      } else {
        const url = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = url; link.download = file.name; link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a imagem.');
    } finally { setSaving(false); }
  }

  return <>
    <div className="page-title"><div><span className="eyebrow">Teste rápido</span><h1>Câmera e predição</h1><p>Tire uma foto no iPhone ou escolha uma imagem. A IA marca as possíveis detecções sem adicionar nada ao dataset.</p></div></div>
    <section className="panel camera-test-panel"><div className="camera-test-controls"><label>Modelo para o teste<select value={modelId} onChange={(event) => { void discard(); setModelId(event.target.value); }} disabled={busy}>{data.models.map((model) => <option key={model.id} value={model.id}>{model.isPromoted ? '★ ' : ''}{model.name}</option>)}</select></label><p>{selectedModel?.calibration && !selectedModel.calibration.stale ? `Ajuste calibrado: confiança ${selectedModel.calibration.best.confidence.toFixed(2)} · NMS IoU ${selectedModel.calibration.best.nms_iou.toFixed(2)}` : 'Sem calibração atual: o teste usará confiança 0,20 e NMS IoU 0,40.'}</p><div className="camera-test-buttons"><button className="primary-button" disabled={busy || !modelId} onClick={() => cameraInput.current?.click()}><Camera size={18} />Abrir câmera</button><button className="secondary-button" disabled={busy || !modelId} onClick={() => fileInput.current?.click()}><ImageIcon size={18} />Escolher foto</button></div><input ref={cameraInput} className="camera-file-input" type="file" accept="image/*" capture="environment" onChange={(event) => { void analyze(event.target.files?.[0]); event.target.value = ''; }} /><input ref={fileInput} className="camera-file-input" type="file" accept="image/*" onChange={(event) => { void analyze(event.target.files?.[0]); event.target.value = ''; }} /></div>
      {busy && <div className="camera-test-loading"><LoaderCircle className="spin" /><strong>Analisando a foto…</strong><span>O modelo é executado no PC que hospeda o Studio.</span></div>}
      {error && <div className="inline-error"><CircleAlert />{error}</div>}
      {result && <div className="camera-test-result"><div className="camera-test-result-head"><div><span className="eyebrow">Resultado</span><h2>{result.detections} possível(is) inseto(s)</h2><p>{result.modelName} · confiança {result.confidence.toFixed(2)} · IoU {result.nmsIou.toFixed(2)}{!result.calibrated ? ' · ajuste padrão' : ''}</p></div><button className="secondary-button" onClick={() => setZoom((value) => !value)}>{zoom ? 'Ajustar' : 'Ampliar'}</button></div><div className={`camera-test-preview ${zoom ? 'zoomed' : ''}`}><img src={result.annotatedUrl} alt="Foto com as detecções do FarmGuard" /></div><div className="camera-test-result-actions"><button className="primary-button" disabled={saving} onClick={() => void save()}><Share2 size={17} />{saving ? 'Preparando…' : 'Salvar / compartilhar'}</button><a className="secondary-button" href={`${result.annotatedUrl}?download=1`} download="farmguard-teste.jpg"><Download size={17} />Baixar imagem</a><button className="secondary-button" onClick={() => void discard()}><Trash2 size={17} />Descartar</button><button className="secondary-button" onClick={() => cameraInput.current?.click()}><RotateCcw size={17} />Nova foto</button></div><p className="camera-test-privacy">A foto fica temporariamente no Studio, não é publicada no FarmGuard nem enviada ao Drive. “Descartar” a remove; testes abandonados expiram em 24 horas.</p></div>}
    </section>
  </>;
}
