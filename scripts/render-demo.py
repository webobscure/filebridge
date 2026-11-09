"""Encode genuine CUA window-capture frames as a short, captioned MP4 and GIF."""
import json
from pathlib import Path
import subprocess
import sys

source = Path(sys.argv[1])
recording = json.loads(source.read_text())
frames = recording['frames']
if len(frames) < 5:
    raise SystemExit('A real window recording with at least five frames is required.')
output = Path(__file__).resolve().parent.parent / 'docs/media'
output.mkdir(parents=True, exist_ok=True)
concat = source.parent / 'frames.ffconcat'
lines = ['ffconcat version 1.0']
for index, frame in enumerate(frames):
    lines.append("file '" + frame['file'].replace("'", "'\\''") + "'")
    end = frames[index + 1]['time'] if index + 1 < len(frames) else recording['duration']
    lines.append('duration ' + str(max(0.04, end - frame['time'])))
lines.append("file '" + frames[-1]['file'].replace("'", "'\\''") + "'")
concat.write_text('\n'.join(lines) + '\n')
marks = recording['marks']
steps = [('connect', 'Connect to your saved FTP server'), ('browse', 'Browse remote folders'),
         ('open', 'Open a remote PHP file'), ('edit', 'Edit it in your editor'),
         ('save', 'Save directly to FTP with Cmd+S / Ctrl+S')]
def timestamp(seconds):
    millis = max(0, round(seconds * 1000))
    return f'{millis//3600000:02}:{millis//60000%60:02}:{millis//1000%60:02},{millis%1000:03}'

captions = []
for index, (key, text) in enumerate(steps):
    start = 0 if index == 0 else marks[key] - frames[0]['time']
    end = (marks[steps[index + 1][0]] if index + 1 < len(steps) else recording['duration']) - frames[0]['time']
    captions.append(f'{index+1}\n{timestamp(start)} --> {timestamp(end)}\n{text}\n')
subtitle = output / 'filebridge-demo.en.srt'
subtitle.write_text('\n'.join(captions))
video = output / 'filebridge-demo.mp4'
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(concat),
    '-i',str(subtitle),'-map','0:v','-map','1:0','-vf','scale=1920:1200:flags=lanczos','-r','30',
    '-c:v','libx264','-preset','medium','-crf','20','-pix_fmt','yuv420p','-c:s','mov_text',
    '-metadata:s:s:0','language=eng','-disposition:s:0','default',
    '-movflags','+faststart',str(video)],check=True)
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(video),'-filter_complex',
    'fps=4,scale=1280:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer',
    '-loop','0',str(output/'filebridge-demo.gif')],check=True)
print('Created', video)
