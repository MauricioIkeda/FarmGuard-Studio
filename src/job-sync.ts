import type { Job } from './types';

function isFinished(job: Job) {
  return ['completed', 'failed', 'cancelled', 'interrupted'].includes(job.status);
}

function newer(left: Job, right: Job): Job {
  if (isFinished(left) !== isFinished(right)) return isFinished(left) ? left : right;
  const leftCount = left.logCount ?? left.logs.length;
  const rightCount = right.logCount ?? right.logs.length;
  if (leftCount !== rightCount) return leftCount > rightCount ? left : right;
  const rank = { queued: 0, running: 1, completed: 2, failed: 2, cancelled: 2, interrupted: 2 };
  if (rank[left.status] !== rank[right.status]) return rank[left.status] > rank[right.status] ? left : right;
  return right;
}

export function mergeJobs(current: Job[], incoming: Job[]): Job[] {
  const byId = new Map(current.map((job) => [job.id, job]));
  for (const job of incoming) {
    const previous = byId.get(job.id);
    byId.set(job.id, previous ? newer(previous, job) : job);
  }
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
