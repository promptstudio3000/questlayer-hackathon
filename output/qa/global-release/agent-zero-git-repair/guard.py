#!/usr/bin/env python3
"""Preserve one reviewed Agent Zero helper repair; never overwrite new upstream code."""
import fcntl,json,pathlib,subprocess
ROOT=pathlib.Path('/opt/prompt-studio/data/agent-zero/usr/workdir/questlayer_task/agent-zero-git-repair')
ROOT.mkdir(parents=True,exist_ok=True)
with (ROOT/'lifecycle-guard.lock').open('w') as lock:
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:raise SystemExit(0)
 code="""import pathlib,hashlib,ast,json
p=pathlib.Path('/a0/helpers/git.py')
before='1c7507a243f7493e4400e02ec18f86df8c6dbd31db8c3a80ed3aaa79d3701e16'
after='d2af4aaf699858994bda2584f7e56c235b2597ab691f6bb694561167a5b0e657'
h=hashlib.sha256(p.read_bytes()).hexdigest();applied=False
if h==before:
 patch=pathlib.Path('/a0/usr/workdir/questlayer_task/agent-zero-git-repair/20261107T143943Z/git.after.py').read_bytes()
 assert hashlib.sha256(patch).hexdigest()==after;ast.parse(patch)
 p.write_bytes(patch);applied=True
print(json.dumps({'state':'patched' if applied else 'verified' if h==after else 'review-required-upstream','applied':applied,'sourceSha256':hashlib.sha256(p.read_bytes()).hexdigest()}))
"""
 result=subprocess.run(['docker','exec','promptstudio-agent-zero','python3','-c',code],capture_output=True,text=True,timeout=30)
 if result.returncode:
  status={'state':'waiting-container','exit':result.returncode}
 else:
  status=json.loads(result.stdout)
  if status['applied']:
   restart=subprocess.run(['docker','exec','promptstudio-agent-zero','supervisorctl','restart','run_ui'],capture_output=True,text=True,timeout=40)
   status['uiRestartExit']=restart.returncode
 (ROOT/'lifecycle-status.json').write_text(json.dumps(status,sort_keys=True)+'\n')
 print(json.dumps(status,sort_keys=True))
