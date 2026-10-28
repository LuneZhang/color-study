import { z } from 'zod';
import { optionalUrl, type Entity } from './core';
export const assetMetaInput = z.object({
  role: z.enum(['user_raw', 'tutorial_raw', 'reference', 'target', 'export', 'preview', 'attachment']).default('reference'),
  sourceUrl: optionalUrl, rightsEvidence: z.string().trim().min(1).max(3000),
  canAnalyze: z.boolean().default(false), owned: z.boolean().default(false),
  tutorialId: z.string().max(100).optional(), pairingEvidence: z.string().max(3000).default(''),
});
export interface ImageAnalysis {
  version: number; colors: { hex: string; ratio: number }[]; histogram: number[]; pixelCount: number;
}
export interface Asset extends Entity {
  name: string; kind: 'image' | 'raw'; role: z.infer<typeof assetMetaInput>['role']; mime: string;
  size: number; hash: string; relativePath: string; previewPath: string | null; thumbnailPath: string | null;
  width: number | null; height: number | null; sourceUrl: string; rightsEvidence: string;
  canAnalyze: boolean; owned: boolean; analysis: ImageAnalysis | null;
}
export const MEDIA_LIMITS = { imageBytes: 50 * 1024 ** 2, rawBytes: 512 * 1024 ** 2, pixels: 100_000_000 };
