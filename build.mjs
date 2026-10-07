import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
process.chdir(root);
const worker = await build({ entryPoints: ['src/gif-worker.js'], bundle: true, minify: true, format: 'iife', write: false, target: 'chrome110' });
const app = await build({ entryPoints: ['src/app.js'], bundle: true, minify: true, format: 'iife', write: false, target: 'chrome110', plugins: [{ name: 'inline-worker', setup(b) {
  b.onResolve({ filter: /\?worker$/ }, (args) => ({ path: args.path, namespace: 'inline-worker' }));
  b.onLoad({ filter: /.*/, namespace: 'inline-worker' }, () => ({ contents: `export default ${JSON.stringify(worker.outputFiles[0].text)}`, loader: 'js' }));
} }] });
const html = (await fs.readFile('src/index.html', 'utf8')).replace('/*__STYLE__*/', await fs.readFile('src/style.css', 'utf8')).replace('/*__APP__*/', () => app.outputFiles[0].text.replaceAll('</script', '<\\/script'));
await fs.mkdir('dist', { recursive: true });
await fs.writeFile('dist/STL_Studio_Offline.html', html);
let notices = 'STL Studio Offline 1.0 — third-party licenses\n\n';
for (const pkg of ['three', 'gifenc', 'mp4-muxer', 'webm-muxer']) {
  const info = JSON.parse(await fs.readFile(`node_modules/${pkg}/package.json`, 'utf8'));
  const entries = await fs.readdir(`node_modules/${pkg}`);
  const license = entries.find((name) => /^license(\.txt|\.md)?$/i.test(name));
  notices += `\n--- ${pkg} ${info.version} ---\n${await fs.readFile(`node_modules/${pkg}/${license}`, 'utf8')}\n`;
}
await fs.writeFile('dist/THIRD_PARTY_LICENSES.txt', notices);
console.log(`Built offline application: ${Buffer.byteLength(html).toLocaleString()} bytes`);
