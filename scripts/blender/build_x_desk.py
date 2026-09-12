"""Blender 5.2: photo-based X DESK 210027, in metres. No generated textures.
Run: /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender/build_x_desk.py
"""
from pathlib import Path
import bpy, math, json, numpy as np
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'assets/x-desk-210027'; OUT=ROOT/'public/models/x-desk-210027'
for d in [BASE/'textures',BASE/'renders',OUT]: d.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
s=bpy.context.scene;s.unit_settings.system='METRIC';s.unit_settings.scale_length=1
# Perspective rectification, not texture synthesis. Coordinates: TL, TR, BL, BR.
patches=[('desktop','01.webp',[(94,129),(782,71),(435,194),(1190,125)],0,704),
 ('middle_panel','04.webp',[(201,399),(1087,399),(195,590),(1090,590)],704,288),
 ('edge_band','04.webp',[(106,185),(1180,185),(106,199),(1180,199)],992,32)]
atlas=np.zeros((1024,1024,3),dtype=np.float32)
for name,filename,quad,row,height in patches:
 im=bpy.data.images.load(str(BASE/'references'/filename));w,h=im.size
 pixels=np.array(im.pixels[:],dtype=np.float32).reshape(h,w,4)[::-1]
 a=[];b=[]
 for (u,v),(x,y) in zip([(0,0),(1,0),(0,1),(1,1)],quad):
  a.extend([[u,v,1,0,0,0,-x*u,-x*v],[0,0,0,u,v,1,-y*u,-y*v]]);b.extend([x,y])
 H=np.append(np.linalg.solve(a,b),1).reshape(3,3)
 v,u=np.mgrid[0:1:complex(height),0:1:1024j];dest=H@np.stack([u.ravel(),v.ravel(),np.ones(u.size)])
 xy=dest[:2]/dest[2];x,y=xy.reshape(2,height,1024);ix=x.astype(int);iy=y.astype(int);fx=(x-ix)[...,None];fy=(y-iy)[...,None]
 sample=(pixels[iy,ix,:3]*(1-fx)+pixels[iy,ix+1,:3]*fx)*(1-fy)+(pixels[iy+1,ix,:3]*(1-fx)+pixels[iy+1,ix+1,:3]*fx)*fy
 assert np.mean(sample.mean(axis=2)>.94)<.001,(name,'background in photo crop')
 atlas[row:row+height]=sample
 bpy.data.images.remove(im)
im=bpy.data.images.new('Original oak photo atlas',width=1024,height=1024,alpha=False)
im.pixels.foreach_set(np.concatenate([atlas,np.ones((1024,1024,1))],axis=2)[::-1].astype(np.float32).ravel())
im.filepath_raw=str(BASE/'textures/oak-photo-atlas-v1.jpg');im.file_format='JPEG';s.render.image_settings.quality=94;im.save()
bpy.data.images.remove(im)
image=bpy.data.images.load(str(BASE/'textures/oak-photo-atlas-v1.jpg'));image.pack()
def material(name,color,roughness):
 m=bpy.data.materials.new(name);m.use_nodes=True
 bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=roughness;bs.inputs['Specular IOR Level'].default_value=.2
 return m
wood=material('Original photographed light oak decor',(.65,.45,.25),.72)
tex=wood.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image;tex.extension='EXTEND'
wood.node_tree.links.new(tex.outputs['Color'],wood.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
metal=material('Black painted steel',(.012,.013,.014),.58)
rubber=material('Black levelling feet',(.008,.008,.008),.88)
bolts=material('Dark screw heads',(.024,.027,.030),.4)
objects=[]
def box(name,loc,size,mat,bevel=.0005,patch=None):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=size
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 o.data.materials.append(mat)
 if patch is not None:
  # Desktop top/bottom are XY; the sloped panel's broad faces are XZ.
  for poly in o.data.polygons:
   normal=poly.normal
   broad=abs(normal.z)>.5 if patch==0 else abs(normal.y)>.5
   idx=patch if broad else 2
   row,hh=[(0,704),(704,288),(992,32)][idx]
   for li in poly.loop_indices:
    v=o.data.vertices[o.data.loops[li].vertex_index].co
    if broad:u=v.x/size[0]+.5;vv=(v.y/size[1]+.5) if patch==0 else (v.z/size[2]+.5)
    elif abs(normal.x)>.5:u=v.y/size[1]+.5;vv=v.z/size[2]+.5
    else:u=v.x/size[0]+.5;vv=v.z/size[2]+.5
    o.data.uv_layers.active.data[li].uv=((2+u*1020)/1024,1-(row+2+(1-vv)*(hh-4))/1024)
 if bevel:
  mod=o.modifiers.new('Small manufactured edge','BEVEL');mod.width=bevel;mod.segments=2
  bpy.ops.object.modifier_apply(modifier=mod.name)
  mod=o.modifiers.new('Face normals','WEIGHTED_NORMAL');mod.keep_sharp=True
  bpy.ops.object.modifier_apply(modifier=mod.name)
 objects.append(o);return o

def beam(name,start,end,width,depth,mat=metal):
 a,b=Vector(start),Vector(end)
 o=box(name,(a+b)/2,(width,depth,(b-a).length),mat)
 o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o

def cylinder(name,loc,radius,depth,mat,axis=None):
 bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=radius,depth=depth,location=loc)
 o=bpy.context.object;o.name=name;o.data.materials.append(mat)
 if axis:o.rotation_euler=Vector(axis).to_track_quat('Z','Y').to_euler()
 for p in o.data.polygons:p.use_smooth=len(p.vertices)==4
 objects.append(o);return o

# Photos establish the construction; thicknesses and obscured joints are estimates.
box('Oak desktop 700 x 480 x 14 mm',(0,0,.733),(.70,.48,.014),wood,patch=0)
for x,side in [(-.313,'left'),(.313,'right')]:
 box(side+' upper side rail',(x,0,.715),(.022,.432,.022),metal)
 box(side+' floor rail',(x,0,.032),(.024,.438,.022),metal)
 # The broad rear-to-front leg carries the sloping wooden cross panel.
 beam(side+' broad diagonal',(x,-.192,.043),(x,.192,.704),.022,.025)
 # Thin cross brace lies inside the broad diagonal, visible as a separate member.
 inner=x-math.copysign(.016,x)
 beam(side+' thin diagonal',(inner,.192,.043),(inner,-.192,.704),.009,.011)
 for y in [-.198,.198]:
  cylinder(side+f' foot {y}',(x,y,.004),.017,.008,rubber)
  cylinder(side+f' levelling stem {y}',(x,y,.0145),.006,.013,bolts)
 # Visible side fixing heads (no invented readable hardware or markings).
 for z in [.425,.535,.715]:
  y=-.192+(z-.043)/(.704-.043)*.384 if z<.7 else .178
  cylinder(side+f' screw {z}',(x+math.copysign(.0118,x),y,z),.004,.002,bolts,(1,0,0))
for y in [-.202,.202]:box('Upper width rail '+str(y),(0,y,.715),(.604,.018,.022),metal)
# Panel follows the broad diagonal rather than becoming a vertical modesty board.
panel_z=.476;panel_y=-.192+(panel_z-.043)/(.704-.043)*.384
panel=box('Sloped oak reinforcing panel',(0,panel_y,panel_z),(.603,.012,.153),wood,patch=1)
panel.rotation_euler.x=-math.atan(.384/.661)
# Bake all object transforms, retaining physical dimensions and uncomplicated exports.
bpy.ops.object.select_all(action='DESELECT')
for o in objects:o.select_set(True);o['product_part']=True
bpy.context.view_layer.objects.active=objects[0]
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
coords=[o.matrix_world@v.co for o in objects for v in o.data.vertices]
lo=[min(v[i] for v in coords) for i in range(3)];hi=[max(v[i] for v in coords) for i in range(3)]
assert all(abs(hi[i]-lo[i]-d)<.00001 for i,d in enumerate([.7,.48,.74])),(lo,hi)
assert abs(lo[2])<.00001
triangles=sum(len(p.vertices)-2 for o in objects for p in o.data.polygons)
bpy.ops.export_scene.gltf(filepath=str(OUT/'x-desk-v1.glb'),export_format='GLB',use_selection=True,export_yup=True,export_animations=False,export_cameras=False,export_lights=False)
bpy.ops.wm.usd_export(filepath=str(OUT/'x-desk-v1.usdz'),selected_objects_only=True,export_animation=False,export_lights=False,export_cameras=False,export_materials=True,generate_preview_surface=True,generate_materialx_network=False,export_textures_mode='NEW',overwrite_textures=True,relative_paths=True,root_prim_path='/XDesk',convert_orientation=True,export_global_forward_selection='NEGATIVE_Z',export_global_up_selection='Y',convert_scene_units='METERS',meters_per_unit=1.0,triangulate_meshes=True)
# Render-only studio, excluded from delivered models.
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.001));o=bpy.context.object;o.name='Studio floor (not exported)';o.is_shadow_catcher=True;o.data.materials.append(material('Studio white',(.8,.8,.8),.8))
s.world=bpy.data.worlds.new('Neutral studio');s.world.use_nodes=True;s.world.node_tree.nodes['Background'].inputs[0].default_value=(.8,.8,.8,1);s.world.node_tree.nodes['Background'].inputs[1].default_value=.25
for name,loc,power,size in [('Key',(-1.6,-2.4,3),55,2.2),('Fill',(2,-.5,1.7),25,2),('Rim',(.5,2,2.5),35,1.8)]:
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.name=name;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,.4))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add();cam=bpy.context.object;s.camera=cam;cam.data.type='ORTHO';cam.data.ortho_scale=1.05
s.render.engine='CYCLES';s.cycles.samples=32;s.cycles.use_denoising=True;s.render.resolution_x=1000;s.render.resolution_y=1000;s.render.resolution_percentage=100;s.render.film_transparent=True
s.render.image_settings.file_format='PNG';s.render.image_settings.color_mode='RGBA';s.view_settings.view_transform='Standard';s.view_settings.look='None'
views={'poster':(-1.3,-1.8,.94),'front':(0,-2,.90),'rear':(0,2,.9),'left':(-2,0,.9),'right':(2,0,.9),'top':(0,0,3)}
for name,loc in views.items():
 cam.location=loc;cam.rotation_euler=(Vector((0,0,.37))-cam.location).to_track_quat('-Z','Y').to_euler()
 if name=='poster':bpy.ops.wm.save_as_mainfile(filepath=str(BASE/'x-desk.blend'))
 s.render.filepath=str(BASE/'renders'/('v1-'+name+'.png'));bpy.ops.render.render(write_still=True)
report={'blender':bpy.app.version_string,'triangles':triangles,'dimensions_m':[.7,.48,.74],'floor_z_m':lo[2],'texture':'Perspective-rectified original photo pixels; no generated wood grain or relief','patches':[{'part':n,'source':f,'quad_pixels':q} for n,f,q,_,_ in patches],'estimates':['Member sections, panel thickness and screw dimensions estimated from photos','Unseen underside and reverse panel reuse photographed oak decor','Finish roughness estimated; no measured material scan'],'physical_android_ar':'not tested','physical_iphone_ar':'not tested'}
(BASE/'model-report.json').write_text(json.dumps(report,indent=2)+'\n');print('X_DESK_COMPLETE',json.dumps(report))
