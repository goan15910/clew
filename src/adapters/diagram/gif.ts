// Pack rasters into an animated GIF. Graphviz draws the frames; this file does not lay them out.
import { inflateSync } from 'node:zlib';

export interface Raster {
  width: number;
  height: number;
  rgba: Uint8Array;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
  if (distanceUp <= distanceUpLeft) return up;
  return upLeft;
}

function unfilter(data: Buffer, width: number, height: number, bpp: number): Buffer {
  const stride = width * bpp;
  const expected = height * (stride + 1);
  if (data.length < expected) throw new Error('truncated PNG image data');
  const out = Buffer.alloc(height * stride);
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = data[src] ?? 0;
    src += 1;
    const row = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const raw = data[src] ?? 0;
      src += 1;
      const left = x >= bpp ? out[row + x - bpp] ?? 0 : 0;
      const up = y > 0 ? out[row - stride + x] ?? 0 : 0;
      const upLeft = x >= bpp && y > 0 ? out[row - stride + x - bpp] ?? 0 : 0;
      let value = raw;
      if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + Math.floor((left + up) / 2);
      else if (filter === 4) value = raw + paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
      out[row + x] = value & 255;
    }
  }
  return out;
}

export function decodePng(bytes: Buffer): Raster {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('PNG signature missing');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let sawHeader = false;
  const idat: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) throw new Error('truncated PNG');
    const chunk = bytes.subarray(start, end);
    if (type === 'IHDR') {
      sawHeader = true;
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      const bitDepth = chunk[8] ?? 0;
      colorType = chunk[9] ?? 0;
      const interlace = chunk[12] ?? 0;
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
        throw new Error(`unsupported PNG ${width}x${height} depth ${bitDepth} color ${colorType}`);
      }
    } else if (type === 'IDAT') idat.push(Buffer.from(chunk));
    else if (type === 'IEND') break;
    offset = end + 4;
  }
  if (!sawHeader || width < 1 || height < 1 || idat.length === 0) throw new Error('PNG is missing image data');
  const bpp = colorType === 6 ? 4 : 3;
  const raw = unfilter(inflateSync(Buffer.concat(idat)), width, height, bpp);
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const src = i * bpp;
    rgba[i * 4] = raw[src] ?? 0;
    rgba[i * 4 + 1] = raw[src + 1] ?? 0;
    rgba[i * 4 + 2] = raw[src + 2] ?? 0;
    rgba[i * 4 + 3] = bpp === 4 ? raw[src + 3] ?? 255 : 255;
  }
  return { width, height, rgba };
}

function pad(frame: Raster, width: number, height: number): Raster {
  if (frame.width === width && frame.height === height) return frame;
  const rgba = new Uint8Array(width * height * 4);
  rgba.fill(255);
  const copyWidth = Math.min(frame.width, width);
  const copyHeight = Math.min(frame.height, height);
  for (let y = 0; y < copyHeight; y += 1) {
    for (let x = 0; x < copyWidth; x += 1) {
      const src = (y * frame.width + x) * 4;
      const dst = (y * width + x) * 4;
      rgba[dst] = frame.rgba[src] ?? 255;
      rgba[dst + 1] = frame.rgba[src + 1] ?? 255;
      rgba[dst + 2] = frame.rgba[src + 2] ?? 255;
      rgba[dst + 3] = 255;
    }
  }
  return { width, height, rgba };
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface Counted extends Rgb {
  count: number;
}

function histogram(frames: readonly Raster[]): Counted[] {
  const counts = new Map<number, number>();
  for (const frame of frames) {
    const pixels = frame.width * frame.height;
    for (let i = 0; i < pixels; i += 1) {
      const offset = i * 4;
      const key = ((frame.rgba[offset] ?? 0) << 16) | ((frame.rgba[offset + 1] ?? 0) << 8) | (frame.rgba[offset + 2] ?? 0);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const colors: Counted[] = [];
  for (const [key, count] of counts) {
    colors.push({ r: (key >> 16) & 255, g: (key >> 8) & 255, b: key & 255, count });
  }
  return colors;
}

function channelRange(box: readonly Counted[]): { channel: 'r' | 'g' | 'b'; range: number } {
  let minR = 255;
  let maxR = 0;
  let minG = 255;
  let maxG = 0;
  let minB = 255;
  let maxB = 0;
  for (const color of box) {
    if (color.r < minR) minR = color.r;
    if (color.r > maxR) maxR = color.r;
    if (color.g < minG) minG = color.g;
    if (color.g > maxG) maxG = color.g;
    if (color.b < minB) minB = color.b;
    if (color.b > maxB) maxB = color.b;
  }
  const red = maxR - minR;
  const green = maxG - minG;
  const blue = maxB - minB;
  if (green >= red && green >= blue) return { channel: 'g', range: green };
  if (red >= blue) return { channel: 'r', range: red };
  return { channel: 'b', range: blue };
}

function average(box: readonly Counted[]): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const color of box) {
    r += color.r * color.count;
    g += color.g * color.count;
    b += color.b * color.count;
    n += color.count;
  }
  if (n === 0) return { r: 0, g: 0, b: 0 };
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

function splitBox(box: readonly Counted[]): [Counted[], Counted[]] {
  const { channel } = channelRange(box);
  const sorted = box.slice().sort((left, right) => left[channel] - right[channel]);
  let total = 0;
  for (const color of sorted) total += color.count;
  let seen = 0;
  let index = 0;
  for (; index < sorted.length - 1; index += 1) {
    seen += sorted[index]?.count ?? 0;
    if (seen >= total / 2) {
      index += 1;
      break;
    }
  }
  if (index <= 0) index = 1;
  if (index >= sorted.length) index = sorted.length - 1;
  return [sorted.slice(0, index), sorted.slice(index)];
}

function paletteOf(frames: readonly Raster[]): Rgb[] {
  const colors = histogram(frames);
  if (colors.length === 0) return [{ r: 255, g: 255, b: 255 }];
  let boxes: Counted[][] = [colors];
  while (boxes.length < 256) {
    let best = -1;
    let bestRange = 0;
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i];
      if (box === undefined || box.length < 2) continue;
      const { range } = channelRange(box);
      if (range > bestRange) {
        bestRange = range;
        best = i;
      }
    }
    if (best < 0 || bestRange === 0) break;
    const box = boxes[best];
    if (box === undefined) break;
    const [left, right] = splitBox(box);
    boxes.splice(best, 1, left, right);
  }
  const palette = boxes.map((box) => average(box));
  while (palette.length < 256) palette.push({ r: 255, g: 255, b: 255 });
  return palette.slice(0, 256);
}

function nearest(palette: readonly Rgb[], cache: Map<number, number>, r: number, g: number, b: number): number {
  const key = (r << 16) | (g << 8) | b;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < palette.length; i += 1) {
    const color = palette[i];
    if (color === undefined) continue;
    const dr = r - color.r;
    const dg = g - color.g;
    const db = b - color.b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
      if (distance === 0) break;
    }
  }
  cache.set(key, best);
  return best;
}

function indexFrame(frame: Raster, palette: readonly Rgb[], cache: Map<number, number>): Uint8Array {
  const indices = new Uint8Array(frame.width * frame.height);
  for (let i = 0; i < indices.length; i += 1) {
    const offset = i * 4;
    indices[i] = nearest(palette, cache, frame.rgba[offset] ?? 0, frame.rgba[offset + 1] ?? 0, frame.rgba[offset + 2] ?? 0);
  }
  return indices;
}

function lzw(indices: Uint8Array, minCodeSize: number): number[] {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoi + 1;
  const dict = new Map<string, number>();
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  const emit = (code: number): void => {
    buffer |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      out.push(buffer & 255);
      buffer >>= 8;
      bits -= 8;
    }
  };
  const phraseCode = (phrase: string): number => {
    if (phrase.length === 1) return phrase.charCodeAt(0);
    const code = dict.get(phrase);
    if (code === undefined) throw new Error('gif lzw phrase missing');
    return code;
  };
  const reset = (): void => {
    dict.clear();
    codeSize = minCodeSize + 1;
    nextCode = eoi + 1;
  };
  emit(clear);
  let phrase = '';
  for (let i = 0; i < indices.length; i += 1) {
    const symbol = String.fromCharCode(indices[i] ?? 0);
    const next = phrase + symbol;
    if (phrase.length === 0 || dict.has(next)) {
      phrase = next;
      continue;
    }
    emit(phraseCode(phrase));
    if (nextCode < 4096) {
      dict.set(next, nextCode);
      if (nextCode === (1 << codeSize) && codeSize < 12) codeSize += 1;
      nextCode += 1;
    } else {
      emit(clear);
      reset();
    }
    phrase = symbol;
  }
  if (phrase.length > 0) emit(phraseCode(phrase));
  emit(eoi);
  if (bits > 0) out.push(buffer & 255);
  return out;
}

function pushSubBlocks(target: number[], data: readonly number[]): void {
  let offset = 0;
  while (offset < data.length) {
    const size = Math.min(255, data.length - offset);
    target.push(size);
    for (let i = 0; i < size; i += 1) target.push(data[offset + i] ?? 0);
    offset += size;
  }
  target.push(0);
}

function writeGif(width: number, height: number, palette: readonly Rgb[], frames: readonly Uint8Array[], timing: { delayCs: number; lastDelayCs: number }): number[] {
  const bytes: number[] = [
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
    width & 255, (width >> 8) & 255,
    height & 255, (height >> 8) & 255,
    0xf7, 0x00, 0x00,
  ];
  for (let i = 0; i < 256; i += 1) {
    const color = palette[i] ?? { r: 255, g: 255, b: 255 };
    bytes.push(color.r, color.g, color.b);
  }
  bytes.push(
    0x21, 0xff, 0x0b,
    0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30,
    0x03, 0x01, 0x00, 0x00, 0x00,
  );
  frames.forEach((indices, index) => {
    const delay = index === frames.length - 1 ? timing.lastDelayCs : timing.delayCs;
    bytes.push(0x21, 0xf9, 0x04, 0x04, delay & 255, (delay >> 8) & 255, 0x00, 0x00);
    bytes.push(0x2c, 0x00, 0x00, 0x00, 0x00, width & 255, (width >> 8) & 255, height & 255, (height >> 8) & 255, 0x00);
    bytes.push(8);
    pushSubBlocks(bytes, lzw(indices, 8));
  });
  bytes.push(0x3b);
  return bytes;
}

export function encodeAnimatedGif(frames: readonly Raster[], timing: { delayCs: number; lastDelayCs: number }): Buffer {
  if (frames.length === 0) throw new Error('a replay needs a frame');
  const first = frames[0];
  if (first === undefined) throw new Error('a replay needs a frame');
  let width = first.width;
  let height = first.height;
  for (const frame of frames) {
    if (frame.width > width) width = frame.width;
    if (frame.height > height) height = frame.height;
  }
  const padded = frames.map((frame) => pad(frame, width, height));
  const palette = paletteOf(padded);
  const cache = new Map<number, number>();
  const indexed = padded.map((frame) => indexFrame(frame, palette, cache));
  return Buffer.from(writeGif(width, height, palette, indexed, timing));
}

function skipSubBlocks(bytes: Uint8Array, offset: number): number {
  let index = offset;
  while (index < bytes.length) {
    const size = bytes[index] ?? 0;
    index += 1;
    if (size === 0) return index;
    index += size;
  }
  throw new Error('truncated gif');
}

/** Image count of a GIF this encoder writes. Used to check that a replay did not drop the last step. */
export function gifFrameCount(bytes: Uint8Array): number {
  if (bytes.length < 13 || bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) throw new Error('not a gif');
  let index = 13;
  const packed = bytes[10] ?? 0;
  if ((packed & 0x80) !== 0) index += 3 * (2 << (packed & 7));
  let frames = 0;
  while (index < bytes.length) {
    const block = bytes[index];
    if (block === 0x3b) return frames;
    if (block === 0x21) {
      const label = bytes[index + 1];
      index += 2;
      if (label === 0xff) {
        const size = bytes[index] ?? 0;
        index += 1 + size;
        index = skipSubBlocks(bytes, index);
        continue;
      }
      if (label === 0xf9) {
        const size = bytes[index] ?? 0;
        index += 1 + size;
        if (bytes[index] === 0) index += 1;
        continue;
      }
      index = skipSubBlocks(bytes, index);
      continue;
    }
    if (block === 0x2c) {
      frames += 1;
      index += 9;
      const imagePacked = bytes[index] ?? 0;
      index += 1;
      if ((imagePacked & 0x80) !== 0) index += 3 * (2 << (imagePacked & 7));
      index += 1;
      index = skipSubBlocks(bytes, index);
      continue;
    }
    throw new Error(`bad gif block at ${index}`);
  }
  throw new Error('gif missing trailer');
}
