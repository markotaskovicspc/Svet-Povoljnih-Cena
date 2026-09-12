"""Download the reviewed free CC0 libraries via Blendkit's normal public API flow."""
import hashlib, json, subprocess, uuid
from pathlib import Path
from urllib.parse import urlencode
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/material-library/blendkit'
OUT.mkdir(parents=True, exist_ok=True)
scene_id = str(uuid.uuid4())
records = json.loads((OUT.parent / 'blendkit-sources.json').read_text())
for record in records:
    target = OUT / record['local_file']
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == record['sha256']:
        print('Verified local:', target.name)
        continue
    query = record['displayName'] + ' asset_type:material'
    url = 'https://www.blendkit.com/api/v1/search/?' + urlencode({'query': query, 'page_size': 100})
    result = json.loads(subprocess.check_output(['curl', '-fsS', url]))
    asset = next(a for a in result['results'] if a['assetBaseId'] == record['assetBaseId'])
    assert asset['isFree'] and asset['canDownload'] and asset['license'] == 'cc_zero'
    file = next(f for f in asset['files'] if f['fileType'] == record['resolution'])
    download = json.loads(subprocess.check_output(['curl', '-fsS', file['downloadUrl'] + '?' + urlencode({'scene_uuid': scene_id})]))
    # Signed download URL stays in memory and is never written to provenance or logs.
    subprocess.run(['curl', '-fsS', download['filePath'], '-o', str(target)], check=True)
    assert hashlib.sha256(target.read_bytes()).hexdigest() == record['sha256'], 'Library changed: review the new revision before using it'
    print('Downloaded:', target.name, target.stat().st_size)
