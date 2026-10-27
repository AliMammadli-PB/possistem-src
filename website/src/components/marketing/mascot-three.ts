/** Real GLB renderer. Loaded only after hydration; SVG remains the failure fallback. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { cycleScene, mascotPose, sceneDuration, MASCOT_PLAYBACK_RATE, type MascotState, type RobotPose } from './mascot-animation';
import { reportUiState } from '@/lib/ui-diagnostics';

export type Mascot3DController={dispose:()=>void};
const MODEL='/assets/mascot-3d/possistem-assistant-v1.glb';
const bound=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));

export async function mountMascot3D(canvas:HTMLCanvasElement,read:()=>MascotState,signal:AbortSignal,onFailure:()=>void,readView?:()=>number):Promise<Mascot3DController>{
 let renderer:THREE.WebGLRenderer|null=null,model:THREE.Group|null=null,env:THREE.WebGLRenderTarget|null=null,disposed=false;
 let timerHandle=false;
 let handle=0,last=0,total=0,cycle=0,activity=0,lastDraw=0,lastReport=0,frames=0,lastGesture=read().gesture,lastMotion=read().motion;
 let pointer:{x:number;y:number}|null=null,gazeX=0,gazeY=0,turn=0,lastView=NaN;
 const pointerType=typeof window.PointerEvent==='function'?'pointermove':'mousemove';
 const native=typeof requestAnimationFrame==='function';
 const request=(cb:FrameRequestCallback)=>native?requestAnimationFrame(cb):window.setTimeout(()=>cb(performance.now()),33);
 const cancel=(id:number)=>timerHandle||!native?clearTimeout(id):cancelAnimationFrame(id);
 const clearPointer=()=>{pointer=null;};
 const move=(e:Event)=>{const p=e as PointerEvent;if(p.pointerType&&p.pointerType!=='mouse'&&p.pointerType!=='pen'){clearPointer();return;}if(read().motion==='full'&&Number.isFinite(p.clientX)&&Number.isFinite(p.clientY))pointer={x:p.clientX,y:p.clientY};};
 const leave=(e:Event)=>{if(!(e as MouseEvent).relatedTarget)clearPointer();};
 const touch=(e:Event)=>{if((e as PointerEvent).pointerType==='touch')clearPointer();};
 const destroyModel=(root:THREE.Object3D)=>{const materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();root.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});for(const m of materials){for(const v of Object.values(m))if(v instanceof THREE.Texture)textures.add(v);m.dispose();}for(const t of textures){const img=t.image;if(typeof ImageBitmap!=='undefined'&&img instanceof ImageBitmap)img.close();t.dispose();}};
 const resize=()=>{if(!renderer)return;const b=canvas.getBoundingClientRect();renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.setSize(Math.max(1,b.width),Math.max(1,b.height),false);camera.left=-2.708*b.width/Math.max(1,b.height);camera.right=-camera.left;camera.updateProjectionMatrix();};
 let observer:ResizeObserver|null=null;
 const visibility=()=>{clearPointer();cancel(handle);last=0;if(!disposed&&!document.hidden){timerHandle=false;handle=request(tick);}};
 const contextLost=(e:Event)=>{e.preventDefault();dispose();onFailure();};
 const dispose=()=>{if(disposed)return;disposed=true;cancel(handle);observer?.disconnect();window.removeEventListener(pointerType,move);window.removeEventListener('pointerdown',touch);window.removeEventListener('blur',clearPointer);window.removeEventListener('resize',resize);document.removeEventListener('pointerout',leave);document.removeEventListener('mouseleave',leave);document.removeEventListener('visibilitychange',visibility);canvas.removeEventListener('webglcontextlost',contextLost);signal.removeEventListener('abort',dispose);if(model)destroyModel(model);env?.dispose();renderer?.renderLists.dispose();renderer?.dispose();};
 const scene=new THREE.Scene();
 const camera=new THREE.OrthographicCamera(-2.60,2.60,2.708,-2.708,.1,50);camera.position.set(0,2.708,11);camera.lookAt(0,2.708,0);
 let rig:THREE.Object3D|undefined,head:THREE.Object3D|undefined,left:THREE.Object3D|undefined,right:THREE.Object3D|undefined,mouth:THREE.Object3D|undefined;
 let eyes:(THREE.Object3D|undefined)[]=[],pupils:(THREE.Object3D|undefined)[]=[],laptop:THREE.Object3D|undefined,book:THREE.Object3D|undefined;
 let pose=mascotPose('idle',0,3800,0);
 const tick=(stamp:number)=>{
  if(disposed||document.hidden||!renderer||!rig||!head)return;
  const state=read(),dt=last?Math.min(80,stamp-last):0;last=stamp;
  const motionChanged=state.motion!==lastMotion,view=readView?.(),viewChanged=view!==undefined&&view!==lastView;lastView=view??NaN;
  if(motionChanged){lastMotion=state.motion;clearPointer();}
  const running=state.motion==='full',quiet=state.motion==='quiet',step=dt*(running?MASCOT_PLAYBACK_RATE:1);
  if(state.motion!=='off'){total+=step;activity+=step;if(running&&state.gesture==='cycle')cycle+=step;}
  if(state.gesture!==lastGesture){activity=0;lastGesture=state.gesture;}
  if((state.motion!=='off'||motionChanged||viewChanged||frames===0)&&(stamp-lastDraw>=(quiet?100:33)-.5||motionChanged||viewChanged||frames===0)){lastDraw=stamp;
   const c=cycleScene(cycle);let action=running?(state.gesture==='cycle'?c.scene:state.gesture):'idle';let elapsed=state.gesture==='cycle'?c.elapsed:activity;
   if(action==='hover'&&elapsed>2000)action='idle';else if(state.gesture!=='cycle'&&elapsed>sceneDuration(action))action='idle';
   const target=mascotPose(action,elapsed,sceneDuration(action),state.motion==='off'?0:total),smooth=1-Math.exp(-Math.max(dt,16)/100);
   if(!running){target.x=target.y=target.tilt=target.left=target.right=0;target.scale=1;target.lookX=target.lookY=0;}
   if(state.motion==='off'){pose=target;gazeX=gazeY=turn=0;}
   for(const key of Object.keys(pose) as (keyof RobotPose)[])pose[key]+=(target[key]-pose[key])*smooth;
   let tx=0,ty=0;if(pointer&&running){const b=canvas.getBoundingClientRect(),dx=pointer.x-b.left-b.width*.5,dy=pointer.y-b.top-b.height*.39,d=Math.hypot(dx,dy,140);tx=dx/d;ty=dy/d;}
   gazeX+=(tx-gazeX)*smooth;gazeY+=(ty-gazeY)*smooth;
   // A measured inspection turn reveals the modeled rear once each automatic cycle.
   const turnTarget=running&&state.gesture==='cycle'&&c.scene==='scan'?Math.PI*2*(.5-.5*Math.cos(Math.PI*Math.min(1,c.elapsed/c.duration))):0;
   if(turnTarget===0&&turn>Math.PI)turn-=Math.PI*2;turn+=(turnTarget-turn)*smooth;
   rig.position.y=-pose.y*.008;rig.position.x=pose.x*.008;rig.rotation.z=-pose.tilt*Math.PI/180;rig.rotation.y=view===undefined?turn+gazeX*.10:view;rig.scale.setScalar(pose.scale);
   head.rotation.y=gazeX*.12+(action==='lookRight'?.16:action==='lookLeft'?-.16:0);head.rotation.x=gazeY*.075;
   if(left)left.rotation.z=-bound(pose.left,-65,110)*Math.PI/180;
   if(right)right.rotation.z=-bound(pose.right,-65,110)*Math.PI/180;
   eyes.forEach((eye,i)=>{if(eye)eye.scale.y=Math.max(.035,i?pose.eyeR:pose.eyeL);});
   pupils.forEach(p=>{if(p){p.position.x=(pointer&&running?gazeX:pose.lookX/9)*.055;p.position.y=-(pointer&&running?gazeY:pose.lookY/6)*.065;}});
   if(mouth){mouth.scale.y=Math.max(.4,pose.smile)+pose.mouth*1.6;mouth.scale.x=1+pose.mouth*.2;}
   if(laptop)laptop.visible=pose.laptop>.4;if(book)book.visible=pose.book>.4;
   renderer.render(scene,camera);frames++;canvas.dataset.frame=String(frames);canvas.dataset.scene=action;canvas.dataset.gaze=pointer&&running?'tracking':'rest';canvas.dataset.turn=turn.toFixed(3);
   if(stamp-lastReport>1000){lastReport=stamp;reportUiState('mascot',{engine:'three-webgl2',motion:state.motion,preference:state.preference,gesture:action,frameCount:frames,gaze:canvas.dataset.gaze,gazeX:Number(gazeX.toFixed(3)),gazeY:Number(gazeY.toFixed(3)),triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls,model:MODEL,visible:!document.hidden,running:state.motion!=='off'});}
  }
  // Paused mode polls slowly for preference changes without drawing or progressing the clock.
  timerHandle=state.motion==='off';handle=timerHandle?window.setTimeout(()=>tick(performance.now()),250):request(tick);
 };
 try{
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;renderer.setClearColor(0,0);
  const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();env=pmrem.fromScene(room,.04);scene.environment=env.texture;scene.environmentIntensity=.7;room.dispose();pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xe9f7ff,0x1b3771,.8));
  const key=new THREE.DirectionalLight(0xe4f4ff,2);key.position.set(-3,6,7);scene.add(key);const rim=new THREE.DirectionalLight(0x55bbff,1.5);rim.position.set(4,3,-3);scene.add(rim);
  signal.addEventListener('abort',dispose,{once:true});
  const response=await fetch(MODEL,{signal,cache:'force-cache'});if(!response.ok)throw new Error('Mascot model unavailable');
  const data=await response.arrayBuffer();if(signal.aborted)throw new DOMException('Aborted','AbortError');
  const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(data,'');
  if(signal.aborted||disposed){destroyModel(gltf.scene);throw new DOMException('Aborted','AbortError');}
  model=gltf.scene;scene.add(model);
  model.traverse(o=>{if(o instanceof THREE.Mesh){const materials=Array.isArray(o.material)?o.material:[o.material];for(const m of materials){if(m instanceof THREE.MeshBasicMaterial)m.toneMapped=false;if(m instanceof THREE.MeshStandardMaterial&&/Ice cyan light/.test(m.name)){m.toneMapped=false;m.emissiveIntensity=.65;}}}});
  rig=model.getObjectByName('MascotRoot');head=model.getObjectByName('Head');left=model.getObjectByName('ArmL');right=model.getObjectByName('ArmR');mouth=model.getObjectByName('Mouth');eyes=['EyeL','EyeR'].map(n=>model!.getObjectByName(n));pupils=['EyeLPupil','EyeRPupil'].map(n=>model!.getObjectByName(n));laptop=model.getObjectByName('Laptop');book=model.getObjectByName('Book');
  if(!rig||!head||eyes.some(e=>!e))throw new Error('Mascot rig incomplete');
  if(laptop)laptop.visible=false;if(book)book.visible=false;
  resize();if(typeof ResizeObserver==='function'){observer=new ResizeObserver(resize);observer.observe(canvas);}
  window.addEventListener('resize',resize,{passive:true});window.addEventListener(pointerType,move,{passive:true});window.addEventListener('pointerdown',touch,{passive:true});window.addEventListener('blur',clearPointer);document.addEventListener('pointerout',leave,{passive:true});document.addEventListener('mouseleave',leave);document.addEventListener('visibilitychange',visibility);canvas.addEventListener('webglcontextlost',contextLost);
  renderer.render(scene,camera);if(!document.hidden)handle=request(tick);
  return{dispose};
 }catch(error){dispose();throw error;}
}
