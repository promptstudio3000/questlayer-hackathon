#!/usr/bin/env python3
"""Bounded reference audit. Read osmium XML from stdin; never repairs data."""
import json,sys,xml.etree.ElementTree as ET
ways=set(); areas=[]; relations=0; members=0
parser=ET.iterparse(sys.stdin.buffer,events=('start','end'));_,root=next(parser)
for event,e in parser:
 if event!='end':continue
 if e.tag=='way':
  ways.add(e.attrib['id'])
  if len(ways)>2000000:raise RuntimeError('Split reference audit above two million ways')
 elif e.tag=='relation':
  relations+=1
  if relations>100000:raise RuntimeError('Split reference audit above 100000 relations')
  tags={t.attrib['k']:t.attrib['v'] for t in e.findall('tag')}
  if tags.get('type') in ('multipolygon','boundary'):
   refs=[m.attrib['ref'] for m in e.findall('member') if m.attrib['type']=='way']
   members+=len(refs)
   if members>2000000:raise RuntimeError('Split reference audit above two million members')
   missing=[ref for ref in refs if ref not in ways]
   if missing:
    areas.append({'id':'osm:r'+e.attrib['id'],'tags':tags,'missingWays':len(missing),'missingWaySample':missing[:32]})
    if len(areas)>1000:raise RuntimeError('Too many incomplete areas for bounded quarantine')
 if e.tag in ('node','way','relation'):
  e.clear();root.clear()
print(json.dumps({'schema':'questlayer.geometry-reference-audit/1','presentWays':len(ways),'relations':relations,'incompleteAreas':areas}))
