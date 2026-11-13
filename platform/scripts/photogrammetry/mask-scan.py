"""Private class-independent foreground masks for dense reconstruction.

Camera estimation keeps the original scene. Mask PNG names/dimensions match the
JPEGs and are consumed by PrepareDenseScene, never by public image endpoints.
"""
import argparse,json,os,time
from pathlib import Path
import numpy as np
from PIL import Image,ImageFilter
from scipy import ndimage

def clean_mask(alpha):
    binary=np.asarray(alpha,dtype=np.uint8)>=128
    labels,count=ndimage.label(binary)
    if not count:raise ValueError('No foreground found')
    h,w=binary.shape;sizes=np.bincount(labels.ravel());sizes[0]=0
    # The subject is framed centrally. Do not select an unrelated small object.
    candidates=np.flatnonzero(sizes>=binary.size*.015)
    if not len(candidates):raise ValueError('Subject too small')
    def score(k):
        y,x=ndimage.center_of_mass(binary,labels,int(k))
        return sizes[k]*np.exp(-3*((x/w-.5)**2+(y/h-.5)**2))
    chosen=max(candidates,key=score);mask=labels==chosen
    # Remove hairline background bridges/spurs before the guard band. Keep real
    # openings; do not fill holes or replace the silhouette with a bounding box.
    mask=ndimage.binary_opening(mask,iterations=max(1,min(3,round(min(h,w)/400))))
    parts,n=ndimage.label(mask)
    if n:
        sizes2=np.bincount(parts.ravel());sizes2[0]=0;mask=parts==int(sizes2.argmax())
    fraction=float(mask.mean())
    if not .02<=fraction<=.92:raise ValueError('Foreground coverage is implausible')
    # A one-pixel safety margin protects the actual silhouette without filling
    # real openings such as a cup handle. Pixels stay aligned with the originals.
    mask=ndimage.binary_dilation(mask,iterations=1)
    return Image.fromarray((mask*255).astype('uint8'),'L'),fraction

def sharpness(image,mask):
    gray=np.asarray(image.convert('L').resize((256,256)),dtype=np.float32)
    foreground=np.asarray(mask.resize((256,256),Image.Resampling.NEAREST))>0
    foreground=ndimage.binary_erosion(foreground,iterations=3)
    values=ndimage.laplace(gray)[foreground]
    return float(values.var()) if values.size else 0.

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--output',required=True);parser.add_argument('--model',default='isnet-general-use',choices=['isnet-general-use','birefnet-general-lite']);parser.add_argument('--limit',type=int,default=96);args=parser.parse_args()
    from rembg import new_session
    source=Path(args.input);target=Path(args.output);target.mkdir(parents=True,exist_ok=True,mode=0o700)
    files=sorted(p for p in source.iterdir() if p.suffix.lower() in ['.jpg','.jpeg'])[:args.limit]
    if not files:raise ValueError('No input photos')
    session=new_session(args.model,providers=['CPUExecutionProvider']);report=[];start=time.monotonic()
    for file in files:
        image=Image.open(file).convert('RGB');alpha=session.predict(image)[0]
        mask,fraction=clean_mask(alpha);metric=sharpness(image,mask)
        mask.save(target/(file.stem+'.png'));os.chmod(target/(file.stem+'.png'),0o600)
        report.append({'file':file.name,'coverage':round(fraction,4),'sharpness':round(metric,2)})
        print(json.dumps({'masked':len(report),'total':len(files),'sharpness':round(metric,2)}),flush=True)
    fractions=[r['coverage']for r in report];median=float(np.median(fractions))
    if max(fractions)>median*3 or min(fractions)<median/3:raise ValueError('Inconsistent subject masks; capture again with the subject centred')
    result={'model':args.model,'seconds':round(time.monotonic()-start,2),'frames':report,'lowDetailFrames':sum(r['sharpness']<15 for r in report),'metricNote':'Low sharpness is advisory: plain objects can also have few edges.'}
    (target/'report.json').write_text(json.dumps(result,indent=2));os.chmod(target/'report.json',0o600)
    print(json.dumps({'complete':True,'photos':len(report),'seconds':result['seconds']}),flush=True)
if __name__=='__main__':main()
