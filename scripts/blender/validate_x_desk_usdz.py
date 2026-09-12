"""Run with Python + usd-core. ARKit compatibility and physical size gate."""
from pathlib import Path
from pxr import Usd, UsdGeom, UsdUtils
import json,zipfile,struct,hashlib
root=Path(__file__).resolve().parents[2];base=root/'assets/x-desk-210027';public=root/'public/models/x-desk-210027'
p=public/'x-desk-v1.usdz'
checker=UsdUtils.ComplianceChecker(arkit=True,skipARKitRootLayerCheck=False);checker.CheckCompliance(str(p))
stage=Usd.Stage.Open(str(p));cache=UsdGeom.BBoxCache(Usd.TimeCode.Default(),[UsdGeom.Tokens.default_,UsdGeom.Tokens.render]);bound=cache.ComputeWorldBound(stage.GetDefaultPrim()).ComputeAlignedRange()
size=list(bound.GetSize());low=list(bound.GetMin())
with zipfile.ZipFile(p) as archive:
 entries=archive.infolist();raw=p.read_bytes()
 for e in entries:
  n,x=struct.unpack_from('<HH',raw,e.header_offset+26)
  assert (e.header_offset+30+n+x)%64==0,e.filename
  assert e.compress_type==0,e.filename
 textures=[e.filename for e in entries if e.filename.endswith(('.png','.jpg'))]
report={'errors':list(checker.GetErrors()),'failed_checks':list(checker.GetFailedChecks()),'warnings':list(checker.GetWarnings()),'up_axis':str(UsdGeom.GetStageUpAxis(stage)),'meters_per_unit':UsdGeom.GetStageMetersPerUnit(stage),'size_m':size,'min_m':low,'textures':textures,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
(base/'usdz-validation.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
assert not report['errors'] and not report['failed_checks']
assert report['up_axis']=='Y' and report['meters_per_unit']==1
assert all(abs(a-b)<.001 for a,b in zip(size,[.7,.74,.48]))
assert abs(low[1])<.001 and len(textures)==1
assert p.stat().st_size<10*1024*1024
