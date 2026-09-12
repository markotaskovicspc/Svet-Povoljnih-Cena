"""Local, repeatable CUBE reconstruction. Blender 5.2 --background --python this_file.
Original photo is authoritative; generated references only guide hidden geometry.
"""
import bpy, math, json, numpy as np
from mathutils import Vector
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'assets/cube-210030'; OUT=ROOT/'public/models/cube-210030'
MESH_STEPS=globals().get('MESH_STEPS',26)
EXPORT_VERSION=globals().get('EXPORT_VERSION','v2')
BLEND_FILENAME=globals().get('BLEND_FILENAME','cube.blend')
RENDER_PREFIX=globals().get('RENDER_PREFIX','')
for p in [BASE/'textures',BASE/'renders',OUT]: p.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.unit_settings.system='METRIC'; scene.unit_settings.scale_length=1
# Sample the genuine photographed backrest fabric through its perspective plane.
source=bpy.data.images.load(str(BASE/'references/01.webp'))
w,h=source.size; pixels=np.array(source.pixels[:],dtype=np.float32).reshape(h,w,4)[::-1]
N=1024
v,u=np.mgrid[0:1:complex(N),0:1:complex(N)]
# Interior of the original backrest, clear of seams and silhouettes.
tl=np.array([387,82]);tr=np.array([700,116]);bl=np.array([381,207]);br=np.array([698,245])
xy=(1-v)[...,None]*((1-u)[...,None]*tl+u[...,None]*tr)+v[...,None]*((1-u)[...,None]*bl+u[...,None]*br)
x=xy[:,:,0];y=xy[:,:,1];ix=x.astype(int);iy=y.astype(int)
fx=(x-ix)[...,None];fy=(y-iy)[...,None]
photo=(pixels[iy,ix,:3]*(1-fx)+pixels[iy,ix+1,:3]*fx)*(1-fy)+(pixels[iy+1,ix,:3]*(1-fx)+pixels[iy+1,ix+1,:3]*fx)*fy
# Preserve the photographed pile and dark narrow valleys instead of replacing
# them with a sine wave. Remove only broad cross-panel illumination.
mean=photo.mean(axis=(0,1))
column=photo.mean(axis=(0,2));lighting=sum(np.roll(column,j) for j in range(-100,101))/201
photo*=np.clip(lighting.mean()/(lighting+1e-6),.88,1.12)[None,:,None]
# Blend wrap boundaries; retain the irregular photographed ribs in the interior.
for axis in [0,1]:
 edge=24
 for j in range(edge):
  a=[slice(None),slice(None),slice(None)];b=a.copy();a[axis]=j;b[axis]=N-1-j
  weight=(1-j/edge)*.5
  av=photo[tuple(a)].copy();bv=photo[tuple(b)].copy()
  photo[tuple(a)]=av*(1-weight)+bv*weight;photo[tuple(b)]=bv*(1-weight)+av*weight
base=np.clip(photo,0,1)
lum=photo.mean(axis=2)
# A low-pass copy drives physical relief; original fibers remain in base color.
relief=sum(np.roll(np.roll(lum,dy,axis=0),dx,axis=1) for dy in range(-5,6) for dx in range(-3,4))/77
low,high=np.percentile(relief,[5,90]);height=np.clip((relief-low)/(high-low),0,1)*.00065
# UV tile spans 58cm along the photographed ribs and 18cm across them.
du=(np.roll(height,-1,axis=1)-np.roll(height,1,axis=1))/(2*.58/N)
dv=(np.roll(height,-1,axis=0)-np.roll(height,1,axis=0))/(2*.18/N)
normal=np.stack([-du,dv,np.ones_like(du)],axis=2)
normal/=np.linalg.norm(normal,axis=2)[:,:,None];normal=normal*.5+.5
rough=np.repeat(np.clip(.96-.10*height/.00065,0,1)[:,:,None],3,axis=2)

def save_texture(name,data,colorspace):
 im=bpy.data.images.new(name,width=N,height=N,alpha=False)
 im.colorspace_settings.name=colorspace
 rgba=np.concatenate([data,np.ones((N,N,1))],axis=2)
 im.pixels.foreach_set(rgba[::-1].astype(np.float32).ravel())
 im.filepath_raw=str(BASE/'textures'/(RENDER_PREFIX+name+'.png'));im.file_format='PNG';im.save()
 # Reload the file so Blender and glTF/USD use identical color interpretation.
 loaded=bpy.data.images.load(im.filepath_raw,check_existing=False);loaded.colorspace_settings.name=colorspace;loaded.pack()
 bpy.data.images.remove(im)
 return loaded
color=save_texture('cube-original-brown-basecolor',base,'sRGB')
roughness=save_texture('cube-fabric-roughness',rough,'Non-Color')
norm=save_texture('cube-corduroy-normal',normal,'Non-Color')
mat=bpy.data.materials.new('Original brown corduroy — photo color and fibers');mat.use_nodes=True
nodes=mat.node_tree.nodes;links=mat.node_tree.links;bs=nodes.get('Principled BSDF')
bs.inputs['Roughness'].default_value=.87
bs.inputs['Specular IOR Level'].default_value=.22
for image,socket in [(color,'Base Color'),(roughness,'Roughness')]:
 t=nodes.new('ShaderNodeTexImage');t.image=image;links.new(t.outputs['Color'],bs.inputs[socket])
t=nodes.new('ShaderNodeTexImage');t.image=norm;n=nodes.new('ShaderNodeNormalMap');n.inputs['Strength'].default_value=.85
links.new(t.outputs['Color'],n.inputs['Color']);links.new(n.outputs['Normal'],bs.inputs['Normal'])
seammat=bpy.data.materials.new('Matching stitched piping');seammat.diffuse_color=(*[float(((c+.055)/1.055)**2.4)*.82 for c in mean],1);seammat.use_nodes=True
sb=seammat.node_tree.nodes.get('Principled BSDF');sb.inputs['Base Color'].default_value=seammat.diffuse_color;sb.inputs['Roughness'].default_value=.9
objects=[]

def cushion(name,loc,size,radius=.02):
 half=Vector(size)/2;core=half-Vector((radius,)*3)
 vertices=[];faces=[];uvs=[];steps=MESH_STEPS
 for axis in range(3):
  axes=[i for i in range(3) if i!=axis]
  for sign in [-1,1]:
   start=len(vertices)
   for j in range(steps+1):
    for i in range(steps+1):
     q=Vector((0,0,0));q[axis]=sign*half[axis];q[axes[0]]=math.sin((i/steps-.5)*math.pi)*half[axes[0]];q[axes[1]]=math.sin((j/steps-.5)*math.pi)*half[axes[1]]
     c=Vector(tuple(max(-core[k],min(core[k],q[k])) for k in range(3)))
     delta=q-c;p=c+delta.normalized()*radius
     # Small upholstery crown rather than rigid box faces.
     crown=.0035*math.sin(math.pi*i/steps)**2*math.sin(math.pi*j/steps)**2
     p[axis]+=sign*crown
     vertices.append(tuple(p+Vector(loc)))
     # Anisotropic physical UV scale preserves the photograph's fiber proportions.
     # Side walls have horizontal ribs; top panels run side-to-side.
     uv=(q.x/.58,q.y/.18) if axis==2 else ((q.y if axis==0 else q.x)/.58,q.z/.18)
     uvs.append(uv)
   for j in range(steps):
    for i in range(steps):
     a=start+j*(steps+1)+i;faces.append((a,a+1,a+steps+2,a+steps+1))
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
 ob=bpy.data.objects.new(name,mesh);scene.collection.objects.link(ob);mesh.materials.append(mat)
 uv=mesh.uv_layers.new(name='FabricUV')
 for poly in mesh.polygons:
  for li in poly.loop_indices:uv.data[li].uv=uvs[mesh.loops[li].vertex_index]
 bpy.context.view_layer.objects.active=ob;ob.select_set(True)
 bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.remove_doubles(threshold=.00001);bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
 for p in mesh.polygons:p.use_smooth=True
 ob.select_set(False);objects.append(ob)
 # Piping rings follow the upper/lower cover edge, with rounded corners.
 for zsign in [-1,1]:
  pts=[];rx=size[0]/2-radius;ry=size[1]/2-radius
  for cx,cy,startangle in [(rx,ry,0),(-rx,ry,90),(-rx,-ry,180),(rx,-ry,270)]:
   for t in range(13):
    angle=math.radians(startangle+t*90/12)
    pts.append((loc[0]+cx+radius*math.cos(angle),loc[1]+cy+radius*math.sin(angle),loc[2]+zsign*(size[2]/2-radius*.65)))
  curve=bpy.data.curves.new(name+' stitched cover edge','CURVE');curve.dimensions='3D';curve.bevel_depth=.0013;curve.bevel_resolution=2
  spl=curve.splines.new('POLY');spl.points.add(len(pts)-1)
  for p,co in zip(spl.points,pts):p.co=(*co,1)
  spl.use_cyclic_u=True
  edge=bpy.data.objects.new(curve.name,curve);scene.collection.objects.link(edge);curve.materials.append(seammat)
  bpy.context.view_layer.objects.active=edge;edge.select_set(True);bpy.ops.object.convert(target='MESH');edge.select_set(False);objects.append(edge)
 return ob
cushion('01 Lower folded cushion',(0,0,.1155),(.8,.8,.231))
cushion('02 Seat folded cushion',(0,0,.3525),(.8,.8,.231))
cushion('03 Rear backrest',(0,.27,.592),(.8,.26,.236),.022)
# Bake the complete envelope to exactly the retailer dimensions, floor at zero.
coords=[ob.matrix_world@v.co for ob in objects for v in ob.data.vertices]
lo=Vector(tuple(min(v[i] for v in coords) for i in range(3)));hi=Vector(tuple(max(v[i] for v in coords) for i in range(3)))
scale=Vector(tuple(t/(hi[i]-lo[i]) for i,t in enumerate([.8,.8,.71])))
center=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z))
for ob in objects:
 for v in ob.data.vertices:v.co=Vector(tuple((v.co[i]-center[i])*scale[i] for i in range(3)))
 ob.select_set(True)
 ob['source']='Photograph reconstruction; hidden details inferred'
triangles=sum(len(p.vertices)-2 for ob in objects for p in ob.data.polygons)
assert triangles<60000,triangles
bpy.ops.export_scene.gltf(filepath=str(OUT/f'cube-{EXPORT_VERSION}.glb'),export_format='GLB',use_selection=True,export_yup=True,export_tangents=True,export_animations=False,export_cameras=False,export_lights=False)
bpy.ops.wm.usd_export(filepath=str(OUT/f'cube-{EXPORT_VERSION}.usdz'),selected_objects_only=True,export_animation=False,export_lights=False,export_cameras=False,export_materials=True,generate_preview_surface=True,generate_materialx_network=False,export_textures_mode='NEW',overwrite_textures=True,relative_paths=True,root_prim_path='/CubeChair',convert_orientation=True,export_global_forward_selection='NEGATIVE_Z',export_global_up_selection='Y',convert_scene_units='METERS',meters_per_unit=1.0,triangulate_meshes=True)
# Neutral studio stage, excluded from both delivered AR files.
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.001))
floor=bpy.context.object;floor.name='Studio floor — excluded from AR';fm=bpy.data.materials.new('Studio white');fm.diffuse_color=(.8,.8,.8,1);floor.data.materials.append(fm)
scene.world=bpy.data.worlds.new('Neutral studio');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.8,.8,.8,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.45
for name,loc,power,size in [('Key',(-1.6,-2.4,3),160,2.2),('Fill',(2,-.5,1.7),95,2),('Rim',(.5,2,2.5),160,1.8)]:
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.name=name;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,.35))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add();camera=bpy.context.object;scene.camera=camera;camera.data.type='ORTHO';camera.data.ortho_scale=1.35
scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.render.resolution_x=1200;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='Standard';scene.view_settings.look='Medium High Contrast' if False else 'None'
for p in (BASE/'generated-references').glob('*.png'):
 im=bpy.data.images.load(str(p));im.pack();im.use_fake_user=True
source.pack();source.use_fake_user=True
views={'poster':(1.3,-1.8,1.2),'front':(0,-2,.7),'rear':(1.3,1.8,1.2),'side':(2,0,.75),'top':(0,0,3)}
for name,loc in views.items():
 camera.location=loc;camera.rotation_euler=(Vector((0,0,.355))-camera.location).to_track_quat('-Z','Y').to_euler()
 if name=='poster':bpy.ops.wm.save_as_mainfile(filepath=str(BASE/BLEND_FILENAME))
 scene.render.filepath=str(BASE/'renders'/(RENDER_PREFIX+name+'.png'));bpy.ops.render.render(write_still=True)
report={'blender':bpy.app.version_string,'triangles':triangles,'dimensions_m':[.8,.8,.71],'texture_source':'references/01.webp backrest fabric sample; perspective-corrected photographed ribs and fibers; 58cm × 18cm UV tile; 0.65mm relief','sample_mean_srgb':mean.tolist(),'physical_android_ar':'not tested','physical_iphone_ar':'not tested','hidden_geometry':'inferred from supplied photo and generated multiview references','formats':['GLB','USDZ']}
(BASE/('model-report.json' if EXPORT_VERSION=='v2' else f'model-report-{EXPORT_VERSION}.json')).write_text(json.dumps(report,indent=2))
print('CUBE_COMPLETE',json.dumps(report))
