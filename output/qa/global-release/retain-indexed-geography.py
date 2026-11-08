#!/usr/bin/env python3
"""Lossless retention of indexed Agent Zero intermediates, never raw PBFs."""
import argparse,fcntl,gzip,hashlib,json,os,pathlib,shutil,stat,time,uuid

def digest(file,decoded=False):
 h=hashlib.sha256()
 with (gzip.open(file,'rb') if decoded else open(file,'rb')) as stream:
  while chunk:=stream.read(1024*1024):h.update(chunk)
 return h.hexdigest()

def sync_dir(parent):
 fd=os.open(parent,os.O_RDONLY)
 try:os.fsync(fd)
 finally:os.close(fd)

def atomic_json(file,value):
 temp=file.with_name(file.name+'.pending-'+uuid.uuid4().hex)
 with temp.open('x') as stream:
  json.dump(value,stream,sort_keys=True);stream.write('\n');stream.flush();os.fsync(stream.fileno())
 temp.chmod(0o600);temp.replace(file);sync_dir(file.parent)

def retain(file,expected,index_file,floor=8*1024**3):
 file=pathlib.Path(file);archive=file.with_name(file.name+'.retained.gz');receipt=file.with_name(file.name+'.retention.json')
 assert file.name in ['pois.geojsonseq','paths.geojsonseq','exclusions.geojsonseq'] and not file.is_symlink()
 before=file.stat();assert stat.S_ISREG(before.st_mode) and before.st_nlink==1
 assert digest(file)==expected,'Original does not match the sealed index'
 if archive.exists():
  assert not archive.is_symlink() and digest(archive,True)==expected,'Existing archive differs'
 else:
  temp=archive.with_name(archive.name+'.pending-'+uuid.uuid4().hex)
  try:
   with file.open('rb') as source,temp.open('xb') as target:
    temp.chmod(0o600)
    with gzip.GzipFile(fileobj=target,mode='wb',filename='',mtime=0,compresslevel=3) as compressed:
     while chunk:=source.read(1024*1024):
      assert shutil.disk_usage(file.parent).free-4*1024**2>=floor,'Disk floor reached; original retained'
      compressed.write(chunk)
    target.flush();os.fsync(target.fileno())
   assert digest(temp,True)==expected,'Round-trip hash differs'
   assert not archive.exists(),'Concurrent archive appeared'
   temp.rename(archive);sync_dir(file.parent)
  finally:
   if temp.exists():temp.unlink() # Only our incomplete reproducible archive.
 current=file.stat();assert (current.st_ino,current.st_size,current.st_mtime_ns)==(before.st_ino,before.st_size,before.st_mtime_ns),'Original changed during retention'
 proof={'schema':'questlayer.indexed-input-retention/1','file':file.name,'archive':archive.name,'originalSha256':expected,'archiveSha256':digest(archive),'originalBytes':before.st_size,'archiveBytes':archive.stat().st_size,'mode':stat.S_IMODE(before.st_mode),'mtimeNs':before.st_mtime_ns,'indexFile':str(index_file)}
 atomic_json(receipt,proof)
 file.unlink();sync_dir(file.parent)
 return proof

def restore(receipt):
 receipt=pathlib.Path(receipt);proof=json.loads(receipt.read_text());assert proof['schema']=='questlayer.indexed-input-retention/1'
 assert proof['file'] in ['pois.geojsonseq','paths.geojsonseq','exclusions.geojsonseq'] and proof['archive']==proof['file']+'.retained.gz'
 assert pathlib.Path(proof['file']).name==proof['file'] and pathlib.Path(proof['archive']).name==proof['archive']
 file=receipt.parent/proof['file'];archive=receipt.parent/proof['archive'];assert not file.exists() and not file.is_symlink() and not archive.is_symlink()
 assert digest(archive)==proof['archiveSha256'] and digest(archive,True)==proof['originalSha256'],'Retained archive differs'
 temp=file.with_name(file.name+'.restore-'+uuid.uuid4().hex)
 try:
  with gzip.open(archive,'rb') as source,temp.open('xb') as target:
   shutil.copyfileobj(source,target,1024*1024);target.flush();os.fsync(target.fileno())
  assert digest(temp)==proof['originalSha256'];temp.chmod(proof['mode']);os.utime(temp,ns=(proof['mtimeNs'],proof['mtimeNs']))
  assert not file.exists();temp.rename(file);sync_dir(file.parent)
 finally:
  if temp.exists():temp.unlink()
 return file

def main(a):
 work=pathlib.Path(a.work).resolve();data=pathlib.Path(a.agent_data).resolve();assert work.is_relative_to(data)
 def host(value,write=False):
  path=pathlib.PurePosixPath(value);assert path.is_relative_to('/a0')
  result=data/str(path.relative_to('/a0'));assert not result.is_symlink()
  if write:assert result.resolve().is_relative_to(work/'sources')
  else:assert result.name=='manifest.json' and 'spatial-index' in result.parts and result.resolve().is_relative_to(data/'usr/workdir/questlayer_task')
  return result
 with (work/'retention.lock').open('a+') as lock:
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:return
  if getattr(a,'below_free_gib',None) is not None and shutil.disk_usage(work).free>=a.below_free_gib*1024**3:
   atomic_json(work/'retention-status.json',{'state':'space-sufficient','at':time.time(),'rawSourcesChanged':False});return
  state=json.loads((work/'state.json').read_text());active=json.loads((work/'status.json').read_text()).get('source');candidates=[];start=time.monotonic()
  for key,source in state['sources'].items():
   if source['stage']=='extract' or not source.get('indexFile') or source['id']==active:continue
   index_file=host(source['indexFile']);index=json.loads(index_file.read_text())
   assert index['policy']=='complete-geometry-spatial-cache/1'
   for role,path in source['inputs'].items():
    try:file=host(path,write=True)
    except AssertionError:continue # Read-only reused indexes do not authorize archiving another work tree.
    marker=file.with_name(file.name+'.receipt.json')
    if file.is_file() and file.stat().st_size>=1024**2 and marker.is_file() and json.loads(marker.read_text())['sha256']==index['hashes'][role]:candidates.append((file.stat().st_size,key,role,file,index_file,index['hashes'][role]))
  results=[]
  # Small archives first can recover working room close to the disk floor.
  for size,key,role,file,index_file,expected in sorted(candidates):
   if len(results)>=a.max_files or time.monotonic()-start>240:break
   latest=json.loads((work/'state.json').read_text())['sources'][key]
   if latest['stage']=='extract' or latest.get('indexFile')!=state['sources'][key]['indexFile'] or latest['id']==json.loads((work/'status.json').read_text()).get('source'):continue
   # The sealed index binds the source hash. Confirm its transport files are
   # present; querySourceIndex independently hashes each chunk when it reads
   # gameplay data. Re-reading all replicated tiles here would duplicate that
   # work and cannot add to the original -> gzip -> decoded-byte equality.
   index=json.loads(index_file.read_text());valid=True
   for refs in index['roles'][role]['tiles'].values():
    for ref in refs:
     chunk=index_file.parent/role/ref['file'];assert chunk.resolve().is_relative_to(index_file.parent/role)
     if time.monotonic()-start>240 or chunk.is_symlink() or not chunk.is_file():valid=False;break
    if not valid:break
   if not valid:continue
   result=retain(file,expected,index_file);results.append(result);print(json.dumps({'state':'retained','source':latest['id'],'role':role,'originalBytes':size,'archiveBytes':result['archiveBytes']}),flush=True)
  atomic_json(work/'retention-status.json',{'state':'finished','files':len(results),'reclaimedBytes':sum(p['originalBytes']-p['archiveBytes'] for p in results),'at':time.time(),'rawSourcesChanged':False})

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--work');p.add_argument('--agent-data');p.add_argument('--max-files',type=int,default=3);p.add_argument('--restore');p.add_argument('--below-free-gib',type=int);a=p.parse_args()
 if a.restore:
  assert a.work and a.agent_data
  work=pathlib.Path(a.work).resolve();receipt=pathlib.Path(a.restore);assert work.is_relative_to(pathlib.Path(a.agent_data).resolve()) and not receipt.is_symlink() and receipt.resolve().is_relative_to(work/'sources')
  print(restore(receipt))
 else:
  assert a.work and a.agent_data and 1<=a.max_files<=100 and (a.below_free_gib is None or 9<=a.below_free_gib<=1024)
  try:main(a)
  except Exception as error:
   atomic_json(pathlib.Path(a.work)/'retention-status.json',{'state':'waiting-resources-or-review','at':time.time(),'errorClass':type(error).__name__,'reason':str(error)[:200],'rawSourcesChanged':False});raise SystemExit(1)
