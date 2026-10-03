import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import puppeteer from 'puppeteer-core';
import {WebSocketServer} from 'ws';
import {findChrome} from '../tools/lib/browser.mjs';

const [filmRoot,outputRoot]=process.argv.slice(2);
if(!filmRoot||!outputRoot) throw new Error('Usage: node pipeline/audio-render.mjs <isolated-film-root> <output-dir> (normally called by audio.py)');
const {startServer}=await import(pathToFileURL(path.join(filmRoot,'tools/serve.mjs')));
const server=await startServer();
let browser,savePath,resolveWav,rejectWav;
const args=['--disable-gpu','--disable-software-rasterizer','--mute-audio','--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding'];
const wss=new WebSocketServer({server:server.server,path:'/__audio',maxPayload:1<<30});
wss.on('connection',ws=>ws.on('message',bytes=>{
  try {fs.writeFileSync(savePath,bytes,{flag:'wx'});resolveWav();ws.send('ack');}
  catch(error){rejectWav(error);ws.close();}
}));
try {
  browser=await puppeteer.launch({executablePath:findChrome(),headless:true,protocolTimeout:0,args});
  const page=await browser.newPage(),requests=[],errors=[];
  page.on('request',request=>requests.push(new URL(request.url()).pathname));
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(server.url+'audio-render.html');
  const results={};
  for(const name of ['baseline','revised']) {
    savePath=path.join(outputRoot,name+'.wav');
    if(fs.existsSync(savePath))throw new Error('Audio output exists: '+name+'.wav');
    const done=new Promise((ok,bad)=>{resolveWav=ok;rejectWav=bad;});
    const rendering=page.evaluate(async ({module,masterGain,sink})=>{
      const {renderScore}=await import(module),{encodeWav}=await import('/src/audio/wav.js');
      const started=performance.now();
      const ctx=new OfflineAudioContext({numberOfChannels:2,length:240*48000,sampleRate:48000});
      await renderScore(ctx,240,masterGain===null?{}:{masterGain});
      const buffer=await ctx.startRendering(),wav=encodeWav(buffer,{bitDepth:24,start:0,end:240});
      const ws=new WebSocket(sink);
      await new Promise((ok,bad)=>{ws.onopen=ok;ws.onerror=()=>bad(new Error('Audio sink connection failed'));});
      const ack=new Promise(ok=>{ws.onmessage=ok;});ws.send(wav);await ack;ws.close();
      return {stats:renderScore.stats,seconds:(performance.now()-started)/1000};
    },{module:name==='baseline'?'/src/audio-baseline/score.js':'/src/audio/score.js',masterGain:name==='baseline'?null:results.baseline.stats.masterGain,sink:server.url.replace('http','ws')+'__audio'});
    [results[name]]=await Promise.all([rendering,done]);
    if(!Number.isFinite(results[name].stats.masterGain))throw new Error('Exact master gain missing');
    console.log(name,JSON.stringify(results[name]));
  }
  if(errors.length)throw new Error(errors.join('\n'));
  if(results.baseline.stats.masterGain!==results.revised.stats.masterGain)throw new Error('Revised score used a different master gain');
  if(requests.some(p=>p.includes('/worlds/')||p.includes('/three/')))throw new Error('Audio render unexpectedly requested picture modules');
  const receipt={cpuOnly:true,chromeVersion:await browser.version(),chromeArgs:args,stats:results,sampleRate:48000,channels:2,bitDepth:24,duration:240,baselineGainSource:'this browser baseline renderScore.stats.masterGain',historicalGainReference:1.9004731748496868,requestedPaths:[...new Set(requests)],pageErrors:errors};
  fs.writeFileSync(path.join(outputRoot,'audio-render-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
} finally {
  wss.close();await browser?.close();await server.close();
}
