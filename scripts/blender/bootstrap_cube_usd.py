"""Restore omitted OpenUSD 25.11 shader resources in the usd-core macOS wheel.
Run in the isolated QA venv after `uv pip install usd-core==25.11`.
Upstream definitions are restored verbatim; validation rules are not disabled.
"""
from pathlib import Path
from urllib.request import urlopen
import json,pxr
root=Path(pxr.__file__).parent/'pluginfo'
for part,upstream in [('usdHydra','usdHydra'),('usdShaders','plugin/usdShaders')]:
 resources=root/part/'resources';shaders=resources/'shaders';shaders.mkdir(parents=True,exist_ok=True)
 folder=f'pxr/usd/{upstream}/shaders'
 entries=json.load(urlopen(f'https://api.github.com/repos/PixarAnimationStudios/OpenUSD/contents/{folder}?ref=v25.11'))
 for entry in entries:
  if entry['type']=='file':(shaders/entry['name']).write_bytes(urlopen(entry['download_url']).read())
 if part=='usdShaders':
  src=urlopen('https://raw.githubusercontent.com/PixarAnimationStudios/OpenUSD/v25.11/pxr/usd/plugin/usdShaders/plugInfo.json').read().decode()
  src=src.replace('@PLUG_INFO_LIBRARY_PATH@','').replace('@PLUG_INFO_RESOURCE_PATH@','resources').replace('@PLUG_INFO_ROOT@','..')
  (resources/'plugInfo.json').write_text(src)
 print('Restored official',part,'resources')
