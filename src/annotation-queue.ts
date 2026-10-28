import type { AnnotationSummary } from './types.js';

export const annotationQueueFilters = [
  { value: 'pending', label: 'Para revisar' },
  { value: 'started', label: 'Em andamento' },
  { value: 'reviewed', label: 'Revisadas' },
  { value: 'excluded', label: 'Excluídas' },
  { value: 'all', label: 'Todas' },
] as const;

export type AnnotationQueueStatus = typeof annotationQueueFilters[number]['value'];
type QueueItem = Pick<AnnotationSummary, 'reviewed' | 'excluded' | 'boxes'>;

export function annotationMatchesStatus(item: QueueItem, status: AnnotationQueueStatus) {
  if (status === 'all') return true;
  if (status === 'excluded') return item.excluded;
  if (item.excluded) return false;
  if (status === 'reviewed') return item.reviewed;
  return !item.reviewed && (status !== 'started' || item.boxes > 0);
}

export function annotationQueueCounts(items: QueueItem[]) {
  return Object.fromEntries(annotationQueueFilters.map(({ value }) =>
    [value, items.filter((item) => annotationMatchesStatus(item, value)).length])) as Record<AnnotationQueueStatus, number>;
}
