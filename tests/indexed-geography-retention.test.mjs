import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

test('indexed geography retention is lossless, restorable and never removes an unverified original',()=>{
 const code=String.raw`
import pathlib,tempfile,importlib.util,hashlib,json
spec=importlib.util.spec_from_file_location('retention','output/qa/global-release/retain-indexed-geography.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as tmp:
 root=pathlib.Path(tmp);file=root/'paths.geojsonseq';raw=('Fixture original geometry with UTF-8 Háj.\n'*10000).encode();expected=hashlib.sha256(raw).hexdigest();file.write_bytes(raw);file.chmod(0o640)
 proof=m.retain(file,expected,root/'index.json',floor=0);assert not file.exists();assert proof['archiveBytes']<proof['originalBytes'];assert m.digest(root/proof['archive'],True)==expected
 restored=m.restore(root/'paths.geojsonseq.retention.json');assert restored.read_bytes()==raw and restored.stat().st_mode&0o777==0o640
 # A replay with both verified copies present can safely release only plaintext.
 m.retain(file,expected,root/'index.json',floor=0);assert not file.exists();m.restore(root/'paths.geojsonseq.retention.json')
 for expected_hash in ['0'*64]:
  try:m.retain(file,expected_hash,root/'index.json',floor=0);raise RuntimeError('Changed source was released')
  except AssertionError:pass
 assert file.read_bytes()==raw
 archive=root/proof['archive'];archive.write_bytes(b'corrupt')
 try:m.retain(file,expected,root/'index.json',floor=0);raise RuntimeError('Corrupt retained copy accepted')
 except (AssertionError,OSError,EOFError):pass
 assert file.read_bytes()==raw
 other=root/'pois.geojsonseq';other.write_bytes(raw)
 try:m.retain(other,expected,root/'index.json',floor=2**70);raise RuntimeError('Disk floor ignored')
 except AssertionError:pass
 assert other.read_bytes()==raw and not (root/'pois.geojsonseq.retained.gz').exists();assert not list(root.glob('*.pending-*'))
 raw_pbf=root/'source.pbf';raw_pbf.write_bytes(raw)
 try:m.retain(raw_pbf,expected,root/'index.json',floor=0);raise RuntimeError('Raw PBF accepted')
 except AssertionError:pass
 assert raw_pbf.read_bytes()==raw
print('passed')
`;
 assert.equal(execFileSync('python3',['-B','-c',code],{encoding:'utf8'}).trim(),'passed');
});

test('retention can read reused sealed indexes without modifying their source work tree',()=>{
 const code=String.raw`
import pathlib,tempfile,importlib.util,hashlib,json,gzip,types
spec=importlib.util.spec_from_file_location('retention','output/qa/global-release/retain-indexed-geography.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as temp:
 data=pathlib.Path(temp)/'agent';task=data/'usr/workdir/questlayer_task';work=task/'candidate/eu-work';extract=work/'sources/fixture/extract';extract.mkdir(parents=True);shared=task/'candidate/shared/sources/fixture/spatial-index/version';(shared/'paths').mkdir(parents=True)
 raw=b'Complete synthetic source bytes.\n'*70000;expected=hashlib.sha256(raw).hexdigest();original=extract/'paths.geojsonseq';original.write_bytes(raw);(extract/'paths.geojsonseq.receipt.json').write_text(json.dumps({'sha256':expected}))
 chunk=shared/'paths/0_0-0.geojsonseq.gz';chunk.write_bytes(gzip.compress(raw));(shared/'manifest.json').write_text(json.dumps({'policy':'complete-geometry-spatial-cache/1','hashes':{'paths':expected},'roles':{'paths':{'tiles':{'0_0':[{'file':chunk.name,'sha256':m.digest(chunk)}]}}}}))
 outside=task/'candidate/shared/sources/fixture/extract';outside.mkdir(parents=True);other=outside/'paths.geojsonseq';other.write_bytes(raw);(outside/'paths.geojsonseq.receipt.json').write_text(json.dumps({'sha256':expected}))
 def container(p):return '/a0/'+str(p.relative_to(data))
 row={'id':'fixture','stage':'plan','indexFile':container(shared/'manifest.json'),'inputs':{'paths':container(original)}}
 (work/'state.json').write_text(json.dumps({'sources':{'fixture':row,'outside':{**row,'id':'outside','inputs':{'paths':container(other)}}}}));(work/'status.json').write_text(json.dumps({'source':'active-other-source'}))
 retain=m.retain;m.retain=lambda file,expected,index_file:retain(file,expected,index_file,floor=0)
 m.main(types.SimpleNamespace(work=str(work),agent_data=str(data),max_files=1));assert not original.exists();assert other.read_bytes()==raw;assert chunk.exists();assert m.digest(extract/'paths.geojsonseq.retained.gz',True)==expected
 assert json.loads((work/'retention-status.json').read_text())['files']==1
print('passed')
`;
 assert.ok(execFileSync('python3',['-B','-c',code],{encoding:'utf8'}).trim().endsWith('passed'));
});
