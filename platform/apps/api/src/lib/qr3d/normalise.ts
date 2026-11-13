import{Worker}from'node:worker_threads';
let running=0;
export function normaliseModel(bytes:Buffer,widthCm:number):Promise<{bytes:Buffer;metadata:{widthCm:number;dimensionsCm:number[];triangles:number;textures:number;bytes:number}}>{
 if(running>=2)return Promise.reject(Error('Model yoxlaması hazırda məşğuldur. Bir az sonra yenidən yoxlayın.'));
 running++;
 return new Promise((resolve,reject)=>{let settled=false;const worker=new Worker(new URL('./glb-worker.mjs',import.meta.url),{workerData:{bytes,widthCm},resourceLimits:{maxOldGenerationSizeMb:192},execArgv:[]});const finish=(error?:Error,result?:any)=>{if(settled)return;settled=true;running--;clearTimeout(timer);void worker.terminate();if(error)reject(error);else resolve(result);};const timer=setTimeout(()=>finish(Error('Model yoxlamasının vaxtı bitdi. Daha sadə GLB seçin.')),15000);worker.once('message',r=>finish(r.ok?undefined:Error(r.error),r.ok?{...r,bytes:Buffer.from(r.bytes)}:undefined));worker.once('error',e=>finish(e));worker.once('exit',()=>finish(Error('Model yoxlaması dayandı.')));});
}
