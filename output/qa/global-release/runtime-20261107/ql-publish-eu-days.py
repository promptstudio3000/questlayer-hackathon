#!/usr/bin/env python3
"""Atomic publication of validated geographic days; no player data or signing."""
import pathlib,json,hashlib,shutil,tempfile,os,subprocess,fcntl,argparse,re

def publish(source,destination,gid,validator):
 source=pathlib.Path(source);destination=pathlib.Path(destination);destination.mkdir(parents=True,exist_ok=True)
 result=[]
 for day in sorted(source.iterdir()):
  if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',day.name) or day.is_symlink() or not day.is_dir():continue
  manifest=day/'manifest.json'
  if not manifest.is_file():continue
  sha=hashlib.sha256(manifest.read_bytes()).hexdigest();target=destination/day.name
  if target.exists():
   assert not target.is_symlink() and hashlib.sha256((target/'manifest.json').read_bytes()).hexdigest()==sha,'Refusing to replace a published day'
   result.append({'day':day.name,'state':'already-published','manifestSha256':sha});continue
  checked=validator(manifest);assert checked['state']=='passed'
  pending=pathlib.Path(tempfile.mkdtemp(prefix='.pending-'+day.name+'-',dir=destination))
  try:
   for p in day.rglob('*'):
    assert not p.is_symlink(),'No links in a published day'
    rel=p.relative_to(day);assert not any(x in ['runtime.env','.env','.data','held-keys','.near-credentials'] for x in rel.parts)
    assert p.suffix not in ['.pem','.key','.sqlite','.db']
    q=pending/rel
    if p.is_dir():q.mkdir(parents=True,exist_ok=True)
    else:q.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,q);os.chown(q,-1,gid);q.chmod(0o640)
   for q in [pending,*[p for p in pending.rglob('*') if p.is_dir()]]:os.chown(q,-1,gid);q.chmod(0o750)
   assert hashlib.sha256((pending/'manifest.json').read_bytes()).hexdigest()==sha
   # Verify copied bytes too; a failed copy never becomes visible to the game.
   assert validator(pending/'manifest.json')['state']=='passed'
   pending.rename(target);result.append({'day':day.name,'state':'published','manifestSha256':sha,'verified':checked})
  except Exception:
   # Leave the isolated failed publication for diagnosis. Never remove data.
   raise
 return result

if __name__=='__main__':
 import grp
 parser=argparse.ArgumentParser();parser.add_argument('--source',required=True);parser.add_argument('--destination',required=True);parser.add_argument('--group',required=True);parser.add_argument('--release',required=True);parser.add_argument('--status',required=True);a=parser.parse_args()
 status=pathlib.Path(a.status);status.parent.mkdir(parents=True,exist_ok=True)
 with status.with_suffix('.lock').open('w') as lock:
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise SystemExit(0)
  gid=grp.getgrnam(a.group).gr_gid;dest=pathlib.Path(a.destination);dest.mkdir(parents=True,exist_ok=True);os.chown(dest,-1,gid);dest.chmod(0o750)
  def validator(file):
   js="import {verifyPreparedActivities} from './server/world-preparation/verify-activities.mjs';console.log(JSON.stringify(verifyPreparedActivities(process.argv[1])));"
   return json.loads(subprocess.check_output(['/usr/local/bin/node','--max-old-space-size=512','--input-type=module','-e',js,str(file)],cwd=a.release,text=True,timeout=120))
  result=publish(a.source,a.destination,gid,validator);body={'state':'ready','days':result};temp=status.with_suffix('.tmp');temp.write_text(json.dumps(body,sort_keys=True)+'\n');temp.replace(status);print(json.dumps(body))
