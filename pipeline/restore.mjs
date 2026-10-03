import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [root,inputRel,outputRel,metadataFile]=process.argv.slice(2),meta=JSON.parse(fs.readFileSync(metadataFile));
const output=path.join(root,outputRel);if(fs.existsSync(output))throw Error('Restore output exists');fs.mkdirSync(output,{recursive:true});
const {startServer}=await import(pathToFileURL(path.join(root,'tools/serve.mjs'))),{launchBrowser}=await import(pathToFileURL(path.join(root,'tools/lib/browser.mjs')));
const server=await startServer(),{browser}=await launchBrowser({headful:false});
try{const page=await browser.newPage();const [w,h]=meta.viewport,[,pad,,picture]=meta.pictureCrop;await page.goto(server.url+`grain-restore.html?w=${w}&h=${h}&pad=${pad}&picture=${picture}`);await page.waitForFunction(()=>window.restoreReady);
 for(const info of meta.frames){const data=await page.evaluate(o=>window.restoreGrain(o),{url:'/'+inputRel+'/'+info.filename,grain:info.grain,grainSize:info.grainSize,frame:info.frame});fs.writeFileSync(path.join(output,info.filename),Buffer.from(data.split(',')[1],'base64'));}
}finally{await browser.close();await server.close();}
