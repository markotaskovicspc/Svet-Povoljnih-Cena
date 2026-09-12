"""Local, repeatable CUBE reconstruction. Blender 5.2 --background --python this_file.
Original photos are authoritative. Generated references are not used.
"""
import bpy, math, json, numpy as np
from mathutils import Vector
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'assets/cube-210030'; OUT=ROOT/'public/models/cube-210030'
MESH_STEPS=24
EXPORT_VERSION='v4'
BLEND_FILENAME='cube-corrected.blend'
RENDER_PREFIX='v4-'
for p in [BASE/'textures',BASE/'renders',OUT]: p.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.unit_settings.system='METRIC'; scene.unit_settings.scale_length=1
# Only the two original product photographs supply visible cloth pixels.
N=2048;TW=1024;TH=512
atlas=np.zeros((N,N,3),dtype=np.float32)
sources={}
for name in ['01.webp','03.webp']:
 im=bpy.data.images.load(str(BASE/'references'/name));im.pack();im.use_fake_user=True
 w,h=im.size;sources[name]=np.array(im.pixels[:],dtype=np.float32).reshape(h,w,4)[::-1]
# Each quad is TL, TR, BL, BR in original photograph pixels. No generated views.
panels=[
 ('lower_front','01.webp',[(35,480),(484,560),(35,594),(484,694)]),
 ('seat_front','01.webp',[(35,338),(484,391),(35,444),(484,525)]),
 ('back_front','01.webp',[(369,78),(758,121),(359,226),(753,275)]),
 ('lower_side','01.webp',[(522,562),(882,455),(522,689),(882,569)]),
 ('seat_side','01.webp',[(518,385),(891,302),(518,530),(891,432)]),
 ('back_side','01.webp',[(793,122),(895,85),(782,280),(895,268)]),
 # Full upper cover of the unfolded front cushion. Preserves its actual nap.
 ('upper_cover','03.webp',[(444,494),(914,585),(119,838),(750,1023)]),
]
means=[]
for idx,(name,source,quad) in enumerate(panels):
 v,u=np.mgrid[0:1:complex(TH),0:1:complex(TW)]
 tl,tr,bl,br=map(np.array,quad)
 xy=(1-v)[...,None]*((1-u)[...,None]*tl+u[...,None]*tr)+v[...,None]*((1-u)[...,None]*bl+u[...,None]*br)
 x=xy[:,:,0];y=xy[:,:,1];ix=x.astype(int);iy=y.astype(int)
 fx=(x-ix)[...,None];fy=(y-iy)[...,None];p=sources[source]
 photo=(p[iy,ix,:3]*(1-fx)+p[iy,ix+1,:3]*fx)*(1-fy)+(p[iy+1,ix,:3]*(1-fx)+p[iy+1,ix+1,:3]*fx)*fy
 # Reject any quad that picks up transparent/background pixels.
 if source=='01.webp':assert np.mean(p[iy,ix,3]<.75)<.001,(name,'transparent crop')
 else:assert np.mean(photo.mean(axis=2)>.8)<.001,(name,'background crop')
 # Keep photographed fibers; no periodic texture synthesis.
 means.append(photo.mean(axis=(0,1)).tolist())
 row,col=divmod(idx,2);atlas[row*TH:(row+1)*TH,col*TW:(col+1)*TW]=photo
mean=np.array(means[:3]).mean(axis=0)
# Same cloth, different photographed illumination: correct only the constant
# panel-wide color cast/exposure. Every rib and fiber remains the source image.
gains=[]
for idx,avg in enumerate(means):
 row,col=divmod(idx,2);gain=mean/np.array(avg);gains.append(gain.tolist())
 atlas[row*TH:(row+1)*TH,col*TW:(col+1)*TW]*=gain
atlas=np.clip(atlas,0,1)
def save_map(name,data,colorspace):
 h,w,_=data.shape;im=bpy.data.images.new(name,width=w,height=h,alpha=False);im.colorspace_settings.name=colorspace
 im.pixels.foreach_set(np.concatenate([data,np.ones((h,w,1))],axis=2)[::-1].astype(np.float32).ravel())
 im.filepath_raw=str(BASE/'textures'/(name+'.png'));im.file_format='PNG';im.save()
 loaded=bpy.data.images.load(im.filepath_raw,check_existing=False);loaded.colorspace_settings.name=colorspace;loaded.pack();bpy.data.images.remove(im);return loaded
color=save_map('v4-original-panel-atlas',atlas,'sRGB')
# Photograph shading cannot establish relief depth or measured roughness.
# A matte constant response avoids exaggerating the photographed rib shadows.
roughness=save_map('v4-matte-roughness',np.full((4,4,3),.95),'Non-Color')
norm=save_map('v4-neutral-normal',np.tile([.5,.5,1.],(4,4,1)),'Non-Color')
mat=bpy.data.materials.new('Original photographed fabric panels');mat.use_nodes=True
nodes=mat.node_tree.nodes;links=mat.node_tree.links;bs=nodes.get('Principled BSDF')
bs.inputs['Specular IOR Level'].default_value=.12
for image,socket in [(color,'Base Color'),(roughness,'Roughness')]:
 t=nodes.new('ShaderNodeTexImage');t.image=image;t.extension='EXTEND';links.new(t.outputs['Color'],bs.inputs[socket])
t=nodes.new('ShaderNodeTexImage');t.image=norm;n=nodes.new('ShaderNodeNormalMap');links.new(t.outputs['Color'],n.inputs['Color']);links.new(n.outputs['Normal'],bs.inputs['Normal'])
(BASE/'panel-provenance-v4.json').write_text(json.dumps([{'panel':name,'source':source,'quad_pixels':quad,'mean_srgb':avg,'lighting_gain_rgb':gain} for (name,source,quad),avg,gain in zip(panels,means,gains)],indent=2))
def panel_uv(idx,u,v):
 # Keep half a texel inside each island; four-pixel margin prevents bleed.
 row,col=divmod(idx,2);pad=4
 return ((col*TW+pad+u*(TW-2*pad))/N,1-(row*TH+pad+(1-v)*(TH-2*pad))/N)
objects=[]

def cushion(name,loc,size,radius=.014):
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
     part=int(name[:2])-1
     if axis==2:
      if part==2:uv=panel_uv(6,q.x/.8+.5,q.y/.8+.5)
      else:uv=panel_uv(6,q.x/size[0]+.5,q.y/size[1]+.5)
     elif axis==1:
      uv=panel_uv(part,q.x/size[0]+.5,q.z/size[2]+.5)
     else:
      uv=panel_uv(3+part,q.y/size[1]+.5,q.z/size[2]+.5)
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
 return ob
cushion('01 Lower folded cushion',(0,0,.1175),(.8,.8,.235))
cushion('02 Seat folded cushion',(0,0,.3535),(.8,.8,.235))
cushion('03 Rear backrest',(0,.27,.5915),(.8,.26,.237),.014)
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
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.8,.8,.8,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.30
for name,loc,power,size in [('Key',(-1.6,-2.4,3),95,2.2),('Fill',(2,-.5,1.7),45,2),('Rim',(.5,2,2.5),70,1.8)]:
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.name=name;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,.35))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add();camera=bpy.context.object;scene.camera=camera;camera.data.type='ORTHO';camera.data.ortho_scale=1.35
scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.render.resolution_x=1200;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
scene.render.film_transparent=True
scene.render.image_settings.color_mode='RGBA'
scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='Standard';scene.view_settings.look='Medium High Contrast' if False else 'None'
views={'poster':(1.3,-1.8,1.2),'front':(0,-2,.7),'rear':(1.3,1.8,1.2),'side':(2,0,.75),'top':(0,0,3)}
for name,loc in views.items():
 camera.location=loc;camera.rotation_euler=(Vector((0,0,.355))-camera.location).to_track_quat('-Z','Y').to_euler()
 if name=='poster':bpy.ops.wm.save_as_mainfile(filepath=str(BASE/BLEND_FILENAME))
 scene.render.filepath=str(BASE/'renders'/(RENDER_PREFIX+name+'.png'));bpy.ops.render.render(write_still=True)
report={'blender':bpy.app.version_string,'triangles':triangles,'dimensions_m':[.8,.8,.71],'texture_source':'Original 01.webp / 03.webp panels with constant per-panel lighting correction; no synthesized ribs, added relief or piping','sample_mean_srgb':mean.tolist(),'physical_android_ar':'not tested','physical_iphone_ar':'not tested','hidden_geometry':'Unphotographed rear/left reuse original panel cloth; construction remains unverified','formats':['GLB','USDZ']}
(BASE/('model-report.json' if EXPORT_VERSION=='v2' else f'model-report-{EXPORT_VERSION}.json')).write_text(json.dumps(report,indent=2))
print('CUBE_COMPLETE',json.dumps(report))
