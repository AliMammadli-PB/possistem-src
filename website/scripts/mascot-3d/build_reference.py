"""Reference-preserving, closed volumetric mascot. Original image projection on
curved front surfaces; modeled ceramic sides/rear. Not a billboard. Blender 5.x.
Every pixel on the front is sampled from the existing production artwork.
"""
import bpy,numpy as np,math,os,sys,json
from mathutils import Vector
from math import sin,cos,pi
args=sys.argv[sys.argv.index('--')+1:];OUT,WEB,ASSET=[os.path.abspath(a) for a in args[:3]]
os.makedirs(OUT,exist_ok=True);os.makedirs(WEB,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene
S=120
# Public site composition is in a 627x650 viewBox.
def world(x,y,d=0):return((x-313.5)/S,d,(650-y)/S)
def material(name,color,metal=.1,rough=.3,emission=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough;p.inputs['Coat Weight'].default_value=.5
 if emission:p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emission
 return m
white=material('Ceramic shell',(.78,.87,1),.2,.25);blue=material('Cobalt enamel',(.006,.045,.40),.6,.22);metal=material('Titanium trim',(.32,.52,.74),.8,.25);dark=material('Joint graphite',(.006,.015,.04),.3,.4);cyan=material('Ice cyan light',(.005,.7,1),.1,.23,1)
# Emission-only keeps the front illustration's precise brand colors and baked light.
def illustration(name,path):
 im=bpy.data.images.load(path,check_existing=True);im.pack();m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;n.clear();t=n.new('ShaderNodeTexImage');t.image=im;e=n.new('ShaderNodeEmission');out=n.new('ShaderNodeOutputMaterial');m.node_tree.links.new(t.outputs['Color'],e.inputs['Color']);m.node_tree.links.new(e.outputs[0],out.inputs[0]);return m,im
front,bodyImg=illustration('Original V3 body and logo',os.path.join(ASSET,'robot-body-v3.webp'))
armMat,armImg=illustration('Original V3 hand',os.path.join(ASSET,'robot-right-v3.webp'))
def group(name,x,y,d=0,parent=None):
 o=bpy.data.objects.new(name,None);scene.collection.objects.link(o);o.location=world(x,y,d) if parent is None else (0,0,0);o.parent=parent;return o
root=group('MascotRoot',313.5,650)
def pivot(name,x,y):
 o=group(name,313.5,650,parent=root);o.location=world(x,y);return o
head=pivot('Head',327,275);torso=pivot('Torso',327,478)
# Ray-sampled alpha silhouette, restricted to explicitly traced part regions.
def inside(poly,x,y):
 mask=np.zeros_like(x,dtype=bool)
 for a,b in zip(poly,poly[1:]+poly[:1]):
  mask^=((a[1]>y)!=(b[1]>y))&(x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1]+1e-12)+a[0])
 return mask
images={};surfaces={}
def patch(name,poly,center,img,rect,frontmat,backmat,parent,depth=.65,back=.4,mirror=False,steps=128):
 # UV rect expressed in site coordinates, identical to SVG <image> placement.
 iw,ih=img.size
 if img.name not in images:
  pixels=np.empty(iw*ih*4,dtype=np.float32);img.pixels.foreach_get(pixels);images[img.name]=pixels.reshape(ih,iw,4)
 pixels=images[img.name];cx,cy=center;angles=np.arange(steps)*2*pi/steps
 radii=np.linspace(0,400,1601)
 xx=cx+np.cos(angles)[:,None]*radii;yy=cy+np.sin(angles)[:,None]*radii
 ux=(xx-rect[0])/rect[2];vy=(yy-rect[1])/rect[3]
 if mirror:ux=1-ux
 ix=np.clip((ux*iw).astype(int),0,iw-1);iy=np.clip(((1-vy)*ih).astype(int),0,ih-1)
 mask=(ux>=0)&(ux<1)&(vy>=0)&(vy<1)&inside(poly,xx,yy)&(pixels[iy,ix,3]>.45)
 if name in ['Reference helmet','Reference left headset']:mask&=~((xx<170)&(yy>308))
 rr=np.max(np.where(mask,radii[None,:],0),axis=1)
 # Exclude isolated antialias speckles by a robust three-sample boundary filter.
 rr=np.median(np.stack([np.roll(rr,-1),rr,np.roll(rr,1)]),axis=0)
 surfaces[name]=(cx,cy,rr,depth)
 rear_rr=sum(np.roll(rr,j) for j in range(-8,9))/17
 verts=[];uvs=[];faces=[];mats=[];rings=18
 loc=parent.location
 def v(x,y,d):
  w=world(x,y,d);verts.append((w[0]-loc.x,w[1]-loc.y,w[2]-loc.z));u=(x-rect[0])/rect[2];uvs.append((1-u if mirror else u,1-(y-rect[1])/rect[3]))
 # Parametric frontal dome and rounded rear close into one watertight shell.
 for side in [0,1]:
  for r in range(rings+1):
   f=r/rings
   for j,a in enumerate(angles):
    radius=rr[j] if side==0 else rear_rr[j]+(rr[j]-rear_rr[j])*f**8
    x=cx+cos(a)*radius*f;y=cy+sin(a)*radius*f
    d=-depth*math.sqrt(max(0,1-f*f)) if side==0 else back*math.sqrt(max(0,1-f*f))
    v(x,y,d)
 offset=(rings+1)*steps
 for side in [0,1]:
  base=offset*side
  for r in range(rings):
   for j in range(steps):
    a=base+r*steps+j;b=base+r*steps+(j+1)%steps;c=b+steps;d=a+steps
    faces.append((a,b,c,d) if side==0 else (d,c,b,a));mats.append(side)
 for j in range(steps):
  a=rings*steps+j;b=rings*steps+(j+1)%steps;faces.append((a,a+offset,b+offset,b));mats.append(1)
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();mesh.materials.append(frontmat);mesh.materials.append(backmat)
 layer=mesh.uv_layers.new()
 for p,mi in zip(mesh.polygons,mats):
  p.material_index=mi;p.use_smooth=True
  for li in p.loop_indices:layer.data[li].uv=uvs[mesh.loops[li].vertex_index]
 o=bpy.data.objects.new(name,mesh);scene.collection.objects.link(o);o.parent=parent;return o
rect=(19.5,36.5,591.5,590.5)
# Silhouette masks overlap along real headset/neck seams, not across the face.
patch('Reference helmet',[(158,185),(228,128),(320,116),(390,125),(471,165),(521,237),(520,303),(503,357),(473,391),(399,404),(273,391),(192,359),(155,314),(151,238)],(330,267),bodyImg,rect,front,white,head,.72,.62)
patch('Reference left headset',[(117,176),(181,167),(181,221),(165,263),(164,308),(123,306),(107,265)],(142,247),bodyImg,rect,front,blue,head,.25,.30)
patch('Reference right headset',[(485,228),(554,231),(576,301),(556,372),(483,394),(469,347),(482,286)],(522,314),bodyImg,rect,front,blue,head,.39,.29)
patch('Reference antenna stem',[(409,103),(442,99),(462,174),(433,181),(412,158)],(433,142),bodyImg,rect,front,blue,head,.13,.13,steps=64)
patch('Reference antenna orb',[(390,35),(490,35),(490,121),(390,121)],(440,79),bodyImg,rect,front,cyan,head,.34,.34,steps=80)
patch('Reference torso',[(213,364),(287,377),(366,389),(438,391),(458,417),(455,497),(402,568),(346,599),(284,591),(221,561),(181,503),(180,429),(193,385)],(322,474),bodyImg,rect,front,white,torso,.59,.49)
# Existing right arm and its mirrored resting left arm, exactly as in production SVG.
for name,center,rect2,poly,mirror,joint in [
 ('ArmR',(505,476),(442,398.5,124,154),[(440,395),(568,395),(568,556),(440,556)],False,(451,426)),
 ('ArmL',(149,435),(88,357.5,124,154),[(86,355),(214,355),(214,514),(86,514)],True,(203,385))]:
 g=pivot(name,*joint);patch(name+' original glove',poly,center,armImg,rect2,armMat,white,g,.19,.19,mirror,96)
# Original face coordinates, now separate emissive meshes on the curved visor.
def ell(name,loc,scale,mat,parent):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=40,ring_count=24,location=(0,0,0));o=bpy.context.object;o.name=name;o.parent=parent;o.location=loc;o.scale=scale;o.data.materials.append(mat)
 for p in o.data.polygons:p.use_smooth=True
 return o
def local(x,y,d,parent):
 w=world(x,y,d);return(w[0]-parent.location.x,w[1]-parent.location.y,w[2]-parent.location.z)
def curve(name,pts,r,mat,parent):
 c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.resolution_u=16;c.bevel_depth=r;c.bevel_resolution=4;s=c.splines.new('BEZIER');s.bezier_points.add(len(pts)-1)
 for p,co in zip(s.bezier_points,pts):p.co=co;p.handle_left_type='AUTO';p.handle_right_type='AUTO'
 o=bpy.data.objects.new(name,c);scene.collection.objects.link(o);o.parent=parent;o.data.materials.append(mat);return o
def flatmat(name,color):
 m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;n.clear();e=n.new('ShaderNodeEmission');e.inputs['Color'].default_value=(*color,1);out=n.new('ShaderNodeOutputMaterial');m.node_tree.links.new(e.outputs[0],out.inputs[0]);return m
def linear(v):return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
iris=bpy.data.materials.new('Aqua display gradient');iris.use_nodes=True;n=iris.node_tree.nodes;n.clear();vc=n.new('ShaderNodeVertexColor');vc.layer_name='Color';em=n.new('ShaderNodeEmission');output=n.new('ShaderNodeOutputMaterial');iris.node_tree.links.new(vc.outputs['Color'],em.inputs['Color']);iris.node_tree.links.new(em.outputs[0],output.inputs[0])
pupilmat=flatmat('Pupil ink',tuple(linear(v/255) for v in (8,28,84)));glint=flatmat('White glint',(1,1,1))
def face_depth(x,y):
 cx,cy,rr,depth=surfaces['Reference helmet'];angle=math.atan2(y-cy,x-cx)%(2*pi);idx=angle/(2*pi)*len(rr);i=int(idx);rad=rr[i]*(1-idx+i)+rr[(i+1)%len(rr)]*(idx-i);f=math.hypot(x-cx,y-cy)/max(1,rad);return -depth*math.sqrt(max(0,1-f*f))
def gradient(u,v):
 t=min(1,math.hypot(u-.35,v-.25)/.78);stops=[(0,(240,255,255)),(.48,(105,246,255)),(1,(0,153,232))]
 a,b=(stops[0],stops[1]) if t<.48 else (stops[1],stops[2]);f=(t-a[0])/(b[0]-a[0]);return tuple(linear((x+(y-x)*f)/255) for x,y in zip(a[1],b[1]))+(1,)
def disc(name,cx,cy,rx,ry,parent,parentworld,mat,offset,gradient_on=False):
 verts=[];colors=[];faces=[];segments=64;rings=10
 for r in range(rings+1):
  f=r/rings
  for i in range(segments):
   a=i*2*pi/segments;dx=cos(a)*rx*f;dy=sin(a)*ry*f
   # Same seven-degree eye roll as the live SVG.
   x=cx+dx*cos(7*pi/180)-dy*sin(7*pi/180);y=cy+dx*sin(7*pi/180)+dy*cos(7*pi/180)
   w=world(x,y,face_depth(x,y)-offset);verts.append(tuple(w[k]-parentworld[k] for k in range(3)));colors.append(gradient((dx/rx+1)/2,(dy/ry+1)/2))
 for r in range(rings):
  for i in range(segments):
   a=r*segments+i;b=r*segments+(i+1)%segments;faces.append((a,b,b+segments,a+segments))
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.materials.append(mat)
 if gradient_on:
  attr=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT')
  for v,c in zip(attr.data,colors):v.color=c
 o=bpy.data.objects.new(name,mesh);scene.collection.objects.link(o);o.parent=parent;return o
for name,x,y,rx,ry in [('EyeL',262,252,28,36),('EyeR',395,267,25,31)]:
 g=bpy.data.objects.new(name,None);scene.collection.objects.link(g);g.parent=head;g.location=local(x,y,face_depth(x,y)-.008,head);pw=world(x,y,face_depth(x,y)-.008)
 disc(name+' halo',x,y,rx,ry,g,pw,iris,.012,True)
 p=bpy.data.objects.new(name+'Pupil',None);scene.collection.objects.link(p);p.parent=g
 prx,pry=(12,27) if name=='EyeL' else (11,23)
 disc(name+' pupil',x+3,y+3,prx,pry,p,pw,pupilmat,.018)
 disc(name+' reflection',x+7,y-17,5 if name=='EyeL' else 4.5,7 if name=='EyeL' else 6,p,pw,glint,.024)
mouth=bpy.data.objects.new('Mouth',None);scene.collection.objects.link(mouth);mouth.parent=head;mouth.location=local(315,303,face_depth(315,303)-.012,head)
# Exact neutral SVG smile, sampled as smooth quadratic curves.
pts=[]
for a,b,c in [((290,295),(315,308),(340,294)),((340,294),(334,316),(315,317)),((315,317),(297,314),(290,295))]:
 for t in np.linspace(0,1,24,endpoint=False):pts.append(((1-t)**2*a[0]+2*(1-t)*t*b[0]+t*t*c[0],(1-t)**2*a[1]+2*(1-t)*t*b[1]+t*t*c[1]))
pw=world(315,303,face_depth(315,303)-.012);verts=[tuple(world(x,y,face_depth(x,y)-.018)[k]-pw[k] for k in range(3)) for x,y in pts]
mesh=bpy.data.meshes.new('Smile');mesh.from_pydata(verts,[],[tuple(range(len(verts)))]);mesh.materials.append(iris);attr=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT')
for v,(x,y) in zip(attr.data,pts):v.color=gradient((x-290)/50,(y-294)/24)
o=bpy.data.objects.new('Smile',mesh);scene.collection.objects.link(o);o.parent=mouth
brow=flatmat('Soft eyebrow',(linear(101/255)*.4,linear(223/255)*.4,linear(242/255)*.4))
for pts in [[(240,204),(259,199),(277,205)],[(376,226),(394,222),(412,232)]]:
 curve('Original eyebrow',[local(x,y,face_depth(x,y)-.01,head) for x,y in pts],1.3/S,brow,head)
# Rear construction follows the original head and torso contours. The source has no rear view.
def rearplate(name,center,scale,mat,parent):return ell(name,local(*center,parent),scale,mat,parent)
rearplate('Rear recessed head panel',(335,260,.61),(.55,.055,.40),blue,head)
for i in range(4):
 curve('Cooling slot',[local(290,237+i*13,.668,head),local(365,237+i*13,.668,head)],.018,dark,head)
for x in [284,371]:
 for y in [219,302]:rearplate('Rear captive screw',(x,y,.66),(.026,.012,.026),metal,head)
rearplate('Rear power housing',(324,467,.48),(.37,.06,.37),blue,torso)
for r,ma in [(.23,metal),(.16,cyan)]:
 pts=[tuple(np.array(local(324,461,.551,torso))+np.array((r*cos(a),0,r*sin(a)))) for a in np.linspace(0,2*pi,65)];curve('Rear power ring',pts,.015,ma,torso)
for i in range(5):rearplate('Charging contact',(301+i*11,499,.54),(.018,.015,.044),metal,torso)
# Exact official logo as a rear decal (front logo already comes from original artwork).
# The logo on the original chest texture is retained unchanged; no substitute lettering.
# Runtime prop pivots retained without redesigning the character.
props=[]
def box(name,loc,scale,mat,parent):
 bpy.ops.mesh.primitive_cube_add(size=2);o=bpy.context.object;o.name=name;o.parent=parent;o.location=loc;o.scale=scale;o.data.materials.append(mat)
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);b=o.modifiers.new('Soft edges','BEVEL');b.width=.025;b.segments=3;bpy.ops.object.modifier_apply(modifier=b.name);return o
laptop=pivot('Laptop',315,478);laptop.location.y=-.9;props.append(laptop)
box('Laptop keyboard',(0,-.12,-.20),(.65,.30,.035),metal,laptop);box('Laptop lid',(0,.05,.13),(.60,.035,.35),blue,laptop);box('Laptop screen',(0,.005,.14),(.54,.012,.28),dark,laptop)
for i in range(3):curve('Screen code',[(-.4,-.013,.30-i*.14),(.3-i*.08,-.013,.30-i*.14)],.012,cyan,laptop)
book=pivot('Book',315,478);book.location.y=-.94;props.append(book)
box('Book cover',(0,0,-.1),(.65,.28,.035),blue,book);box('Book paper',(0,0,-.045),(.61,.25,.025),white,book);curve('Book fold',[(0,-.25,-.012),(0,.25,-.012)],.009,metal,book)

# Convert curves for glTF. Original texture is packed for editability.
for o in list(scene.objects):
 if o.type=='CURVE':
  bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH')
# Surface normals must face the observer for the reference texture.
for o in list(root.children_recursive):
 if o.type=='MESH':
  bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.render.film_transparent=True
scene.render.resolution_x=3840;scene.render.resolution_y=3840;scene.render.resolution_percentage=25;scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='Standard';scene.world.color=(.15,.15,.15)
def light(loc,power,size):
 d=bpy.data.lights.new('Softbox','AREA');d.energy=power;d.shape='DISK';d.size=size;o=bpy.data.objects.new('Softbox',d);scene.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,2.7))-o.location).to_track_quat('-Z','Y').to_euler()
light((-3,-4,7),180,5);light((4,3,5),240,4)
d=bpy.data.cameras.new('Camera');cam=bpy.data.objects.new('Camera',d);scene.collection.objects.link(cam);scene.camera=cam;d.type='ORTHO';d.ortho_scale=5.6;cam.location=(0,-12,2.7);cam.rotation_euler=(Vector((0,0,2.7))-cam.location).to_track_quat('-Z','Y').to_euler()
for g in props:
 for o in g.children_recursive:o.hide_render=True
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'Possistem-Original-3D.blend'))
bpy.ops.object.select_all(action='DESELECT')
for o in [root]+list(root.children_recursive):o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(WEB,'possistem-assistant-v1.glb'),export_format='GLB',use_selection=True,export_animations=False,export_cameras=False,export_lights=False,export_yup=True,export_apply=True)
if '--render4k' in args:scene.render.resolution_percentage=100
for name,loc in [('original-front',(0,-12,2.7)),('original-back',(3,12,3.8)),('original-side',(10,-4,3.1))]:
 cam.location=loc;cam.rotation_euler=(Vector((0,0,2.7))-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=os.path.join(OUT,name+('.png' if '--render4k' not in args else '-4k.png'));bpy.ops.render.render(write_still=True)
