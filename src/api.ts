import type { Annotation, AnnotationSummary, AuthStatus, CameraTest, DatasetImage, Job, Overview, PredictionDetections, PublicationChange } from './types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (response.status === 401 && url !== '/api/auth/login') {
    window.dispatchEvent(new Event('farmguard:unauthorized'));
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Falha HTTP ${response.status}`);
  return body as T;
}

export const api = {
  authStatus: () => request<AuthStatus>('/api/auth/status'),
  login: (username: string, password: string) =>
    request<AuthStatus>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<AuthStatus>('/api/auth/logout', { method: 'POST' }),
  overview: () => request<Overview>('/api/overview'),
  calibrationPreview: (image: string, selections: Array<{ modelId: string; confidence: number; iou: number }>) =>
    request<{ id: string; image: string; results: Array<{ width: number; height: number; detections: number;
      boxes: Array<{ xyxy: number[]; confidence: number }>; url: string }> }>('/api/calibration/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image, selections }),
    }),
  promoteModel: (modelId: string) => request<{ name: string; modelId: string; confidence: number; nmsIou: number; backupRoot: string; iaApiWarning?: string }>('/api/models/promote', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId, confirmation: 'PROMOVER' }),
  }),
  cameraTest: async (modelId: string, file: File) => {
    const response = await fetch(`/api/camera-test?modelId=${encodeURIComponent(modelId)}`, {
      method: 'POST', headers: { 'Content-Type': file.type }, body: file,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Falha HTTP ${response.status}`);
    return body as CameraTest;
  },
  discardCameraTest: (id: string) => fetch(`/api/camera-test/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  datasetSplit: () => request<DatasetImage[]>('/api/dataset/split'),
  moveDatasetImage: (image: string, split: 'train' | 'val') => request<DatasetImage[]>('/api/dataset/split', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image, split }),
  }),
  reapplyDatasetSplit: () => request<DatasetImage[]>('/api/dataset/split/reapply', { method: 'POST' }),
  annotations: () => request<AnnotationSummary[]>('/api/annotations'),
  uploadParquet: async (file: File) => {
    const response = await fetch('/api/sources/parquet', {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Falha HTTP ${response.status}`);
    return body as { count: number };
  },
  annotation: (key: string) => request<Annotation>(`/api/annotations/${key}`),
  saveAnnotation: (annotation: Annotation) =>
    request<Annotation>(`/api/annotations/${annotation.key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(annotation),
    }),
  suggestAnnotation: (key: string) =>
    request<{ key: string; model: string; boxes: Annotation['boxes'] }>(`/api/annotations/${encodeURIComponent(key)}/suggest`, {
      method: 'POST',
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
  predictionDetections: (group: string, file: string) =>
    request<PredictionDetections>(`/api/predictions/${encodeURIComponent(group)}/${encodeURIComponent(file)}/detections`),
  publicationPlan: () => request<PublicationChange[]>('/api/publication/plan'),
  publishDrafts: (keys: string[], rebuild = false) =>
    request<{ published: string[]; imagesAdded: string[]; driveBackedUp: number; driveErrors: string[]; backupRoot: string; job: Job | null }>('/api/publication/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys, rebuild }),
    }),
};
