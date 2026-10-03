from pathlib import Path
import argparse,json,hashlib,subprocess

def probe(video):return json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_streams','-show_data_hash','sha256','-of','json',str(video)]))['streams'][0]

def packets(video,hashes=False):
 cmd=['ffprobe','-v','error','-select_streams','v:0','-show_packets','-show_entries','packet=pts_time,pos,size,flags'+(',data_hash' if hashes else '')]
 if hashes:cmd+=['-show_data_hash','sha256']
 return json.loads(subprocess.check_output(cmd+['-of','json',str(video)]))['packets']

def idr_types(video,packet):
 with Path(video).open('rb') as f:f.seek(int(packet['pos']));data=f.read(int(packet['size']))
 offset=0;types=[]
 while offset<len(data):
  size=int.from_bytes(data[offset:offset+4],'big');offset+=4
  if not size or offset+size>len(data):raise ValueError('Invalid length-prefixed HEVC packet')
  t=(data[offset]>>1)&63
  if t<=31:types.append(t)
  offset+=size
 return types

def validate(video,count,width=3840,height=1920,reference=None,log=None):
 video=Path(video);s=probe(video)
 expected={'codec_name':'hevc','codec_tag_string':'hvc1','profile':'Main','width':width,'height':height,'pix_fmt':'yuv420p','has_b_frames':0,'r_frame_rate':'30/1','time_base':'1/15360','color_range':'tv','color_space':'bt709','color_transfer':'bt709','color_primaries':'bt709','nb_frames':str(count)}
 for k,v in expected.items():
  if s.get(k)!=v:raise ValueError(f'{video}: {k}={s.get(k)!r}, expected {v!r}')
 if float(s['start_time'])!=0 or abs(float(s['duration'])-count/30)>1e-6:raise ValueError('Clip timing mismatch')
 p=packets(video)
 if len(p)!=count or any(abs(float(x['pts_time'])-i/30)>1e-6 for i,x in enumerate(p)):raise ValueError('Packet count/PTS mismatch')
 idrs=[]
 for i,x in enumerate(p):
  if 'K' in x['flags']:
   nal=idr_types(video,x)
   if not nal or any(t not in [19,20] for t in nal):raise ValueError('Keyframe is not a true IDR')
   idrs.append({'frame':i,'nal_types':nal})
 if not set(range(0,count,60))<={x['frame'] for x in idrs}:raise ValueError('Missing2-second IDR boundary')
 if reference and probe(reference)['extradata_hash']!=s['extradata_hash']:raise ValueError('HEVC header differs; do not concatenate hvc1 by stream copy')
 log=Path(log or str(video)+'.decode.log')
 with log.open('w') as f:subprocess.run(['ffmpeg','-hide_banner','-v','error','-i',str(video),'-f','null','-'],stdout=f,stderr=f,check=True)
 if log.stat().st_size:raise ValueError('Decoder emitted errors: '+str(log))
 digest=hashlib.sha256()
 with video.open('rb') as f:
  for block in iter(lambda:f.read(8*1024*1024),b''):digest.update(block)
 return {'file':str(video),'stream':s,'frames':count,'every_pts_verified':True,'true_idrs':idrs,'full_decode_ok':True,'sha256':digest.hexdigest()}
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('video');ap.add_argument('--frames',required=True,type=int);ap.add_argument('--width',type=int,default=3840);ap.add_argument('--height',type=int,default=1920);ap.add_argument('--reference');ap.add_argument('--receipt',required=True);a=ap.parse_args();Path(a.receipt).write_text(json.dumps(validate(a.video,a.frames,a.width,a.height,a.reference),indent=2)+'\n')
