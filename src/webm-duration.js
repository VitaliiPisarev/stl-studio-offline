import { localizedError } from './i18n.js';

// webm-muxer 5.x writes the final frame's timestamp as Segment Duration.
// Our constant-rate, video-only export also needs that frame's display interval.
// Update only the typed EBML Duration element; never scan compressed frame bytes.
export function setWebMDuration(buffer, seconds) {
  const view = new DataView(buffer), bytes = new Uint8Array(buffer);
  function element(offset, limit) {
    const readVint = (pos, isId) => {
      if (pos >= limit) throw localizedError('webmHeaderDamaged');
      let length = 1, marker = 128;
      while (length <= 8 && !(bytes[pos] & marker)) { marker >>= 1; length++; }
      if (length > (isId ? 4 : 8) || pos + length > limit) throw localizedError('webmHeaderInvalid');
      let value = isId ? bytes[pos] : bytes[pos] & (marker - 1);
      for (let i = 1; i < length; i++) value = value * 256 + bytes[pos + i];
      return { value, length };
    };
    const id = readVint(offset, true), size = readVint(offset + id.length, false);
    const start = offset + id.length + size.length, end = start + size.value;
    if (end > limit || end <= offset) throw localizedError('webmBlockInvalid');
    return { id: id.value, start, end, size: size.value };
  }
  function find(id, from, end) {
    for (let offset = from; offset < end;) {
      const entry = element(offset, end); if (entry.id === id) return entry; offset = entry.end;
    }
    return null;
  }
  const segment = find(0x18538067, 0, bytes.length);
  const info = segment && find(0x1549a966, segment.start, segment.end);
  const duration = info && find(0x4489, info.start, info.end);
  const scaleEntry = info && find(0x2ad7b1, info.start, info.end);
  if (!duration || duration.size !== 8) throw localizedError('webmDurationMissing');
  let scale = 1000000;
  if (scaleEntry) { scale = 0; for (let i = scaleEntry.start; i < scaleEntry.end; i++) scale = scale * 256 + bytes[i]; }
  if (scale <= 0) throw localizedError('webmScaleInvalid');
  view.setFloat64(duration.start, seconds * 1e9 / scale, false);
  return buffer;
}
