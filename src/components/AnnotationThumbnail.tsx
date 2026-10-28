import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';

export function AnnotationThumbnail({ annotationKey }: { annotationKey: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '120px' });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return <span ref={ref} className="queue-thumb" title={state === 'error' ? 'Miniatura indisponível. Selecione a foto para tentar abrir.' : undefined}>
    {state !== 'ready' && <ImageIcon size={20} />}
    {visible && state !== 'error' && <img src={`/api/annotations/${annotationKey}/thumbnail`} decoding="async" fetchPriority="low" alt="" onLoad={() => setState('ready')} onError={() => setState('error')} />}
  </span>;
}
