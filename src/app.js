import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Muxer as MP4Muxer, ArrayBufferTarget as MP4Target } from 'mp4-muxer';
import { Muxer as WebMMuxer, ArrayBufferTarget as WebMTarget } from 'webm-muxer';
import workerCode from './gif-worker.js?worker';
import { setWebMDuration } from './webm-duration.js';
import { t, locale, setLanguage, translateDOM, localizedError } from './i18n.js';

const $ = (id) => document.getElementById(id);
const rad = THREE.MathUtils.degToRad;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const TAU = Math.PI * 2;
let statusMessage = { key: 'ready', values: {}, error: false };
function renderStatus() {
  $('status').textContent = t(statusMessage.key, statusMessage.values);
  $('status').classList.toggle('error', statusMessage.error);
}
function status(key, values = {}, error = false) { statusMessage = { key, values, error }; renderStatus(); }
translateDOM(); renderStatus();
const cancelled = () => new DOMException(t('cancelledError'), 'AbortError');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: $('canvas'), antialias: true, alpha: true, preserveDrawingBuffer: true });
} catch (e) {
  status('webglFailed', {}, true);
  $('export').disabled = true; $('open').disabled = true;
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1.3, 1.3, 1.3, -1.3, 0.01, 50);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false; controls.enableZoom = false; controls.enableDamping = false;
controls.minPolarAngle = rad(5); controls.maxPolarAngle = rad(105);
const spin = new THREE.Group(); scene.add(spin);
const orientation = new THREE.Group(); spin.add(orientation);
const material = new THREE.MeshStandardMaterial({ color: '#c6a675', roughness: 0.68, metalness: 0.03, side: THREE.DoubleSide });
const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const environment = pmrem.fromScene(room, 0.04);
scene.environment = environment.texture; scene.environmentIntensity = 0.6;
room.dispose(); pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xf8faff, 0x736a5c, 1.0));
const key = new THREE.DirectionalLight(0xfff5e5, 2.7);
key.position.set(-2, 8, 3); key.castShadow = true;
key.shadow.radius = 4; key.shadow.blurSamples = 8;
key.shadow.mapSize.set(1024, 1024);
Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.1, far: 20 });
key.shadow.normalBias = 0.015; key.shadow.bias = -0.00015;
scene.add(key);
const fill = new THREE.DirectionalLight(0xdcecff, 0.8); fill.position.set(3, 1, -3); scene.add(fill);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ color: 0x20222a, opacity: 0.20 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

let busy = false, loading = false, playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let baseName = 'demo-rook', currentModel = null, modelRadius = 1, exportJob = null;
let resultUrl = null, disabledBefore = [], lastTime = performance.now();
let modelInfo = null, resultInfo = null;
let progressMessage = { key: 'prepare', values: {} };
const number = (value) => value.toLocaleString(locale(), { maximumFractionDigits: 2 });
function renderModelInfo() {
  if (!modelInfo) return;
  $('filename').textContent = modelInfo.demo ? t('demoName') : modelInfo.name;
  $('model-info').textContent = t('modelInfo', { triangles: number(modelInfo.triangles), x: number(modelInfo.x), y: number(modelInfo.y), z: number(modelInfo.z) });
}
function renderResult() {
  if (!resultInfo) return;
  $('download').textContent = t('downloadFormat', { format: resultInfo.format.toUpperCase() });
  $('result-info').textContent = t(resultInfo.format === 'png' ? 'resultStill' : 'resultAnimation', { ...resultInfo, size: number(resultInfo.bytes / 1024 / 1024) });
}
function refreshLanguage() {
  translateDOM(); renderStatus(); renderModelInfo(); renderResult();
  $('progress-text').textContent = t(progressMessage.key, progressMessage.values);
  setPlaying(playing); updateExportNote(); updateLabels(); resize();
}

function dimensions() {
  const aspect = Number($('aspect').value), edge = Number($('size').value);
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  return aspect >= 1 ? [edge, even(edge / aspect)] : [even(edge * aspect), edge];
}
function setProjection(aspect) {
  const half = modelRadius * 1.2 / (Number($('zoom').value) / 100);
  const h = half / Math.min(1, aspect), w = h * aspect;
  Object.assign(camera, { left: -w, right: w, top: h, bottom: -h });
  camera.updateProjectionMatrix();
}
function cameraElevation(value) {
  const azimuth = Math.atan2(camera.position.x, camera.position.z);
  camera.position.set(6 * Math.cos(rad(value)) * Math.sin(azimuth), 6 * Math.sin(rad(value)), 6 * Math.cos(rad(value)) * Math.cos(azimuth));
  camera.lookAt(0, 0, 0); controls.update();
}
function resize() {
  const area = $('dropzone'); const aspect = Number($('aspect').value);
  const maxW = Math.max(50, area.clientWidth - 30), maxH = Math.max(50, area.clientHeight - 30);
  const width = Math.min(maxW, maxH * aspect), height = width / aspect;
  $('stage').style.width = `${width}px`; $('stage').style.height = `${height}px`;
  if (!busy) { renderer.setSize(Math.round(width), Math.round(height), false); setProjection(aspect); }
  const [w, h] = dimensions();
  $('frame-label').textContent = `${$('aspect').selectedOptions[0].text.split(' — ')[0]} · ${w} × ${h}`;
}
new ResizeObserver(resize).observe($('dropzone'));

function updateLabels() {
  for (const id of ['elevation', 'angle']) $(id + '-out').textContent = $(id).value + '°';
  for (const id of ['zoom', 'brightness']) $(id + '-out').textContent = $(id).value + '%';
}
function updateAppearance(forceOpaque = false) {
  const transparent = $('transparent').checked && !forceOpaque;
  renderer.setClearColor($('bg-color').value, transparent ? 0 : 1);
  material.color.set($('model-color').value);
  const styles = { matte: [0.68, 0.03], satin: [0.32, 0.08], metal: [0.28, 0.87] };
  [material.roughness, material.metalness] = styles[$('surface').value];
  renderer.toneMappingExposure = Number($('brightness').value) / 100;
  ground.visible = $('shadow').checked;
}
function setPlaying(value) {
  playing = value; $('play').textContent = t(playing ? 'pause' : 'play');
}
function setStartAngle() { spin.rotation.y = -rad(Number($('angle').value)); }
function resetView() {
  $('elevation').value = 20; $('angle').value = 25; $('zoom').value = 100;
  camera.position.set(0, 6 * Math.sin(rad(20)), 6 * Math.cos(rad(20)));
  controls.target.set(0, 0, 0); camera.lookAt(0, 0, 0); controls.update();
  setStartAngle(); updateLabels(); resize();
}
function recenterOrientation() {
  const angle = spin.rotation.y; spin.rotation.y = 0;
  orientation.position.set(0, 0, 0); scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(orientation);
  const center = box.getCenter(new THREE.Vector3());
  orientation.position.copy(center.negate()); scene.updateMatrixWorld(true);
  const centered = new THREE.Box3().setFromObject(orientation);
  // A sphere around the oriented box gives safe framing through a full rotation.
  modelRadius = Math.max(0.01, centered.getSize(new THREE.Vector3()).length() / 2);
  ground.position.y = centered.min.y - 0.004;
  spin.rotation.y = angle; resize();
}
function disposeModel(model) {
  if (!model) return;
  const geos = new Set(), mats = new Set();
  model.traverse((obj) => {
    if (obj.geometry) geos.add(obj.geometry);
    for (const mat of (Array.isArray(obj.material) ? obj.material : [obj.material])) if (mat && mat !== material) mats.add(mat);
  });
  geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose());
}
function installModel(model, name, stl = false, demo = false) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const max = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(max) || max <= 0) throw localizedError('emptyGeometry');
  let triangles = 0, valid = true;
  model.traverse((obj) => {
    if (!obj.isMesh) { if (obj.isLine || obj.isPoints) obj.visible = false; return; }
    const attr = obj.geometry.attributes.position;
    for (let i = 0; i < attr.array.length; i++) if (!Number.isFinite(attr.array[i])) { valid = false; break; }
    triangles += (obj.geometry.index ? obj.geometry.index.count : attr.count) / 3;
  });
  if (!valid || !triangles) throw localizedError('invalidGeometry');
  const oldMats = new Set();
  model.traverse((obj) => {
    if (!obj.isMesh) return;
    for (const mat of (Array.isArray(obj.material) ? obj.material : [obj.material])) if (mat && mat !== material) oldMats.add(mat);
    obj.material = material; obj.castShadow = true; obj.receiveShadow = false;
    if (!obj.geometry.attributes.normal) obj.geometry.computeVertexNormals();
  });
  oldMats.forEach((m) => m.dispose());
  const wrapper = new THREE.Group();
  model.position.sub(center); wrapper.add(model); wrapper.scale.setScalar(2 / max);
  disposeModel(currentModel); orientation.clear(); currentModel = wrapper;
  orientation.quaternion.identity(); if (stl) orientation.rotation.x = -Math.PI / 2;
  orientation.add(wrapper); baseName = name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'model';
  modelInfo = { name, demo, triangles: Math.round(triangles), x: size.x, y: size.y, z: size.z };
  renderModelInfo();
  recenterOrientation(); resetView();
}

async function loadFile(file) {
  if (!file || busy || loading) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['stl', 'obj'].includes(ext)) { status('supportedFiles', {}, true); return; }
  if (file.size > 200 * 1024 * 1024) { status('fileTooLarge', {}, true); return; }
  loading = true; lockUI(true); status('opening', { name: file.name }); await tick();
  let model;
  try {
    if (ext === 'stl') {
      const bytes = await file.arrayBuffer();
      if (bytes.byteLength < 84) throw localizedError('invalidSTL');
      const header = new TextDecoder().decode(bytes.slice(0, 80));
      const count = new DataView(bytes).getUint32(80, true);
      if (!/^.{0,4}solid/i.test(header) && 84 + count * 50 > bytes.byteLength) throw localizedError('truncatedSTL');
      const geometry = new STLLoader().parse(bytes);
      geometry.computeVertexNormals();
      model = new THREE.Mesh(geometry, material);
    } else model = new OBJLoader().parse(await file.text());
    installModel(model, file.name, ext === 'stl');
    status(ext === 'stl' ? 'openedSTL' : 'openedOBJ');
  } catch (e) {
    if (model) disposeModel(model);
    status('openFailed', { error: e }, true);
  } finally { loading = false; lockUI(false); $('file').value = ''; }
}
function loadDemo() {
  if (busy || loading) return;
  const model = new THREE.Group();
  const points = [[0,0],[.67,0],[.72,.055],[.72,.15],[.63,.22],[.62,.30],[.51,.34],[.46,.43],[.38,.57],[.33,.75],[.30,1.06],[.29,1.38],[.35,1.48],[.43,1.52],[.43,1.62],[.39,1.68],[.47,1.74],[.48,1.90],[.33,1.90],[.33,1.77],[0,1.77]].map(([x,y]) => new THREE.Vector2(x,y));
  model.add(new THREE.Mesh(new THREE.LatheGeometry(points, 96), material));
  for (let i = 0; i < 6; i++) {
    const a = i * TAU / 6, tooth = new THREE.Mesh(new THREE.BoxGeometry(.26, .25, .19), material);
    tooth.position.set(Math.sin(a) * .40, 2.005, Math.cos(a) * .40); tooth.rotation.y = a; model.add(tooth);
  }
  installModel(model, 'demo-rook', false, true); baseName = 'demo-rook';
}
function lockUI(value) {
  if (value) {
    disabledBefore = [...document.querySelectorAll('#language, #settings button, #settings input, #settings select, .export-fields button, .export-fields select, .viewer-controls button')].map((el) => [el, el.disabled]);
    disabledBefore.forEach(([el]) => { el.disabled = true; }); controls.enabled = false;
  } else { disabledBefore.forEach(([el, was]) => { el.disabled = was; }); controls.enabled = true; disabledBefore = []; }
  document.body.classList.toggle('busy', value);
}
function progress(value, key, values = {}) {
  progressMessage = { key, values };
  $('progress').value = value; $('progress-text').textContent = t(key, values);
}
function checkCancel() { if (exportJob?.cancel) throw cancelled(); }
function saveResult(blob, extension, details) {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = URL.createObjectURL(blob);
  const a = $('download'); a.href = resultUrl; a.download = `${baseName}.${extension}`;
  resultInfo = { ...details, format: extension, bytes: blob.size };
  renderResult();
  $('result').hidden = false; a.click();
}
function makeWorker() {
  const url = URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' }));
  const worker = new Worker(url); URL.revokeObjectURL(url);
  exportJob.worker = worker;
  return (message, transfers = []) => new Promise((resolve, reject) => {
    checkCancel(); exportJob.reject = reject;
    worker.onmessage = (ev) => { exportJob.reject = null; ev.data.error ? reject(new Error(ev.data.error)) : resolve(ev.data); };
    worker.onerror = (ev) => { exportJob.reject = null; reject(ev.message ? new Error(ev.message) : localizedError('gifEncoderFailed')); };
    worker.postMessage(message, transfers);
  });
}
function renderFrame(i, count, start, dir, opaque) {
  spin.rotation.y = start - dir * TAU * i / count;
  updateAppearance(opaque); renderer.render(scene, camera);
}
async function exportGIF(w, h, frames, fps, start, dir) {
  const rpc = makeWorker();
  const sampleCanvas = document.createElement('canvas'); sampleCanvas.width = 128; sampleCanvas.height = Math.max(1, Math.round(128 * h / w));
  const sc = sampleCanvas.getContext('2d', { willReadFrequently: true });
  const chunks = [], sampleCount = 12;
  for (let i = 0; i < sampleCount; i++) {
    checkCancel(); renderFrame(i, sampleCount, start, dir, false);
    sc.clearRect(0, 0, sampleCanvas.width, sampleCanvas.height); sc.drawImage(renderer.domElement, 0, 0, sampleCanvas.width, sampleCanvas.height);
    chunks.push(sc.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data);
    progress(i / sampleCount * 0.08, 'gifPalette'); await tick();
  }
  const samples = new Uint8Array(chunks.reduce((sum, a) => sum + a.length, 0));
  let offset = 0; for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
  await rpc({ type: 'init', pixels: samples.buffer, transparent: $('transparent').checked }, [samples.buffer]);
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  for (let i = 0; i < frames; i++) {
    checkCancel(); renderFrame(i, frames, start, dir, false);
    ctx.clearRect(0, 0, w, h); ctx.drawImage(renderer.domElement, 0, 0);
    const pixels = ctx.getImageData(0, 0, w, h).data;
    // GIF stores centiseconds; distribute rounding so the total duration is exact.
    const delay = (Math.round((i + 1) * 100 / fps) - Math.round(i * 100 / fps)) * 10;
    await rpc({ type: 'frame', pixels: pixels.buffer, width: w, height: h, delay }, [pixels.buffer]);
    progress(.08 + .90 * (i + 1) / frames, 'frameProgress', { format: 'GIF', frame: i + 1, frames });
  }
  checkCancel(); const result = await rpc({ type: 'finish' });
  return new Blob([result.bytes], { type: 'image/gif' });
}
async function selectVideoConfig(format, w, h, fps) {
  if (!('VideoEncoder' in window)) throw localizedError('videoUnavailable');
  const codecs = format === 'mp4' ? ['avc1.420033', 'avc1.42002a', 'avc1.4d0033'] : ['vp09.00.10.08', 'vp8'];
  for (const codec of codecs) {
    const config = { codec, width: w, height: h, framerate: fps, bitrate: Math.max(2000000, Math.min(20000000, Math.round(w * h * fps * .25))), hardwareAcceleration: 'no-preference' };
    if (format === 'mp4') config.avc = { format: 'avc' };
    try { if ((await VideoEncoder.isConfigSupported(config)).supported) return config; } catch {}
  }
  throw localizedError(format === 'mp4' ? 'mp4Unavailable' : 'webmUnavailable');
}
async function exportVideo(format, w, h, frames, fps, start, dir) {
  const config = await selectVideoConfig(format, w, h, fps); checkCancel();
  const isMP4 = format === 'mp4', target = isMP4 ? new MP4Target() : new WebMTarget();
  const muxer = isMP4 ? new MP4Muxer({ target, video: { codec: 'avc', width: w, height: h, frameRate: fps }, fastStart: 'in-memory' }) : new WebMMuxer({ target, video: { codec: config.codec === 'vp8' ? 'V_VP8' : 'V_VP9', width: w, height: h, frameRate: fps } });
  let codecError = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => { try { muxer.addVideoChunk(chunk, meta); } catch (e) { codecError = e; } }, error: (e) => { codecError = e; } });
  exportJob.encoder = encoder;
  try {
    encoder.configure(config);
    for (let i = 0; i < frames; i++) {
      checkCancel(); if (codecError) throw codecError;
      renderFrame(i, frames, start, dir, true);
      const timestamp = Math.round(i * 1e6 / fps), duration = Math.round((i + 1) * 1e6 / fps) - timestamp;
      const frame = new VideoFrame(renderer.domElement, { timestamp, duration, alpha: 'discard' });
      try { encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 }); } finally { frame.close(); }
      // Bounded queue: never keep a full animation's uncompressed frames in RAM.
      if (encoder.encodeQueueSize >= 6) await encoder.flush();
      progress(.95 * (i + 1) / frames, 'frameProgress', { format: format.toUpperCase(), frame: i + 1, frames }); await tick();
    }
    checkCancel(); progress(.98, 'muxing'); await encoder.flush();
    if (codecError) throw codecError; checkCancel(); muxer.finalize();
    if (!isMP4) setWebMDuration(target.buffer, frames / fps);
    return new Blob([target.buffer], { type: isMP4 ? 'video/mp4' : 'video/webm' });
  } finally { if (encoder.state !== 'closed') encoder.close(); }
}
async function startExport() {
  if (busy || loading || !currentModel) return;
  const format = $('format').value, [w, h] = dimensions(), fps = Number($('fps').value), seconds = Number($('duration').value), frames = fps * seconds;
  if (format === 'gif' && Math.max(w, h) > 1080) { status('gifSizeLimit', {}, true); return; }
  if (format === 'gif' && frames > 300) { status('gifFrameLimit', {}, true); return; }
  const gl = renderer.getContext();
  if (Math.max(w, h) > gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) { status('gpuSizeLimit', {}, true); return; }
  busy = true; lockUI(true); exportJob = { cancel: false, worker: null, encoder: null, reject: null };
  const oldAngle = spin.rotation.y, pixelRatio = renderer.getPixelRatio();
  const start = -rad(Number($('angle').value)), dir = Number($('direction').value);
  $('progress-box').hidden = false; status('exporting'); progress(0, 'prepare');
  try {
    renderer.setPixelRatio(1); renderer.setSize(w, h, false); setProjection(w / h); await tick();
    let blob;
    if (format === 'png') {
      updateAppearance(); renderer.render(scene, camera);
      blob = await new Promise((resolve, reject) => renderer.domElement.toBlob((b) => b ? resolve(b) : reject(localizedError('pngFailed')), 'image/png'));
    } else if (format === 'gif') blob = await exportGIF(w, h, frames, fps, start, dir);
    else blob = await exportVideo(format, w, h, frames, fps, start, dir);
    checkCancel();
    saveResult(blob, format, { w, h, seconds, fps });
    status('exportDone', { format: format.toUpperCase() });
    progress(1, 'done');
  } catch (e) {
    if (exportJob.cancel || e.name === 'AbortError') status('exportCancelled');
    else status('exportFailed', { error: e }, true);
  } finally {
    exportJob.worker?.terminate(); exportJob = null;
    spin.rotation.y = oldAngle; busy = false; renderer.setPixelRatio(pixelRatio);
    updateAppearance(); lockUI(false); resize(); $('progress-box').hidden = true;
  }
}
function updateExportNote() {
  const f = $('format').value;
  $('export').textContent = t('saveFormat', { format: f.toUpperCase() });
  $('export-note').textContent = f === 'gif' ? t('gifNote') : f === 'png' ? t('pngNote') : t('videoNote', { format: f.toUpperCase() }) + (f === 'mp4' ? ' ' + t('mp4Fallback') : '');
}

$('language').onchange = () => { setLanguage($('language').value); refreshLanguage(); };
$('open').onclick = () => $('file').click();
$('file').onchange = (e) => loadFile(e.target.files[0]);
$('demo').onclick = () => { loadDemo(); status('demoReady'); };
for (const axis of ['x', 'y', 'z']) $('rot-' + axis).onclick = () => {
  const vector = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
  orientation.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(vector, Math.PI / 2));
  recenterOrientation();
};
$('fit').onclick = resetView;
$('elevation').oninput = () => { cameraElevation(Number($('elevation').value)); updateLabels(); };
$('angle').oninput = () => { setStartAngle(); setPlaying(false); updateLabels(); };
$('zoom').oninput = () => { resize(); updateLabels(); };
$('brightness').oninput = () => { updateAppearance(); updateLabels(); };
for (const id of ['model-color', 'bg-color', 'transparent', 'shadow', 'surface']) $(id).oninput = () => updateAppearance();
document.querySelectorAll('[data-color]').forEach((button) => { button.onclick = () => { $('model-color').value = button.dataset.color; updateAppearance(); }; });
for (const id of ['aspect', 'size']) $(id).onchange = resize;
$('format').onchange = updateExportNote;
$('play').onclick = () => setPlaying(!playing);
$('restart').onclick = () => { setStartAngle(); setPlaying(false); };
$('export').onclick = startExport;
$('cancel').onclick = () => {
  if (!exportJob) return;
  exportJob.cancel = true;
  if (exportJob.worker) { exportJob.worker.terminate(); exportJob.reject?.(cancelled()); }
  if (exportJob.encoder && exportJob.encoder.state !== 'closed') exportJob.encoder.close();
};
$('help').onclick = () => $('help-dialog').showModal();
$('close-help').onclick = () => $('help-dialog').close();
controls.addEventListener('start', () => { if (!busy) setPlaying(false); });
controls.addEventListener('change', () => { $('elevation').value = Math.round(90 - THREE.MathUtils.radToDeg(controls.getPolarAngle())); updateLabels(); });
$('canvas').addEventListener('wheel', (e) => {
  e.preventDefault(); if (busy || loading) return;
  $('zoom').value = THREE.MathUtils.clamp(Number($('zoom').value) - Math.sign(e.deltaY) * 5, 50, 175); resize(); updateLabels();
}, { passive: false });
let dragDepth = 0;
document.addEventListener('dragenter', (e) => { e.preventDefault(); if (e.dataTransfer.types.includes('Files')) { dragDepth++; if (!busy && !loading) $('dropzone').classList.add('drag-over'); } });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('dragleave', (e) => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('dropzone').classList.remove('drag-over'); } });
document.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; $('dropzone').classList.remove('drag-over'); loadFile(e.dataTransfer.files[0]); });
window.addEventListener('beforeunload', (e) => { if (busy) { e.preventDefault(); e.returnValue = ''; } });
$('canvas').addEventListener('webglcontextlost', (e) => { e.preventDefault(); if (exportJob) $('cancel').click(); status('contextLost', {}, true); });
document.addEventListener('visibilitychange', () => { if (busy && document.hidden) status('exportBackground'); });

loadDemo(); resetView(); updateAppearance(); updateLabels(); updateExportNote(); setPlaying(playing);
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastTime) / 1000, .1); lastTime = now;
  if (busy || loading) return;
  if (playing) spin.rotation.y -= Number($('direction').value) * TAU * dt / Number($('duration').value);
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);
