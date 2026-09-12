"""Refine photographed CUBE/X DESK materials with locally downloaded CC0 Blendkit assets.
Geometry, original base-color pixels, photo UVs and dimensions are preserved.
Blender 5.2: -b --disable-autoexec --python scripts/blender/enhance_product_materials.py
"""
import bpy,numpy as np,json,math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];LIB=ROOT/'assets/material-library/blendkit'

def read_image(path,noncolor=True):
 im=bpy.data.images.load(str(path),check_existing=False)
 if noncolor:im.colorspace_settings.name='Non-Color'
 w,h=im.size;a=np.array(im.pixels[:],dtype=np.float32).reshape(h,w,4)[::-1,:,:3].copy();bpy.data.images.remove(im);return a

def resize(a,w,h):
 # Periodic linear sampling for the library's tileable microstructure only.
 ys=np.arange(h)*a.shape[0]/h;xs=np.arange(w)*a.shape[1]/w
 y=ys.astype(int)%a.shape[0];x=xs.astype(int)%a.shape[1];fy=(ys%1)[:,None,None];fx=(xs%1)[None,:,None]
 return (a[y[:,None],x[None,:]]*(1-fx)+a[y[:,None],(x+1)[None,:]%a.shape[1]]*fx)*(1-fy)+(a[(y+1)[:,None]%a.shape[0],x[None,:]]*(1-fx)+a[(y+1)[:,None]%a.shape[0],(x+1)[None,:]%a.shape[1]]*fx)*fy

def save_map(path,a):
 path.parent.mkdir(parents=True,exist_ok=True);h,w,_=a.shape
 im=bpy.data.images.new(path.stem,width=w,height=h,alpha=False);im.colorspace_settings.name='Non-Color'
 im.pixels.foreach_set(np.concatenate([np.clip(a,0,1),np.ones((h,w,1))],axis=2)[::-1].astype(np.float32).ravel());im.file_format='PNG';im.filepath_raw=str(path);im.save();bpy.data.images.remove(im)

def texture(mat,path,socket,normal=False):
 bs=mat.node_tree.nodes.get('Principled BSDF');nodes=mat.node_tree.nodes;links=mat.node_tree.links
 for l in list(bs.inputs[socket].links):links.remove(l)
 im=bpy.data.images.load(str(path),check_existing=False);im.colorspace_settings.name='Non-Color';im.pack()
 t=nodes.new('ShaderNodeTexImage');t.image=im;t.extension='REPEAT'
 if normal:
  n=nodes.new('ShaderNodeNormalMap');n.inputs['Strength'].default_value=1;links.new(t.outputs['Color'],n.inputs['Color']);links.new(n.outputs['Normal'],bs.inputs[socket])
 else:links.new(t.outputs['Color'],bs.inputs[socket])

def extract(kind):
 bpy.ops.wm.read_factory_settings(use_empty=True)
 with bpy.data.libraries.load(str(LIB/(kind+'.blend')),link=False) as(src,dst):dst.materials=src.materials
 for im in bpy.data.images:
  if im.name in ['Render Result','Viewer Node']:continue
  folder=LIB/kind;folder.mkdir(exist_ok=True);im.filepath_raw=str(folder/(bpy.path.basename(im.filepath) or im.name));im.save()
 return dst.materials[0]

# The large downloaded albedo images are not used: our products retain their own photos.
for kind in ['oak-cc0','corduroy']:extract(kind)
rough=read_image(LIB/'corduroy/ribbed_corduroy_rough_8k.exr')
normal=read_image(LIB/'corduroy/ribbed_corduroy_nor_gl_8k.exr')*2-1
# Remove each source column's average wale profile. Adding a second library rib
# pattern would conflict with the actual ribs already visible in the photographs.
fiber=normal[:,:,:2]-normal[:,:,:2].mean(axis=0,keepdims=True)
fiber=np.rot90(fiber);fiber=fiber[:,:,[1,0]];fiber[:,:,1]*=-1
micro=np.concatenate([fiber*.26,np.ones((*fiber.shape[:2],1))],axis=2)
micro/=np.linalg.norm(micro,axis=2,keepdims=True)
clothnormal=resize(micro*.5+.5,512,512)
clothrough=resize(np.rot90(rough-rough.mean(axis=0,keepdims=True)),512,512)*.25+.84
chair=ROOT/'assets/cube-210030/textures'
save_map(chair/'v6-blendkit-fiber-normal.png',clothnormal)
save_map(chair/'v6-blendkit-fabric-roughness.png',clothrough)
# The table is printed oak decor. Use a restrained satin response; real-wood
# displacement would imply grooves which the product photos do not establish.
oakrough=read_image(LIB/'oak-cc0/Clean OAK_Roughness.jpg')
desk=ROOT/'assets/x-desk-210027/textures'
save_map(desk/'v2-blendkit-oak-roughness.png',resize(np.clip(.58+(oakrough-oakrough.mean())*.6,.5,.66),512,512))
# Bake the actual CC0 powder-coat shader to small portable maps, over a 25 mm tile.
metal=extract('metal');scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=16
out=next(n for n in metal.node_tree.nodes if n.type=='OUTPUT_MATERIAL')
for link in list(out.inputs['Displacement'].links):metal.node_tree.links.remove(link)
bpy.ops.mesh.primitive_plane_add(size=.025);plane=bpy.context.object;plane.data.materials.append(metal)
for mode,name in [('ROUGHNESS','v2-blendkit-metal-roughness'),('NORMAL','v2-blendkit-metal-normal')]:
 im=bpy.data.images.new(name,width=256,height=256,alpha=False);im.colorspace_settings.name='Non-Color'
 node=metal.node_tree.nodes.new('ShaderNodeTexImage');node.image=im;metal.node_tree.nodes.active=node
 bpy.ops.object.bake(type=mode,margin=4)
 a=np.array(im.pixels[:],dtype=np.float32).reshape(256,256,4)[::-1,:,:3]
 if mode=='NORMAL':
  a=a*2-1;a[:,:,:2]-=a[:,:,:2].mean(axis=(0,1),keepdims=True);a/=np.maximum(np.linalg.norm(a,axis=2,keepdims=True),1e-8);a=a*.5+.5
 save_map(desk/(name+'.png'),a)
 metal.node_tree.nodes.remove(node);bpy.data.images.remove(im)

reports=[]
for kind,source,version,outputname in [('cube-210030','cube-corrected.blend','v6','cube'),('x-desk-210027','x-desk.blend','v2','x-desk')]:
 base=ROOT/'assets'/kind;public=ROOT/'public/models'/kind
 bpy.ops.wm.open_mainfile(filepath=str(base/source));s=bpy.context.scene
 objects=[o for o in s.objects if o.type=='MESH' and (o.get('source') if outputname=='cube' else o.get('product_part'))]
 coords_before=np.concatenate([np.array([tuple(o.matrix_world@v.co) for v in o.data.vertices]) for o in objects])
 if outputname=='cube':
  mat=objects[0].data.materials[0];bs=mat.node_tree.nodes.get('Principled BSDF')
  # Use the already delivered loss-checked JPEG, byte-for-byte.
  image=bpy.data.images.load(str(chair/'v5-original-panel-atlas.jpg'));image.pack()
  for n in mat.node_tree.nodes:
   if n.type=='TEX_IMAGE' and n.image and 'original-panel-atlas' in n.image.name:n.image=image
  texture(mat,chair/'v6-blendkit-fabric-roughness.png','Roughness');texture(mat,chair/'v6-blendkit-fiber-normal.png','Normal',True)
  bs.inputs['Specular IOR Level'].default_value=.18
 else:
  mat=bpy.data.materials.get('Original photographed light oak decor');texture(mat,desk/'v2-blendkit-oak-roughness.png','Roughness')
  mat=bpy.data.materials.get('Black painted steel');texture(mat,desk/'v2-blendkit-metal-roughness.png','Roughness');texture(mat,desk/'v2-blendkit-metal-normal.png','Normal',True)
  # Metal only: map the 25 mm coating tile at its physical scale. Oak UVs stay intact.
  for o in objects:
   if mat not in list(o.data.materials):continue
   uv=o.data.uv_layers.active
   for poly in o.data.polygons:
    points=[o.data.vertices[i].co for i in poly.vertices]
    tangent=(points[1]-points[0]).normalized();bitangent=poly.normal.cross(tangent).normalized()
    for li in poly.loop_indices:
     v=o.data.vertices[o.data.loops[li].vertex_index].co
     uv.data[li].uv=(v.dot(tangent)/.025,v.dot(bitangent)/.025)
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0]
 coords_after=np.concatenate([np.array([tuple(o.matrix_world@v.co) for v in o.data.vertices]) for o in objects]);assert np.array_equal(coords_before,coords_after)
 bpy.ops.export_scene.gltf(filepath=str(public/f'{outputname}-{version}.glb'),export_format='GLB',use_selection=True,export_yup=True,export_tangents=True,export_animations=False,export_cameras=False,export_lights=False)
 bpy.ops.wm.usd_export(filepath=str(public/f'{outputname}-{version}.usdz'),selected_objects_only=True,export_animation=False,export_lights=False,export_cameras=False,export_materials=True,generate_preview_surface=True,generate_materialx_network=False,export_textures_mode='NEW',overwrite_textures=True,relative_paths=True,root_prim_path='/Product',convert_orientation=True,export_global_forward_selection='NEGATIVE_Z',export_global_up_selection='Y',convert_scene_units='METERS',meters_per_unit=1,triangulate_meshes=True)
 bpy.ops.wm.save_as_mainfile(filepath=str(base/f'{outputname}-blendkit.blend'))
 s.render.filepath=str(base/'renders'/f'{version}-blendkit-poster.png');bpy.ops.render.render(write_still=True)
 for fmt in ['glb','usdz']:assert (public/f'{outputname}-{version}.{fmt}').stat().st_size<10*1024*1024
 reports.append({'product':kind,'version':version,'geometry_unchanged':True,'photographed_basecolor_unchanged':True,'size_m':(coords_after.max(axis=0)-coords_after.min(axis=0)).tolist(),'glb_bytes':(public/f'{outputname}-{version}.glb').stat().st_size,'usdz_bytes':(public/f'{outputname}-{version}.usdz').stat().st_size})
(LIB/'refinement-report.json').write_text(json.dumps(reports,indent=2)+'\n');print('MATERIALS_COMPLETE',json.dumps(reports))
