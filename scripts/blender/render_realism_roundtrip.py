"""Render the delivered files under the same studio as the source models."""
from pathlib import Path
import bpy
root=Path(__file__).resolve().parents[2]
for folder,name,version,tag in [('cube-210030','cube','v7','source'),('x-desk-210027','x-desk','v3','product_part')]:
 for fmt in ['glb','usdz']:
  base=root/'assets'/folder
  bpy.ops.wm.open_mainfile(filepath=str(base/(name+'-realism.blend')))
  for ob in list(bpy.context.scene.objects):
   if ob.get(tag):bpy.data.objects.remove(ob,do_unlink=True)
  path=str(root/'public/models'/folder/(name+'-'+version+'.'+fmt))
  if fmt=='glb':bpy.ops.import_scene.gltf(filepath=path)
  else:bpy.ops.wm.usd_import(filepath=path)
  bpy.context.scene.render.filepath=str(base/'renders'/(version+'-realism-'+fmt+'-roundtrip.png'))
  bpy.ops.render.render(write_still=True)
