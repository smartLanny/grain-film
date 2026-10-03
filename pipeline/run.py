"""Film-specific PNG/NR/grain/export pipeline. External model and CLI stay external."""
from pathlib import Path
import argparse,hashlib,json,math,shutil,subprocess,sys
from PIL import Image,ImageCms
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
ICC=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()

def sha(p):
 h=hashlib.sha256()
 with Path(p).open('rb') as f:
  for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
 return h.hexdigest()

def save(p,value):Path(p).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')

def load_config(path,scene=None):
 c=json.loads(Path(path).read_text());c=c[scene] if scene else c
 required={'name','start','end','shot_start','preroll_seconds','scale','samples','passes','profile','intensity','detail','colour'}
 if not required<=c.keys():raise ValueError('Missing config fields: '+str(sorted(required-c.keys())))
 if not c['name'].replace('-','').replace('_','').isalnum():raise ValueError('Use a simple clip name')
 if not all(math.isfinite(float(c[k])) for k in ['start','end','shot_start','preroll_seconds','scale','intensity','detail','colour']):raise ValueError('Non-finite controls')
 if not 0<=c['shot_start']<=c['start']<c['end']<=240 or c['preroll_seconds']<0 or c['start']-c['preroll_seconds']<c['shot_start']:raise ValueError('Invalid time range or preroll crosses shot boundary')
 if c['passes'] not in [1,2] or c['profile'] not in ['standard','natural'] or not 0<=c['intensity']<=1 or not 0<=c['detail']<=8 or not 0<=c['colour']<=4:raise ValueError('Invalid NR controls (intensity above1 is clamped by backend, so not accepted here)')
 if c['samples'] not in range(1,65):raise ValueError('samples must be an integer1..64')
 c=dict(c);c['input_first']=round((c['start']-c['preroll_seconds'])*30);c['input_last']=round(c['end']*30);c['visible_first']=round(c['start']*30)
 for t in [c['start'],c['end'],c['start']-c['preroll_seconds']]:
  if abs(t*30-round(t*30))>1e-7:raise ValueError('Times must fall on30fps frame boundaries')
 c['width']=round(1920*c['scale']);c['viewport_height']=round(1080*c['scale']);c['height']=c['width']//2;c['pad']=(c['viewport_height']-c['height'])//2
 if c['width']<=0 or c['width']%2 or c['height']%2 or (c['viewport_height']-c['height'])%2:raise ValueError('Scale must yield even18:9 pixels and integer symmetric padding')
 if 'white_transition_protection' in c:
  p=c['white_transition_protection']
  if not p['start']<=p['hold_until']<p['nr_from']:raise ValueError('Invalid white transition protection')
 return c

def command(args,log,stdout=None):
 with Path(log).open('w') as f:subprocess.run([str(x) for x in args],stdout=stdout or f,stderr=f,check=True)

def film_copy(work):
 film=work/'film'
 if film.exists():return film
 film.mkdir(parents=True)
 for name in ['src','tools'] :shutil.copytree(ROOT/name,film/name)
 for name in ['index.html','SCRIPT.md']:
  if (ROOT/name).exists():shutil.copy2(ROOT/name,film/name)
 (film/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True)
 p=film/'src/post.js';s=p.read_text()
 for name in ['FS_VERT','FINAL_FRAG']:
  if 'export const '+name not in s:s=s.replace('const '+name+' =','export const '+name+' =',1)
 p.write_text(s);shutil.copy2(ROOT/'pipeline/grain-restore.html',film/'grain-restore.html');return film

def frames(directory,first,last):
 actual=sorted(directory.glob('*.png'));expected=[f'f{i:06}.png' for i in range(first,last)]
 if [p.name for p in actual]!=expected:raise ValueError('Missing, extra or incorrectly ordered PNG frames: '+str(directory))
 return actual

def crop_picture(path,c):return Image.open(path).convert('RGB').crop((0,c['pad'],c['width'],c['pad']+c['height']))

def capture(work,c):
 film=film_copy(work);p=work/'resolved-config.json';save(p,c)
 command(['node',ROOT/'pipeline/capture.mjs',film,p],work/'capture.log');base=film/'out'/c['name']
 for arm in ['on','off']:
  dest=base/arm/'input'
  if dest.exists():raise FileExistsError(dest)
  dest.mkdir()
  for f in frames(base/arm/'full',c['input_first'],c['input_last']):
   im=Image.open(f);assert im.size==(c['width'],c['viewport_height']);crop_picture(f,c).save(dest/f.name,icc_profile=ICC,compress_level=1)
 return film

def infer(work,c,cli,model):
 film=work/'film';base=film/'out'/c['name'];input_dir=base/'off/input';frames(input_dir,c['input_first'],c['input_last']);count=c['input_last']-c['input_first'];receipts=[]
 for layer in range(1,c['passes']+1):
  out=base/f'pass{layer}'
  if out.exists():raise FileExistsError('Preserve complete/partial output; use a fresh work directory: '+str(out))
  args=[cli,'process-png-sequence',input_dir,'--output',out,'--model',model,'--profile',c['profile'],'--processing-scale','1','--precision','float16','--intensity',c['intensity'],'--detail-strength',c['detail'],'--colour-strength',c['colour'],'--motion','automatic','--temporal','on']
  rp=work/f'pass{layer}-receipt.json'
  with rp.open('w') as f:command(args,work/f'pass{layer}.log',stdout=f)
  receipt=json.loads(rp.read_text());assert receipt['inputFrames']==receipt['outputFrames']==count;frames(out,c['input_first'],c['input_last']);receipts.append({'layer':layer,'native':receipt,'command':[str(x) for x in args]});input_dir=out
 save(work/'nr-receipt.json',{'passes':receipts,'model_files':{str(p.relative_to(model)):sha(p) for p in sorted(model.rglob('*')) if p.is_file()},'binary_sha256':sha(cli),'contract':'display-sRGB PNG; no extra TRC transform; independent process/history/flow per layer'})

def encode(directory,video,c,log):
 if video.exists():raise FileExistsError(video)
 args=['ffmpeg','-hide_banner','-loglevel','verbose','-n','-framerate','30','-i',directory/'f%06d.png','-vf','scale=in_range=full:out_range=limited:out_color_matrix=bt709,format=nv12,sidedata=mode=delete:type=ICC_PROFILE,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709','-frames:v',c['input_last']-c['visible_first'],'-an','-c:v','hevc_videotoolbox','-q:v','75','-allow_sw','0','-realtime','0','-prio_speed','0','-g','60','-force_key_frames','expr:gte(t,n_forced*2)','-bf','0','-pix_fmt','yuv420p','-profile:v','main','-tag:v','hvc1','-color_range','tv','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-video_track_timescale','15360','-bsf:v','hevc_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0','-movflags','+faststart+write_colr',video]
 command(args,log);return [str(x) for x in args]

def export(work,c,baseline=False):
 film=work/'film';base=film/'out'/c['name'];meta=json.loads((base/'frames.json').read_text());source=base/'on/input'
 if not baseline:
  source=base/'restored';raw=base/f"pass{c['passes']}";frames(raw,c['input_first'],c['input_last']);command(['node',ROOT/'pipeline/restore.mjs',film,str(raw.relative_to(film)),str(source.relative_to(film)),base/'frames.json'],work/'restore.log')
 final=work/'visible';original=work/'original-visible'
 for p in [final,original]:
  if p.exists():raise FileExistsError(p)
  p.mkdir()
 weights=[]
 for i,frame in enumerate(range(c['visible_first'],c['input_last'])):
  name=f'f{frame:06}.png';a=Image.open(base/'on/input'/name).convert('RGB');b=a.copy() if baseline else crop_picture(source/name,c);w=1
  if not baseline and 'white_transition_protection' in c:
   p=c['white_transition_protection'];t=frame/30;u=max(0,min(1,(t-p['hold_until'])/(p['nr_from']-p['hold_until'])));w=u*u*(3-2*u)
   if t<p['nr_from']:b=Image.fromarray(np.rint(np.asarray(a).astype(np.float32)*(1-w)+np.asarray(b).astype(np.float32)*w).clip(0,255).astype(np.uint8))
  weights.append({'absolute_frame':frame,'NR_weight':w});a.save(original/f'f{i:06}.png',icc_profile=ICC,compress_level=1);b.save(final/f'f{i:06}.png',icc_profile=ICC,compress_level=1)
 commands={'original':encode(original,work/'original.mp4',c,work/'original-encode.log')}
 if not baseline:commands['enhanced']=encode(final,work/'enhanced.mp4',c,work/'enhanced-encode.log')
 save(work/'export-receipt.json',{'config':c,'commands':commands,'final_grain_applied_once':not baseline,'white_protection_weights':weights,'videos':{name:sha(work/f'{name}.mp4') for name in commands},'viewport':meta['viewport'],'pictureCrop':meta['pictureCrop'],'pixel_contract':'Source display-sRGB retained; RGB-to-limited-YUV BT709 matrix; accepted BT709 video labels, no TRC conversion.'})

def verify(work,c,baseline=False):
 from validate import validate
 count=c['input_last']-c['visible_first'];reference=work/'original.mp4';results=[validate(reference,count,c['width'],c['height'],log=work/'original-decode.log')]
 if not baseline:results.append(validate(work/'enhanced.mp4',count,c['width'],c['height'],reference=reference,log=work/'enhanced-decode.log'))
 save(work/'validation.json',results)

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--config',required=True);ap.add_argument('--scene');ap.add_argument('--work',required=True);ap.add_argument('--stage',choices=['capture','infer','export','verify','all'],default='all');ap.add_argument('--baseline',action='store_true');ap.add_argument('--mlx-cli');ap.add_argument('--model');ap.add_argument('--check',action='store_true');args=ap.parse_args();c=load_config(args.config,args.scene);work=Path(args.work).expanduser().resolve()
 cli=Path(args.mlx_cli).expanduser().resolve() if args.mlx_cli else None;model=Path(args.model).expanduser().resolve() if args.model else None
 if args.stage in ['all','infer'] and not args.baseline:
  if not cli or not cli.is_file() or not model or not model.is_dir():ap.error('Supply external --mlx-cli and legally available --model package directory')
 if args.check:print(json.dumps(c,indent=2));return
 if args.stage=='all' and work.exists():raise FileExistsError('Fresh work directory required')
 work.mkdir(parents=True,exist_ok=True)
 for stage in (['capture','infer','export','verify'] if args.stage=='all' else [args.stage]):
  if stage=='capture':capture(work,c)
  elif stage=='infer' and not args.baseline:infer(work,c,cli,model)
  elif stage=='export':export(work,c,args.baseline)
  elif stage=='verify':verify(work,c,args.baseline)
if __name__=='__main__':main()
