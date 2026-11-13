import{parentPort,workerData}from'node:worker_threads';
import{normaliseGlb}from'./glb.mjs';
try{const result=await normaliseGlb(workerData.bytes,workerData.widthCm);parentPort.postMessage({ok:true,...result});}catch(e){parentPort.postMessage({ok:false,error:e.message});}
