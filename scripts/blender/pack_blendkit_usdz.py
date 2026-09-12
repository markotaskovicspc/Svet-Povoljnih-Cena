from pathlib import Path
from pxr import Usd,Sdf,UsdUtils
import json
root=Path(__file__).resolve().parents[2]
for folder,name in [('cube-210030','cube-v6'),('x-desk-210027','x-desk-v2')]:
 work=root/'.tools/blendkit'/('package-'+name)
 layers=list(work.glob('*.usdc'))+list(work.glob('*.usda'));assert len(layers)==1
 stage=Usd.Stage.Open(str(layers[0]));replacements=json.loads((work/'replacements.json').read_text())
 for prim in stage.Traverse():
  for attr in prim.GetAttributes():
   value=attr.Get()
   if isinstance(value,Sdf.AssetPath):
    old=value.path.removeprefix('./')
    if old in replacements:attr.Set(Sdf.AssetPath("./"+replacements[old]))
 stage.GetRootLayer().Save()
 target=root/'public/models'/folder/(name+'.usdz')
 assert UsdUtils.CreateNewUsdzPackage(Sdf.AssetPath(str(layers[0])),str(target))
 print(name,target.stat().st_size)
