"""Render actual exported GLB and USDZ under the original Blender studio."""
from pathlib import Path
import bpy, os
root=Path(__file__).resolve().parents[2];base=root/'assets/cube-210030'
version=os.environ.get('CUBE_EXPORT_VERSION','v5')
for fmt in ['glb','usdz']:
 bpy.ops.wm.open_mainfile(filepath=str(base/'cube-corrected.blend'))
 for ob in list(bpy.context.scene.objects):
  if ob.get('source'):bpy.data.objects.remove(ob,do_unlink=True)
 path=str(root/'public/models/cube-210030'/('cube-'+version+'.'+fmt))
 if fmt=='glb':bpy.ops.import_scene.gltf(filepath=path)
 else:bpy.ops.wm.usd_import(filepath=path)
 bpy.context.scene.render.filepath=str(base/'renders'/(version+'-'+fmt+'-roundtrip.png'))
 bpy.ops.render.render(write_still=True)
