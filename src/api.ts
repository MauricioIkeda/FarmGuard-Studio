import type { Annotation, AnnotationSummary, Job, Overview } from './types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Falha HTTP ${response.status}`);
  return body as T;
}

export const api = {
  overview: () => request<Overview>('/api/overview'),
  annotations: () => request<AnnotationSummary[]>('/api/annotations'),
  annotation: (key: string) => request<Annotation>(`/api/annotations/${key}`),
  saveAnnotation: (annotation: Annotation) =>
    request<Annotation>(`/api/annotations/${annotation.key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(annotation),
    }),
  jobs: () => request<Job[]>('/api/jobs'),
  createJob: (type: Job['type'], options: Record<string, unknown>) =>
    request<Job>('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, options }),
    }),
  predictionFiles: (group: string) =>
    request<string[]>(`/api/predictions/${encodeURIComponent(group)}`),
};
