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

export type Model = {
  id: string;
  name: string;
  path: string;
  group: 'model' | 'run';
  size: number;
  modifiedAt: string;
};

export type Prediction = {
  name: string;
  count: number;
  modifiedAt: string;
  preview: string | null;
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
  predictions: Prediction[];
  thresholds: Array<Record<string, string | number>>;
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
  studioDraft?: boolean;
};

export type Job = {
  id: string;
  type: 'train' | 'validate' | 'predict' | 'tune';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  logs: string[];
  command: string[];
  exitCode?: number | null;
};
