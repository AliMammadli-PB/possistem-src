"""Clean the capture's central object and export a mobile draft; never auto-publish."""
import bpy,bmesh,sys,json,math,os
import numpy as np
from mathutils import Vector,Matrix
args=sys.argv[sys.argv.index('--')+1:];obj,sfm,out=args[:3]
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
data=json.load(open(sfm));poses=[p['pose']['transform'] for p in data.get('poses',[])];
if len(poses)<12:raise RuntimeError('Fewer than 12 calibrated camera positions')
centers=np.array([list(map(float,p['center']))for p in poses]);rotations=[np.array(list(map(float,p['rotation']))).reshape(3,3)for p in poses]
solutions=[]
for transpose in [False,True]:
 rays=np.array([(r.T if transpose else r)@np.array([0,0,1])for r in rotations]);mats=np.array([np.eye(3)-np.outer(d,d)for d in rays]);focus=np.linalg.lstsq(mats.sum(axis=0),np.einsum('nij,nj->i',mats,centers),rcond=None)[0];error=np.median(np.linalg.norm(np.cross(centers-focus,rays),axis=1));solutions.append((error,focus,rays))
_,focus,rays=min(solutions,key=lambda s:s[0]);
# AliceVision's OBJ writer flips Y/Z relative to the SfM camera coordinates.
axis=np.array([1,-1,-1]);focus=focus*axis;centers=centers*axis;rays=rays*axis
dist=float(np.median(np.linalg.norm(centers-focus,axis=1)))
_,_,vt=np.linalg.svd(centers-centers.mean(axis=0));up=vt[-1];cameraUp=centers.mean(axis=0)-focus
if np.dot(up,cameraUp)<0:up=-up
up=Vector(up.tolist()).normalized();rotation=up.rotation_difference(Vector((0,0,1))).to_matrix().to_4x4();rotation.translation=-(rotation.to_3x3()@Vector(focus.tolist()))
# File XYZ is intentionally imported unchanged, then aligned using the recovered cameras.
bpy.ops.wm.obj_import(filepath=obj,forward_axis='Y',up_axis='Z');meshes=[o for o in bpy.context.selected_objects if o.type=='MESH']
if not meshes:raise RuntimeError('No reconstructed mesh')
for o in meshes:o.matrix_world=rotation@o.matrix_world
bpy.context.view_layer.objects.active=meshes[0]
if len(meshes)>1:bpy.ops.object.join()
o=bpy.context.object;bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
intrinsics=data.get('intrinsics',[]);halfFov=.45
if intrinsics:
 k=intrinsics[0];f=float(k.get('pxFocalLength') or k.get('focalLength') or 0);w=float(k.get('width',0));sensor=float(k.get('sensorWidth',36))
 if f and w:
  if f<100:f=f*w/sensor
  halfFov=min(.8,max(.25,w/(2*f)))
radius=dist*halfFov*.9
if not math.isfinite(radius) or radius<=0:raise RuntimeError('Capture centre cannot be estimated')
# Fit the support surface itself: an orbit's PCA can be tilted on a partial scan.
points=np.array([list(v.co)for v in o.data.vertices]);sample=points[np.sum(points[:,:2]**2,axis=1)<(radius*2)**2];rng=np.random.default_rng(31)
if len(sample)>6000:sample=sample[rng.choice(len(sample),6000,replace=False)]
best=None;threshold=radius*.005
# Foreground masks already exclude the support plane. Fitting one on a flat
# package would mistake the package's own surface for the table and erase it.
for _ in range(0 if '--foreground-masked' in args else 180):
 if len(sample)<100:break
 a,b,c=sample[rng.choice(len(sample),3,replace=False)];normal=np.cross(b-a,c-a);norm=np.linalg.norm(normal)
 if norm<1e-9:continue
 normal/=norm
 if abs(normal[2])<.85:continue
 mask=np.abs((sample-a)@normal)<threshold;score=int(mask.sum())
 if best is None or score>best[0]:best=(score,mask)
floor=None
if best and best[0]>max(100,len(sample)*.15):
 support=sample[best[1]];origin=support.mean(axis=0);normal=np.linalg.svd(support-origin)[2][-1]
 if normal[2]<0:normal=-normal
 planeRotation=Vector(normal.tolist()).rotation_difference(Vector((0,0,1))).to_matrix()
 for v in o.data.vertices:v.co=planeRotation@v.co
 floor=float((planeRotation@Vector(origin.tolist())).z)
 print('SUPPORT_PLANE',best[0],len(sample),floor,list(normal))
bm=bmesh.new();bm.from_mesh(o.data)
bad=[v for v in bm.verts if v.co.x*v.co.x+v.co.y*v.co.y>radius*radius or abs(v.co.z)>radius*1.6 or (floor is not None and v.co.z<floor+threshold*1.5)]
bmesh.ops.delete(bm,geom=bad,context='VERTS')
# A single plate/object should not carry detached reconstruction shards into AR.
remaining=set(bm.verts);components=[]
while remaining:
 seed=remaining.pop();group={seed};todo=[seed]
 while todo:
  v=todo.pop()
  for edge in v.link_edges:
   n=edge.other_vert(v)
   if n in remaining:remaining.remove(n);group.add(n);todo.append(n)
 faces={f for v in group for f in v.link_faces};components.append((sum(f.calc_area()for f in faces),group))
if not components:raise RuntimeError('No isolated object surface')
main=max(components,key=lambda c:c[0]);total=sum(c[0]for c in components)
if total<=0 or main[0]<total*.2:raise RuntimeError('Capture is too fragmented; use clearer overlapping views')
bmesh.ops.delete(bm,geom=[v for v in bm.verts if v not in main[1]],context='VERTS')
loose=[v for v in bm.verts if not v.link_faces];bmesh.ops.delete(bm,geom=loose,context='VERTS');bm.to_mesh(o.data);bm.free();o.data.update()
if len(o.data.polygons)<100:raise RuntimeError('Not enough object surface after background cleanup')
for image in bpy.data.images:
 if image.size[0] and max(image.size)>2048:
  r=2048/max(image.size);image.scale(max(1,int(image.size[0]*r)),max(1,int(image.size[1]*r)))
for m in o.data.materials:
 if m and m.use_nodes:
  p=m.node_tree.nodes.get('Principled BSDF')
  if p:p.inputs['Roughness'].default_value=.8;p.inputs['Metallic'].default_value=0
bpy.context.view_layer.objects.active=o;o.select_set(True)
o.data.calc_loop_triangles();count=len(o.data.loop_triangles)
if count>80000:
 d=o.modifiers.new('Mobile mesh budget','DECIMATE');d.ratio=80000/count;bpy.ops.object.modifier_apply(modifier=d.name)
props={p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties};opts=dict(filepath=out,export_format='GLB',use_selection=True,export_image_format='JPEG',export_apply=True)
# Retry texture encoding before rejecting a detailed mesh. Never send an
# oversized draft or reuse a previous export after a failed Blender invocation.
for quality in [85,75,65]:
 if 'export_jpeg_quality' in props:opts['export_jpeg_quality']=quality
 bpy.ops.export_scene.gltf(**opts)
 if os.path.getsize(out)<=10*1024*1024:break
else:
 for image in bpy.data.images:
  if image.size[0] and max(image.size)>1536:
   r=1536/max(image.size);image.scale(max(1,int(image.size[0]*r)),max(1,int(image.size[1]*r)))
 bpy.ops.export_scene.gltf(**opts)
 if os.path.getsize(out)>10*1024*1024:
  os.remove(out)
  raise RuntimeError('Reconstruction needs further operator optimisation before upload')
print('SCAN_EXPORT',json.dumps({'cameras':len(poses),'triangles':len(o.data.polygons),'bytes':os.path.getsize(out),'focusResidual':float(min(s[0]for s in solutions)),'draft':True}))
