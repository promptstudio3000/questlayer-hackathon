#!/usr/bin/env python3
"""Scoped deterministic collector supervisor. Only its child group is stopped."""
import argparse,fcntl,json,os,signal,subprocess,time,shutil
from pathlib import Path
def record_interruption(root,reason,started_at,child_pid,now=None):
 """Persist only the exact stopped child's unfinished step under recovery lock."""
 now=time.time() if now is None else now
 if reason not in ('time-slice','resource-floor'):return None
 root=Path(root);lock=root/'.prepare.lock';recovery=root/'.prepare.lock.recovery'
 if not lock.exists():return None
 original=lock.read_bytes();owner=json.loads(original)
 if owner.get('pid')!=child_pid:return None
 try:os.kill(child_pid,0);return None
 except ProcessLookupError:pass
 with recovery.open('x'):
  try:
   assert lock.read_bytes()==original,'Collector lock changed'
   state_file=root/'state.json';state=json.loads(state_file.read_text());status=json.loads((root/'status.json').read_text())
   from datetime import datetime
   if datetime.fromisoformat(status['at'].replace('Z','+00:00')).timestamp()<started_at:return None
   matches=[s for s in state['sources'].values() if s['id']==status.get('source') and s['stage']==status.get('phase')]
   if len(matches)!=1:return None
   source=matches[0]
   # A completed step resets attempts before aggregate publication starts.
   # Do not blame that following publication on the next unstarted region.
   if source.get('attempts',0)<1:return None
   previous=source.get('lastInterruption',{})
   if previous.get('childPid')==child_pid and previous.get('startedAt')==started_at:return None
   if reason=='resource-floor':source['attempts']=max(0,source.get('attempts',0)-1)
   else:
    source['error']='Scoped worker time limit; original inputs retained.'
    source['nextAttempt']=int(now*1000)+min(3600000,60000*2**min(source.get('attempts',1),6))
    if source['stage']=='regions' and source.get('attempts',0)>=3:
     plan=json.loads(Path(source['plan']).read_text())['plans'];cursor=source['cursor']
     if cursor<len(plan):
      source.setdefault('rejected',[]).append({'plan':plan[cursor]['id'],'reason':source['error']})
      source['cursor']+=1;source['attempts']=0
   event={'at':now,'startedAt':started_at,'childPid':child_pid,'reason':reason,'source':source['id'],'stage':source['stage'],'cursor':source.get('cursor')}
   source['lastInterruption']=event
   tmp=state_file.with_name('state.json.supervisor-pending');tmp.write_text(json.dumps(state,sort_keys=True,separators=(',',':'))+'\n');tmp.chmod(0o600);os.replace(tmp,state_file)
   with (root/'interruptions.jsonl').open('a') as audit:audit.write(json.dumps(event)+'\n')
   return event
  finally:recovery.unlink()


def main():
 p=argparse.ArgumentParser();p.add_argument('--config',type=Path,required=True);p.add_argument('--node',required=True);p.add_argument('--source',type=Path,required=True);a=p.parse_args();config=json.loads(a.config.read_text());root=Path(config['workDir']);root.mkdir(parents=True,exist_ok=True)
 def status(state,**extra):
  t=root/'run-status.json.tmp';t.write_text(json.dumps({'at':time.time(),'state':state,**extra}));os.replace(t,root/'run-status.json')
 def resources():
  free=shutil.disk_usage(root).free
  mem={line.split(':')[0]:int(line.split()[1])*1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.split(':')[0] in ('MemAvailable',)}
  c=Path('/sys/fs/cgroup/memory.current');current=int(c.read_text()) if c.exists() else 0
  return free,mem.get('MemAvailable',0),current
 with (root/'supervisor.lock').open('a+') as lock:
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise SystemExit(0)
  free,available,current=resources()
  utc=time.gmtime();minute=utc.tm_hour*60+utc.tm_min
  prepare_only=free<9*1024**3 or minute>=config.get('nextDayMinuteUTC',1410)
  # Publication can use the headroom, while retaining the service floor.
  floor=8*1024**3 if prepare_only else 9*1024**3
  minimum=floor+(128*1024**2 if prepare_only else 0)
  if free<minimum or available<512*1024**2 or current>4*1024**3:
   status('waiting-resources',freeBytes=free,availableMemory=available,containerMemory=current);raise SystemExit(0)
  with (root/'worker.log').open('ab') as log:
   command=[a.node,'--max-old-space-size=512',str(a.source/'scripts/continue-playable-world.mjs'),str(a.config)]+(['--prepare-only'] if prepare_only else [])
   child=subprocess.Popen(command,cwd=a.source,stdout=log,stderr=log,start_new_session=True)
   try:os.setpriority(os.PRIO_PROCESS,child.pid,10)
   except ProcessLookupError:pass
   status('running',pid=child.pid,prepareOnly=prepare_only);start=time.monotonic();started_at=time.time();reason=None
   while child.poll() is None:
    free,available,current=resources()
    if free<floor or available<256*1024**2 or current>4600*1024**2:reason='resource-floor'
    if reason is None and time.monotonic()-start>(3300 if prepare_only else 1200):reason='time-slice'
    if reason:
     # Child has its own session/group, inherited by its osmium subprocesses.
     # No process-name matching and no signals outside this exact group.
     try:os.killpg(child.pid,signal.SIGTERM)
     except ProcessLookupError:pass
     try:child.wait(timeout=10)
     except subprocess.TimeoutExpired:
      try:os.killpg(child.pid,signal.SIGKILL)
      except ProcessLookupError:pass
      child.wait()
     break
    time.sleep(2)
   recovered=record_interruption(root,reason,started_at,child.pid) if reason else None
  status('interrupted' if reason else 'finished',recovery=recovered,pid=child.pid,exitCode=child.returncode,reason=reason,durationSeconds=round(time.monotonic()-start,1))

if __name__=='__main__':main()
