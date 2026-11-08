// Local design prototype. This module has no financial or GPS authority.
export const SIZE = 16;
export const MAX_HEIGHT = 5;
export const KEY = 'questlayer-gotchiverse-design-1';
export const cellKey = (x, y) => `${x},${y}`;
export function natural(x, y, cx = 0, cy = 0) {
  const n = Math.abs(Math.sin((x + cx * SIZE) * 12.9898 + (y + cy * SIZE) * 78.233));
  return { height: n > .96 ? 2 : 1, material: n < .05 ? 'water' : 'grass', object: null };
}
export function createState() {
  return { version: 1, realm: 'questlayer', cx: 0, cy: 0, selected: [7, 7], player: [8, 8],
    permits: 0, completed: false, cells: {}, leases: {}, archives: [], friend: false, cacheFound: false };
}
export function chunk(s) { return cellKey(s.cx, s.cy); }
export function cell(s, x, y) { return s.cells[`${chunk(s)}:${cellKey(x, y)}`] ?? natural(x, y, s.cx, s.cy); }
export function mayEdit(s, now = Date.now()) {
  const lease = s.leases[chunk(s)];
  return !!lease && lease.until > now && (s.friend ? lease.friends : lease.owner === 'me');
}
export function outdoor(s) {
  if (s.completed) return false;
  s.completed = true; s.permits++; return true;
}
export function claim(s, now = Date.now()) {
  if (s.permits < 1 || s.friend) return false;
  const old = s.leases[chunk(s)];
  if (old && old.until > now) return false;
  if (old) return false; // Expired builds require a deliberate renew or takeover choice.
  s.permits--; s.leases[chunk(s)] = { owner: 'me', until: now + 30 * 86400000, friends: false }; return true;
}
export function renew(s, now = Date.now()) {
  const old = s.leases[chunk(s)];
  if (!old || old.owner !== 'me' || old.until > now || s.friend || s.permits < 1) return false;
  s.permits--; old.until = now + 30 * 86400000; return true;
}
export function edit(s, action, now = Date.now()) {
  if (!mayEdit(s, now)) return false;
  const [x, y] = s.selected;
  const c = { ...cell(s, x, y) };
  if (action === 'raise') { if (c.height >= MAX_HEIGHT) return false; c.height++; }
  else if (action === 'lower') { if (c.height <= 0) return false; c.height--; }
  else if (['grass', 'stone', 'water'].includes(action)) c.material = action;
  else if (action === 'collectible') c.object = 'sample-collectible';
  else if (action === 'remove') c.object = null;
  else return false;
  s.cells[`${chunk(s)}:${cellKey(x, y)}`] = c; return true;
}
export function takeover(s, now = Date.now()) {
  const key = chunk(s), old = s.leases[key];
  if (!old || old.until > now || s.friend) return false;
  const terrain = Object.fromEntries(Object.entries(s.cells).filter(([k]) => k.startsWith(`${key}:`)));
  s.archives.push({ chunk: key, at: now, terrain });
  s.archives = s.archives.slice(-20);
  for (const k of Object.keys(terrain)) delete s.cells[k];
  s.leases[key] = { owner: 'other', until: now + 30 * 86400000, friends: false }; return true;
}
// Persisted data is only a bounded convenience, never a trusted claim or inventory.
export function restore(raw) {
  try {
    if (typeof raw !== 'string' || raw.length > 1000000) return createState();
    const v = JSON.parse(raw);
    const coord = n => Number.isInteger(n) && Math.abs(n) <= 100000;
    const point = p => Array.isArray(p) && p.length === 2 && p.every(n => Number.isInteger(n) && n >= 0 && n < SIZE);
    if (v.version !== 1 || !coord(v.cx) || !coord(v.cy) || !point(v.selected) || !point(v.player)) return createState();
    if (!['questlayer', 'gotchiverse', 'geocaching'].includes(v.realm) || !Number.isInteger(v.permits) || v.permits < 0 || v.permits > 100) return createState();
    if (typeof v.completed !== 'boolean' || typeof v.friend !== 'boolean' || typeof v.cacheFound !== 'boolean') return createState();
    const validKey = /^-?\d{1,6},-?\d{1,6}:[0-9]{1,2},[0-9]{1,2}$/;
    if (!v.cells || typeof v.cells !== 'object' || Array.isArray(v.cells) || Object.keys(v.cells).length > 4096) return createState();
    for (const [k, c] of Object.entries(v.cells)) {
      if (!validKey.test(k) || !c || !Number.isInteger(c.height) || c.height < 0 || c.height > MAX_HEIGHT || !['grass', 'stone', 'water'].includes(c.material) || ![null, 'sample-collectible'].includes(c.object)) return createState();
      const [x,y] = k.split(':')[1].split(',').map(Number); if (x >= SIZE || y >= SIZE) return createState();
    }
    if (!v.leases || typeof v.leases !== 'object' || Array.isArray(v.leases) || Object.keys(v.leases).length > 100) return createState();
    for (const [k, l] of Object.entries(v.leases)) if (!/^-?\d{1,6},-?\d{1,6}$/.test(k) || !l || !['me','other'].includes(l.owner) || !Number.isSafeInteger(l.until) || typeof l.friends !== 'boolean') return createState();
    // Archived JSON is not loaded back into editable terrain. Export first if needed.
    return { ...createState(), realm:v.realm, cx:v.cx, cy:v.cy, selected:v.selected, player:v.player,
      permits:v.permits, completed:v.completed, cells:v.cells, leases:v.leases, friend:v.friend, cacheFound:v.cacheFound };
  } catch { return createState(); }
}
