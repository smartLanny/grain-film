"""GRAIN-specific 240s assembly: source-rendered base plus three approved NR shots."""
from pathlib import Path
import argparse,subprocess,json,wave
from run import save,sha
from validate import validate,packets,probe

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--base',required=True);ap.add_argument('--s06',required=True);ap.add_argument('--s10',required=True);ap.add_argument('--s11',required=True);ap.add_argument('--audio-wav');ap.add_argument('--work',required=True);ap.add_argument('--output',required=True);a=ap.parse_args();work=Path(a.work).resolve();out=Path(a.output).resolve()
 if out.exists() or work.exists():raise FileExistsError('Choose fresh assembly work/output; preserve existing deliverables')
 base=Path(a.base).resolve();header=probe(base);assert int(header['nb_frames'])==7200 and header['width']==3840 and header['height']==1920 and header['r_frame_rate']=='30/1';work.mkdir(parents=True);parts=[]
 for first,last,name in [(0,44,None),(44,58,'s06'),(58,82,None),(82,96,'s10'),(96,102,'s11'),(102,240,None)]:
  if name:p=Path(getattr(a,name)).resolve()
  else:
   p=work/f'base-{first}-{last}.mp4';subprocess.run(['ffmpeg','-v','error','-n','-ss',str(first),'-i',str(base),'-t',str(last-first),'-map','0:v:0','-an','-c:v','copy','-tag:v','hvc1','-video_track_timescale','15360','-avoid_negative_ts','make_zero',str(p)],check=True)
  receipt=validate(p,(last-first)*30,reference=base,log=work/f'{first}-{last}.decode.log');parts.append({'path':str(p),'first':first,'last':last,'validation':receipt})
 listing=work/'concat.txt';listing.write_text(''.join("file '"+p['path'].replace("'","'\\''")+"'\n" for p in parts));expected=[x['data_hash'] for p in parts for x in packets(p['path'],hashes=True)]
 untrimmed=work/'assembled-untrimmed.mp4';cmd=['ffmpeg','-v','error','-n','-f','concat','-safe','0','-i',str(listing)]
 if a.audio_wav:
  wav=Path(a.audio_wav).resolve()
  with wave.open(str(wav)) as w:
   assert w.getframerate()==48000 and w.getnframes()==240*48000 and w.getnchannels()==2;w.setpos(round(238.5*48000));assert not any(w.readframes(w.getnframes()-w.tell())),'Tail trim requires original final1.5seconds silence'
  cmd+=['-i',str(wav),'-map','0:v:0','-map','1:a:0','-c:a','aac_at','-b:a','320k','-ar','48000','-ac','2']
 else:cmd+=['-i',str(base),'-map','0:v:0','-map','1:a:0','-c:a','copy']
 cmd+=['-c:v','copy','-tag:v','hvc1','-movflags','+faststart',str(untrimmed)];subprocess.run(cmd,check=True)
 # Original GRAIN ends with silence. Trim only AAC delay padding; all7200 video packets must survive.
 subprocess.run(['ffmpeg','-v','error','-n','-i',str(untrimmed),'-map','0','-c','copy','-t','239.98','-movflags','+faststart',str(out)],check=True)
 actual=packets(out,hashes=True);assert len(actual)==7200 and [x['data_hash'] for x in actual]==expected;result=validate(out,7200,reference=base,log=work/'full-decode.log');result['parts']=parts;result['videoPacketsCopiedExactly']=True;result['audioEncodes']=1 if a.audio_wav else 0;result['baseSha256']=sha(base);save(work/'assembly-receipt.json',result)
if __name__=='__main__':main()
