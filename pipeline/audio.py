"""Rebuild original/revised score on CPU WebAudio; patch only 65–78s PCM."""
from pathlib import Path
import argparse, subprocess, shutil, wave, json, hashlib
import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(8 * 1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def decode(data):
    a = np.frombuffer(data, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
    v = a[:, 0] | a[:, 1] << 8 | a[:, 2] << 16
    return np.where(v & 0x800000, v - 0x1000000, v).reshape(-1, 2).astype(np.float64) / 2**23


def encode(audio):
    q = np.rint(np.clip(audio, -1, 1) * np.where(audio < 0, 8388608, 8388607)).astype(np.int32)
    q = np.where(q < 0, q + 16777216, q).reshape(-1)
    return np.column_stack([q & 255, q >> 8 & 255, q >> 16 & 255]).astype(np.uint8).tobytes()


def write_wav(path, params, data):
    with path.open('xb') as output:
        with wave.open(output, 'wb') as wav:
            wav.setparams(params)
            wav.writeframes(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work', default=str(ROOT / 'out/audio'), help='Fresh output directory (default: repo out/audio)')
    args = parser.parse_args()
    work = Path(args.work).resolve()
    work.mkdir(parents=True, exist_ok=False)
    film = work / 'film'
    (film / 'src/lib').mkdir(parents=True)
    (film / 'tools').mkdir(parents=True)
    shutil.copytree(ROOT / 'src/audio', film / 'src/audio')
    shutil.copytree(ROOT / 'pipeline/audio-baseline', film / 'src/audio-baseline')
    shutil.copy2(ROOT / 'src/lib/random.js', film / 'src/lib/random.js')
    shutil.copy2(ROOT / 'tools/serve.mjs', film / 'tools/serve.mjs')
    shutil.copy2(ROOT / 'pipeline/audio-render.html', film / 'audio-render.html')
    with (work / 'audio.log').open('x') as log:
        subprocess.run(['node', str(ROOT / 'pipeline/audio-render.mjs'), str(film), str(work)], stdout=log, stderr=log, check=True)
    data, params = [], []
    for name in ['baseline', 'revised']:
        with wave.open(str(work / (name + '.wav'))) as wav:
            params.append(wav.getparams())
            data.append(wav.readframes(wav.getnframes()))
    assert params[0] == params[1] and params[0].nchannels == 2 and params[0].sampwidth == 3 and params[0].framerate == 48000 and params[0].nframes == 240 * 48000
    first, last, fade = 65 * 48000, 78 * 48000, round(.2 * 48000)
    old, new = data
    u = np.linspace(0, 1, fade)
    ramp = u * u * (3 - 2 * u)
    weights = np.ones(last - first)
    weights[:fade], weights[-fade:] = ramp, ramp[::-1]
    start, end = first * 6, last * 6
    x, y = decode(old[start:end]), decode(new[start:end])
    patch = x + (y - x) * weights[:, None]
    assert abs(patch).max() < 1, 'Patch clipping'
    body = bytearray(old)
    body[start:end] = encode(patch)
    assert body[:start] == old[:start] and body[end:] == old[end:], 'Outside PCM changed'
    out = work / 'patched-240s.wav'
    write_wav(out, params[0], body)
    for name, pcm in [('original-58-80.wav', old), ('patched-58-80.wav', body)]:
        write_wav(work / name, params[0], pcm[58 * 48000 * 6:80 * 48000 * 6])
    boundaries = {}
    for name, k in [('in', first), ('out', last)]:
        a = decode(old[(k - 1) * 6:(k + 1) * 6])
        b = decode(body[(k - 1) * 6:(k + 1) * 6])
        difference = float(np.max(np.abs(b[1 if name == 'in' else 0] - a[1 if name == 'in' else 0])))
        assert difference <= 2 / 2**23, 'Boundary quantization jump'
        boundaries[name] = {'patchEdgeDifference': difference, 'baselineSampleStep': float(np.max(np.abs(a[1] - a[0]))), 'patchedSampleStep': float(np.max(np.abs(b[1] - b[0])))}
    regions = []
    for begin, finish in [(58, 65), (65, 69), (69, 72.2), (72.2, 74), (74, 78), (78, 80)]:
        entry = {'range': [begin, finish]}
        for name, pcm in [('baseline', old), ('patched', body)]:
            audio = decode(pcm[round(begin * 48000) * 6:round(finish * 48000) * 6])
            entry[name] = {'rmsDbfs': float(20 * np.log10(np.sqrt(np.mean(audio * audio)))), 'peakDbfs': float(20 * np.log10(np.max(np.abs(audio))))}
        regions.append(entry)
    outside_old, outside_new = old[:start] + old[end:], body[:start] + body[end:]
    render = json.loads((work / 'audio-render-receipt.json').read_text())
    full_peak = 0
    for i in range(0, len(body), 48000 * 6):
        full_peak = max(full_peak, float(np.max(np.abs(decode(body[i:i + 48000 * 6])))))
    assert full_peak < 1, 'Full WAV clipping'
    baseline_text = (ROOT / 'pipeline/audio-baseline/score.js').read_text()
    revised_text = (ROOT / 'src/audio/score.js').read_text()
    for cue in ['stemStrings', 'stemKeys']:
        fragments = []
        for text in [baseline_text, revised_text]:
            begin = text.index('function ' + cue)
            finish = text.index('\nfunction ', begin + 1)
            fragments.append(text[begin:finish])
        assert fragments[0] == fragments[1], cue + ' music cue function changed'
    historical = json.loads((ROOT / 'pipeline/audio-baseline/manifest.json').read_text())
    baseline_hash = sha(work / 'baseline.wav')
    report = {'window': [65, 78], 'fadeSeconds': .2, 'outsidePcmBytesIdentical': True, 'outsidePcmSha256Baseline': hashlib.sha256(outside_old).hexdigest(), 'outsidePcmSha256Patched': hashlib.sha256(outside_new).hexdigest(), 'frames': params[0].nframes, 'duration': 240, 'sampleRate': 48000, 'channels': 2, 'bitDepth': 24, 'baselineWavSha256': baseline_hash, 'revisedWavSha256': sha(work / 'revised.wav'), 'patchedWavSha256': sha(out), 'baselineMasterGain': render['stats']['baseline']['stats']['masterGain'], 'revisedMasterGain': render['stats']['revised']['stats']['masterGain'], 'historicalGainReference': historical['historicalGainReference'], 'historicalBaselineHashMatchOnThisRun': baseline_hash == historical['historicalWavSha256Reference'], 'fullPeakDbfs': float(20 * np.log10(full_peak)), 'patchPeakDbfs': float(20 * np.log10(abs(patch).max())), 'boundaries': boundaries, 'regions': regions, 'baselineSources': {p.name: sha(p) for p in sorted((ROOT / 'pipeline/audio-baseline').glob('*.js'))}, 'currentAudioSources': {p.name: sha(p) for p in sorted((ROOT / 'src/audio').glob('*.js'))}, 'cpuOnly': True, 'musicalCueFunctionsUnchanged': True, 'note': 'Fresh baseline and revised share the baseline exact gain; original limiter still runs. No private WAV input. Historical hash is an observation, not a cross-browser guarantee.'}
    with (work / 'audio-patch-receipt.json').open('x') as receipt:
        json.dump(report, receipt, ensure_ascii=False, indent=2)
        receipt.write('\n')
    print(json.dumps({'output': str(out), 'outsidePcmBytesIdentical': True, 'historicalBaselineHashMatchOnThisRun': report['historicalBaselineHashMatchOnThisRun'], 'masterGain': report['baselineMasterGain'], 'patchedSha256': report['patchedWavSha256']}, indent=2))


if __name__ == '__main__':
    main()
