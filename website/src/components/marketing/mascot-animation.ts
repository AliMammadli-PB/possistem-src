import { reportUiState } from '@/lib/ui-diagnostics';

export const MASCOT_SCENES=['hello','blink','doubleBlink','winkLeft','winkRight','happy','shy','surprise','laugh','sad','cry','think','lookLeft','lookRight','lookUp','lookDown','reading','page','typing','coding','coffee','sleep','wake','dance','jump','wave','clap','salute','listen','confused','love','celebrate','nod','no','stretch','charge','scan','peek','dizzy','heartbeat'] as const;
export type MascotScene=typeof MASCOT_SCENES[number];
export type MascotGesture=MascotScene|'idle'|'hover'|'cycle'|'talk'|'thinking'|'greet';
export type MascotMotion='auto'|'full'|'off';
export type EffectiveMotion='full'|'quiet'|'off';
export const AUTO_SCENES:readonly MascotGesture[]=['hello','lookRight','nod','typing','happy','listen','wave','think','page','peek','talk','stretch','coding','love','scan','dance','reading','celebrate','blink','jump'];
export const sceneDuration=(scene:string)=>scene==='blink'||scene==='doubleBlink'?2100:scene.startsWith('wink')?2400:scene==='sleep'?3800:scene==='reading'||scene==='typing'?4600:3800;
export const sceneGap=(scene:string)=>['reading','typing','sleep'].includes(scene)?0:550;
export const SCENE_DURATIONS=MASCOT_SCENES.map(sceneDuration);
export const SCENE_GAP=550;
export const MASCOT_PLAYBACK_RATE=1.25;
const CYCLE_MS=AUTO_SCENES.reduce((n,s)=>n+sceneDuration(s)+sceneGap(s),0);
const clamp=(v:number,min=0,max=1)=>Math.max(min,Math.min(max,v));
const ease=(v:number)=>{const x=clamp(v);return x*x*(3-2*x);};
const n=(v:number)=>Number(v.toFixed(3));
/** Closing, brief contact, opening: a blink is never a persistent facial state. */
export function blinkPulse(elapsed:number,start:number,duration=190){const t=(elapsed-start)/duration;if(t<=0||t>=1)return 0;if(t<.38)return ease(t/.38);if(t<.57)return 1;return 1-ease((t-.57)/.43);}
const naturalBlink=(total:number)=>Math.max(blinkPulse(total%8400,1900),blinkPulse(total%8400,6100,180));
export type RobotPose={x:number;y:number;tilt:number;scale:number;left:number;right:number;eyeL:number;eyeR:number;lookX:number;lookY:number;smile:number;mouth:number;oh:number;book:number;laptop:number;cup:number;page:number;typing:number;question:number;speech:number;stars:number;heart:number;cheeks:number;tears:number;sleep:number;charge:number;scan:number};
export function mascotPose(action:MascotGesture,elapsed:number,duration:number,total:number):RobotPose{
 const t=elapsed/1000,beat=Math.sin(t*5.2),slow=Math.sin(t*2.1),progress=clamp(elapsed/duration);
 const blink=naturalBlink(total),p:RobotPose={x:1.2*Math.sin(total/650),y:-10*Math.sin(total/340),tilt:.55*Math.sin(total/540),scale:1,left:1.8*Math.sin(total/480),right:-1.2*Math.sin(total/500+.7),eyeL:1-blink*.985,eyeR:1-blink*.985,lookX:0,lookY:0,smile:1,mouth:0,oh:0,book:0,laptop:0,cup:0,page:0,typing:0,question:0,speech:0,stars:0,heart:0,cheeks:0,tears:0,sleep:0,charge:0,scan:0};
 const wink=(which:'eyeL'|'eyeR',start=650)=>{const pulse=blinkPulse(elapsed,start,340);if(pulse>0){p.eyeL=p.eyeR=1;p[which]=1-.985*pulse;}};
 switch(action){
 case 'hello':case 'greet':case 'wave':case 'hover':p.left=85-13*Math.sin(t*5.5);p.tilt=-1.5+1.2*slow;p.smile=1.25;if(action==='hover'){wink('eyeR');p.cheeks=.25;}break;
 case 'blink':{const b=blinkPulse(elapsed,650);p.eyeL=p.eyeR=1-.985*b;break;}
 case 'doubleBlink':{const b=Math.max(blinkPulse(elapsed,550,170),blinkPulse(elapsed,850,170));p.eyeL=p.eyeR=1-.985*b;break;}
 case 'winkLeft':wink('eyeL');p.smile=1.2;break;case 'winkRight':wink('eyeR');p.smile=1.2;break;
 case 'happy':p.y-=4*Math.sin(Math.PI*progress);p.smile=1.55;p.stars=.7;break;
 case 'shy':p.lookY=3;p.tilt=2;p.cheeks=.5;p.smile=.65;p.eyeL*=.88;p.eyeR*=.88;break;
 case 'surprise':p.eyeL*=1.08;p.eyeR*=1.08;p.oh=.9;p.y-=5*Math.sin(Math.PI*progress);p.stars=.5;break;
 case 'laugh':p.smile=1.65;p.mouth=.35+.12*beat;p.y-=1.8*Math.abs(beat);p.eyeL*=.7;p.eyeR*=.7;break;
 case 'sad':p.smile=-.55;p.lookY=2;p.eyeL*=.75;p.eyeR*=.75;p.y+=2;break;
 case 'cry':p.smile=-.6;p.eyeL*=.6;p.eyeR*=.6;p.tears=.6;break;
 case 'thinking':case 'think':p.lookX=2;p.lookY=-4;p.tilt=2.5;p.smile=.4;p.question=.8;break;
 case 'lookLeft':p.lookX=-5*ease(elapsed/350);p.smile=.7;break;case 'lookRight':p.lookX=5*ease(elapsed/350);p.smile=.7;break;
 case 'lookUp':p.lookY=-5;p.smile=.7;break;case 'lookDown':p.lookY=5;p.smile=.7;break;
 case 'reading':case 'page':p.left=-50;p.right=78;p.book=1;p.lookY=4;p.lookX=2*Math.sin(t*1.5);p.smile=.45;if(action==='page')p.page=ease((elapsed-900)/1000);break;
 case 'typing':case 'coding':p.left=-56+3.2*beat;p.right=62+2.2*Math.sin(t*6);p.laptop=1;p.typing=1;p.lookY=3;p.smile=.65;break;
 // The single-joint artwork can hold a cup; pretending to reach its mouth would detach the arm.
 case 'coffee':p.right=46+4*Math.sin(t*1.7);p.cup=1;p.smile=.9;p.eyeL*=.92;p.eyeR*=.92;break;
 case 'sleep':{const rest=ease((elapsed-450)/500)*(1-ease((elapsed-2600)/650));p.eyeL*=1-rest*.985;p.eyeR*=1-rest*.985;p.sleep=rest;p.smile=.3;p.y+=rest*3;break;}
 case 'wake':p.eyeL*=1.05;p.eyeR*=1.05;p.left=28*Math.sin(Math.PI*progress);p.right=-22*Math.sin(Math.PI*progress);p.y-=3*Math.sin(Math.PI*progress);p.smile=1.25;break;
 case 'dance':p.x=4*slow;p.y-=4*Math.abs(beat);p.tilt=2.5*slow;p.left=18+16*beat;p.right=-12-12*beat;p.smile=1.3;break;
 case 'jump':p.y-=17*Math.sin(Math.PI*clamp((elapsed-400)/1000));p.scale=1-.018*Math.sin(Math.PI*progress);p.smile=1.4;break;
 case 'clap':{const tap=(1-Math.cos(t*6))/2;p.left=-62-13*tap;p.right=92+13*tap;p.smile=1.35;break;}
 case 'salute':p.left=124*ease(elapsed/400);p.tilt=-1.5;p.smile=.7;break;
 case 'listen':p.tilt=-2.5+Math.sin(t*2);p.lookX=-2;p.smile=.5;p.speech=.65;break;
 case 'talk':p.mouth=.2+.22*(1+Math.sin(t*10))/2;p.smile=1.1;p.left=18+9*slow;p.speech=1;break;
 case 'confused':p.x=2*slow;p.lookX=2*Math.sin(t*2);p.question=1;p.smile=.35;break;
 case 'love':p.heart=.8;p.cheeks=.2;p.smile=1.2;break;
 case 'celebrate':p.left=84-12*beat;p.right=-7+5*slow;p.stars=.85;p.smile=1.4;p.y-=3*Math.sin(Math.PI*progress);break;
 case 'nod':p.y+=2.5*Math.sin(t*3);p.tilt=1.5*Math.sin(t*3);p.smile=1.1;break;
 case 'no':p.x=3*Math.sin(t*3);p.lookX=-2*Math.sin(t*3);p.smile=.25;break;
 case 'stretch':p.left=36*Math.sin(Math.PI*progress);p.right=-32*Math.sin(Math.PI*progress);p.y-=4*Math.sin(Math.PI*progress);p.smile=1.1;break;
 case 'charge':p.charge=.7+.2*slow;p.stars=.3;p.smile=.6;break;
 case 'scan':p.scan=.6;p.lookX=4*Math.sin(t*1.5);p.smile=.4;break;
 case 'peek':p.x=5*Math.sin(Math.PI*progress);p.lookX=4;p.smile=.6;wink('eyeL',950);break;
 case 'dizzy':p.tilt=1.8*slow;p.lookX=3*slow;p.lookY=2*Math.cos(t*2.1);p.oh=.45;p.stars=.6;break;
 case 'heartbeat':p.scale=1+.008*Math.sin(t*4);p.heart=.7;p.smile=1.1;break;
 }
 p.eyeL=clamp(p.eyeL,.015,1.1);p.eyeR=clamp(p.eyeR,.015,1.1);return p;
}
export function cycleScene(elapsed:number){let cursor=((elapsed%CYCLE_MS)+CYCLE_MS)%CYCLE_MS;for(let i=0;i<AUTO_SCENES.length;i++){const scene=AUTO_SCENES[i],duration=sceneDuration(scene),gap=sceneGap(scene);if(cursor<duration+gap)return{scene:cursor<duration?scene:'idle' as MascotGesture,index:i,elapsed:cursor,duration,stage:cursor<duration?'scene':'rest'};cursor-=duration+gap;}return{scene:'idle' as MascotGesture,index:0,elapsed:0,duration:3800,stage:'rest'};}
const blendPose=(from:RobotPose,to:RobotPose,progress:number)=>{const p={...to},w=ease(progress);for(const k of Object.keys(p) as (keyof RobotPose)[])p[k]=from[k]+(to[k]-from[k])*w;return p;};
export type MascotState={gesture:MascotGesture;motion:EffectiveMotion;preference:MascotMotion};
export type MascotController=(()=>void)&{play:(scene:MascotGesture)=>void;seek:(scene:MascotGesture,elapsed:number)=>void};

export type MascotGaze={x:number;y:number;leanX:number;leanY:number};
/** A bounded gaze cone in the eyes' local seven-degree coordinate system. */
export function mascotGaze(clientX:number,clientY:number,bounds:Pick<DOMRect,'left'|'top'|'width'|'height'>):MascotGaze{
 if(![clientX,clientY,bounds.left,bounds.top,bounds.width,bounds.height].every(Number.isFinite)||bounds.width<=0||bounds.height<=0)return{x:0,y:0,leanX:0,leanY:0};
 const dx=clientX-(bounds.left+bounds.width*328/627),dy=clientY-(bounds.top+bounds.height*260/650),distance=Math.hypot(dx,dy,160),angle=7*Math.PI/180;
 return{x:9*(dx*Math.cos(angle)+dy*Math.sin(angle))/distance,y:6*(-dx*Math.sin(angle)+dy*Math.cos(angle))/distance,leanX:dx/distance,leanY:dy/distance};
}

export function startMascotAnimation(svg:SVGSVGElement,read:()=>MascotState):MascotController{
 const parts=new Map<string,SVGElement>();svg.querySelectorAll<SVGElement>('[data-part]').forEach(e=>parts.set(e.dataset.part!,e));
 const attr=(name:string,key:string,value:string|number)=>parts.get(name)?.setAttribute(key,String(value));
 const opacity=(name:string,value:number)=>attr(name,'opacity',n(clamp(value)));
 let disposed=false,handle=0,last:number|null=null,total=0,cycle=0,activity=0,lastDraw=-1000,lastReport=-1000,frames=0,previous:MascotGesture='idle',previousScene='',transition=0,manual:{scene:MascotGesture;elapsed:number;freeze:boolean}|null=null;
 let pose=mascotPose('idle',0,3800,0),from=pose,failedAssets=0,loadedAssets=0;
 const native=typeof window.requestAnimationFrame==='function',now=()=>typeof performance!=='undefined'?performance.now():Date.now();
 const request=(cb:FrameRequestCallback)=>native?window.requestAnimationFrame(cb):window.setTimeout(()=>cb(now()),33);
 const cancel=(id:number)=>native?window.cancelAnimationFrame(id):window.clearTimeout(id);
 const pointerEvent=typeof window.PointerEvent==='function'?'pointermove':'mousemove';
 let pointer:{x:number;y:number}|null=null,bounds:DOMRect|null=null,boundsDirty=true;
 let gaze: MascotGaze={x:0,y:0,leanX:0,leanY:0},gazeWeight=0;
 let perspective=false;try{perspective=typeof CSS!=='undefined'&&CSS.supports('transform','perspective(600px) rotateY(1deg)');}catch{/* Flat browsers retain the material lighting. */}
 const clearPointer=()=>{pointer=null;};
 const followPointer=(event:Event)=>{const e=event as PointerEvent;if(e.pointerType&&e.pointerType!=='mouse'&&e.pointerType!=='pen'){clearPointer();return;}if(read().motion!=='full'||document.visibilityState==='hidden')return;if(Number.isFinite(e.clientX)&&Number.isFinite(e.clientY))pointer={x:e.clientX,y:e.clientY};};
 const leavePointer=(event:Event)=>{if(!(event as MouseEvent).relatedTarget)clearPointer();};
 const touchPointer=(event:Event)=>{if((event as PointerEvent).pointerType==='touch')clearPointer();};
 const invalidateBounds=()=>{boundsDirty=true;};
 const updateGaze=(delta:number,enabled:boolean)=>{
  if(boundsDirty||!bounds){bounds=svg.getBoundingClientRect();boundsDirty=false;}
  const target=enabled&&pointer?mascotGaze(pointer.x,pointer.y,bounds):{x:0,y:0,leanX:0,leanY:0};
  const weight=1-Math.exp(-delta/110);for(const key of ['x','y','leanX','leanY'] as const)gaze[key]+=(target[key]-gaze[key])*weight;
  gazeWeight+=((enabled&&pointer?1:0)-gazeWeight)*weight;
 };

 const draw=(p:RobotPose,clock=total)=>{
  const tracking=read().motion==='full'&&!manual?.freeze,weight=tracking?gazeWeight:0;
  const eyeX=clamp(p.lookX*(1-weight)+gaze.x*weight,-9,9),eyeY=clamp(p.lookY*(1-weight)+gaze.y*weight,-6,6);
  const lightX=tracking?gaze.leanX:0,lightY=tracking?gaze.leanY:0;
  svg.style.transform=perspective&&tracking?`perspective(600px) rotateX(${n(-lightY*4)}deg) rotateY(${n(lightX*5)}deg)`:'none';
  svg.dataset.gaze=tracking&&pointer?'tracking':'rest';svg.dataset.depth=perspective?'perspective':'lighting';
  attr('visor-light','cx',n(255+lightX*60));attr('visor-light','cy',n(205+lightY*40));
  attr('shell-light','cx',n(272+lightX*45));attr('shell-light','cy',n(428+lightY*30));
  attr('rig','transform',`translate(${n(p.x)} ${n(p.y)}) rotate(${n(p.tilt)} 313.5 390) translate(313.5 390) scale(${n(p.scale)}) translate(-313.5 -390)`);
  attr('shadow','rx',n(clamp(132+p.y*.5,112,144)));attr('shadow','opacity',n(clamp(.14+p.y*.002,.08,.18)));
  attr('left','transform',`rotate(${n(p.left)} 203 385)`);attr('right','transform',`rotate(${n(p.right)} 451 426)`);
  for(const side of ['left','right'] as const){const opening=side==='left'?p.eyeL:p.eyeR;const radius=side==='left'?36:31;attr(`aperture-${side}`,'y',n(-radius*opening));attr(`aperture-${side}`,'height',n(2*radius*opening));attr(`eye-white-${side}`,'ry',n(radius*Math.max(1,opening)));opacity(`eye-${side}`,opening<.09?0:1);opacity(`lid-${side}`,opening<.09?1:0);attr(`pupil-${side}`,'transform',`translate(${n(eyeX)} ${n(eyeY)})`);attr(`glint-${side}`,'transform',`translate(${n(-lightX*1.8)} ${n(-lightY*1.2)})`);}
  const s=p.smile,open=p.mouth;
  const mouth=p.oh>.1?`M302 303C302 ${n(287-7*p.oh)} 329 ${n(287-7*p.oh)} 329 303C329 ${n(319+5*p.oh)} 302 ${n(319+5*p.oh)} 302 303Z`:s<0?`M293 309Q315 ${n(309+27*s)} 337 309`:s<.5?`M303 305Q315 ${n(306+9*s)} 328 304`:`M290 295Q315 ${n(301+7*s)} 340 294Q334 ${n(307+9*s+12*open)} 315 ${n(308+9*s+12*open)}Q297 ${n(309+5*s)} 290 295Z`;
  attr('mouth','d',mouth);attr('mouth','fill',s<.5&&p.oh<=.1?'none':`url(#${svg.dataset.artworkId}-eye)`);attr('mouth','stroke-width',s<.5?5:2);
  for(const name of ['book','laptop','cup','question','speech','heart','cheeks','tears','sleep','charge','scan'] as const)opacity(name,p[name]);
  opacity('sparkles',p.stars*(.8+.2*Math.sin(clock/350)));
  // The mug follows the palm's actual shoulder rotation and counter-rotates to stay upright.
  const a=p.right*Math.PI/180,cx=451+73*Math.cos(a)-90*Math.sin(a),cy=426+73*Math.sin(a)+90*Math.cos(a);
  attr('cup','transform',`translate(${n(cx)} ${n(cy)}) rotate(-3)`);attr('steam','transform',`translate(0 ${n(-2*Math.sin(clock/450))})`);
  opacity('page-text',p.page<.5?1:0);
  attr('page','transform',`translate(315 478) scale(${n(Math.cos(p.page*Math.PI))} 1) translate(-315 -478)`);
  for(let i=0;i<3;i++){opacity(`line-${i}`,p.typing ? .4+.6*((Math.sin(clock/250-i)+1)/2):1);opacity(`dot-${i}`,.35+.65*((Math.sin(clock/220-i*1.2)+1)/2));}
  attr('scan','transform',`translate(0 ${n(22*Math.sin(clock/600))})`);
  attr('speech','transform',`translate(${n(2*Math.sin(clock/430))} ${n(-3*Math.sin(clock/390))})`);
 };
 const publish=(state:MascotState,scene:string,index:number,stage:string)=>{let reduced=false;try{reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false;}catch{/* Optional browser API. */}reportUiState('mascot',{gesture:scene,motion:state.motion,preference:state.preference,engine:native?'raster-svg-raf':'raster-svg-timer',sceneIndex:index+1,sceneCount:MASCOT_SCENES.length,cycleSceneCount:AUTO_SCENES.length,gaze:pointer&&state.motion==='full'?'tracking':'rest',gazeX:n(gaze.x),gazeY:n(gaze.y),depth:perspective?'perspective':'lighting',playbackRate:state.motion==='full'?MASCOT_PLAYBACK_RATE:1,targetFps:state.motion==='full'?60:20,stage,frameCount:frames,elapsedMs:Math.round(total),eyeLeft:n(pose.eyeL),eyeRight:n(pose.eyeR),loadedAssets,failedAssets,systemReduced:reduced,visible:document.visibilityState!=='hidden',running:!disposed&&state.motion!=='off'&&document.visibilityState!=='hidden'});};
 const tick=(stamp:number)=>{
  if(disposed)return;const state=read(),wallDelta=last===null?0:clamp(stamp-last,0,80),delta=wallDelta*(state.motion==='full'?MASCOT_PLAYBACK_RATE:1);last=stamp;updateGaze(wallDelta,state.motion==='full'&&!manual?.freeze);total+=delta;activity+=delta;transition+=delta;
  if(state.gesture!==previous){previous=state.gesture;activity=0;}
  if(state.gesture==='cycle'&&state.motion==='full'&&!manual)cycle+=delta;
  if(manual&&!manual.freeze)manual.elapsed+=delta;
  const frameDuration=1000/(state.motion==='full'?60:20),sinceDraw=stamp-lastDraw;
  if(sinceDraw>=frameDuration-.5){lastDraw=stamp-(sinceDraw%frameDuration);let scene:MascotGesture=state.gesture,elapsed=activity,duration=sceneDuration(scene),index=0,stage='activity';
   if(manual){scene=manual.scene;elapsed=manual.elapsed;duration=sceneDuration(scene);if(!manual.freeze&&elapsed>duration){manual=null;scene='idle';stage='rest';}}
   else if(scene==='cycle'){const c=cycleScene(cycle);scene=c.scene;elapsed=c.elapsed;duration=c.duration;index=c.index;stage=c.stage;}
   else if(scene==='hover'&&elapsed>2000){scene='idle';stage='hover-rest';}
   else if(scene!=='idle'&&elapsed>duration){scene='idle';stage='rest';}
   if(state.motion!=='full'){scene='idle';stage=state.motion==='off'?'stopped':'quiet';}
   if(previousScene!==scene){from=pose;transition=0;previousScene=scene;}
   const poseClock=manual?.freeze?elapsed:state.motion==='off'?0:total;const target=mascotPose(scene,elapsed,duration,poseClock);
   if(state.motion!=='full'){target.x=target.y=target.tilt=target.left=target.right=0;target.scale=1;}
   pose=manual?.freeze?target:blendPose(from,target,transition/280);draw(pose,poseClock);svg.dataset.scene=scene;svg.dataset.frame=String(++frames);
   if(stamp-lastReport>=1000){publish(state,scene,index,stage);lastReport=stamp;}
   if(state.motion==='off')return;
  }
  handle=request(tick);
 };
 const visibility=()=>{clearPointer();cancel(handle);last=null;if(!disposed&&document.visibilityState!=='hidden')handle=request(tick);else publish(read(),previousScene,0,'hidden');};
 const load=(image:SVGImageElement,url:string,fallback?:string)=>{const probe=new Image();probe.onload=()=>{if(disposed)return;image.setAttribute('href',url);loadedAssets++;if(loadedAssets===3){opacity('art',1);opacity('placeholder',0);svg.dataset.ready='true';}};probe.onerror=()=>{if(disposed)return;if(fallback){failedAssets++;load(image,fallback);}else{failedAssets++;svg.dataset.assetError='true';}};probe.src=url;};
 svg.querySelectorAll<SVGImageElement>('image[data-src]').forEach(image=>load(image,image.dataset.src!,image.dataset.fallback));
 window.addEventListener(pointerEvent,followPointer,{passive:true});window.addEventListener('pointerdown',touchPointer,{passive:true});window.addEventListener('blur',clearPointer);document.addEventListener('pointerout',leavePointer,{passive:true});document.addEventListener('mouseleave',leavePointer);window.addEventListener('resize',invalidateBounds,{passive:true});window.addEventListener('scroll',invalidateBounds,true);
 draw(pose);document.addEventListener('visibilitychange',visibility);if(document.visibilityState!=='hidden')handle=request(tick);
 const cleanup=(()=>{disposed=true;cancel(handle);document.removeEventListener('visibilitychange',visibility);window.removeEventListener(pointerEvent,followPointer);window.removeEventListener('pointerdown',touchPointer);window.removeEventListener('blur',clearPointer);document.removeEventListener('pointerout',leavePointer);document.removeEventListener('mouseleave',leavePointer);window.removeEventListener('resize',invalidateBounds);window.removeEventListener('scroll',invalidateBounds,true);svg.style.removeProperty('transform');publish(read(),previousScene,0,'detached');}) as MascotController;
 cleanup.play=scene=>{manual={scene,elapsed:0,freeze:false};from=pose;previousScene='';transition=0;last=null;};
 cleanup.seek=(scene,elapsed)=>{manual={scene,elapsed:clamp(elapsed,0,sceneDuration(scene)),freeze:true};from=pose;previousScene='';transition=0;};
 return cleanup;
}
