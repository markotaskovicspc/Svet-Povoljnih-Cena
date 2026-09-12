"""Rebuild v3 with a smaller regular surface grid, keeping UV boundaries stable.
Avoid collapse decimation: it distorts the visible corduroy near cushion edges.
"""
from pathlib import Path
import runpy,json
root=Path(__file__).resolve().parents[2];base=root/'assets/cube-210030';out=root/'public/models/cube-210030'
result=runpy.run_path(str(Path(__file__).with_name('build_cube.py')),init_globals={
 'MESH_STEPS':18,'EXPORT_VERSION':'v3','BLEND_FILENAME':'cube-optimized.blend','RENDER_PREFIX':'v3-',
})
original=json.loads((base/'model-report.json').read_text())
report={'before_triangles':original['triangles'],'after_triangles':result['triangles'],'size_m':[.8,.8,.71],'floor_z':0,'method':'Regular 18 × 18 surface grid instead of 26 × 26; stable UV boundaries; no collapse decimation','textures':'Original 1024px photo-derived PNG maps retained at full resolution','glb_before_bytes':(out/'cube-v2.glb').stat().st_size,'glb_after_bytes':(out/'cube-v3.glb').stat().st_size,'usdz_before_bytes':(out/'cube-v2.usdz').stat().st_size,'usdz_after_bytes':(out/'cube-v3.usdz').stat().st_size}
(base/'optimization-report.json').write_text(json.dumps(report,indent=2)+'\n');print(report)
