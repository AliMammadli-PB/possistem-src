"""Controlled regression photos, rendered from the user's existing GLB; not a real scan."""
import bpy,sys,math,os
from mathutils import Vector
args=sys.argv[sys.argv.index('--')+1:];src,out=args;os.makedirs(out,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=src)
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH'];points=[o.matrix_world@Vector(c) for o in meshes for c in o.bound_box]
lo=Vector([min(v[i]for v in points)for i in range(3)]);hi=Vector([max(v[i]for v in points)for i in range(3)]);factor=.28/max(hi.x-lo.x,hi.y-lo.y)
# Parent the imported hierarchy so its internal transforms stay intact.
bpy.ops.object.empty_add();root=bpy.context.object
for o in list(bpy.context.scene.objects):
 if o!=root and o.parent is None:o.parent=root
root.scale=(factor,)*3;root.location=(-.5*(hi.x+lo.x)*factor,-.5*(hi.y+lo.y)*factor,-lo.z*factor)
bpy.context.view_layer.update()
bpy.ops.mesh.primitive_plane_add(size=1.5,location=(0,0,-.002));plane=bpy.context.object
mat=bpy.data.materials.new('Textured test board');mat.use_nodes=True;n=mat.node_tree.nodes;noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=125;noise.inputs['Detail'].default_value=2;mat.node_tree.links.new(noise.outputs['Color'],n.get('Principled BSDF').inputs['Base Color']);plane.data.materials.append(mat)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=8;prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='CUDA';prefs.get_devices();
for d in prefs.devices:d.use=d.type=='CUDA'
scene.cycles.device='GPU';scene.cycles.use_denoising=True;scene.render.resolution_x=768;scene.render.resolution_y=768;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='JPEG';scene.render.image_settings.quality=95;scene.world.color=(.35,.35,.35)
for loc,power,size in [((.3,-.3,1),80,1),((-.4,.3,.8),50,.7)]:
 bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=size;light.rotation_euler=(Vector((0,0,0))-light.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add();cam=bpy.context.object;scene.camera=cam;cam.data.lens=36;cam.data.sensor_width=36
for ring,elevation in enumerate([25,45]):
 for i in range(24):
  
  if os.path.exists(os.path.join(out,f'{ring*24+i:04d}.jpg')):continue
  theta=2*math.pi*i/24;el=math.radians(elevation);radius=.47
  cam.location=(radius*math.cos(theta)*math.cos(el),radius*math.sin(theta)*math.cos(el),radius*math.sin(el));cam.rotation_euler=(Vector((0,0,.02))-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=os.path.join(out,f'{ring*24+i:04d}.jpg');bpy.ops.render.render(write_still=True)
print('CONTROLLED_RENDER_PHOTOS',48,out)
