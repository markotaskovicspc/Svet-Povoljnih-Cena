"""Same v4 USD stage and geometry; replace only the photographic PNG with JPEG."""
from pathlib import Path
import tempfile, zipfile, shutil
from pxr import Usd, Sdf, UsdUtils
root = Path(__file__).resolve().parents[2]
public = root / 'public/models/cube-210030'
with tempfile.TemporaryDirectory(prefix='cube-delivery-') as temp:
    work = Path(temp)
    with zipfile.ZipFile(public / 'cube-v4.usdz') as archive:
        layer_name = archive.namelist()[0]
        archive.extractall(work)
    stage = Usd.Stage.Open(str(work / layer_name))
    old = 'v4-original-panel-atlas.png'
    new = 'v5-original-panel-atlas.jpg'
    replacements = 0
    for prim in stage.Traverse():
        for attr in prim.GetAttributes():
            value = attr.Get()
            if isinstance(value, Sdf.AssetPath) and old in value.path:
                attr.Set(Sdf.AssetPath(value.path.replace(old, new)))
                replacements += 1
    assert replacements > 0
    shutil.copyfile(root / 'assets/cube-210030/textures' / new, work / 'textures' / new)
    stage.GetRootLayer().Save()
    assert UsdUtils.CreateNewUsdzPackage(Sdf.AssetPath(str(work / layer_name)), str(public / 'cube-v5.usdz'))
print('Optimized USDZ bytes:', (public / 'cube-v5.usdz').stat().st_size)
