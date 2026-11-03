import { useEffect, useId, useRef, useState } from 'react';
import { Maximize, Minus, Plus, X } from 'lucide-react';
import type { AnnotationEvaluation as Evaluation, Box } from '../types';

const layers = [
  { id: 'tp', label: 'Acertos', color: '#49ebac' },
  { id: 'fp', label: 'Sem correspondência', color: '#ff616b' },
  { id: 'fn', label: 'Não detectados', color: '#ffbe55' },
  { id: 'ignored', label: 'Neutralizados', color: '#c6ccd5' },
  { id: 'regions', label: 'Áreas incertas', color: '#bd8bff' },
  { id: 'reference', label: 'Referência humana', color: '#5eb7ff' },
] as const;

export function AnnotationEvaluation({ result, onClose }: { result: Evaluation; onClose: () => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const hatch = useId().replace(/:/g, '');
  const [visible, setVisible] = useState({ tp: true, fp: true, fn: true, ignored: false, regions: true, reference: false });
  const [fitScale, setFitScale] = useState(0.25);
  const [zoom, setZoom] = useState(1);
  const { annotation, counts } = result;
  const scale = fitScale * zoom;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const controls = stage.current?.parentElement?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), summary, [tabindex="0"]');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, [onClose]);
  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      setFitScale(Math.max(0.01, Math.min((node.clientWidth - 24) / annotation.width, (node.clientHeight - 24) / annotation.height)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [annotation.width, annotation.height]);
  const rectangle = (box: Box, key: string, color: string, dashed = false, title = '') => <rect key={key}
    x={box.x} y={box.y} width={box.width} height={box.height} fill="none" stroke={color}
    strokeWidth={2 / scale} strokeDasharray={dashed ? `${6 / scale} ${4 / scale}` : undefined}>
    <title>{title}</title>
  </rect>;
  const percent = (value: number | null) => value === null ? '—' : `${(100 * value).toFixed(1)}%`;
  return <div className="modal-backdrop evaluation-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="evaluation-modal" role="dialog" aria-modal="true" aria-labelledby="evaluation-title" aria-describedby="evaluation-description">
      <header className="evaluation-header"><div><span className="eyebrow">Conferência da IA · {result.mode === 'enhanced' ? 'reforçada' : 'padrão'}</span><h2 id="evaluation-title">Detecções e referência humana</h2><p id="evaluation-description">{annotation.image} · {result.model}</p></div><button ref={closeButton} className="icon-button" aria-label="Fechar conferência" onClick={onClose}><X /></button></header>
      <div className="evaluation-metrics">
        <span><strong>{counts.tp}</strong> acertos</span><span><strong>{counts.fp}</strong> sem correspondência</span><span><strong>{counts.fn}</strong> não detectados</span><span><strong>{counts.ignored}</strong> neutralizados</span><span>Precisão <strong>{percent(result.precision)}</strong></span><span>Revocação <strong>{percent(result.recall)}</strong></span>
      </div>
      <details className="evaluation-help"><summary>Como ler a comparação · {counts.reference} insetos revisados</summary><p className="evaluation-explanation">Vermelho indica possível erro da IA ou anotação a revisar. Cinza não recebe acerto nem erro. Insetos confirmados dentro do roxo continuam valendo; duplicatas continuam como erro. As áreas incertas não somam insetos ao total. Esta conferência usa IoU ≥ {result.matchIou.toFixed(2).replace('.', ',')}, o mesmo critério da calibração; o mAP mede limiares diferentes (0,50 a 0,95).</p></details>
      {result.countIsPartial && <p className="evaluation-partial">Contagem parcial · regiões incertas em {percent(result.uncertainFraction)} da foto.</p>}
      <div className="evaluation-controls"><div className="evaluation-legend">{layers.map(({ id, label, color }) => <label key={id} style={{ color }}><input type="checkbox" checked={visible[id]} onChange={() => setVisible((current) => ({ ...current, [id]: !current[id] }))} />{label}</label>)}</div><div className="evaluation-zoom"><button className="icon-button" aria-label="Diminuir zoom da conferência" onClick={() => setZoom((value) => Math.max(1, value / 1.5))}><Minus /></button><button className="icon-button" aria-label="Ajustar foto da conferência" onClick={() => setZoom(1)}><Maximize /></button><button className="icon-button" aria-label="Aumentar zoom da conferência" onClick={() => setZoom((value) => Math.min(16, value * 1.5))}><Plus /></button></div></div>
      <div className="evaluation-stage" ref={stage} tabIndex={0} aria-label="Foto com resultados; amplie e role para examinar os detalhes">
        <svg width={annotation.width * scale} height={annotation.height * scale} viewBox={`0 0 ${annotation.width} ${annotation.height}`} role="img" aria-label="Acertos, erros, insetos não detectados e áreas incertas">
          <defs><pattern id={hatch} patternUnits="userSpaceOnUse" width={14 / scale} height={14 / scale}><path d={`M0 0 L${14 / scale} ${14 / scale}`} stroke="#bd8bff" strokeWidth={1 / scale} opacity="0.4" /></pattern></defs>
          <image href={`/api/annotations/${annotation.key}/image`} width={annotation.width} height={annotation.height} />
          {visible.regions && (annotation.ignore_regions || []).map((region, i) => <g key={`region-${i}`}><rect x={region.x} y={region.y} width={region.width} height={region.height} fill={region.kind === 'crowd' ? `url(#${hatch})` : '#bd8bff30'} />{rectangle(region, `border-${i}`, '#bd8bff', region.kind === 'crowd', region.kind === 'crowd' ? 'Aglomerado: indivíduos não delimitáveis' : 'Indefinida: não dá para confirmar insetos')}</g>)}
          {visible.reference && annotation.boxes.map((box, i) => rectangle(box, `truth-${i}`, '#5eb7ff', true, `Referência humana #${i + 1}`))}
          {result.predictions.map((box, i) => visible[box.status] && rectangle(box, `pred-${i}`, layers.find((layer) => layer.id === box.status)!.color, box.status === 'ignored', `${box.status === 'tp' ? 'Acerto' : box.status === 'fp' ? 'Sem correspondência' : 'Neutralizado'} · ${percent(box.confidence)}`))}
          {visible.fn && result.missed.map((i) => rectangle(annotation.boxes[i], `missed-${i}`, '#ffbe55', true, `Inseto não detectado #${i + 1}`))}
        </svg>
      </div>
      <footer className="evaluation-footer">Conferência sem alterar suas anotações · IoU ≥ {result.matchIou.toFixed(2).replace('.', ',')}.</footer>
    </section>
  </div>;
}
