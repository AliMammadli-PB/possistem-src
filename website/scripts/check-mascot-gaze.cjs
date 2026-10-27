const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');
const browsers=require('playwright-core'),engine=process.env.QA_BROWSER||'chromium';
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
 const file=req.url==='/gaze.js'?path.join(root,'src/components/marketing/mascot-gaze.ts'):req.url.startsWith('/three/')?path.join(root,'node_modules/three',req.url.slice(7)):req.url==='/model.glb'?path.join(root,'public/assets/mascot-3d/possistem-assistant-v1.glb'):null;
 if(file){res.setHeader('Content-Type',req.url.endsWith('.glb')?'model/gltf-binary':'text/javascript');const source=fs.readFileSync(file);res.end(req.url==='/gaze.js'?ts.transpileModule(source.toString(),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText:source);return;}
 res.end('<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>');
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await browsers[engine].launch({executablePath:process.env.QA_CHROMIUM_EXECUTABLE,headless:true,args:engine==='chromium'?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[]});try{
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
 const result=await page.evaluate(async()=>{
 const THREE=await import('three'),{GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js'),{MeshoptDecoder}=await import('three/addons/libs/meshopt_decoder.module.js'),{createEyeGaze}=await import('/gaze.js');
 const {scene}=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('/model.glb');scene.updateMatrixWorld(true);let failuresBefore=0,samplesChecked=0;const directions=[-1,0,1],v=new THREE.Vector3(),ray=new THREE.Raycaster(),down=new THREE.Vector3(0,0,-1);const detail=[];
 for(const side of ['L','R']){
 const eye=scene.getObjectByName('Eye'+side),pupil=scene.getObjectByName('Eye'+side+'Pupil'),iris=eye.children.find(o=>/halo$/i.test(o.name));const inverse=eye.matrixWorld.clone().invert();
 const irisGeometry=iris.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,iris.matrixWorld)),surface=new THREE.Mesh(irisGeometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));surface.updateMatrixWorld(true);
 const inspect=()=>{let failures=0;pupil.updateWorldMatrix(true,true);pupil.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.getAttribute('position'),m=new THREE.Matrix4().multiplyMatrices(inverse,o.matrixWorld);for(let i=0;i<p.count;i+=3){v.fromBufferAttribute(p,i).applyMatrix4(m);ray.set(new THREE.Vector3(v.x,v.y,2),down);const hits=ray.intersectObject(surface);if(!hits.length||v.z-hits[0].point.z<.003)failures++;samplesChecked++;}});return failures;};
 for(const x of directions)for(const y of directions){pupil.position.set(x*.055,y*.065,0);failuresBefore+=inspect();}pupil.position.set(0,0,0);scene.updateMatrixWorld(true);
 const project=createEyeGaze(eye,pupil);if(!project)throw Error('Shipped GLB has no usable iris');
 for(const x of directions)for(const y of directions){project(x*.055,y*.065);const failures=inspect();if(failures)throw Error(`${side}: ${failures} hidden pupil/glint vertices at ${x},${y}`);}
 detail.push({eye:side,gazePositions:9});
 }
 return {failuresBefore,samplesChecked,detail};
 });assert.ok(result.failuresBefore>0,'Regression must reproduce the original occlusion');console.log(JSON.stringify({engine,browser:browser.version(),...result,passed:'Actual compressed GLB: pupil and reflection remain inside and above both curved irises in all nine gaze directions.'},null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);server.close();process.exitCode=1});
