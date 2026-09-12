import bpy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
for kind,outputname,version in [("cube-210030","cube","v6"),("x-desk-210027","x-desk","v2")]:
 base=ROOT/"assets"/kind;public=ROOT/"public/models"/kind
 bpy.ops.wm.open_mainfile(filepath=str(base/f"{outputname}-blendkit.blend"))
 bpy.ops.object.select_all(action="DESELECT")
 for ob in bpy.context.scene.objects:
  if ob.type=="MESH" and (ob.get("source") if outputname=="cube" else ob.get("product_part")):ob.select_set(True)
 bpy.ops.export_scene.gltf(filepath=str(public/f'{outputname}-{version}.glb'),export_format='GLB',use_selection=True,export_yup=True,export_tangents=True,export_animations=False,export_cameras=False,export_lights=False)
 bpy.ops.wm.usd_export(filepath=str(public/f'{outputname}-{version}.usdz'),selected_objects_only=True,export_animation=False,export_lights=False,export_cameras=False,export_materials=True,generate_preview_surface=True,generate_materialx_network=False,export_textures_mode='NEW',overwrite_textures=True,relative_paths=True,root_prim_path='/Product',convert_orientation=True,export_global_forward_selection='NEGATIVE_Z',export_global_up_selection='Y',convert_scene_units='METERS',meters_per_unit=1,triangulate_meshes=True)
