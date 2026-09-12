"""CUBE v9: original-photo UV projection, close folded joints, no generated cloth."""
import bpy,math,json
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
R=Path(__file__).resolve().parents[2];B=R/'assets/cube-210030';O=R/'public/models/cube-210030'
bpy.ops.wm.open_mainfile(filepath=str(B/'cube-blendkit.blend'))
objects=[o for o in bpy.context.scene.objects if o.get('source')]
# Interior photo quadrilaterals: original cloth only, avoiding white/transparent pixels.
quads=[[(24,476),(491,556),(24,617),(491,727)],[(24,332),(491,389),(24,451),(491,534)],[(352,61),(769,99),(344,236),(764,291)],[(513,554),(892,445),(513,716),(892,588)],[(514,385),(898,295),(514,532),(897,441)],[(793,122),(895,85),(782,280),(895,268)],[(444,494),(914,585),(119,838),(750,1023)]]
materials=[]
for idx in range(7):
 file='03.webp' if idx==6 else '01.webp'
 im=bpy.data.images.load(str(B/'references'/file),check_existing=True);im.pack()
 m=bpy.data.materials.new('Original photo panel '+str(idx));m.use_nodes=True;m.use_fake_user=True
 nt=m.node_tree;nt.nodes.clear();out=nt.nodes.new('ShaderNodeOutputMaterial');emit=nt.nodes.new('ShaderNodeEmission')
 t=nt.nodes.new('ShaderNodeTexImage');t.image=im;t.extension='EXTEND';uvn=nt.nodes.new('ShaderNodeUVMap');uvn.uv_map='OriginalPhotoUV';nt.links.new(uvn.outputs['UV'],t.inputs['Vector'])
 gain=(1.15,1.22,1.43) if idx<3 else (1.70,2.00,2.45) if idx<6 else (1.85,2.00,2.30)
 mix=nt.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[2].default_value=(*gain,1)
 nt.links.new(t.outputs['Color'],mix.inputs[1]);nt.links.new(mix.outputs[0],emit.inputs['Color']);nt.links.new(emit.outputs[0],out.inputs['Surface']);materials.append(m)
for ob in objects:
 ob.data.materials.clear()
 for m in materials:ob.data.materials.append(m)
 uv=ob.data.uv_layers.active;uv.name='OriginalPhotoUV'
 delivery=ob.data.uv_layers.new(name='DeliveryUV')
 for li in range(len(uv.data)):delivery.data[li].uv=uv.data[li].uv.copy()
 for face in ob.data.polygons:
  # Each original island belongs wholly to one photographic panel.
  center=sum((uv.data[li].uv for li in face.loop_indices),Vector((0,0)))/len(face.loop_indices)
  col=min(1,int(center.x*2));row=min(3,int((1-center.y)*4));idx=row*2+col;idx=min(6,idx)
  face.material_index=idx
  im=materials[face.material_index].node_tree.nodes.get('Image Texture').image;w,h=im.size
  tl,tr,bl,br=[Vector(x) for x in quads[idx]]
  for li in face.loop_indices:
   old=uv.data[li].uv.copy();u=(old.x*2048-col*1024-4)/1016;v=((1-old.y)*2048-row*512-4)/504
   p=(1-v)*((1-u)*tl+u*tr)+v*((1-u)*bl+u*br)
   uv.data[li].uv=(p.x/w,1-p.y/h)
# Bake only photo colour and constant illumination correction into a delivery atlas.
# No synthetic rib texture or normal map is introduced.
baked=bpy.data.images.new('v9-original-photo-atlas',width=2048,height=2048,alpha=False)
baked.colorspace_settings.name='sRGB'
for m in materials:
 t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=baked;m.node_tree.nodes.active=t
bpy.ops.object.select_all(action='DESELECT')
for ob in objects:ob.select_set(True);ob.data.uv_layers.active=ob.data.uv_layers['DeliveryUV'];ob.data.uv_layers['DeliveryUV'].active_render=True
bpy.context.view_layer.objects.active=objects[0];bpy.context.scene.cycles.samples=1
bpy.ops.object.bake(type='EMIT',margin=8,use_clear=True)
baked.filepath_raw=str(B/'textures/v9-original-photo-atlas.jpg');baked.file_format='JPEG';bpy.context.scene.render.image_settings.quality=95;baked.save();baked.pack()
mat=bpy.data.materials.new('CUBE original photographed cloth v9');mat.use_nodes=True
bs=mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Roughness'].default_value=.93;bs.inputs['Specular IOR Level'].default_value=.12
tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=baked;mat.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
for ob in objects:
 ob.data.materials.clear();ob.data.materials.append(mat)
 for poly in ob.data.polygons:poly.material_index=0
 ob.data.uv_layers.remove(ob.data.uv_layers['OriginalPhotoUV'])
# Fine sewn joins follow the actual cushion surface, without enlarged decorative piping.
seam=bpy.data.materials.new('CUBE fine cover join');seam.use_nodes=True
bs=seam.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.045,.028,.019,1);bs.inputs['Roughness'].default_value=.96
parts=list(objects)
for ob in parts:
 verts=[v.co for v in ob.data.vertices];lo=Vector(tuple(min(v[i] for v in verts) for i in range(3)));hi=Vector(tuple(max(v[i] for v in verts) for i in range(3)));center=(lo+hi)/2
 bvh=BVHTree.FromPolygons(verts,[p.vertices[:] for p in ob.data.polygons])
 for z in [lo.z+.010,hi.z-.010]:
  pts=[]
  for i in range(120):
   a=i*2*math.pi/120;direction=Vector((math.cos(a),math.sin(a),0));hit,n,_,_=bvh.ray_cast(Vector((center.x,center.y,z)),direction)
   if hit is not None:pts.append(hit+n*.0001)
  curve=bpy.data.curves.new(ob.name+' cover seam','CURVE');curve.dimensions='3D';curve.bevel_depth=.0004;curve.bevel_resolution=1
  spline=curve.splines.new('POLY');spline.points.add(len(pts)-1)
  for point,p in zip(spline.points,pts):point.co=(*p,1)
  spline.use_cyclic_u=True;thread=bpy.data.objects.new(curve.name,curve);bpy.context.collection.objects.link(thread);thread.data.materials.append(seam)
  bpy.ops.object.select_all(action='DESELECT');thread.select_set(True);bpy.context.view_layer.objects.active=thread;bpy.ops.object.convert(target='MESH');thread=bpy.context.object;thread['source']=True;objects.append(thread)
# Keep the original compact folded geometry; remove the generated uniform ribs and thick seams.
s=bpy.context.scene;s.camera.location=(1.45,-1.9,1.02);s.camera.rotation_euler=(Vector((0,0,.355))-s.camera.location).to_track_quat('-Z','Y').to_euler();s.cycles.samples=40
bpy.ops.wm.save_as_mainfile(filepath=str(B/'cube-photo-fidelity.blend'))
s.render.filepath=str(B/'renders/v9-photo-fidelity.png');bpy.ops.render.render(write_still=True)
bpy.ops.object.select_all(action='DESELECT')
for ob in objects:ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(O/'cube-v9.glb'),export_format='GLB',use_selection=True,export_yup=True,export_tangents=True,export_animations=False,export_cameras=False,export_lights=False,export_image_format='JPEG',export_jpeg_quality=95)
bpy.ops.wm.usd_export(filepath=str(O/'cube-v9.usdz'),selected_objects_only=True,export_animation=False,export_lights=False,export_cameras=False,export_materials=True,generate_preview_surface=True,generate_materialx_network=False,export_textures_mode='NEW',overwrite_textures=True,relative_paths=True,root_prim_path='/Product',convert_orientation=True,export_global_forward_selection='NEGATIVE_Z',export_global_up_selection='Y',convert_scene_units='METERS',meters_per_unit=1,triangulate_meshes=True)
print('PHOTO_FIDELITY',json.dumps({'quads':quads,'source':'original 01.webp and 03.webp','generated_texture':False}))
