import type { ImageAnalysis } from '../../../shared/src/media';

export const ANALYSIS_PARAMETERS = { version: 1, sampleEdge: 512, thumbnailEdge: 480, previewEdge: 2560, colors: 6, bins: 32 } as const;
type Pixel = [number, number, number];
function channelRange(pixels: Pixel[]) {
  const min = [255, 255, 255], max = [0, 0, 0];
  for (const pixel of pixels) for (let c = 0; c < 3; c++) {
    min[c] = Math.min(min[c], pixel[c]); max[c] = Math.max(max[c], pixel[c]);
  }
  const ranges = max.map((value, c) => value - min[c]);
  const range = Math.max(...ranges);
  return { channel: ranges.indexOf(range), range };
}
export function analyzePixels(rgba: Buffer): ImageAnalysis | null {
  const pixels: Pixel[] = [];
  const histogram = Array<number>(ANALYSIS_PARAMETERS.bins).fill(0);
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    const pixel: Pixel = [rgba[i], rgba[i + 1], rgba[i + 2]];
    pixels.push(pixel);
    const brightness = 0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2];
    histogram[Math.min(31, Math.floor(brightness / 8))]++;
  }
  if (pixels.length < 4) return null;
  const boxes = [{ pixels, ...channelRange(pixels) }];
  while (boxes.length < ANALYSIS_PARAMETERS.colors) {
    boxes.sort((a, b) => b.range * b.pixels.length - a.range * a.pixels.length);
    const box = boxes[0];
    if (!box.range || box.pixels.length < 2) break;
    box.pixels.sort((a, b) => a[box.channel] - b[box.channel]);
    const half = Math.floor(box.pixels.length / 2);
    boxes.splice(0, 1, ...[box.pixels.slice(0, half), box.pixels.slice(half)].map(part => ({ pixels: part, ...channelRange(part) })));
  }
  const colors = new Map<string, number>();
  for (const box of boxes) {
    const sum = box.pixels.reduce<number[]>((acc, pixel) => acc.map((value, c) => value + pixel[c]), [0, 0, 0]);
    const hex = '#' + sum.map(value => Math.round(value / box.pixels.length).toString(16).padStart(2, '0')).join('');
    colors.set(hex, (colors.get(hex) ?? 0) + box.pixels.length / pixels.length);
  }
  return { version: ANALYSIS_PARAMETERS.version, colors: [...colors].map(([hex, ratio]) => ({ hex, ratio })).sort((a, b) => b.ratio - a.ratio), histogram, pixelCount: pixels.length };
}
