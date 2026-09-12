from pathlib import Path
from pxr import Usd,UsdGeom,UsdUtils
import json,zipfile,hashlib,struct
root=Path(__file__).resolve().parents[2];reports=[]
for folder,name,size,albedo in [('cube-210030','cube-v6',[.8,.71,.8],'v5-original-panel-atlas.jpg'),('x-desk-210027','x-desk-v2',[.7,.74,.48],'oak-photo-atlas-v1.jpg')]:
 p=root/'public/models'/folder/(name+'.usdz');checker=UsdUtils.ComplianceChecker(arkit=True);checker.CheckCompliance(str(p));stage=Usd.Stage.Open(str(p))
 bound=UsdGeom.BBoxCache(Usd.TimeCode.Default(),[UsdGeom.Tokens.default_]).ComputeWorldBound(stage.GetDefaultPrim()).ComputeAlignedRange();actual=list(bound.GetSize());low=list(bound.GetMin())
 assert all(abs(a-b)<.001 for a,b in zip(actual,size)) and abs(low[1])<.001
 assert UsdGeom.GetStageUpAxis(stage)=='Y' and UsdGeom.GetStageMetersPerUnit(stage)==1
 raw=p.read_bytes()
 with zipfile.ZipFile(p) as z:
  for e in z.infolist():
   n,x=struct.unpack_from('<HH',raw,e.header_offset+26);assert(e.header_offset+30+n+x)%64==0 and e.compress_type==0
  photo=next(n for n in z.namelist() if n.endswith(albedo));assert z.read(photo)==(root/'assets'/folder/'textures'/albedo).read_bytes()
  textures=[n for n in z.namelist() if n.endswith(('.png','.jpg'))];assert len(textures)>1
 report={'folder':folder,'size_m':actual,'floor_y':low[1],'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'errors':list(checker.GetErrors()),'failed_checks':list(checker.GetFailedChecks()),'warnings':list(checker.GetWarnings()),'textures':textures,'original_basecolor_unchanged':True}
 assert not report['errors'] and not report['failed_checks'],report
 reports.append(report)
(root/'assets/material-library/usdz-validation.json').write_text(json.dumps(reports,indent=2)+'\n');print(json.dumps(reports))
