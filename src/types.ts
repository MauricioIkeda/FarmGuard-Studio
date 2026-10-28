export type MetricHistory = Record<string, string | number>;

export type Run = {
  name: string;
  epochs: number;
  modifiedAt: string;
  hasBest: boolean;
  hasLast: boolean;
  bestPath: string | null;
  metrics: {
    precision: number;
    recall: number;
    map50: number;
    map5095: number;
    boxLoss: number;
  };
  history: MetricHistory[];
};

export type InferenceSource = 'promoted' | 'calibration' | 'defaults';
export const inferenceSourceLabel = (source: InferenceSource) => ({
  promoted: 'Ajuste publicado', calibration: 'Calibração atual', defaults: 'Valores padrão',
})[source];

export type Model = {
  id: string;
  name: string;
  path: string;
  group: 'model' | 'run';
  size: number;
  modifiedAt: string;
  calibration: ModelCalibration | null;
  isPromoted: boolean;
  inference: { confidence: number; nmsIou: number; imgsz: number; maxDet: number; source: InferenceSource };
};

export type ThresholdRow = {
  confidence: number; nms_iou: number; match_iou: number;
  ground_truth: number; predictions: number; tp: number; fp: number; fn: number;
  precision: number; recall: number; f1: number; edit_proxy: number;
  ignored_predictions?: number;
};

export type ModelCalibration = {
  modelId: string;
  calibratedAt: string;
  mode?: 'automatic' | 'manual';
  best: ThresholdRow;
  rows: ThresholdRow[];
  testedPairs?: number;
  stale: boolean;
};

export type Prediction = {
  name: string;
  count: number;
  modifiedAt: string;
  preview: string | null;
};

export type PredictionDetections = {
  width: number;
  height: number;
  boxes: Array<{ x1: number; y1: number; x2: number; y2: number; confidence: number }>;
};

export type Overview = {
  connected: boolean;
  farmGuardRoot: string;
  operationsEnabled: boolean;
  dataset: {
    total: number;
    reviewed: number;
    pending: number;
    excluded: number;
    boxes: number;
    drafts: number;
    traps: Array<{ name: string; count: number }>;
  };
  runs: Run[];
  models: Model[];
  promoted: { name: string; sourceModelId: string | null } | null;
  predictions: Prediction[];
  thresholds: Array<Record<string, string | number>>;
  drive: {
    configured: boolean;
    connected: boolean;
    remote: string | null;
    projectRoot: string | null;
    error?: string;
  };
};

export type AnnotationSummary = {
  key: string;
  image: string;
  reviewed: boolean;
  excluded: boolean;
  boxes: number;
  width: number;
  height: number;
  trap: string | null;
  createdAt: string | null;
  cached: boolean;
};

export type DatasetImage = {
  image: string;
  split: 'train' | 'val';
  desiredSplit: 'train' | 'val';
  trap: string;
  boxes: number;
  ignoreRegions: number;
};

export type Box = { x: number; y: number; width: number; height: number };

export type Annotation = {
  schema_version: number;
  key: string;
  image: string;
  width: number;
  height: number;
  reviewed: boolean;
  excluded: boolean;
  class: string;
  source?: { type?: string; url?: string; metadata?: Record<string, unknown> };
  boxes: Box[];
  ignore_regions?: Box[];
  studioDraft?: boolean;
};

export type Job = {
  id: string;
  type: 'train' | 'validate' | 'predict' | 'tune' | 'dataset' | 'drive' | 'drive-pull' | 'drive-datasets';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  logs: string[];
  logCount?: number;
  command: string[];
  exitCode?: number | null;
  calibration?: { modelId: string };
};

export type AuthStatus = {
  enabled: boolean;
  authenticated: boolean;
  username: string | null;
};

export type PublicationChange = {
  key: string;
  image: string;
  trap: string | null;
  publishedBefore: boolean;
  boxesBefore: number;
  boxesAfter: number;
  ignoreBefore: number;
  ignoreAfter: number;
  reviewedBefore: boolean;
  reviewedAfter: boolean;
  excludedBefore: boolean;
  excludedAfter: boolean;
  changed: boolean;
};

export type CameraTest = {
  id: string;
  modelId: string;
  modelName: string;
  confidence: number;
  nmsIou: number;
  calibrated: boolean;
  settingsSource: InferenceSource;
  width: number;
  height: number;
  detections: number;
  originalUrl: string;
  annotatedUrl: string;
};
