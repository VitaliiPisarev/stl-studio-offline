import { GIFEncoder, quantize, applyPalette } from 'gifenc';

let gif, colors, palette, transparent, count = 0;
self.onmessage = ({ data: m }) => {
  try {
    if (m.type === 'init') {
      transparent = m.transparent;
      let pixels = new Uint8Array(m.pixels);
      if (transparent) {
        const opaque = new Uint8Array(pixels.length);
        let j = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] >= 128) {
            opaque.set(pixels.subarray(i, i + 4), j); j += 4;
          }
        }
        pixels = opaque.subarray(0, j);
      }
      colors = pixels.length ? quantize(pixels, transparent ? 255 : 256) : [[0, 0, 0]];
      palette = transparent ? [[0, 0, 0], ...colors] : colors;
      gif = GIFEncoder(); count = 0;
      self.postMessage({ ok: true });
    } else if (m.type === 'frame') {
      const pixels = new Uint8Array(m.pixels);
      const indices = applyPalette(pixels, colors);
      if (transparent) {
        for (let i = 0; i < indices.length; i++) indices[i] = pixels[i * 4 + 3] < 128 ? 0 : indices[i] + 1;
      }
      gif.writeFrame(indices, m.width, m.height, {
        palette: count === 0 ? palette : undefined,
        delay: m.delay, repeat: 0, transparent, transparentIndex: 0, dispose: 2,
      });
      count++; self.postMessage({ ok: true });
    } else if (m.type === 'finish') {
      gif.finish(); const bytes = gif.bytes();
      self.postMessage({ bytes: bytes.buffer }, [bytes.buffer]); gif = null;
    }
  } catch (e) { self.postMessage({ error: e.message }); }
};
