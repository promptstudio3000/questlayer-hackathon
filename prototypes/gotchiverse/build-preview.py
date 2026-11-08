#!/usr/bin/env python3
"""Build an offline, single-file copy of the isolated interaction study."""
from pathlib import Path
import re

root=Path(__file__).resolve().parent
html=(root/'index.html').read_text()
css=(root/'style.css').read_text()
model=re.sub(r'^export ', '', (root/'model.mjs').read_text(), flags=re.M)
app=re.sub(r'^import .*?;\n', '', (root/'app.mjs').read_text(), count=1)
assert '</script' not in model.lower()+app.lower()
assert '</style' not in css.lower()
html=html.replace('<link rel="stylesheet" href="./style.css">','<style>'+css+'</style>')
html=html.replace('<script type="module" src="./app.mjs"></script>',
    '<script type="module">'+model+'\n'+app+'</script>')
(root/'preview.html').write_text(html)
print('Built offline preview.html')
