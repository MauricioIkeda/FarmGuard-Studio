import crypto from 'node:crypto';
import fs from 'node:fs/promises';

export function shareImageWork<T>() {
  const pending = new Map<string, Promise<T>>();
  return (key: string, work: () => Promise<T>) => {
    const existing = pending.get(key);
    if (existing) return existing;
    const task = Promise.resolve().then(work).finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  };
}

export function limitImageWork(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    else active += 1;
    try { return await work(); }
    finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

export async function writeImageCache(target: string, buffer: Buffer) {
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, buffer);
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
