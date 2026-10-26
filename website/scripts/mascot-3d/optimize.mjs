import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS,KHRMaterialsUnlit} from '@gltf-transform/extensions';
import {dedup,weld,meshopt} from '@gltf-transform/functions';
import {MeshoptEncoder,MeshoptDecoder} from 'meshoptimizer';
await MeshoptEncoder.ready;await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder,'meshopt.decoder':MeshoptDecoder});
const doc=await io.read(process.argv[2]);
// glTF does not multiply emissiveFactor by COLOR_0. Preserve Blender's
// vertex-colored emission as an unlit base color instead of a white emitter.
const unlit=doc.createExtension(KHRMaterialsUnlit);
for(const mat of doc.getRoot().listMaterials())if(mat.getName()==='Aqua display gradient'){
 mat.setBaseColorFactor([1,1,1,1]).setEmissiveFactor([0,0,0]);
 mat.setExtension('KHR_materials_unlit',unlit.createUnlit());
}
for(const mesh of doc.getRoot().listMeshes())for(const primitive of mesh.listPrimitives()){
 if(primitive.getMaterial()?.getName()==='Aqua display gradient'&&primitive.getAttribute('COLOR_1')){
  primitive.setAttribute('COLOR_0',primitive.getAttribute('COLOR_1'));
  primitive.setAttribute('COLOR_1',null);
 }
}
await doc.transform(dedup(),weld(),meshopt({encoder:MeshoptEncoder,level:'medium'}));
await io.write(process.argv[3],doc);
console.log('Preserved pivots:',doc.getRoot().listNodes().map(n=>n.getName()).filter(n=>['MascotRoot','Head','ArmL','ArmR','EyeL','EyeR','EyeLPupil','EyeRPupil','Mouth','Laptop','Book'].includes(n)));
