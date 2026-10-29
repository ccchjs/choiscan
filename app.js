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
const liveStream = () => !!stream && stream.getVideoTracks().some(t => t.readyState === 'live');
function ensureStream() {
  if (stream && !liveStream()) { try { stream.getTracks().forEach(t => t.stop()); } catch (e) {} stream = null; }   // camera was cut off (phone locked, other app): open a fresh one
  if (stream) return Promise.resolve(stream);
  if (!camBusy) camBusy = openCamera().then(s => {
    stream = s; s.getVideoTracks().forEach(t => t.addEventListener('ended', () => { if (stream === s) stream = null; }));
    return s;
  }).finally(() => { camBusy = null; });
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


/* ---------- Auto edge detection: finds the paper and places the 4 corners ---------- */
function boxBlur(a, w, h, r) {
  const t = new Float32Array(a.length), o = new Float32Array(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += a[y * w + xx]; n++; } } t[y * w + x] = s / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += t[yy * w + x]; n++; } } o[y * w + x] = s / n;
  }
  return o;
}
function hullOf(P) {
  P.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop(); return lo.concat(up);
}
const polyArea = P => Math.abs(P.reduce((s, p, i) => { const q = P[(i + 1) % P.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
function autoCorners(src) {
  const k = Math.min(1, 360 / Math.max(src.width, src.height));
  const w = Math.max(16, Math.round(src.width * k)), h = Math.max(16, Math.round(src.height * k)), N = w * h;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.drawImage(src, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  let g = new Float32Array(N);
  for (let i = 0; i < N; i++) g[i] = .299 * d[i * 4] + .587 * d[i * 4 + 1] + .114 * d[i * 4 + 2];
  g = boxBlur(boxBlur(g, w, h, 2), w, h, 2);
  // Otsu threshold: separates the paper from the table
  const hist = new Float64Array(256); for (let i = 0; i < N; i++) hist[Math.min(255, g[i] | 0)]++;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let wb = 0, sb = 0, bv = -1, thr = 128;
  for (let t = 0; t < 256; t++) {
    wb += hist[t]; if (!wb) continue; const wf = N - wb; if (!wf) break; sb += t * hist[t];
    const mb = sb / wb, mf = (sum - sb) / wf, v = wb * wf * (mb - mf) * (mb - mf); if (v > bv) { bv = v; thr = t; }
  }
  let best = null;
  for (const bright of [true, false]) {
    const m = new Uint8Array(N); for (let i = 0; i < N; i++) m[i] = (g[i] > thr) === bright ? 1 : 0;
    // largest connected blob
    const seen = new Uint8Array(N), st = new Int32Array(N); let bs = -1, ba = 0;
    for (let i = 0; i < N; i++) {
      if (!m[i] || seen[i]) continue;
      let sp = 0, a = 0; st[sp++] = i; seen[i] = 1;
      while (sp) { const p = st[--sp]; a++; const px = p % w, py = (p / w) | 0;
        if (px > 0 && m[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; st[sp++] = p - 1; }
        if (px < w - 1 && m[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; st[sp++] = p + 1; }
        if (py > 0 && m[p - w] && !seen[p - w]) { seen[p - w] = 1; st[sp++] = p - w; }
        if (py < h - 1 && m[p + w] && !seen[p + w]) { seen[p + w] = 1; st[sp++] = p + w; } }
      if (a > ba) { ba = a; bs = i; }
    }
    if (bs < 0 || ba < N * .06) continue;
    // collect that blob's outline points
    const mark = new Uint8Array(N), B = []; let sp = 0; st[sp++] = bs; mark[bs] = 1;
    while (sp) { const p = st[--sp], px = p % w, py = (p / w) | 0; let edge = false;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = px + dx, ny = py + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) { edge = true; continue; }
        const q = ny * w + nx; if (!m[q]) edge = true; else if (!mark[q]) { mark[q] = 1; st[sp++] = q; } }
      if (edge) B.push([px, py]); }
    let H = hullOf(B); if (H.length < 4) continue;
    const ha = polyArea(H), fa = ha / N, sol = ba / ha;
    if (fa < .08 || fa > .985 || sol < .7) continue;
    // shrink the outline to its 4 corners (drop the least important point each time)
    let Q = H.slice();
    while (Q.length > 4) {
      let bi = 0, bm = 1e18;
      for (let i = 0; i < Q.length; i++) { const a = Q[(i + Q.length - 1) % Q.length], b = Q[i], c2 = Q[(i + 1) % Q.length];
        const ar = Math.abs((b[0] - a[0]) * (c2[1] - a[1]) - (c2[0] - a[0]) * (b[1] - a[1])); if (ar < bm) { bm = ar; bi = i; } }
      Q.splice(bi, 1);
    }
    if (polyArea(Q) / ha < .85) continue;
    const dSeg = (p, a, b) => { const vx = b[0] - a[0], vy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy || 1))); return Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy); };
    const Bo = B.filter(p => { let m2 = 1e9; for (let i = 0; i < H.length; i++) { const dd = dSeg(p, H[i], H[(i + 1) % H.length]); if (dd < m2) m2 = dd; } return m2 <= 2.5; });   // outer edge only (ignore text inside)
    if (!best || sol > best.sol) best = { Q, sol, B: Bo };
  }
  if (!best) return null;
  // refine: fit a straight line to each paper edge, then use where the lines cross as the corners
  {
    const Qs = best.Q, diag = Math.hypot(w, h), lines = [];
    for (let i = 0; i < 4; i++) {
      const a = Qs[i], b = Qs[(i + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
      let pts_ = best.B.filter(p => { const t = ((p[0] - a[0]) * ux + (p[1] - a[1]) * uy) / L, dd = Math.abs(-(p[0] - a[0]) * uy + (p[1] - a[1]) * ux); return t > .12 && t < .88 && dd < diag * .03; });
      let ln = null;
      for (let it = 0; it < 2 && pts_.length > 8; it++) {
        const mx = pts_.reduce((s2, p) => s2 + p[0], 0) / pts_.length, my = pts_.reduce((s2, p) => s2 + p[1], 0) / pts_.length;
        let sxx = 0, syy = 0, sxy = 0; pts_.forEach(p => { sxx += (p[0] - mx) ** 2; syy += (p[1] - my) ** 2; sxy += (p[0] - mx) * (p[1] - my); });
        const an = .5 * Math.atan2(2 * sxy, sxx - syy); ln = [mx, my, Math.cos(an), Math.sin(an)];
        if (it === 0) pts_ = pts_.filter(p => Math.abs(-(p[0] - mx) * ln[3] + (p[1] - my) * ln[2]) < Math.max(2, diag * .008));
      }
      lines.push(ln);
    }
    if (lines.every(Boolean)) {
      const nq = [];
      for (let i = 0; i < 4; i++) {
        const A = lines[(i + 3) % 4], Bq = lines[i], den = A[2] * Bq[3] - A[3] * Bq[2];
        if (Math.abs(den) < 1e-3) break;
        const t = ((Bq[0] - A[0]) * Bq[3] - (Bq[1] - A[1]) * Bq[2]) / den, X = A[0] + t * A[2], Y = A[1] + t * A[3];
        if (X < -w * .03 || X > w * 1.03 || Y < -h * .03 || Y > h * 1.03 || Math.hypot(X - Qs[i][0], Y - Qs[i][1]) > diag * .08) break;
        nq.push([X, Y]);
      }
      if (nq.length === 4) best.Q = nq;
    }
  }
  const cx0 = best.Q.reduce((s, p) => s + p[0], 0) / 4, cy0 = best.Q.reduce((s, p) => s + p[1], 0) / 4;
  let Q = best.Q.map(p => [cx0 + (p[0] - cx0) * 1.012 + .5, cy0 + (p[1] - cy0) * 1.012 + .5]);   // tiny margin so edges are not cut
  Q.sort((a, b) => Math.atan2(a[1] - cy0, a[0] - cx0) - Math.atan2(b[1] - cy0, b[0] - cx0));
  let s0 = 0; Q.forEach((p, i) => { if (p[0] + p[1] < Q[s0][0] + Q[s0][1]) s0 = i; });
  Q = Q.slice(s0).concat(Q.slice(0, s0));
  return Q.map(p => [Math.min(1, Math.max(0, p[0] / w)), Math.min(1, Math.max(0, p[1] / h))]);
}
const DEF_PTS = () => [[.1, .1], [.9, .1], [.9, .9], [.1, .9]];

function setSource(bmp) {
  const k = Math.min(1, 3000 / Math.max(bmp.width, bmp.height));
  img = document.createElement('canvas');
  img.width = Math.round(bmp.width * k); img.height = Math.round(bmp.height * k);
  img.getContext('2d').drawImage(bmp, 0, 0, img.width, img.height);
  let a = null; try { a = autoCorners(img); } catch (e) {}
  pts = a || DEF_PTS();
  $('#crophint').textContent = a ? 'Edges found automatically. Drag the corners if needed, then tap Crop.' : 'Drag the four corners to the edges of the paper.';
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
$('#auto').onclick = () => {
  let a = null; try { a = autoCorners(img); } catch (e) {}
  pts = a || DEF_PTS(); drawCrop();
  toast(a ? 'Edges found. Drag the corners if needed.' : "Couldn't find the paper edges. Drag the corners by hand.");
};
// Close the editor and go back (stays connected to the phone; the scan stays in the list)
function closeEditor() { curItem = null; show(base === 'pc' ? 'pc' : base); }
$('#xcrop').onclick = $('#xedit').onclick = closeEditor;
addEventListener('keydown', e => { if (e.key === 'Escape' && (!V.crop.hidden || !V.edit.hidden)) closeEditor(); });
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
  if (typeof QRCode !== 'undefined') new QRCode(q, { text: url, width: 280, height: 280, correctLevel: QRCode.CorrectLevel.L });
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
let qrRun = false, qrText = '', qrGen = 0, qrTick = 0, qrLast = 0, qrDet = null;
const qcv = document.createElement('canvas'), qcx = qcv.getContext('2d', { willReadFrequently: true });
function setQR(t) { $('#qmsg').textContent = t; $('#qres').hidden = true; }
function qrFail(msg) { $('#qerr').textContent = msg + ' Tap "Open camera", or use "From photo".'; $('#qfix').hidden = false; }
async function startQR() {
  const my = ++qrGen; qrRun = false; $('#qfix').hidden = true;
  setQR('Point the camera at the QR code. Fill the frame with it and hold steady.');
  try { await ensureStream(); }
  catch (e) { if (my === qrGen) qrFail(camMsg(e)); return; }
  if (my !== qrGen) return;
  if (V.qrs.hidden) { if (V.cam.hidden) stopCam(); return; }
  const q = $('#qv'); q.muted = true; q.srcObject = stream;
  try { await q.play(); } catch (e) {}
  if (my !== qrGen) return;
  qrRun = true; qrLoop(my);
  setTimeout(() => { if (my === qrGen && qrRun && !V.qrs.hidden && (!q.videoWidth || q.paused)) qrFail('The camera did not start.'); }, 3000);
}
async function scanFrame(v, n) {
  // 1) the phone's own QR reader, when the browser has one (fast and accurate)
  if (qrDet === null) { try { qrDet = 'BarcodeDetector' in window ? new BarcodeDetector({ formats: ['qr_code'] }) : false; } catch (e) { qrDet = false; } }
  if (qrDet) { try { const r = await qrDet.detect(v); if (r && r[0] && r[0].rawValue) return r[0].rawValue; } catch (e) { qrDet = false; } }
  if (typeof jsQR === 'undefined') return null;
  // 2) jsQR: alternate between the whole frame and a zoomed-in center, so small QR codes on a screen are found too
  const vw = v.videoWidth, vh = v.videoHeight, zoom = n % 2 ? 1 : 2;
  const sw = vw / zoom, sh = vh / zoom, sx = (vw - sw) / 2, sy = (vh - sh) / 2, k = Math.min(1, 1000 / sw);
  qcv.width = Math.round(sw * k); qcv.height = Math.round(sh * k);
  qcx.drawImage(v, sx, sy, sw, sh, 0, 0, qcv.width, qcv.height);
  const r = jsQR(qcx.getImageData(0, 0, qcv.width, qcv.height).data, qcv.width, qcv.height, { inversionAttempts: n % 6 === 0 ? 'attemptBoth' : 'dontInvert' });
  return r && r.data ? r.data : null;
}
async function qrLoop(my) {
  if (my !== qrGen || !qrRun || V.qrs.hidden) { if (my === qrGen) qrRun = false; return; }
  const v = $('#qv'), now = performance.now();
  if (v.videoWidth && now - qrLast > 110) {
    qrLast = now; qrTick++;
    let found = null; try { found = await scanFrame(v, qrTick); } catch (e) {}
    if (my !== qrGen) return;
    if (found) { qrRun = false; return onQR(found); }
  }
  requestAnimationFrame(() => qrLoop(my));
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
$('#qagain').onclick = () => startQR();
$('#qopencam').onclick = () => { stopCam(); startQR(); };   // button press = allowed to ask for the camera again
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
