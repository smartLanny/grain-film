import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [filmRoot,configFile]=process.argv.slice(2),cfg=JSON.parse(fs.readFileSync(configFile));
const {startServer}=await import(pathToFileURL(path.join(filmRoot,'tools/serve.mjs')));
const {launchBrowser,openFilmPage}=await import(pathToFileURL(path.join(filmRoot,'tools/lib/browser.mjs')));
const base=path.join(filmRoot,'out',cfg.name),arms=['on','off'];
for(const a of arms){const d=path.join(base,a,'full');if(fs.existsSync(d))throw Error('Capture output exists: '+d);fs.mkdirSync(d,{recursive:true});}
const server=await startServer();const {browser,gl}=await launchBrowser({headful:false});const frames=[];
try {
 const page=await openFilmPage(browser,server.url,{scale:cfg.scale,query:'samples='+cfg.samples});
 for(let frame=cfg.input_first;frame<cfg.input_last;frame++){
  const info=await page.evaluate(async f=>{
   const png=await window.__film.stillDataURL(f,'image/png'),post=window.__film.engine.post,u=post.final.uniforms;
   const grain=u.uGrain.value,grainSize=u.uGrainSize.value;u.uGrain.value=0;post._pass(post.final,null);
   const clean=document.getElementById('film').toDataURL('image/png');u.uGrain.value=grain;
   return{png,clean,grain,grainSize,width:document.getElementById('film').width,height:document.getElementById('film').height};
  },frame);
  const filename=`f${String(frame).padStart(6,'0')}.png`;
  for(const a of arms)fs.writeFileSync(path.join(base,a,'full',filename),Buffer.from((a==='on'?info.png:info.clean).split(',')[1],'base64'));
  frames.push({filename,frame,seconds:frame/30,grain:info.grain,grainSize:info.grainSize});
  if(info.width!==cfg.width||info.height!==cfg.viewport_height)throw Error('Unexpected capture dimensions');
 }
 const meta={name:cfg.name,paired_scene_pass:true,viewport:[cfg.width,cfg.viewport_height],pictureCrop:[0,cfg.pad,cfg.width,cfg.height],samples:cfg.samples,gl,frames};
 fs.writeFileSync(path.join(base,'frames.json'),JSON.stringify(meta,null,2));
}finally{await browser.close();await server.close();}
