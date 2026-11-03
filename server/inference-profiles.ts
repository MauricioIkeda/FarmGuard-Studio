import fs from 'node:fs/promises';
import path from 'node:path';
import { farmPaths } from './config.js';
import type { InferenceSettings } from './model-management.js';

export function enhancedSettings(published: InferenceSettings, document: Record<string, unknown>): InferenceSettings {
  const profiles = document.annotation_profiles;
  if (profiles !== undefined && (!profiles || typeof profiles !== 'object' || Array.isArray(profiles))) {
    throw new Error('Perfis de anotação inválidos.');
  }
  const profile = (profiles as Record<string, unknown> | undefined)?.enhanced as Record<string, unknown> | undefined;
  if (profile === undefined) return { ...published, imgsz: 1280 };
  if (!profile || typeof profile !== 'object' || Array.isArray(profile) || profile.augment !== true ||
      typeof profile.model_sha256 !== 'string' || !published.modelSha256 ||
      profile.model_sha256.toUpperCase() !== published.modelSha256.toUpperCase()) {
    throw new Error('O perfil reforçado não corresponde ao modelo principal.');
  }
  const { imgsz, confidence, nms_iou: nmsIou, max_det: maxDet } = profile;
  if (typeof imgsz !== 'number' || !Number.isInteger(imgsz) || imgsz < 640 || imgsz > 1920 || imgsz % 32 !== 0 ||
      typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < .01 || confidence > .99 ||
      typeof nmsIou !== 'number' || !Number.isFinite(nmsIou) || nmsIou < .01 || nmsIou > .99 ||
      typeof maxDet !== 'number' || !Number.isInteger(maxDet) || maxDet < 1 || maxDet > 1000) {
    throw new Error('Parâmetros do perfil reforçado inválidos.');
  }
  return { ...published, imgsz, confidence, nmsIou, maxDet };
}

export async function promotedEnhancedSettings(published: InferenceSettings) {
  const document = JSON.parse(await fs.readFile(path.join(farmPaths.models, 'insect-detector.json'), 'utf8')) as Record<string, unknown>;
  return enhancedSettings(published, document);
}
