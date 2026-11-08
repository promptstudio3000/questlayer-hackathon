import { SIZE, KEY, createState, cell, chunk, mayEdit, outdoor, claim, renew, edit, takeover, restore } from './model.mjs';
const $ = id => document.getElementById(id);
let state = createState(), storageOK = true;
try { const raw = localStorage.getItem(KEY); if (raw) state = restore(raw); } catch { storageOK = false; }
const canvas = $('world'), ctx = canvas.getContext('2d');
let faces = [], width = 0, height = 0;
function announce(message) { $('status').textContent = message; }
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch { storageOK = false; announce('Browser storage is unavailable. Keep this tab open or export your blueprint.'); }
}
function selectRealm(realm) {
  state.realm = realm;
  for (const b of document.querySelectorAll('[data-realm]')) b.setAttribute('aria-pressed', String(b.dataset.realm === realm));
  $('outdoor').hidden = realm !== 'questlayer'; $('virtual').hidden = realm !== 'gotchiverse'; $('geocache').hidden = realm !== 'geocaching';
  save(); update();
}
function update() {
  $('permits').textContent = `${state.permits} sample permit${state.permits === 1 ? '' : 's'}`;
  $('sample-quest').disabled = state.completed;
  $('quest-result').textContent = state.completed ? 'One sample permit is yours. Take it into Gotchiverse.' : '';
  $('cache').disabled = state.cacheFound;
  $('cache-result').textContent = state.cacheFound ? 'Sample cache found. A story collected, with no payment or yield.' : '';
  $('chunk-name').textContent = `Grid ${state.cx} / ${state.cy}`;
  const lease = state.leases[chunk(state)], active = !!lease && lease.until > Date.now(), editable = mayEdit(state);
  $('lease-label').textContent = !lease ? 'An open piece of the world.' : !active ? 'Your build stays. Editing rests.' : lease.owner === 'other' ? 'A new player is building here.' : 'A little world, made by you.';
  $('lease-help').textContent = !lease ? 'Use an outdoor test permit to try a 30-day local claim. Real claims will also require QGOLD.' : !active ? 'Renew before another player claims it. Your terrain remains visible while this claim is expired.' : lease.owner === 'other' ? 'The previous terrain was archived before this new claim. Your personal collectibles were not transferred.' : `Claimed until ${new Date(lease.until).toLocaleDateString('en-GB')}. Shape the terrain or invite your friends.`;
  $('claim').hidden = !!lease; $('claim').disabled = state.permits < 1 || state.friend;
  $('friends-row').hidden = !active || lease?.owner !== 'me' || state.friend;
  $('friends').checked = !!lease?.friends;
  $('visitor').checked = state.friend;
  for (const b of document.querySelectorAll('[data-edit]')) b.disabled = !editable;
  $('expire').disabled = !active || state.friend || lease.owner !== 'me';
  $('renew').disabled = !lease || active || lease.owner !== 'me' || state.friend || state.permits < 1;
  $('takeover').disabled = !lease || active || state.friend;
  $('archive-count').textContent = `${state.archives.length} archived blueprint${state.archives.length === 1 ? '' : 's'} in this session.`;
  const [x,y] = state.selected, c = cell(state,x,y);
  $('cell-description').textContent = `Block ${x + 1}, ${y + 1} · ${c.material} · height ${c.height}`;
  if (state.realm === 'gotchiverse') draw();
}
function polygon(points, color, stroke) {
  ctx.beginPath(); ctx.moveTo(...points[0]); for (const p of points.slice(1)) ctx.lineTo(...p); ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}
function draw() {
  const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
  width = rect.width; height = rect.height;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = width * dpr; canvas.height = height * dpr; ctx.setTransform(dpr,0,0,dpr,0,0);
  const sky = ctx.createLinearGradient(0,0,0,height); sky.addColorStop(0,'#e8d9f6'); sky.addColorStop(1,'#d6c2eb'); ctx.fillStyle=sky; ctx.fillRect(0,0,width,height);
  const unit = Math.min((width - 24) / 32, (height - 68) / 19), rise = unit * .68, ox = width / 2, oy = 44;
  faces = [];
  for (let sum = 0; sum <= 30; sum++) for (let y = 0; y < SIZE; y++) {
    const x = sum - y; if (x < 0 || x >= SIZE) continue;
    const c = cell(state,x,y), px = ox+(x-y)*unit, py = oy+(x+y)*unit*.5, top = py-c.height*rise;
    const colors = c.material === 'grass' ? ['#a5ce8d','#637b68','#778f70'] : c.material === 'stone' ? ['#c9bce1','#776585','#9583a7'] : ['#8bcad8','#52879b','#69a6b8'];
    polygon([[px-unit,top],[px,top+unit*.5],[px,py+unit*.5+rise],[px-unit,py+rise]],colors[1]);
    polygon([[px,top+unit*.5],[px+unit,top],[px+unit,py+rise],[px,py+unit*.5+rise]],colors[2]);
    const points = [[px,top-unit*.5],[px+unit,top],[px,top+unit*.5],[px-unit,top]];
    polygon(points, colors[0], '#6f5c8c33'); faces.push({x,y,points});
    if (x===state.selected[0] && y===state.selected[1]) { polygon(points,'#ffe78c99','#5429b5'); ctx.lineWidth=1; }
    if (c.object) {
      ctx.fillStyle='#5b318b';ctx.fillRect(px-unit*.4,top-unit*1.7,unit*.8,unit*1.5);
      ctx.fillStyle='#f4d56d';ctx.fillRect(px-unit*.6,top-unit*2,unit*1.2,unit*.45);
      ctx.fillStyle='#ffebac';ctx.fillRect(px-unit*.15,top-unit*2.9,unit*.3,unit*.65);
    }
    if (x===state.player[0] && y===state.player[1]) {
      const p = Math.max(unit*.23,3); ctx.fillStyle='#fff7ff';
      ctx.fillRect(px-p*2,top-p*7,p*4,p*5);ctx.fillRect(px-p*3,top-p*6,p*6,p*3);
      ctx.fillStyle='#5429b5';ctx.fillRect(px-p*1.5,top-p*5,p,p);ctx.fillRect(px+p*.5,top-p*5,p,p);
      ctx.fillStyle='#ed8cd7';ctx.fillRect(px-p*2.5,top-p*3.8,p,p*.7);ctx.fillRect(px+p*1.5,top-p*3.8,p,p*.7);
    }
  }
  if (!mayEdit(state)) { ctx.fillStyle='#40215d';ctx.font='600 14px system-ui';ctx.fillText(state.leases[chunk(state)] ? 'VIEWING · editing is paused' : 'OPEN LAND · claim to build',16,height-18); }
}
function pointInside(x,y,points) { let inside=false; for(let i=0,j=points.length-1;i<points.length;j=i++) { const [xi,yi]=points[i],[xj,yj]=points[j];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))inside=!inside;}return inside; }
function moveSelection(dx,dy) { state.selected=[Math.max(0,Math.min(15,state.selected[0]+dx)),Math.max(0,Math.min(15,state.selected[1]+dy))];save();update(); }
for (const b of document.querySelectorAll('[data-realm]')) b.onclick=()=>selectRealm(b.dataset.realm);
$('sample-quest').onclick=()=>{outdoor(state);save();update();};
$('enter-world').onclick=()=>{selectRealm('gotchiverse');document.querySelector('[data-realm="gotchiverse"]').focus();};
$('claim').onclick=()=>{if(claim(state)){announce('This grid is yours in the local prototype. Select a block and start building.');save();update();}};
for(const b of document.querySelectorAll('[data-edit]')) b.onclick=()=>{if(edit(state,b.dataset.edit)){announce(`${b.textContent}: block ${state.selected.map(n=>n+1).join(', ')} updated locally.`);save();update();}else announce('This action is unavailable: check your claim or the block height.');};
for(const b of document.querySelectorAll('[data-select]')) b.onclick=()=>moveSelection(...b.dataset.select.split(',').map(Number));
for(const b of document.querySelectorAll('[data-pan]')) b.onclick=()=>{const [dx,dy]=b.dataset.pan.split(',').map(Number);state.cx=Math.max(-100000,Math.min(100000,state.cx+dx));state.cy=Math.max(-100000,Math.min(100000,state.cy+dy));save();update();};
$('friends').onchange=()=>{const l=state.leases[chunk(state)];if(l&&l.owner==='me'&&!state.friend){l.friends=$('friends').checked;save();update();}};
$('visitor').onchange=()=>{state.friend=$('visitor').checked;save();update();announce(state.friend?'Previewing a friend. Editing follows this claim’s friends setting.':'Returned to your own local profile.');};
$('expire').onclick=()=>{const l=state.leases[chunk(state)];if(l&&l.owner==='me'&&!state.friend){l.until=Date.now()-1;state.permits=Math.max(1,state.permits);save();update();announce('Expiration simulated. One test renewal permit supplied. The existing terrain stays visible.');}};
$('renew').onclick=()=>{if(renew(state)){save();update();announce('Claim renewed locally. Your terrain was preserved.');}};
$('takeover').onclick=()=>{if(takeover(state)){save();update();announce('Old blueprint archived for this session. Another player’s claim starts from natural terrain. Personal NFT ownership is outside this prototype.');}};
$('export').onclick=()=>{const blob=new Blob([JSON.stringify({prototype:true,chunk:chunk(state),cells:state.cells,archives:state.archives},null,2)],{type:'application/json'});const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='gotchiverse-local-blueprint.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
$('cache').onclick=()=>{state.cacheFound=true;save();update();};
canvas.addEventListener('click',e=>{const r=canvas.getBoundingClientRect(),f=[...faces].reverse().find(f=>pointInside(e.clientX-r.left,e.clientY-r.top,f.points));if(f){state.selected=[f.x,f.y];save();update();}});
canvas.addEventListener('keydown',e=>{const arrows={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]},walk={w:[0,-1],s:[0,1],a:[-1,0],d:[1,0]};if(arrows[e.key]){e.preventDefault();moveSelection(...arrows[e.key]);}else if(walk[e.key.toLowerCase()]){e.preventDefault();const [dx,dy]=walk[e.key.toLowerCase()];state.player=[Math.max(0,Math.min(15,state.player[0]+dx)),Math.max(0,Math.min(15,state.player[1]+dy))];save();update();}});
new ResizeObserver(()=>{if(state.realm==='gotchiverse')draw();}).observe(canvas);
selectRealm(state.realm);
if(!storageOK)announce('Browser storage is unavailable. Export your blueprint before leaving.');
