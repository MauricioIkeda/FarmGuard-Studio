import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import crypto from 'node:crypto';
import readline from 'node:readline';
import type { WorkerPrediction } from './ai-suggestions.js';
import type { InferenceSettings } from './model-management.js';

type Pending = {
  id: string;
  resolve: (value: WorkerPrediction) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export class EnhancedWorker {
  private child?: ChildProcessWithoutNullStreams;
  private lines?: readline.Interface;
  private pending?: Pending;
  private idle?: ReturnType<typeof setTimeout>;
  private errorTail = '';

  constructor(private readonly python: string, private readonly worker: string, private readonly cwd: string,
    private readonly timeoutMs = 120_000, private readonly idleMs = 180_000) {}

  run(image: string, settings: InferenceSettings): Promise<WorkerPrediction> {
    if (this.pending) return Promise.reject(new Error('A IA já está analisando outra imagem.'));
    clearTimeout(this.idle);
    if (!this.child) this.start();
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => this.close(new Error('A inferência excedeu o tempo limite.')), this.timeoutMs);
      this.pending = { id, resolve, reject, timeout };
      this.child!.stdin.write(`${JSON.stringify({ id, image, settings })}\n`, (error) => {
        if (error && this.pending?.id === id) this.close(error);
      });
    });
  }

  close(error = new Error('O processo de análise foi encerrado.')) {
    clearTimeout(this.idle);
    const pending = this.pending;
    this.pending = undefined;
    if (pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.lines?.close();
    this.lines = undefined;
    const child = this.child;
    this.child = undefined;
    child?.kill();
  }

  private start() {
    const child = spawn(this.python, [this.worker, '--persistent'], {
      cwd: this.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.errorTail = '';
    this.lines = readline.createInterface({ input: child.stdout });
    const fail = (error: Error) => { if (this.child === child) this.close(error); };
    child.stderr.on('data', (chunk: Buffer) => {
      if (this.child === child) this.errorTail = `${this.errorTail}${chunk.toString('utf8')}`.slice(-2000);
    });
    child.stdin.on('error', fail);
    child.on('error', fail);
    child.on('close', (code) => fail(new Error(`Worker de IA encerrou (código ${code}). ${this.errorTail.trim()}`)));
    this.lines.on('line', (line) => {
      if (this.child !== child || !this.pending) return;
      let message: Record<string, unknown>;
      try { message = JSON.parse(line) as Record<string, unknown>; }
      catch { return; }
      if (message?.id !== this.pending.id) return;
      if (message.ok !== true) {
        this.close(new Error(String(message.error || 'Falha na inferência da IA.')));
        return;
      }
      const result = message.result as WorkerPrediction | undefined;
      if (!result || !Array.isArray(result.detections) || !Number.isFinite(result.width) || !Number.isFinite(result.height)) {
        this.close(new Error('Resposta inválida do worker de IA.'));
        return;
      }
      const pending = this.pending;
      this.pending = undefined;
      clearTimeout(pending.timeout);
      this.idle = setTimeout(() => { if (!this.pending) this.close(); }, this.idleMs);
      this.idle.unref();
      pending.resolve(result);
    });
  }
}
