import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

export type ApiPrediction = {
  model: { name: string; sha256: string };
  image: { width: number; height: number };
  estimated_count: number;
  detections: Array<{ confidence: number; box_px: { x: number; y: number; width: number; height: number } }>;
};

export type ApiModel = { name: string; sha256: string; confidence: number; nms_iou: number };

export function iaApiConfigured() { return Boolean(config.iaApiInternalUrl); }

function headers(extra: Record<string, string> = {}) {
  return { ...extra, ...(config.iaApiInternalToken ? { 'x-farmguard-internal-token': config.iaApiInternalToken } : {}) };
}

function endpoint(route: string) {
  const url = new URL(route, `${config.iaApiInternalUrl.replace(/\/$/, '')}/`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Endereço interno da IA API inválido.');
  return url;
}

export async function predictPromotedImage(imagePath: string): Promise<ApiPrediction> {
  if (!iaApiConfigured()) throw new Error('IA API interna não configurada.');
  const mime = ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' } as Record<string, string>)[path.extname(imagePath).toLowerCase()];
  if (!mime) throw new Error('Formato de imagem incompatível com a IA API.');
  const body = await fs.readFile(imagePath);
  if (body.length > 15 * 1024 * 1024) throw new Error('A imagem excede o limite de 15 MB da IA API.');
  const response = await fetch(endpoint('/v1/predict'), {
    method: 'POST', headers: headers({ 'content-type': mime }), body: new Uint8Array(body), signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`IA API retornou HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const result = await response.json() as ApiPrediction;
  if (!result.model?.name || !Number.isFinite(result.image?.width) || !Number.isFinite(result.image?.height) || !Array.isArray(result.detections)) {
    throw new Error('Resposta inválida da IA API.');
  }
  return result;
}

export async function reloadPromotedModel() {
  if (!iaApiConfigured()) return;
  const response = await fetch(endpoint('/internal/reload'), {
    method: 'POST', headers: headers(), signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`IA API não atualizou o modelo: HTTP ${response.status}.`);
}

export async function getPromotedModel(): Promise<ApiModel> {
  const response = await fetch(endpoint('/v1/model'), { headers: headers(), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`IA API retornou HTTP ${response.status} ao consultar o modelo.`);
  const result = await response.json() as ApiModel;
  if (!result.name || !Number.isFinite(result.confidence) || !Number.isFinite(result.nms_iou)) throw new Error('Modelo inválido na IA API.');
  return result;
}
