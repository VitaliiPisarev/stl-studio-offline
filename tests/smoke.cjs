const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const out = path.resolve(__dirname, '../test-output');
(async () => {
  await fs.mkdir(out, {recursive:true});
  const exe = process.env.CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch({executablePath:exe,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],headless:true});
  const context = await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1040},offline:true});
  const page = await context.newPage();
  const errors=[], requests=[];
  page.on('pageerror', e=>errors.push(e.message));
  page.on('request', r=>{ if (/^https?:/.test(r.url())) requests.push(r.url()); });
  page.on('console',m=>{ if(m.type()==='error') console.log('console:',m.text().slice(0,300)); });
  await page.goto(pathToFileURL(path.resolve(__dirname,'../dist/STL_Studio_Offline.html')).href);
  await page.waitForTimeout(1000);
  assert.equal(errors.length,0,errors.join('\n'));
  assert.ok((await page.locator('#model-info').innerText()).includes('треугольников'));
  await page.locator('#restart').click();
  await page.screenshot({path:path.join(out,'interface.png'),fullPage:true});
  await page.locator('#size').selectOption('480');
  await page.locator('#duration').selectOption('2');
  await page.locator('#fps').selectOption('10');
  const results=[];
  async function save(format, filename) {
    await page.locator('#format').selectOption(format);
    const waiter=page.waitForEvent('download',{timeout:120000});
    await page.locator('#export').click();
    const download=await waiter;
    await download.saveAs(path.join(out,filename));
    await page.waitForFunction(()=>!document.body.classList.contains('busy'));
    assert.ok((await page.locator('#status').innerText()).startsWith('Готово:'),await page.locator('#status').innerText());
    results.push({format,name:filename,suggested:download.suggestedFilename(),size:(await fs.stat(path.join(out,filename))).size});
  }
  await page.locator('#transparent').check();
  await page.locator('#shadow').uncheck();
  await save('png','transparent.png');
  await save('gif','transparent.gif');
  await page.locator('#transparent').uncheck();
  await save('webm','rook.webm');
  // Probe H.264 before exporting, since Linux Chromium may omit its encoder.
  const mp4 = await page.evaluate(async()=> 'VideoEncoder' in window && (await VideoEncoder.isConfigSupported({codec:'avc1.420033',width:480,height:480,bitrate:2000000,framerate:10})).supported);
  if(mp4) await save('mp4','rook.mp4');
  else {
    await page.locator('#format').selectOption('mp4'); await page.locator('#export').click();
    await page.waitForFunction(()=>!document.body.classList.contains('busy'));
    assert.ok((await page.locator('#status').innerText()).includes('WebM'));
    results.push({format:'mp4',unsupported:true,handled:true});
  }
  // Real file import: ASCII STL with asymmetric geometry and original units.
  const pts=[[0,0,0],[30,0,0],[0,20,0],[0,0,50]];
  const faces=[[0,2,1],[0,1,3],[1,2,3],[2,0,3]];
  const ascii='solid test\n'+faces.map(face=>'facet normal 0 0 0\nouter loop\n'+face.map(i=>'vertex '+pts[i].join(' ')).join('\n')+'\nendloop\nendfacet').join('\n')+'\nendsolid test';
  await page.locator('#file').setInputFiles({name:'модель ASCII.stl',mimeType:'application/octet-stream',buffer:Buffer.from(ascii)});
  await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Модель открыта.'));
  assert.ok((await page.locator('#model-info').innerText()).includes('30 × 20 × 50'));
  const binary = Buffer.alloc(84+50*4); binary.write('solid binary header'); binary.writeUInt32LE(4,80);
  faces.forEach((f,i)=>f.forEach((v,j)=>pts[v].forEach((x,k)=>binary.writeFloatLE(x,84+i*50+12+j*12+k*4))));
  await page.locator('#file').setInputFiles({name:'binary.stl',mimeType:'application/octet-stream',buffer:binary});
  await page.waitForFunction(()=>document.querySelector('#filename').textContent==='binary.stl');
  await page.locator('#rot-x').click(); await page.locator('#rot-z').click();
  await page.locator('#aspect').selectOption('0.5625');
  await save('png','portrait.png');
  await save('gif','asymmetric.gif');
  // Cancellation terminates worker and restores controls.
  await page.locator('#size').selectOption('1080'); await page.locator('#duration').selectOption('10'); await page.locator('#fps').selectOption('30');
  await page.locator('#format').selectOption('gif'); await page.locator('#export').click();
  await page.locator('#cancel').click();
  await page.waitForFunction(()=>!document.body.classList.contains('busy'));
  assert.ok((await page.locator('#status').innerText()).includes('отменён'));
  assert.equal(await page.locator('#open').isEnabled(),true);
  // Malformed STL must leave the current valid model in place.
  await page.locator('#file').setInputFiles({name:'bad.stl',mimeType:'application/octet-stream',buffer:Buffer.from('bad')});
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Не удалось открыть'));
  assert.equal(await page.locator('#filename').innerText(),'binary.stl');
  await page.locator('#file').setInputFiles({name:'sample.obj',mimeType:'text/plain',buffer:Buffer.from(pts.map(v=>'v '+v.join(' ')).join('\n')+'\n'+faces.map(f=>'f '+f.map(i=>i+1).join(' ')).join('\n'))});
  await page.waitForFunction(()=>document.querySelector('#filename').textContent==='sample.obj');
  assert.ok((await page.locator('#model-info').innerText()).includes('4 треугольников'));
  await page.locator('#help').click(); assert.equal(await page.locator('#help-dialog').isVisible(),true); await page.locator('#close-help').click();
  assert.equal(requests.length,0,'Network requests: '+requests.join(','));
  assert.equal(errors.length,0,'Browser errors: '+errors.join(','));
  const report={results,asciiSTL:true,binarySTL:true,obj:true,invalidFilePreservesModel:true,cancel:true,offline:true,networkRequests:requests,errors};
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
