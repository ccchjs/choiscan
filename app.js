const $ = s => document.querySelector(s);
const V = { home: $('#home'), qrs: $('#qrs'), pc: $('#pc'), cam: $('#cam'), crop: $('#crop'), edit: $('#edit') };
let stream, img, pts = [], raw, cur, mode = 'magic', pages = [];
let adj = 50, adjDirty = false, pvFrame = 0, rawSmall = null;

function toast(t) {
  const e = $('#toast'); e.textContent = t; e.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('on'), 2800);
}
addEventListener('error', e => toast('Error: ' + e.message));
function show(n) {
  for (const k in V) V[k].hidden = k !== n;
  n === 'cam' ? startCam() : n === 'qrs' ? startQR() : stopCam();
  $('#editbar').hidden = n !== 'edit';
  $('#cback').hidden = role === 'phone';
  if (typeof setExp === 'function') setExp();
}

/* ---------- Camera ---------- */
let camBusy = null;
async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const e = new Error('no-media'); e.name = 'NoMedia'; throw e;
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false
    });
  } catch (e) {
    if (e.name === 'NotAllowedError' || e.name === 'SecurityError') throw e;
    // fallback: walang special na constraints (para sa mga phone na ayaw sa facingMode/resolution)
    return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
}
// iisa lang ang pagbubukas ng camera kahit ilang beses tawagin
function ensureStream() {
  if (stream) return Promise.resolve(stream);
  if (!camBusy) camBusy = openCamera().then(s => (stream = s)).finally(() => { camBusy = null; });
  return camBusy;
}
function camMsg(e) {
  const n = e && e.name;
  if (n === 'NoMedia') return window.isSecureContext
    ? 'This browser does not support the camera. Open the link in Chrome or Safari.'
    : 'The link must use https:// for the camera to work.';
  if (n === 'NotAllowedError' || n === 'SecurityError')
    return 'Camera access was denied. Tap "Open camera" and choose Allow. If it still fails, allow it in your browser Settings. If the link came from Messenger/FB/Viber, open it in Chrome or Safari.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No camera was found on this device.';
  if (n === 'NotReadableError') return 'Another app is using the camera. Close it and try again.';
  return 'Could not open the camera.';
}
function camFail(e) {
  $('#camerr').textContent = camMsg(e) + ' You can also use "Phone camera" or "Upload" below.';
  $('#camfix').hidden = false;
}
async function startCam() {
  try { await ensureStream(); }
  catch (e) { if (!V.cam.hidden) camFail(e); return; }
  if (V.cam.hidden) { if (V.qrs.hidden) stopCam(); return; }
  $('#camfix').hidden = true;
  const v = $('#video');
  v.srcObject = stream;               // laging i-attach, kahit galing sa QR scanner ang stream
  v.play().catch(() => {});
}
function stopCam() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
}
$('#camopen').onclick = startCam;   // galing sa pindot ng user, kaya papayagan ng browser
$('#shot').onclick = () => {
  const v = $('#video');
  if (!v.videoWidth) return toast('Camera is not ready. Use Upload.');
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
  handleImage(c);
};
async function fromFile(e) {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try { handleImage(await createImageBitmap(f)); } catch (err) { toast('Could not read this image.'); }
}
$('#file').onchange = fromFile;
$('#file2').onchange = fromFile;

function setSource(bmp) {
  const k = Math.min(1, 3000 / Math.max(bmp.width, bmp.height));
  img = document.createElement('canvas');
  img.width = Math.round(bmp.width * k); img.height = Math.round(bmp.height * k);
  img.getContext('2d').drawImage(bmp, 0, 0, img.width, img.height);
  pts = [[.1, .1], [.9, .1], [.9, .9], [.1, .9]];
  show('crop'); drawCrop();
}

/* ---------- Crop (4 draggable corners) ---------- */
const cc = $('#cc'), cx = cc.getContext('2d');
function drawCrop() {
  const k = Math.min(Math.min(innerWidth - 24, 900) / img.width, innerHeight * .62 / img.height);
  cc.width = Math.round(img.width * k); cc.height = Math.round(img.height * k);
  cx.drawImage(img, 0, 0, cc.width, cc.height);
  const P = pts.map(p => [p[0] * cc.width, p[1] * cc.height]);
  const path = () => { cx.beginPath(); P.forEach((p, i) => i ? cx.lineTo(p[0], p[1]) : cx.moveTo(p[0], p[1])); cx.closePath(); };
  cx.fillStyle = 'rgba(20,33,61,.45)';
  cx.beginPath(); cx.rect(0, 0, cc.width, cc.height);
  P.forEach((p, i) => i ? cx.lineTo(p[0], p[1]) : cx.moveTo(p[0], p[1]));
  cx.closePath(); cx.fill('evenodd');
  cx.strokeStyle = '#2b59ff'; cx.lineWidth = 2; path(); cx.stroke();
  P.forEach(p => { cx.beginPath(); cx.arc(p[0], p[1], 11, 0, 7); cx.fillStyle = '#fff'; cx.fill(); cx.stroke(); });
}
let drag = -1;
cc.onpointerdown = e => {
  const r = cc.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  let best = 1e9;
  pts.forEach((p, i) => { const d = Math.hypot(p[0] * r.width - x, p[1] * r.height - y); if (d < best) { best = d; drag = i; } });
  if (best > 44) drag = -1; else cc.setPointerCapture(e.pointerId);
};
cc.onpointermove = e => {
  if (drag < 0) return;
  const r = cc.getBoundingClientRect(), cl = v => Math.min(1, Math.max(0, v));
  pts[drag] = [cl((e.clientX - r.left) / r.width), cl((e.clientY - r.top) / r.height)];
  drawCrop();
};
cc.onpointerup = cc.onpointercancel = () => drag = -1;
$('#retake').onclick = () => show(base);
addEventListener('resize', () => { if (!V.crop.hidden) drawCrop(); });

/* ---------- Perspective warp (pure JS) ---------- */
function solve(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let m = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r;
    [A[i], A[m]] = [A[m], A[i]]; [b[i], b[m]] = [b[m], b[i]];
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}
function homography(dst, src) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dst[i], [u, v] = src[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return solve(A, b);
}
function warp(im, p) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let w = Math.max(d(p[0], p[1]), d(p[3], p[2])), h = Math.max(d(p[0], p[3]), d(p[1], p[2]));
  const k = Math.min(1, 2200 / Math.max(w, h));
  w = Math.max(10, Math.round(w * k)); h = Math.max(10, Math.round(h * k));
  const H = homography([[0, 0], [w, 0], [w, h], [0, h]], p);
  const sw = im.width, sh = im.height, S = im.getContext('2d').getImageData(0, 0, sw, sh).data;
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const ox = out.getContext('2d'), od = ox.createImageData(w, h), O = od.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const z = H[6] * x + H[7] * y + 1;
    let u = (H[0] * x + H[1] * y + H[2]) / z, v = (H[3] * x + H[4] * y + H[5]) / z;
    u = Math.min(Math.max(u, 0), sw - 1.001); v = Math.min(Math.max(v, 0), sh - 1.001);
    const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0, i = (y0 * sw + x0) * 4, o = (y * w + x) * 4;
    for (let c = 0; c < 3; c++)
      O[o + c] = S[i + c] * (1 - fx) * (1 - fy) + S[i + 4 + c] * fx * (1 - fy) + S[i + sw * 4 + c] * (1 - fx) * fy + S[i + sw * 4 + 4 + c] * fx * fy;
    O[o + 3] = 255;
  }
  ox.putImageData(od, 0, 0);
  return out;
}
$('#apply').onclick = () => {
  toast('Processing...');
  setTimeout(() => {
    raw = warp(img, pts.map(p => [p[0] * img.width, p[1] * img.height]));
    mode = 'magic'; adj = 50; show('edit'); render();
  }, 30);
};

/* ---------- Enhancement: shadow removal, contrast, sharpen ---------- */
function blur(a, w, h, r, mx) {
  const t = new Float32Array(a.length), o = new Float32Array(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0, m = 0;
    for (let k = -r; k <= r; k++) { const xx = x + k; if (xx < 0 || xx >= w) continue; const v = a[y * w + xx]; s += v; n++; if (v > m) m = v; }
    t[y * w + x] = mx ? m : s / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0, m = 0;
    for (let k = -r; k <= r; k++) { const yy = y + k; if (yy < 0 || yy >= h) continue; const v = t[yy * w + x]; s += v; n++; if (v > m) m = v; }
    o[y * w + x] = mx ? m : s / n;
  }
  return o;
}
function sharpen(D, w, h) {
  const s = new Uint8ClampedArray(D.data), d = D.data;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) { const j = i + c; d[j] = s[j] * 3 - .5 * (s[j - 4] + s[j + 4] + s[j - w * 4] + s[j + w * 4]); }
  }
}
function getBG(src) {
  let B = bgCache.get(src);
  if (B) return B;
  const w = src.width, h = src.height;
  // estimate paper background: shrink, remove text (max filter), smooth, enlarge
  const sw = Math.max(8, Math.round(w / 8)), sh = Math.max(8, Math.round(h / 8));
  const s = document.createElement('canvas'); s.width = sw; s.height = sh;
  const sx = s.getContext('2d'); sx.drawImage(src, 0, 0, sw, sh);
  const sd = sx.getImageData(0, 0, sw, sh);
  for (let c = 0; c < 3; c++) {
    const a = new Float32Array(sw * sh);
    for (let i = 0; i < a.length; i++) a[i] = sd.data[i * 4 + c];
    const b = blur(blur(a, sw, sh, 3, true), sw, sh, 6, false);
    for (let i = 0; i < a.length; i++) sd.data[i * 4 + c] = b[i];
  }
  sx.putImageData(sd, 0, 0);
  const bg = document.createElement('canvas'); bg.width = w; bg.height = h;
  const bx = bg.getContext('2d'); bx.imageSmoothingQuality = 'high'; bx.drawImage(s, 0, 0, w, h);
  B = bx.getImageData(0, 0, w, h).data;
  bgCache.set(src, B);   // i-cache para mabilis ang slider
  return B;
}
// adj: 0-100 (50 = dating default). Magic/Gray = lakas ng contrast, B&W = lakas ng itim
function enhance(src, m, adj = 50) {
  const w = src.width, h = src.height, o = document.createElement('canvas');
  o.width = w; o.height = h;
  const x = o.getContext('2d'); x.drawImage(src, 0, 0);
  if (m === 'original') return o;
  const B = getBG(src);
  const D = x.getImageData(0, 0, w, h), d = D.data;
  const N = 1024, L = new Uint8ClampedArray(N + 1);
  const gm = (m === 'magic' ? .8 : 1) + adj * .014, thr = .8 - adj * .0024;
  for (let i = 0; i <= N; i++) { const t = i / N; L[i] = (m === 'bw' ? (t - thr) / .17 : Math.pow(t, gm)) * 255; }
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] / Math.max(B[i], 1), g = d[i + 1] / Math.max(B[i + 1], 1), b = d[i + 2] / Math.max(B[i + 2], 1);
    if (m !== 'magic') { r = g = b = .299 * r + .587 * g + .114 * b; }
    r = r > 1 ? 1 : r; g = g > 1 ? 1 : g; b = b > 1 ? 1 : b;
    d[i] = L[(r * N + .5) | 0]; d[i + 1] = L[(g * N + .5) | 0]; d[i + 2] = L[(b * N + .5) | 0];
  }
  if (m !== 'bw') sharpen(D, w, h);
  x.putImageData(D, 0, 0);
  return o;
}
const bgCache = new WeakMap();

/* ---------- Edit view ---------- */
function render() {
  cur = enhance(raw, mode, adj); adjDirty = false;
  const ec = $('#ec'); ec.width = cur.width; ec.height = cur.height;
  ec.getContext('2d').drawImage(cur, 0, 0);
  document.querySelectorAll('.modes button').forEach(b => b.classList.toggle('on', b.dataset.m === mode));
  $('#adj').hidden = mode === 'original';
  $('#adjr').value = adj; $('#adjv').textContent = adj;
  setExp();
}
// mabilis na preview habang ginagalaw ang slider (maliit na kopya), buo pagkabitaw
function preview() {
  if (!raw) return;
  if (!rawSmall || rawSmall.src !== raw) {
    const k = Math.min(1, 800 / Math.max(raw.width, raw.height)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(raw.width * k)); c.height = Math.max(1, Math.round(raw.height * k));
    c.getContext('2d').drawImage(raw, 0, 0, c.width, c.height);
    rawSmall = { src: raw, c };
  }
  const p = enhance(rawSmall.c, mode, adj), ec = $('#ec');
  ec.width = p.width; ec.height = p.height; ec.getContext('2d').drawImage(p, 0, 0);
  adjDirty = true;
}
const flush = () => { if (adjDirty) render(); };
$('#adjr').oninput = e => {
  adj = +e.target.value; $('#adjv').textContent = adj;
  cancelAnimationFrame(pvFrame); pvFrame = requestAnimationFrame(preview);
};
$('#adjr').onchange = () => { cancelAnimationFrame(pvFrame); render(); };
$('#adjreset').onclick = () => { adj = 50; render(); };
document.querySelectorAll('.modes button').forEach(b => b.onclick = () => { mode = b.dataset.m; adj = 50; render(); });
$('#back').onclick = () => { show('crop'); drawCrop(); };
function rot(dir) {
  flush();
  const r = document.createElement('canvas'); r.width = raw.height; r.height = raw.width;
  const c = r.getContext('2d'); c.translate(r.width / 2, r.height / 2); c.rotate(dir * Math.PI / 2);
  c.drawImage(raw, -raw.width / 2, -raw.height / 2);
  raw = r; render();
}
$('#rotl').onclick = () => rot(-1);
$('#rotr').onclick = () => rot(1);
$('#add').onclick = () => {
  flush();
  pages.push({ c: cur });
  if (curItem) { inbox = inbox.filter(i => i !== curItem); curItem = null; renderInbox(); }
  updateTray(); show(base);
  toast('Page added: ' + pages.length + (role === 'pc' ? '. Pick the next scan.' : '. Capture the next one.'));
};

/* ---------- Pages tray (may numero at pwedeng palit-palitan) ---------- */
let dragI = -1, shownPages = 0;
function movePage(i, j) {
  if (i === j || j < 0 || j >= pages.length || i < 0) return;
  const [p] = pages.splice(i, 1); pages.splice(j, 0, p);
  updateTray();
}
function thumbOf(p) {
  if (!p.t) {
    const c = document.createElement('canvas'); c.height = 200; c.width = Math.max(1, Math.round(200 * p.c.width / p.c.height));
    c.getContext('2d').drawImage(p.c, 0, 0, c.width, c.height);
    p.t = c;
  }
  return p.t;
}
function updateTray() {
  const t = $('#thumbs'); t.innerHTML = '';
  pages.forEach((p, i) => {
    const d = document.createElement('div'); d.className = 'th'; d.draggable = true;
    d.title = 'Page ' + (i + 1) + ' (drag to move)';
    const n = document.createElement('span'); n.className = 'num'; n.textContent = i + 1;
    const x = document.createElement('button'); x.textContent = '×'; x.setAttribute('aria-label', 'Remove page ' + (i + 1));
    x.onclick = () => { pages.splice(i, 1); updateTray(); };
    const mv = document.createElement('div'); mv.className = 'mvs';
    const a = document.createElement('button'); a.className = 'prev'; a.textContent = '◀'; a.disabled = i === 0;
    a.setAttribute('aria-label', 'Move page ' + (i + 1) + ' earlier'); a.onclick = () => movePage(i, i - 1);
    const b = document.createElement('button'); b.className = 'next'; b.textContent = '▶'; b.disabled = i === pages.length - 1;
    b.setAttribute('aria-label', 'Move page ' + (i + 1) + ' later'); b.onclick = () => movePage(i, i + 1);
    mv.append(a, b);
    d.ondragstart = e => { dragI = i; d.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(i)); } catch (err) {} };
    d.ondragend = () => { d.classList.remove('dragging'); document.querySelectorAll('.th.over').forEach(o => o.classList.remove('over')); };
    d.ondragover = e => { e.preventDefault(); d.classList.add('over'); };
    d.ondragleave = () => d.classList.remove('over');
    d.ondrop = e => { e.preventDefault(); movePage(dragI, i); dragI = -1; };
    d.append(thumbOf(p), n, x, mv); t.append(d);
  });
  const label = pages.length ? pages.length + ' page' + (pages.length > 1 ? 's' : '') : '';
  $('#count').textContent = label; $('#sidecount').textContent = label;
  $('#sideempty').hidden = pages.length > 0;
  if (pages.length > shownPages) {   // may bagong page: i-scroll papunta sa dulo
    const s = $('#side'); t.scrollLeft = t.scrollWidth; s.scrollTop = s.scrollHeight;
  }
  shownPages = pages.length;
  setExp();
}

/* ---------- Export ---------- */
function list() {
  const L = pages.slice();
  if (cur && !V.edit.hidden && !pages.some(p => p.c === cur)) L.push({ c: cur });
  return L;
}
function setExp() {
  const n = list().length;
  document.querySelectorAll('.exports button').forEach(b => b.disabled = !n);
}
const blobP = (c, t, q) => new Promise(r => c.toBlob(r, t, q));
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function toPDF() {
  if (!window.jspdf) return toast('PDF library not loaded yet. Internet is needed on first use.');
  const { jsPDF } = window.jspdf; let doc;
  list().forEach((p, i) => {
    const o = p.c.width > p.c.height ? 'l' : 'p';
    if (!i) doc = new jsPDF({ orientation: o, unit: 'mm', format: 'a4' }); else doc.addPage('a4', o);
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const r = Math.min(W / p.c.width, H / p.c.height), w = p.c.width * r, h = p.c.height * r;
    doc.addImage(p.c.toDataURL('image/jpeg', .92), 'JPEG', (W - w) / 2, (H - h) / 2, w, h);
  });
  doc.save('choi_scan.pdf');
}
async function toDocx() {
  if (!window.docx) return toast('Word library not loaded yet. Internet is needed on first use.');
  const { Document, Packer, Paragraph, ImageRun } = window.docx, kids = [];
  for (const p of list()) {
    const b = await blobP(p.c, 'image/jpeg', .92);
    let w = 600, h = Math.round(w * p.c.height / p.c.width);
    if (h > 900) { w = Math.round(w * 900 / h); h = 900; }
    kids.push(new Paragraph({ children: [new ImageRun({ data: await b.arrayBuffer(), transformation: { width: w, height: h } })] }));
  }
  download(await Packer.toBlob(new Document({ sections: [{ children: kids }] })), 'choi_scan.docx');
}
async function toImages(type, ext) {
  const L = list();
  for (let i = 0; i < L.length; i++) {
    download(await blobP(L[i].c, type, .92), 'choi_scan' + (L.length > 1 ? '_' + (i + 1) : '') + '.' + ext);
    await new Promise(r => setTimeout(r, 350));
  }
}
document.querySelectorAll('.exports button').forEach(b => b.onclick = async () => {
  flush();
  toast('Creating file...');
  try {
    const x = b.dataset.x;
    if (x === 'pdf') await toPDF();
    else if (x === 'docx') await toDocx();
    else if (x === 'png') await toImages('image/png', 'png');
    else await toImages('image/jpeg', 'jpg');
  } catch (e) { console.error(e); toast('Export error.'); }
});

/* ---------- Phone <-> PC link (WebRTC via PeerJS, walang sariling server) ---------- */
// Optional: kung may TURN credentials ka (hal. libreng account sa metered.ca), ilagay dito para mas tumibay sa mobile data.
const TURN = []; // [{ urls: 'turn:...', username: '...', credential: '...' }]
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }, ...TURN] };
let role = 'solo', base = 'cam', peer, conn, inbox = [], curItem = null, sent = 0, pcId = '';
const rid = () => 'scn-' + Math.random().toString(36).slice(2, 8);

function handleImage(src) {
  if (role === 'phone') return sendImage(src);
  curItem = null; setSource(src);
}

/* PC side */
function startPC(tries = 0) {
  if (typeof Peer === 'undefined') return toast('PeerJS failed to load. Internet is required.');
  role = 'pc'; base = 'pc'; show('pc');
  let id = null;
  try { id = localStorage.getItem('scn-pcid'); } catch (e) {}
  if (!id || tries > 2) id = rid();
  try { localStorage.setItem('scn-pcid', id); } catch (e) {}
  if (peer) peer.destroy();
  $('#pstatus').textContent = 'Connecting...';
  peer = new Peer(id, { config: ICE });
  peer.on('open', () => { drawQR(id); $('#pstatus').textContent = 'Waiting for phone...'; });
  peer.on('connection', c => {
    c.on('open', () => { $('#pstatus').textContent = 'Phone connected ✓'; });
    c.on('close', () => { $('#pstatus').textContent = 'Phone disconnected. Waiting...'; });
    c.on('data', d => onPhoneData(c, d));
  });
  peer.on('error', e => {
    if (e.type === 'unavailable-id') setTimeout(() => startPC(tries + 1), 2500);
    else toast('Connection error: ' + e.type);
  });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) {} });
}
function drawQR(id) {
  const url = location.origin + location.pathname + '?pc=' + id;
  $('#plink').textContent = url;
  const q = $('#qr'); q.innerHTML = '';
  if (typeof QRCode !== 'undefined') new QRCode(q, { text: url, width: 200, height: 200 });
  else q.textContent = 'QR failed to load. Use the link.';
}
async function addInbox(blob) {
  const bmp = await createImageBitmap(blob);
  inbox.push({ bmp, url: URL.createObjectURL(blob) });
  renderInbox();
}
async function onPhoneData(c, d) {
  if (!d || d.t !== 'img') return;
  try {
    await addInbox(new Blob([d.buf], { type: 'image/jpeg' }));
    c.send({ t: 'ok' }); toast('New scan from phone');
  } catch (e) { c.send({ t: 'err' }); }
}
function renderInbox() {
  const box = $('#inbox'); box.innerHTML = '';
  inbox.forEach(it => {
    const d = document.createElement('div'); d.className = 'th big';
    const im = document.createElement('img'); im.src = it.url; im.alt = 'Scan to edit';
    im.onclick = () => { curItem = it; setSource(it.bmp); };
    const x = document.createElement('button'); x.textContent = '×'; x.setAttribute('aria-label', 'Remove scan');
    x.onclick = () => { inbox = inbox.filter(i => i !== it); renderInbox(); };
    d.append(im, x); box.append(d);
  });
  $('#pempty').hidden = inbox.length > 0;
}
$('#pfile').onchange = async e => {
  for (const f of e.target.files) { try { await addInbox(f); } catch (err) { toast('Could not read a file.'); } }
  e.target.value = '';
};
$('#pback').onclick = () => { if (peer) { peer.destroy(); peer = null; } role = 'solo'; base = 'cam'; show('home'); };

/* Phone side */
function setPstat(t, retry) { $('#pstat').textContent = t; $('#preconn').hidden = !retry; $('#pwifi').hidden = !retry; }
function startPhone(id) {
  role = 'phone'; base = 'cam'; pcId = id;
  document.body.classList.add('phone');
  $('#pstat').hidden = false; show('cam'); connectPhone();
}
let connSeq = 0, connTimer = 0;
async function connectPhone() {
  const my = ++connSeq; clearTimeout(connTimer);
  if (typeof Peer === 'undefined') return setPstat('PeerJS failed to load. Internet is required.', true);
  if (peer) peer.destroy();
  setPstat('Connecting to PC...');
  // Camera permission first: it lets the browser use the real local address, which helps same-Wi-Fi links.
  try { await Promise.race([ensureStream().catch(() => {}), new Promise(r => setTimeout(r, 4000))]); } catch (e) {}
  if (my !== connSeq) return;
  const fail = t => { if (my === connSeq) setPstat(t, true); };
  const giveUp = () => fail("Can't reach the PC. Make sure PC mode is open on the computer, then tap Reconnect. Same Wi-Fi works best.");
  connTimer = setTimeout(() => { if (!conn || !conn.open) giveUp(); }, 20000);
  peer = new Peer({ config: ICE });
  peer.on('open', () => {
    if (my !== connSeq) return;
    setPstat('Contacting PC...');
    conn = peer.connect(pcId, { reliable: true });
    conn.on('open', () => { clearTimeout(connTimer); setPstat('Connected to PC ✓  Sent: ' + sent); });
    conn.on('close', () => fail('Disconnected from PC.'));
    conn.on('error', e => fail('Connection error: ' + (e && e.type || e)));
    conn.on('data', d => {
      if (d && d.t === 'ok') { sent++; setPstat('Connected to PC ✓  Sent: ' + sent); toast('Sent to PC ✓'); }
      else if (d && d.t === 'err') toast('PC did not receive it. Try again.');
    });
  });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) {} });
  peer.on('error', e => { clearTimeout(connTimer); fail(e.type === 'peer-unavailable'
    ? 'Could not find the PC. Make sure PC mode is open on the computer.' : 'Connection error: ' + e.type); });
}
$('#preconn').onclick = connectPhone;
async function sendImage(src) {
  if (!conn || !conn.open) return toast('Not connected to the PC yet.');
  const k = Math.min(1, 3000 / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  toast('Sending...');
  const blob = await blobP(c, 'image/jpeg', .92);
  conn.send({ t: 'img', buf: await blob.arrayBuffer() });
}

/* ---------- QR scanner (jsQR) ---------- */
let qrRun = false, qrText = '';
const qcv = document.createElement('canvas'), qcx = qcv.getContext('2d', { willReadFrequently: true });
function setQR(t) { $('#qmsg').textContent = t; $('#qres').hidden = true; }
async function startQR() {
  setQR('Point the camera at the QR code.');
  try { await ensureStream(); }
  catch (e) { return setQR(camMsg(e) + ' Use "From photo".'); }
  if (V.qrs.hidden) { if (V.cam.hidden) stopCam(); return; }
  const q = $('#qv'); q.srcObject = stream; q.play().catch(() => {});
  if (!qrRun) { qrRun = true; qrLoop(); }
}
function qrLoop() {
  if (!qrRun || V.qrs.hidden) { qrRun = false; return; }
  const v = $('#qv');
  if (v.videoWidth && typeof jsQR !== 'undefined') {
    const k = Math.min(1, 640 / v.videoWidth);
    qcv.width = Math.round(v.videoWidth * k); qcv.height = Math.round(v.videoHeight * k);
    qcx.drawImage(v, 0, 0, qcv.width, qcv.height);
    const r = jsQR(qcx.getImageData(0, 0, qcv.width, qcv.height).data, qcv.width, qcv.height);
    if (r && r.data) { qrRun = false; return onQR(r.data); }
  }
  requestAnimationFrame(qrLoop);
}
function onQR(t) {
  let u = null; try { u = new URL(t); } catch (e) {}
  const id = u && (u.origin + u.pathname === location.origin + location.pathname) ? u.searchParams.get('pc') : null;
  if (id) { toast('PC link found. Connecting...'); return startPhone(id); }
  qrText = t; $('#qtext').textContent = t; $('#qres').hidden = false; $('#qmsg').textContent = 'QR code found:';
  const web = u && /^https?:$/.test(u.protocol);
  $('#qopen').hidden = !web; if (web) $('#qopen').href = u.href;
}
$('#goQR').onclick = () => show('qrs');
$('#qback').onclick = () => show('home');
$('#qagain').onclick = () => { if (stream) { setQR('Point the camera at the QR code.'); qrRun = true; qrLoop(); } else startQR(); };
$('#qcopy').onclick = () => navigator.clipboard.writeText(qrText).then(() => toast('Copied.')).catch(() => toast('Could not copy. Select the text instead.'));
$('#qfile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const b = await createImageBitmap(f), k = Math.min(1, 1200 / Math.max(b.width, b.height));
    qcv.width = Math.round(b.width * k); qcv.height = Math.round(b.height * k);
    qcx.drawImage(b, 0, 0, qcv.width, qcv.height);
    const r = typeof jsQR !== 'undefined' && jsQR(qcx.getImageData(0, 0, qcv.width, qcv.height).data, qcv.width, qcv.height);
    r && r.data ? onQR(r.data) : toast('No QR code found in the image.');
  } catch (err) { toast('Could not read the photo.'); }
};

/* Home */
$('#pcam').onclick = () => { role = 'pc'; base = 'pc'; show('cam'); };
$('#cback').onclick = () => show(base === 'pc' ? 'pc' : 'home');
$('#goSolo').onclick = () => { role = 'solo'; base = 'cam'; show('cam'); };
$('#goPC').onclick = () => startPC();
function init() {
  const id = new URLSearchParams(location.search).get('pc');
  if (id) startPhone(id); else show('home');
}

/* ---------- Start ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
init();
