// Skylark: Deadline Run — an original offline WebGL2 flight game.
'use strict';
(function () {
const $ = id => document.getElementById(id);
const cv = $('gl'), hud = $('hud'), hx = hud.getContext('2d');
const ov = $('ov'), ovc = $('ovc');
const gl = cv.getContext('webgl2', { antialias: true, powerPreference: 'high-performance' });
if (!gl) { ovc.innerHTML = '<h1>SKYLARK</h1><p>This game needs WebGL2. Please open it in a current desktop Chrome.</p>'; return; }

// ---------------------------------------------------------------- math
const DEG = 180 / Math.PI, RAD = Math.PI / 180;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};
const mixc = (a, b, t) => V.lerp(a, b, clamp(t, 0, 1));
function persp(fov, asp, n, f) { const t = 1 / Math.tan(fov / 2), m = new Float32Array(16); m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = 2 * f * n / (n - f); return m; }
function lookAt(e, c, up) {
  const z = V.norm(V.sub(e, c)), x = V.norm(V.cross(up, z)), y = V.cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -V.dot(x, e), -V.dot(y, e), -V.dot(z, e), 1]);
}
function mmul(a, b) { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; }
const basisM = (r, u, f, p) => new Float32Array([r[0], r[1], r[2], 0, u[0], u[1], u[2], 0, f[0], f[1], f[2], 0, p[0], p[1], p[2], 1]);
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- noise & terrain
function hash(i, j) { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function vn(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, o) { let s = 0, a = 0.5, f = 1, t = 0; for (let k = 0; k < o; k++) { s += a * vn(x * f + k * 17.3, z * f - k * 9.1); t += a; a *= 0.5; f *= 2.03; } return s / t; }
function ridged(x, z, o) { let s = 0, a = 0.5, f = 1, t = 0; for (let k = 0; k < o; k++) { const n = 1 - Math.abs(2 * vn(x * f + k * 5.7, z * f + k * 3.3) - 1); s += a * n * n; t += a; a *= 0.5; f *= 2.1; } return s / t; }

const RW = { hx: 25, hz: 700, y: 24 };   // runway half-width, half-length, elevation (m)
const GEAR = 1.85;
function rawH(x, z) {
  const r = Math.hypot(x * 0.9, z) + (fbm(x * 0.0006, z * 0.0006, 3) - 0.5) * 1800;
  const mask = 1 - ss(2600, 4700, r);
  const n = fbm(x * 0.0007 + 3.1, z * 0.0007 + 7.7, 5);
  const mm = ss(0.42, 0.68, fbm(x * 0.00025 + 11, z * 0.00025 - 4, 3));
  const rg = ridged(x * 0.0009, z * 0.0009, 5);
  const h = mask * (40 + (n - 0.45) * 420 + Math.pow(rg, 2.2) * 1100 * mm) - (1 - mask) * 90;
  const dx = Math.max(0, Math.abs(x) - RW.hx - 30), dz = Math.max(0, Math.abs(z) - RW.hz - 60);
  const t = ss(0, 500, Math.hypot(dx, dz));
  return RW.y + (h - RW.y) * t;
}
const N = 320, CELL = 40, HALF = N * CELL / 2, NV = N + 1;
const HG = new Float32Array(NV * NV);
for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) HG[j * NV + i] = rawH(-HALF + i * CELL, -HALF + j * CELL);
function groundH(x, z) {
  const gx = (x + HALF) / CELL, gz = (z + HALF) / CELL;
  if (gx < 0 || gz < 0 || gx >= N || gz >= N) return -90;
  const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j, k = j * NV + i;
  const a = HG[k], b = HG[k + 1], c = HG[k + NV], d = HG[k + NV + 1];
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
function normalAt(x, z) { const e = CELL; return V.norm([groundH(x - e, z) - groundH(x + e, z), 2 * e, groundH(x, z - e) - groundH(x, z + e)]); }
function tcol(h, ny, x, z) {
  const v = vn(x * 0.004, z * 0.004), w = vn(x * 0.02 + 5, z * 0.02 + 9);
  if (h < 0) return mixc([0.62, 0.58, 0.42], [0.2, 0.3, 0.32], -h / 30);
  let c = mixc([0.2, 0.37, 0.12], [0.37, 0.5, 0.17], v * 0.7 + w * 0.3);
  c = mixc(c, [0.5, 0.46, 0.3], ss(170, 380, h) * 0.85 + (w - 0.5) * 0.2);
  c = mixc([0.8, 0.74, 0.54], c, ss(2, 9, h));
  c = mixc(c, mixc([0.37, 0.34, 0.31], [0.53, 0.49, 0.45], w), ss(0.9, 0.72, ny));
  c = mixc(c, [0.94, 0.95, 0.98], ss(520, 650, h + (w - 0.5) * 90) * ss(0.55, 0.78, ny));
  return c;
}

// ---------------------------------------------------------------- GL helpers
function upload(p, n, c, idx) {
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  [[p, 0], [n, 1], [c, 2]].forEach(([d, loc]) => {
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, d instanceof Float32Array ? d : new Float32Array(d), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
  });
  const big = p.length / 3 > 65535, ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, big ? new Uint32Array(idx) : new Uint16Array(idx), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: idx.length, type: big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
}
class MB {
  constructor() { this.p = []; this.n = []; this.c = []; this.i = []; }
  vert(p, n, c) { this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.c.push(c[0], c[1], c[2]); return this.p.length / 3 - 1; }
  quad(a, b, c, d, n, col) { const k = this.vert(a, n, col); this.vert(b, n, col); this.vert(c, n, col); this.vert(d, n, col); this.i.push(k, k + 1, k + 2, k, k + 2, k + 3); }
  tri(a, b, c, col, ctr) { let n = V.norm(V.cross(V.sub(b, a), V.sub(c, a))); if (ctr && V.dot(n, V.sub(a, ctr)) < 0) n = V.mul(n, -1); const k = this.vert(a, n, col); this.vert(b, n, col); this.vert(c, n, col); this.i.push(k, k + 1, k + 2); }
  hex(C, col) {
    const ctr = V.mul(C.reduce((s, p) => V.add(s, p), [0, 0, 0]), 1 / 8);
    for (const f of [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]) {
      const a = C[f[0]], b = C[f[1]], c = C[f[2]], d = C[f[3]];
      let n = V.cross(V.sub(b, a), V.sub(d, a)); if (V.len(n) < 1e-9) n = V.cross(V.sub(c, b), V.sub(a, b));
      n = V.norm(n); const fc = V.mul(V.add(V.add(a, b), V.add(c, d)), 0.25);
      if (V.dot(n, V.sub(fc, ctr)) < 0) n = V.mul(n, -1);
      this.quad(a, b, c, d, n, col);
    }
  }
  box(cx, cy, cz, sx, sy, sz, col) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    this.hex([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], col);
  }
  sect(z0, w0, h0, y0, z1, w1, h1, y1, col) {
    this.hex([[-w0, y0 - h0, z0], [w0, y0 - h0, z0], [w0, y0 + h0, z0], [-w0, y0 + h0, z0], [-w1, y1 - h1, z1], [w1, y1 - h1, z1], [w1, y1 + h1, z1], [-w1, y1 + h1, z1]], col);
  }
  sphere(c, r, sy, col, la = 6, lo = 10) {
    const base = this.p.length / 3;
    for (let i = 0; i <= la; i++) { const th = i / la * Math.PI; for (let j = 0; j <= lo; j++) { const ph = j / lo * Math.PI * 2; const n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]; this.vert([c[0] + n[0] * r, c[1] + n[1] * r * sy, c[2] + n[2] * r], n, col); } }
    for (let i = 0; i < la; i++) for (let j = 0; j < lo; j++) { const a = base + i * (lo + 1) + j, b = a + lo + 1; this.i.push(a, b, a + 1, a + 1, b, b + 1); }
  }
  disc(r, seg, col, plane) {
    const c = this.vert([0, 0, 0], plane === 'xy' ? [0, 0, 1] : [0, 1, 0], col);
    for (let k = 0; k <= seg; k++) { const a = k / seg * Math.PI * 2, x = Math.cos(a) * r, y = Math.sin(a) * r; this.vert(plane === 'xy' ? [x, y, 0] : [x, 0, y], plane === 'xy' ? [0, 0, 1] : [0, 1, 0], col); if (k) this.i.push(c, c + k, c + k + 1); }
  }
  build() { return upload(this.p, this.n, this.c, this.i); }
}
function prog(vs, fs) {
  const p = gl.createProgram();
  for (const [t, s] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    gl.attachShader(p, sh);
  }
  gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
const unis = (p, names) => { const u = {}; names.forEach(n => u[n] = gl.getUniformLocation(p, n)); return u; };

const mainP = prog(`#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec3 aCol;
uniform mat4 uVP; uniform mat4 uM;
out vec3 vCol; out vec3 vNor; out vec3 vWP;
void main(){ vec4 w=uM*vec4(aPos,1.0); vWP=w.xyz; vNor=mat3(uM)*aNor; vCol=aCol; gl_Position=uVP*w; }`,
`#version 300 es
precision highp float;
in vec3 vCol; in vec3 vNor; in vec3 vWP;
uniform vec3 uSun; uniform vec3 uCam; uniform vec3 uFog; uniform vec3 uTint; uniform vec3 uSunC; uniform vec3 uAmbS; uniform vec3 uAmbG;
uniform float uFogD; uniform float uEmis; uniform float uAlpha; uniform float uWater; uniform float uTime; uniform float uSpec; uniform float uDetail;
uniform vec3 uLLP; uniform vec3 uLLD; uniform float uLL; uniform float uFlash;
out vec4 o;
float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float vno(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1.0,0.0)),u.x),mix(h21(i+vec2(0.0,1.0)),h21(i+vec2(1.0,1.0)),u.x),u.y); }
void main(){
  vec3 n=normalize(vNor); vec3 base=vCol*uTint; vec3 v=normalize(uCam-vWP); float dist=length(uCam-vWP); vec3 c;
  if(uWater>0.5){
    vec2 p=vWP.xz; float t=uTime; vec3 wn=vec3(0.0,1.0,0.0);
    wn.x=0.06*sin(p.x*0.045+t*1.1)+0.04*sin(p.x*0.11-p.y*0.07+t*1.7)+0.025*sin(p.x*0.31+p.y*0.23+t*2.3);
    wn.z=0.06*sin(p.y*0.05+t*0.9)+0.04*sin(p.y*0.13+p.x*0.05+t*1.5)+0.025*sin(p.y*0.29-p.x*0.21+t*2.7);
    n=normalize(wn);
    float fr=pow(1.0-max(dot(v,n),0.0),4.0); float d=max(dot(n,uSun),0.0);
    c=mix(vec3(0.03,0.16,0.27)*(uAmbS+uSunC*0.6*d),uFog,0.12+0.75*fr);
    vec3 h=normalize(v+uSun); c+=uSunC*pow(max(dot(n,h),0.0),300.0)*2.5; c+=vec3(0.45,0.5,0.6)*uFlash*0.6;
  } else {
    if(uDetail>0.5){ float dn=0.5*vno(vWP.xz*0.35)+0.3*vno(vWP.xz*0.09)+0.2*vno(vWP.xz*0.02); base*=mix(1.0,0.78+0.44*dn,exp(-dist/1100.0)); }
    float d=max(dot(n,uSun),0.0);
    vec3 amb=mix(uAmbG,uAmbS,n.y*0.5+0.5);
    c=base*(amb+uSunC*d);
    vec3 h=normalize(v+uSun); float nh=max(dot(n,h),0.0);
    float sp=uSpec>0.5?pow(nh,90.0)*uSpec:pow(nh,32.0)*uSpec;
    c+=uSunC*sp*d;
    if(uSpec>0.5){ float fr=pow(1.0-max(dot(n,v),0.0),3.0); c+=uAmbS*fr*0.7; }
    if(uLL>0.0){ vec3 dl=vWP-uLLP; float dd=max(length(dl),0.01); vec3 ld=dl/dd; float cone=smoothstep(0.955,0.992,dot(ld,uLLD));
      float att=uLL*cone*clamp(1.0-dd/950.0,0.0,1.0)/(1.0+dd*dd/60000.0); c+=base*vec3(1.0,0.95,0.84)*att*max(dot(n,-ld),0.0)*2.6; }
    c+=base*uFlash*0.9;
    c=mix(c,base,uEmis);
  }
  float f=1.0-exp(-pow(dist/uFogD,1.5)); if(uEmis>0.95) f*=0.55;
  o=vec4(mix(c,uFog,clamp(f,0.0,1.0)),uAlpha);
}`);
const U = unis(mainP, ['uVP', 'uM', 'uSun', 'uCam', 'uFog', 'uTint', 'uFogD', 'uEmis', 'uAlpha', 'uWater', 'uTime', 'uSunC', 'uAmbS', 'uAmbG', 'uSpec', 'uDetail', 'uLLP', 'uLLD', 'uLL', 'uFlash']);
const skyP = prog(`#version 300 es
layout(location=0) in vec3 aPos; out vec2 vN;
void main(){ vN=aPos.xy; gl_Position=vec4(aPos.xy,0.9999,1.0); }`,
`#version 300 es
precision highp float; in vec2 vN; uniform vec3 uR; uniform vec3 uU; uniform vec3 uF; uniform vec3 uSun; uniform vec2 uT;
uniform vec3 uHor; uniform vec3 uZen; uniform vec3 uSunC; uniform float uStars; uniform float uFlash; out vec4 o;
float h13(vec3 p3){ p3=fract(p3*0.1031); p3+=dot(p3,p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }
void main(){
  vec3 d=normalize(uF+vN.x*uT.x*uR+vN.y*uT.y*uU); float h=d.y;
  vec3 c=mix(uHor,uZen,pow(clamp(h,0.0,1.0),0.55));
  if(h<0.0) c=mix(uHor,uHor*0.7,clamp(-h*3.0,0.0,1.0));
  float s=max(dot(d,uSun),0.0); c+=uSunC*(pow(s,700.0)*4.0+pow(s,14.0)*0.25+pow(s,5.0)*0.35*(1.0-uSun.y));
  if(uStars>0.0 && h>0.0){ vec3 q=d*600.0; vec3 ce=floor(q); float hh=h13(ce);
    if(hh>0.9975){ float sd=length(fract(q)-0.5); c+=vec3(0.9,0.93,1.0)*smoothstep(0.5,0.1,sd)*uStars*(0.45+0.55*(hh-0.9975)/0.0025)*clamp(h*4.0,0.0,1.0); } }
  c+=vec3(0.7,0.74,0.88)*uFlash;
  o=vec4(c,1.0);
}`);
const SU = unis(skyP, ['uR', 'uU', 'uF', 'uSun', 'uT', 'uHor', 'uZen', 'uSunC', 'uStars', 'uFlash']);
const skyVAO = gl.createVertexArray(); gl.bindVertexArray(skyVAO);
{ const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0); }
gl.bindVertexArray(null);

const SUN = V.norm([-0.45, 0.55, 0.62]);
const TOD = [
  { name: 'DAY', sun: SUN, sunC: [1.05, 0.97, 0.85], ambS: [0.42, 0.5, 0.62], ambG: [0.27, 0.25, 0.23], fog: [0.74, 0.84, 0.95], zen: [0.15, 0.35, 0.72], cloud: [1, 1, 1], fogD: 7200, vig: '0,0,0', vigA: 0.32, flare: true },
  { name: 'GOLDEN HOUR', sun: V.norm([-0.55, 0.13, 0.83]), sunC: [1.45, 0.82, 0.45], ambS: [0.36, 0.36, 0.52], ambG: [0.26, 0.19, 0.17], fog: [0.97, 0.67, 0.47], zen: [0.17, 0.22, 0.47], cloud: [1.05, 0.78, 0.66], fogD: 6200, vig: '30,10,24', vigA: 0.45, flare: true },
  { name: 'NIGHT', sun: V.norm([0.3, 0.42, 0.86]), sunC: [0.2, 0.25, 0.38], ambS: [0.07, 0.09, 0.16], ambG: [0.035, 0.035, 0.045], fog: [0.035, 0.05, 0.09], zen: [0.005, 0.01, 0.035], cloud: [0.2, 0.22, 0.3], fogD: 6500, vig: '0,0,8', vigA: 0.5, flare: false, night: 1 },
];
const WX = [
  { name: 'CLEAR', gray: 0, sun: 1, amb: 1, fogD: 1, cloudK: 1, wind: 3.5, rain: 0, turb: 0.35 },
  { name: 'RAIN', gray: 0.65, sun: 0.45, amb: 0.85, fogD: 0.5, cloudK: 0.7, wind: 8, rain: 1, turb: 0.8 },
  { name: 'STORM', gray: 0.9, sun: 0.18, amb: 0.5, fogD: 0.32, cloudK: 0.45, wind: 13, rain: 2, turb: 1.4 },
];
let wxI = 0; try { wxI = (+localStorage.getItem('skylark_wx') || 0) % 3; } catch (e) { }
function setWX(i) { wxI = i; try { localStorage.setItem('skylark_wx', String(i)); } catch (e) { } const b = $('wxb'); if (b) b.textContent = 'WEATHER: ' + WX[i].name; }
const WIND_DIR = 75 * RAD; let windV = [0, 0, 0], windSpd = 0, windFrom = 0;
function windAt(t) {
  const W0 = WX[wxI], g = 1 + 0.3 * Math.sin(t * 0.53) + 0.2 * Math.sin(t * 1.37 + 2) + (W0.rain > 1 ? 0.25 * Math.sin(t * 2.9) : 0);
  windSpd = Math.max(0, W0.wind * D.wind * g); const a = WIND_DIR + 0.25 * Math.sin(t * 0.11);
  windV = [Math.sin(a) * windSpd, 0, Math.cos(a) * windSpd]; windFrom = ((a * DEG + 180) % 360 + 360) % 360;
}
const DIFF = [
  { name: 'EASY', time: 270, bonus: 15, ringR: 36, bonusR: 24, auth: 0.85, wind: 0.55, turb: 0.5, hard: -9.5, gold: 10, mult: 0.8, col: '#7dffa8' },
  { name: 'NORMAL', time: 210, bonus: 12, ringR: 28, bonusR: 19, auth: 1, wind: 1, turb: 1, hard: -7.5, gold: 8, mult: 1, col: '#ffd27a' },
  { name: 'HARD', time: 160, bonus: 9, ringR: 21, bonusR: 15, auth: 1.12, wind: 1.45, turb: 1.5, hard: -6, gold: 6, mult: 1.35, col: '#ff7a6a' },
];
let diffI = 1, routeRandom = false, routeSeed = 0;
try { diffI = clamp(+(localStorage.getItem('skylark_diff') ?? 1) || 0, 0, 2); routeRandom = localStorage.getItem('skylark_route') === 'R'; } catch (e) { }
let D = DIFF[diffI];
const bestKey = () => 'skylark_best_' + D.name;
function setDiff(i) { diffI = i; D = DIFF[i]; try { localStorage.setItem('skylark_diff', String(i)); } catch (e) { } const b = $('dfb'); if (b) b.textContent = 'DIFFICULTY: ' + D.name; try { loadBest(); if (state === 'title') { buildRoute(); pickGhost(); } } catch (e) { } }
function setRoute(r) { routeRandom = r; try { localStorage.setItem('skylark_route', r ? 'R' : 'C'); } catch (e) { } const b = $('rtb'); if (b) b.textContent = 'ROUTE: ' + (r ? 'RANDOM' : 'CLASSIC'); }
let ghosts = {}, ghost = null, ghostOn = true;
try { ghosts = JSON.parse(localStorage.getItem('skylark_ghosts') || '{}') || {}; ghostOn = localStorage.getItem('skylark_ghostOn') !== '0'; } catch (e) { ghosts = {}; }
const ghostKey = () => routeRandom ? null : D.name + '-CLASSIC2';
function pickGhost() { const k = ghostKey(); ghost = k && ghosts[k] ? ghosts[k] : null; }
function setGhostOn(v) { ghostOn = v; try { localStorage.setItem('skylark_ghostOn', v ? '1' : '0'); } catch (e) { } const b = $('ghb'); if (b) b.textContent = 'GHOST: ' + (v ? 'ON' : 'OFF'); }
let todI = 0; try { todI = (+localStorage.getItem('skylark_tod') || 0) % 3; } catch (e) { }
let L = TOD[todI];
function setTOD(i) { todI = i; L = TOD[i]; try { localStorage.setItem('skylark_tod', String(i)); } catch (e) { } const b = $('todb'); if (b) b.textContent = 'TIME: ' + L.name; }
setTOD(todI); setWX(wxI); setGhostOn(ghostOn); setDiff(diffI); setRoute(routeRandom); pickGhost();
let E = L, flashV = 0, boltT = 9, nextBolt = 4, boltPts = null, FDT = 0.016;
const drops = [];
function envNow() {
  const W0 = WX[wxI], g = (L.fog[0] + L.fog[1] + L.fog[2]) / 3, e = Object.assign({}, L);
  e.fog = mixc(L.fog, [g * 0.78, g * 0.82, g * 0.88], W0.gray); e.zen = mixc(L.zen, [g * 0.5, g * 0.54, g * 0.6], W0.gray);
  e.sunC = V.mul(L.sunC, W0.sun); e.ambS = V.mul(L.ambS, W0.amb); e.ambG = V.mul(L.ambG, W0.amb);
  e.fogD = L.fogD * W0.fogD; e.cloud = V.mul(L.cloud, W0.cloudK); e.flare = L.flare && !wxI; e.stars = L.night && !wxI ? 1 : 0;
  if (flashV > 0) e.fog = mixc(e.fog, [0.72, 0.75, 0.85], flashV * 0.55);
  return e;
}
function makeBolt() { const x0 = 0.15 + Math.random() * 0.7; boltPts = [[x0, 0]]; let x = x0, y = 0; const yEnd = 0.3 + Math.random() * 0.25; while (y < yEnd) { y += 0.025 + Math.random() * 0.04; x += (Math.random() - 0.5) * 0.06; boltPts.push([x, y]); } }
function stormUpdate(dt) {
  if (WX[wxI].rain > 1 && state !== 'paused') { nextBolt -= dt; if (nextBolt <= 0) { nextBolt = 5 + Math.random() * 9; boltT = 0; makeBolt(); thunder(0.5 + Math.random() * 1.8); } }
  boltT += dt;
  flashV = boltT < 0.06 ? 1 : boltT < 0.12 ? 0.25 : boltT < 0.2 ? 0.9 : boltT < 0.5 ? 0.6 * (1 - (boltT - 0.2) / 0.3) : 0;
}
const I4 = basisM([1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0]);
const rnd = rng(1337);

// ---------------------------------------------------------------- world meshes
const terrain = (() => {
  const p = new Float32Array(NV * NV * 3), n = new Float32Array(NV * NV * 3), c = new Float32Array(NV * NV * 3), idx = new Uint32Array(N * N * 6);
  for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
    const k = j * NV + i, x = -HALF + i * CELL, z = -HALF + j * CELL, h = HG[k];
    const hl = HG[j * NV + Math.max(i - 1, 0)], hr = HG[j * NV + Math.min(i + 1, N)], hd = HG[Math.max(j - 1, 0) * NV + i], hu = HG[Math.min(j + 1, N) * NV + i];
    const nn = V.norm([hl - hr, 2 * CELL, hd - hu]), col = tcol(h, nn[1], x, z);
    p.set([x, h, z], k * 3); n.set(nn, k * 3); c.set(col, k * 3);
  }
  let q = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * NV + i, b = a + 1, cc = a + NV, d = cc + 1; idx[q++] = a; idx[q++] = cc; idx[q++] = b; idx[q++] = b; idx[q++] = cc; idx[q++] = d; }
  return upload(p, n, c, idx);
})();
const water = (() => { const m = new MB(), S = 45000; m.quad([-S, 0, -S], [S, 0, -S], [S, 0, S], [-S, 0, S], [0, 1, 0], [0.1, 0.3, 0.4]); return m.build(); })();

// runway, markings, lights, buildings
const Y = RW.y;
const runway = new MB(), marks = new MB(), lights = new MB(), blds = new MB(), wins = new MB();
runway.quad([-RW.hx, Y + 0.25, -RW.hz], [RW.hx, Y + 0.25, -RW.hz], [RW.hx, Y + 0.25, RW.hz], [-RW.hx, Y + 0.25, RW.hz], [0, 1, 0], [0.19, 0.19, 0.21]);
runway.quad([RW.hx, Y + 0.2, 60], [96, Y + 0.2, 60], [96, Y + 0.2, 270], [RW.hx, Y + 0.2, 270], [0, 1, 0], [0.36, 0.36, 0.37]);
const WH = [0.92, 0.92, 0.88];
const mark = (x0, x1, z0, z1, col = WH) => marks.quad([x0, Y + 0.45, z0], [x1, Y + 0.45, z0], [x1, Y + 0.45, z1], [x0, Y + 0.45, z1], [0, 1, 0], col);
for (let z = -RW.hz + 90; z < RW.hz - 90; z += 60) mark(-0.6, 0.6, z, z + 30);
mark(-RW.hx + 0.6, -RW.hx + 1.4, -RW.hz, RW.hz); mark(RW.hx - 1.4, RW.hx - 0.6, -RW.hz, RW.hz);
for (const e of [-1, 1]) {
  for (let k = 0; k < 6; k++) for (const s of [-1, 1]) { const x = s * (3 + k * 3.2); mark(x - 0.9, x + 0.9, e * (RW.hz - 50), e * (RW.hz - 10)); }
  for (const s of [-1, 1]) mark(s * 7, s * 12, e * (RW.hz - 330), e * (RW.hz - 280));
  for (let k = -12; k <= 12; k += 2) lights.box(k * 2, Y + 0.6, e * (RW.hz + 2), 0.7, 0.5, 0.7, e < 0 ? [0.3, 1, 0.4] : [1, 0.25, 0.2]);
  for (let d = 30; d <= 330; d += 30) { lights.box(0, Y + 1.5, e * (RW.hz + d), 0.8, 0.8, 0.8, [1, 0.95, 0.8]); if (d % 90 === 0) for (let x = -12; x <= 12; x += 4) lights.box(x, Y + 1.5, e * (RW.hz + d), 0.6, 0.6, 0.6, [1, 0.95, 0.8]); }
}
for (let z = -RW.hz; z <= RW.hz; z += 50) for (const s of [-1, 1]) lights.box(s * (RW.hx + 1.5), Y + 0.6, z, 0.6, 0.6, 0.6, [1, 0.85, 0.5]);
// tower, hangars, windsock
blds.box(75, Y + 15, -150, 7, 30, 7, [0.86, 0.84, 0.78]); blds.box(75, Y + 32, -150, 10, 4, 10, [0.12, 0.22, 0.34]); blds.box(75, Y + 34.5, -150, 11, 1, 11, [0.15, 0.15, 0.17]);
lights.box(75, Y + 35.5, -150, 0.8, 0.8, 0.8, [1, 0.2, 0.15]);
for (const z of [110, 165, 220]) {
  blds.box(115, Y + 7, z, 34, 14, 46, [0.6, 0.63, 0.62]);
  blds.box(97.8, Y + 5.5, z, 0.4, 11, 38, [0.28, 0.31, 0.34]);
  blds.hex([[98, Y + 14, z - 23], [132, Y + 14, z - 23], [132, Y + 14, z - 23], [115, Y + 19, z - 23], [98, Y + 14, z + 23], [132, Y + 14, z + 23], [132, Y + 14, z + 23], [115, Y + 19, z + 23]], [0.45, 0.2, 0.17]);
}
blds.box(40, Y + 4, -480, 0.25, 8, 0.25, [0.8, 0.8, 0.8]);
wins.box(75, Y + 32, -150, 10.15, 2.2, 10.15, [0.55, 0.85, 1.0]);
for (const z of [110, 165, 220]) wins.box(97.5, Y + 12.2, z, 0.3, 0.5, 32, [1, 0.88, 0.65]);
// village houses
for (let k = 0, made = 0; k < 900 && made < 90; k++) {
  const vx = rnd() < 0.5 ? 1100 : -1300, vz = rnd() < 0.5 ? -300 : 900;
  const x = vx + (rnd() - 0.5) * 700, z = vz + (rnd() - 0.5) * 700, h = groundH(x, z);
  if (h < 6 || h > 160 || normalAt(x, z)[1] < 0.93 || (Math.abs(x) < 160 && Math.abs(z) < 900)) continue;
  made++;
  const w = 7 + rnd() * 6, d = 8 + rnd() * 7, hh = 4.5 + rnd() * 3;
  const wall = [[0.9, 0.86, 0.76], [0.85, 0.82, 0.8], [0.78, 0.74, 0.62], [0.92, 0.92, 0.9]][(rnd() * 4) | 0];
  const roof = [[0.62, 0.2, 0.14], [0.36, 0.22, 0.16], [0.3, 0.32, 0.36]][(rnd() * 3) | 0];
  blds.box(x, h + hh / 2 - 1, z, w, hh + 2, d, wall);
  if (hash(made, 77) < 0.8) { wins.box(x + w / 2 + 0.06, h + hh * 0.55, z + d * 0.15, 0.1, 1.3, 1.6, [1, 0.78, 0.38]); wins.box(x - w / 2 - 0.06, h + hh * 0.55, z - d * 0.2, 0.1, 1.3, 1.6, [1, 0.72, 0.32]); }
  const y0 = h + hh, y1 = y0 + 3 + rnd() * 2, x0 = x - w / 2 - 0.5, x1 = x + w / 2 + 0.5;
  blds.hex([[x0, y0, z - d / 2 - 0.5], [x1, y0, z - d / 2 - 0.5], [x1, y0, z - d / 2 - 0.5], [x, y1, z - d / 2 - 0.5], [x0, y0, z + d / 2 + 0.5], [x1, y0, z + d / 2 + 0.5], [x1, y0, z + d / 2 + 0.5], [x, y1, z + d / 2 + 0.5]], roof);
}
// trees
const trees = new MB();
for (let k = 0, made = 0; k < 30000 && made < 4200; k++) {
  const x = (rnd() - 0.5) * 9400, z = (rnd() - 0.5) * 9400, h = groundH(x, z);
  if (h < 5 || h > 460) continue;
  if (Math.abs(x) < 170 && Math.abs(z) < RW.hz + 400) continue;
  if (fbm(x * 0.0015 + 40, z * 0.0015, 3) < 0.48) continue;
  const ny = normalAt(x, z)[1]; if (ny < 0.82) continue;
  made++;
  const th = 9 + rnd() * 10, r = 2.6 + rnd() * 2.2, g = 0.75 + rnd() * 0.4;
  trees.box(x, h + th * 0.12, z, r * 0.25, th * 0.3, r * 0.25, [0.3, 0.2, 0.11]);
  if (h < 140 && rnd() < 0.55) { trees.sphere([x, h + th * 0.55, z], r * 1.25, 1.05, [0.22 * g, 0.4 * g, 0.13 * g], 4, 6); continue; }
  for (let L = 0; L < 2; L++) {
    const yb = h + th * (0.18 + L * 0.32), yt = h + th * (L ? 1 : 0.72), rr = r * (L ? 0.72 : 1), apex = [x, yt, z], col = [0.12 * g, 0.3 * g, 0.14 * g];
    for (let s = 0; s < 6; s++) {
      const a0 = s / 6 * 6.283 + x, a1 = (s + 1) / 6 * 6.283 + x;
      trees.tri([x + Math.cos(a0) * rr, yb, z + Math.sin(a0) * rr], [x + Math.cos(a1) * rr, yb, z + Math.sin(a1) * rr], apex, col, [x, yb + (yt - yb) * 0.25, z]);
    }
  }
}
// rocks: boulders on slopes and along the shore
const rocks = new MB();
for (let k = 0, made = 0; k < 20000 && made < 650; k++) {
  const x = (rnd() - 0.5) * 9400, z = (rnd() - 0.5) * 9400, h = groundH(x, z);
  if (h < 1 || (Math.abs(x) < 170 && Math.abs(z) < RW.hz + 400)) continue;
  const ny = normalAt(x, z)[1], shore = h < 7;
  if (!shore && (ny > 0.88 || ny < 0.5)) continue;
  if (shore && rnd() < 0.6) continue;
  made++;
  const sz = (shore ? 1.5 : 3) + rnd() * (shore ? 3 : 9), g = 0.36 + rnd() * 0.2, la = 3, lo = 6, s0 = rocks.p.length / 3, cy = h + sz * 0.15;
  rocks.sphere([x, cy, z], sz, 0.62, [g * 1.05, g, g * 0.92], la, lo);
  for (let i = 0; i <= la; i++) for (let j = 0; j <= lo; j++) {
    const vi = s0 + i * (lo + 1) + j, jj = (i === 0 || i === la) ? 0 : j % lo, f = 0.7 + 0.6 * hash(k * 7 + i, jj + k * 21), c0 = [x, cy, z];
    for (let a = 0; a < 3; a++) rocks.p[vi * 3 + a] = c0[a] + (rocks.p[vi * 3 + a] - c0[a]) * f;
  }
}
// clouds
const clouds = new MB();
for (let k = 0; k < 55; k++) {
  const cx = (rnd() - 0.5) * 13000, cz = (rnd() - 0.5) * 13000, cy = 700 + rnd() * 450, np = 4 + ((rnd() * 5) | 0);
  for (let q = 0; q < np; q++) clouds.sphere([cx + (rnd() - 0.5) * 320, cy + (rnd() - 0.5) * 40, cz + (rnd() - 0.5) * 220], 70 + rnd() * 95, 0.55, [1, 1, 1], 5, 9);
}
const LGLOW = [];
for (let k = 0; k < lights.p.length / 3; k += 24) {
  let x = 0, y = 0, z = 0; for (let q = 0; q < 24; q++) { x += lights.p[(k + q) * 3]; y += lights.p[(k + q) * 3 + 1]; z += lights.p[(k + q) * 3 + 2]; }
  LGLOW.push({ p: [x / 24, y / 24, z / 24], col: lights.c.slice(k * 3, k * 3 + 3).map(v => Math.round(Math.min(1, v) * 255)).join(',') });
}
function makeSock() {
  const m = new MB(), sg = [[0, 0.62, [1, 0.42, 0.08]], [1.1, 0.5, [0.95, 0.95, 0.95]], [2.2, 0.38, [1, 0.42, 0.08]], [3.3, 0.26, null]];
  for (let i = 0; i < 3; i++) m.sect(sg[i][0], sg[i][1], sg[i][1], 0, sg[i + 1][0], sg[i + 1][1], sg[i + 1][1], 0, sg[i][2]);
  m.box(0, 0, 0, 1.4, 0.08, 0.08, [0.8, 0.8, 0.8]); return m.build();
}
const M = { wins: wins.build(), sock: makeSock(), runway: runway.build(), marks: marks.build(), lights: lights.build(), blds: blds.build(), trees: trees.build(), clouds: clouds.build(), rocks: rocks.build() };

// aircraft: lofted fuselage, airfoil-section wings and tail, wheels in spats
const PW = [0.94, 0.94, 0.96], PR = [0.8, 0.1, 0.07], PN = [0.1, 0.16, 0.36], PD = [0.1, 0.1, 0.12], PM = [0.55, 0.56, 0.58], PG = [0.12, 0.2, 0.3];
function loft(m, S, seg, ox = 0) {
  const base = m.p.length / 3;
  for (const s of S) for (let k = 0; k <= seg; k++) {
    const a = k / seg * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    m.vert([ox + ca * s[1], s[3] + sa * s[2], s[0]], V.norm([ca / Math.max(s[1], 0.01), sa / Math.max(s[2], 0.01), 0]), s[4]);
  }
  for (let i = 0; i < S.length - 1; i++) for (let k = 0; k < seg; k++) { const a = base + i * (seg + 1) + k, b = a + seg + 1; m.i.push(a, a + 1, b, a + 1, b + 1, b); }
}
const PROF = [[0, 0], [0.06, 0.55], [0.3, 1], [0.7, 0.6], [1, 0.08], [1, -0.04], [0.7, -0.25], [0.3, -0.45], [0.06, -0.35]];
const cen = pts => V.mul(pts.reduce((s, p) => V.add(s, p), [0, 0, 0]), 1 / pts.length);
function foil(m, A, B, map, col) {
  const pa = PROF.map(q => map(A, q)), pb = PROF.map(q => map(B, q)), ca = cen(pa), cb = cen(pb), mid = V.mul(V.add(ca, cb), 0.5), n = PROF.length;
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n, a = pa[k], b = pa[k2], c = pb[k2], d = pb[k];
    let nn = V.cross(V.sub(b, a), V.sub(d, a)); if (V.len(nn) < 1e-9) nn = V.cross(V.sub(c, b), V.sub(a, b)); nn = V.norm(nn);
    if (V.dot(nn, V.sub(V.mul(V.add(V.add(a, b), V.add(c, d)), 0.25), mid)) < 0) nn = V.mul(nn, -1);
    m.quad(a, b, c, d, nn, col);
  }
  return { pa, pb, ca, cb };
}
function surf(m, st, map, cols) {
  let first = null, last = null;
  for (let i = 0; i < st.length - 1; i++) { const r = foil(m, st[i], st[i + 1], map, cols[i]); if (!i) first = r; last = r; }
  for (const [pts, c, away, col] of [[first.pa, first.ca, first.cb, cols[0]], [last.pb, last.cb, last.ca, cols[cols.length - 1]]])
    for (let k = 0; k < pts.length; k++) m.tri(pts[k], pts[(k + 1) % pts.length], c, col, away);
}
function rod(m, a, b, t, col) {
  const d = V.norm(V.sub(b, a)); let p1 = V.cross(d, [0, 0, 1]); if (V.len(p1) < 0.1) p1 = V.cross(d, [1, 0, 0]); p1 = V.norm(p1); const p2 = V.cross(d, p1);
  const ring = c => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => V.add(c, V.add(V.mul(p1, i * t), V.mul(p2, j * t))));
  m.hex([...ring(a), ...ring(b)], col);
}
function wheel(m, c, r, w, col) {
  const seg = 14, base = m.p.length / 3;
  for (const sx of [-w / 2, w / 2]) for (let k = 0; k <= seg; k++) { const a = k / seg * 6.2832; m.vert([c[0] + sx, c[1] + Math.cos(a) * r, c[2] + Math.sin(a) * r], [0, Math.cos(a), Math.sin(a)], col); }
  for (let k = 0; k < seg; k++) { const a = base + k, b = base + seg + 1 + k; m.i.push(a, a + 1, b, a + 1, b + 1, b); }
  for (const sx of [-1, 1]) {
    const hub = m.vert([c[0] + sx * w / 2, c[1], c[2]], [sx, 0, 0], PM), b0 = m.p.length / 3;
    for (let k = 0; k <= seg; k++) { const a = k / seg * 6.2832; m.vert([c[0] + sx * w / 2, c[1] + Math.cos(a) * r * 0.97, c[2] + Math.sin(a) * r * 0.97], [sx, 0, 0], col); if (k) m.i.push(hub, b0 + k - 1, b0 + k); }
  }
}
const wingMap = (S, q) => [S.s, S.o + q[1] * S.t, S.le - q[0] * S.ch];
const finMap = (S, q) => [q[1] * S.t, S.s, S.le - q[0] * S.ch];
{
  const b = new MB();
  const FS = [[-4.75, 0.05, 0.07, 0.5, PW], [-4.3, 0.15, 0.2, 0.45, PW], [-3.2, 0.3, 0.36, 0.33, PW], [-1.8, 0.46, 0.54, 0.2, PW], [-0.4, 0.57, 0.63, 0.1, PW],
    [1.0, 0.6, 0.62, 0.04, PW], [2.3, 0.56, 0.56, 0.0, PW], [2.3, 0.56, 0.56, 0.0, PR], [3.0, 0.48, 0.48, -0.03, PR], [3.38, 0.36, 0.36, -0.05, PR]];
  loft(b, FS, 18);
  loft(b, [[3.38, 0.22, 0.22, -0.05, PR], [3.38, 0.22, 0.22, -0.05, PW], [3.6, 0.17, 0.17, -0.05, PW], [3.8, 0.04, 0.04, -0.05, PW]], 14);
  for (const sx of [-1, 1]) for (let i = 2; i < 6; i++) {
    const A = FS[i], B = FS[i + 1];
    for (const [d0, d1, col] of [[-0.02, 0.09, PN], [-0.13, -0.06, PR]]) {
      const xa = sx * A[1] * 1.02, xb = sx * B[1] * 1.02;
      b.quad([xa, A[3] + d0 * A[2] / 0.6, A[0]], [xb, B[3] + d0 * B[2] / 0.6, B[0]], [xb, B[3] + d1 * B[2] / 0.6, B[0]], [xa, A[3] + d1 * A[2] / 0.6, A[0]], [sx, 0, 0], col);
    }
  }
  loft(b, [[-0.27, 0.415, 0.435, 0.66, PD], [-0.15, 0.415, 0.435, 0.66, PD]], 16);
  for (const sg of [-1, 1]) {
    surf(b, [{ s: sg * 0.45, o: -0.36, le: 1.25, ch: 2.0, t: 0.27 }, { s: sg * 4.9, o: -0.1, le: 1.04, ch: 1.42, t: 0.15 }, { s: sg * 5.78, o: -0.05, le: 0.97, ch: 1.22, t: 0.11 }], wingMap, [PW, PR]);
    surf(b, [{ s: sg * 0.12, o: 0.44, le: -3.7, ch: 1.1, t: 0.12 }, { s: sg * 2.15, o: 0.47, le: -4.05, ch: 0.62, t: 0.07 }], wingMap, [PW]);
    rod(b, [sg * 0.4, -0.4, 0.5], [sg * 1.5, -1.3, 0.5], 0.05, PM);
    wheel(b, [sg * 1.5, -1.52, 0.5], 0.33, 0.18, PD);
    loft(b, [[0.0, 0.05, 0.06, -1.42, PW], [0.25, 0.17, 0.3, -1.42, PW], [0.65, 0.18, 0.32, -1.42, PW], [1.05, 0.05, 0.08, -1.38, PW]], 12, sg * 1.5);
    b.box(sg * 0.42, -0.3, 2.65, 0.08, 0.08, 0.35, PD);
  }
  surf(b, [{ s: 0.45, le: -3.05, ch: 1.75, t: 0.15 }, { s: 1.9, le: -4.05, ch: 0.95, t: 0.085 }, { s: 2.2, le: -4.25, ch: 0.78, t: 0.07 }], finMap, [PN, PR]);
  rod(b, [0, -0.45, 2.75], [0, -1.35, 2.75], 0.05, PM);
  wheel(b, [0, -1.59, 2.75], 0.26, 0.14, PD);
  b.box(0, 0.95, -1.9, 0.03, 0.35, 0.06, PD);
  M.body = b.build();
  const c = new MB();
  loft(c, [[-1.8, 0.05, 0.04, 0.7, PG], [-1.15, 0.3, 0.3, 0.68, PG], [-0.2, 0.4, 0.42, 0.66, PG], [0.75, 0.38, 0.38, 0.6, PG], [1.4, 0.1, 0.1, 0.52, PG]], 16);
  M.canopy = c.build();
  const l = new MB();
  l.box(-5.82, -0.03, 0.55, 0.1, 0.1, 0.22, [1, 0.12, 0.1]); l.box(5.82, -0.03, 0.55, 0.1, 0.1, 0.22, [0.1, 1, 0.25]); l.box(0, 0.5, -4.8, 0.08, 0.08, 0.08, [1, 1, 1]);
  l.box(-3.2, -0.2, 1.15, 0.22, 0.06, 0.06, [1, 0.97, 0.85]);
  M.plights = l.build();
  const sb = new MB(); sb.box(-5.82, -0.03, -0.2, 0.1, 0.1, 0.12, [1, 1, 1]); sb.box(5.82, -0.03, -0.2, 0.1, 0.1, 0.12, [1, 1, 1]); M.strobe = sb.build();
  const pr = new MB();
  for (const sg of [-1, 1]) {
    const y0 = sg * 0.16, y1 = sg * 1.28, y2 = sg * 1.4;
    pr.hex([[-0.12, y0, -0.035], [0.12, y0, 0.02], [0.12, y0, 0.05], [-0.12, y0, -0.005], [-0.07, y1, -0.012], [0.07, y1, 0.0], [0.07, y1, 0.02], [-0.07, y1, 0.008]], PD);
    pr.hex([[-0.07, y1, -0.012], [0.07, y1, 0.0], [0.07, y1, 0.02], [-0.07, y1, 0.008], [-0.05, y2, -0.008], [0.05, y2, 0.0], [0.05, y2, 0.015], [-0.05, y2, 0.007]], [0.95, 0.8, 0.15]);
  }
  M.prop = pr.build();
  const pd = new MB(); pd.disc(1.4, 24, [0.25, 0.25, 0.27], 'xy'); M.propDisc = pd.build();
  const sh = new MB(); sh.disc(1, 20, [0, 0, 0], 'xz'); M.shadow = sh.build();
  const fb = new MB(); fb.sphere([0, 0, 0], 1, 1, [1, 1, 1], 8, 12); M.ball = fb.build();
  const pf = new MB(); pf.sphere([0, 0, 0], 1, 1, [1, 1, 1], 5, 8); M.puff = pf.build();
}
const PARKED = [
  { M: basisM([0, 0, 1], [0, 1, 0], [-1, 0, 0], [66, RW.y + GEAR, 125]), t: [0.72, 0.86, 1.0] },
  { M: basisM([0, 0, 1], [0, 1, 0], [-1, 0, 0], [66, RW.y + GEAR, 195]), t: [1.0, 0.93, 0.66] },
];

// rings
const NR = 12, RING_MESH_R = 28, NB = 4;
const rings = [], bonusRings = [];
{
  const tm = new MB(), R = RING_MESH_R, r = 2.6, S1 = 40, S2 = 8;
  for (let i = 0; i <= S1; i++) for (let j = 0; j <= S2; j++) {
    const th = i / S1 * Math.PI * 2, ph = j / S2 * Math.PI * 2, cr = R + r * Math.cos(ph);
    tm.vert([cr * Math.cos(th), cr * Math.sin(th), r * Math.sin(ph)], [Math.cos(ph) * Math.cos(th), Math.cos(ph) * Math.sin(th), Math.sin(ph)], [1, 1, 1]);
  }
  for (let i = 0; i < S1; i++) for (let j = 0; j < S2; j++) { const a = i * (S2 + 1) + j, b = a + S2 + 1; tm.i.push(a, b, a + 1, a + 1, b, b + 1); }
  M.ring = tm.build();
}

function maxNear(x, z, r) { let m = -1e9; for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) m = Math.max(m, groundH(x + dx * r, z + dz * r)); return m; }
function seaSpot(a, r0) {
  for (let R2 = r0; R2 < 6200; R2 += 60) {
    const x = Math.sin(a) * R2, z = Math.cos(a) * R2;
    if (maxNear(x, z, 140) < -6 && maxNear(x, z, 320) < 2) return [x, z, R2];
  }
  return null;
}
function ringBasis(c, n, R) { const rr = V.norm(V.cross([0, 1, 0], n)), uu = V.cross(n, rr), k = R / RING_MESH_R; return basisM(V.mul(rr, k), V.mul(uu, k), V.mul(n, k), c); }
const SEA_IDX = [2, 6, 10];
function buildRoute() {
  const pts = [], valley = [];
  if (!routeRandom) {
    for (let i = 0; i < NR; i++) {
      const a = 0.22 + i / NR * Math.PI * 2 * 0.94, R2 = 2100 + 650 * Math.sin(a * 3 + 1), x = Math.sin(a) * R2, z = Math.cos(a) * R2;
      const sp = SEA_IDX.includes(i) ? seaSpot(a, R2 + 200) : null;
      if (sp) { pts.push([sp[0], D.ringR + 14 + 8 * Math.sin(i * 2.3), sp[1]]); valley.push('sea'); }
      else { pts.push([x, Math.max(0, maxNear(x, z, 160)) + 115 + 65 * Math.sin(i * 1.9), z]); valley.push(false); }
    }
  } else {
    const rr = rng(routeSeed), dir = rr() < 0.5 ? 1 : -1, a0 = rr() * Math.PI * 2;
    for (let i = 0; i < NR; i++) {
      const aC = a0 + dir * (i + 0.5) / NR * Math.PI * 2 * 0.92, wantValley = i % 3 === 1;
      if (i % 4 === 3) { const sp = seaSpot(aC + (rr() - 0.5) * 0.25, 2200 + rr() * 600); if (sp) { pts.push([sp[0], D.ringR + 12 + rr() * 20, sp[1]]); valley.push('sea'); continue; } }
      let bestP = null, bestS = -1e9;
      for (let k = 0; k < (wantValley ? 40 : 6); k++) {
        const a = aC + (rr() - 0.5) * 0.3, R2 = 1300 + rr() * 2200, x = Math.sin(a) * R2, z = Math.cos(a) * R2, h = groundH(x, z);
        if (Math.abs(x) < 300 && Math.abs(z) < RW.hz + 500) continue;
        let sc = rr();
        if (wantValley) { if (h < 15) continue; let ring = 0; for (let q = 0; q < 8; q++) { const b = q / 8 * 6.283; ring += groundH(x + Math.cos(b) * 380, z + Math.sin(b) * 380); } sc = ring / 8 - h; }
        if (sc > bestS) { bestS = sc; bestP = [x, z, h]; }
      }
      if (!bestP) { const x = Math.sin(aC) * 2200, z = Math.cos(aC) * 2200; bestP = [x, z, groundH(x, z)]; }
      const [x, z] = bestP, isV = wantValley && bestS > 60 ? true : false, floor = Math.max(maxNear(x, z, 70), 0);
      pts.push([x, isV ? floor + D.ringR + 38 + rr() * 25 : Math.max(floor, maxNear(x, z, 180)) + 90 + rr() * 110, z]); valley.push(isV);
    }
  }
  rings.length = 0;
  for (let i = 0; i < NR; i++) {
    const prev = i ? pts[i - 1] : [0, 0, RW.hz], next = i < NR - 1 ? pts[i + 1] : [0, 0, -RW.hz - 1500];
    const n = V.norm([next[0] - prev[0], 0, next[2] - prev[2]]);
    rings.push({ c: pts[i], n, M: ringBasis(pts[i], n, D.ringR), valley: valley[i] });
  }
  bonusRings.length = 0;
  const br = rng(routeRandom ? routeSeed ^ 0x5bd1 : 4242);
  for (const i of [1, 4, 7, 9]) {
    const a = rings[i].c, b = rings[i + 1].c, d = V.norm([b[0] - a[0], 0, b[2] - a[2]]), side = V.cross([0, 1, 0], d), sg = br() < 0.5 ? -1 : 1;
    const m = V.add(V.lerp(a, b, 0.45 + br() * 0.1), V.mul(side, sg * (200 + br() * 160)));
    m[1] = Math.max((a[1] + b[1]) / 2 + 40 + br() * 90, Math.max(maxNear(m[0], m[2], 60), 0) + D.bonusR + 30);
    bonusRings.push({ c: m, n: d, M: ringBasis(m, d, D.bonusR), got: false });
  }
}
buildRoute();

// minimap
const MR = 6000, MS = 160;
const mini = document.createElement('canvas'); mini.width = mini.height = MS;
{
  const mx = mini.getContext('2d'), img = mx.createImageData(MS, MS);
  for (let j = 0; j < MS; j++) for (let i = 0; i < MS; i++) {
    const x = -MR + (i + 0.5) / MS * 2 * MR, z = MR - (j + 0.5) / MS * 2 * MR, h = groundH(x, z);
    let c;
    if (h < 0) c = mixc([0.25, 0.55, 0.7], [0.05, 0.2, 0.38], -h / 80);
    else { const n = normalAt(x, z); c = V.mul(tcol(h, n[1], x, z), 0.55 + 0.7 * Math.max(0, V.dot(n, SUN))); }
    const k = (j * MS + i) * 4; img.data[k] = clamp(c[0] * 255, 0, 255); img.data[k + 1] = clamp(c[1] * 255, 0, 255); img.data[k + 2] = clamp(c[2] * 255, 0, 255); img.data[k + 3] = 255;
  }
  mx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------- audio
let AC = null, eng, eng2, engF, engG, windG, rainG, master, noiseBuf, muted = false;
function initAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = 0.9; master.connect(AC.destination);
    eng = AC.createOscillator(); eng.type = 'sawtooth'; eng2 = AC.createOscillator(); eng2.type = 'square';
    engF = AC.createBiquadFilter(); engF.type = 'lowpass'; engF.frequency.value = 500; engG = AC.createGain(); engG.gain.value = 0;
    const g2 = AC.createGain(); g2.gain.value = 0.35;
    eng.connect(engF); eng2.connect(g2); g2.connect(engF); engF.connect(engG); engG.connect(master);
    noiseBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const ns = AC.createBufferSource(); ns.buffer = noiseBuf; ns.loop = true;
    const nf = AC.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 700; nf.Q.value = 0.5;
    windG = AC.createGain(); windG.gain.value = 0; ns.connect(nf); nf.connect(windG); windG.connect(master);
    const rs = AC.createBufferSource(); rs.buffer = noiseBuf; rs.loop = true; const rf = AC.createBiquadFilter(); rf.type = 'highpass'; rf.frequency.value = 1400;
    rainG = AC.createGain(); rainG.gain.value = 0; rs.connect(rf); rf.connect(rainG); rainG.connect(master); rs.start();
    ns.start(); eng.start(); eng2.start();
  } catch (e) { AC = null; }
}
function tone(f, dur, type, vol, delay = 0) {
  if (!AC) return; const t = AC.currentTime + delay, o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}
function boom() {
  if (!AC) return; const t = AC.currentTime, s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(80, t + 2);
  g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 2.2); s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + 2.3);
  tone(55, 1.5, 'sine', 0.6);
}
function thunder(delay) {
  if (!AC) return; const t = AC.currentTime + delay, s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = noiseBuf; s.loop = true; f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(70, t + 3.5);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.8, t + 0.08); g.gain.exponentialRampToValueAtTime(0.001, t + 4);
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + 4.2);
}
function audioUpdate() {
  if (!AC) return; const t = AC.currentTime, on = P.alive && state !== 'title' && state !== 'paused';
  const rpm = 0.25 + 0.75 * P.thr;
  master.gain.setTargetAtTime(muted ? 0 : 0.9, t, 0.05);
  eng.frequency.setTargetAtTime(36 + rpm * 64 + P.spd * 0.12, t, 0.15); eng2.frequency.setTargetAtTime((36 + rpm * 64) * 0.5, t, 0.15);
  engF.frequency.setTargetAtTime(260 + rpm * 1100, t, 0.2); engG.gain.setTargetAtTime(on ? 0.05 + 0.08 * P.thr : 0, t, 0.25);
  windG.gain.setTargetAtTime(on ? Math.min(0.34, P.spd / 380 + windSpd / 120) : 0, t, 0.3);
  if (rainG) rainG.gain.setTargetAtTime(WX[wxI].rain * 0.09 * (state === 'paused' ? 0.3 : 1), t, 0.4);
}

// ---------------------------------------------------------------- game state
const P = { pos: [0, 0, 0], f: [0, 0, 1], u: [0, 1, 0], r: [1, 0, 0], spd: 0, thr: 0, ground: true, alive: true, next: 0, vs: 0, cp: 0, cr: 0, cy: 0, touchVS: 0 };
let countdown = 0, cdLast = 0, accScore = 0, bonusScore = 0, perfects = 0, greats = 0, bonusGot = 0;
const trail = [], TRAIL_LIFE = 7; let smokeOn = true, lastEmit = null;
let state = 'title', timeLeft = 210, camMode = 0, crashT = 0, crashPos = null, crashWhy = '', endShown = false, flightT = 0;
let msg = '', msgT = 0, beepT = 0, propA = 0, chase = [0, 0, 0];
const CAM = { e: [0, 50, -100], c: [0, 0, 0], up: [0, 1, 0], r: [1, 0, 0], u: [0, 1, 0], f: [0, 0, 1] };
let VPm = I4;
let best = 0;
function loadBest() { try { best = +localStorage.getItem(bestKey()) || 0; } catch (e) { best = 0; } if (typeof showBest === 'function') showBest(); }
loadBest();
function showBest() { const b = $('best'); if (b) b.textContent = (best ? `BEST ${D.name}  ${best}` : '') + (ghost ? '  ·  GHOST READY' : (routeRandom ? '  ·  GHOST: CLASSIC ROUTE ONLY' : '')); }
const rec = [], ringTimes = []; let recAcc = 0, newGhost = false, lastKind = 'win';
showBest();

function reset() {
  Object.assign(P, { pos: [0, RW.y + GEAR, -RW.hz + 60], f: [0, 0, 1], u: [0, 1, 0], r: [1, 0, 0], spd: 0, thr: 0, ground: true, alive: true, next: 0, vs: 0, cp: 0, cr: 0, cy: 0, touchVS: 0 });
  for (const B of bonusRings) B.got = false;
  trail.length = 0; lastEmit = null; rec.length = 0; ringTimes.length = 0; recAcc = 0; newGhost = false;
  timeLeft = D.time; countdown = 3.2; cdLast = 4; accScore = 0; bonusScore = 0; perfects = 0; greats = 0; bonusGot = 0;
  crashT = 0; endShown = false; flightT = 0; msg = ''; msgT = 0;
  chase = V.add(P.pos, [0, 7.5, -24]);
}
reset();
function flash(s, t = 2.2) { msg = s; msgT = t; }
function startGame() { initAudio(); if (routeRandom) routeSeed = (Math.random() * 2 ** 31) | 0; buildRoute(); pickGhost(); reset(); state = 'play'; ov.classList.add('hide'); }
function togglePause() {
  if (state === 'play') { state = 'paused'; if (document.exitPointerLock) document.exitPointerLock(); ovc.innerHTML = '<h1>PAUSED</h1><h2>DEADLINE RUN</h2><button class="go" data-act="resume">RESUME ▸</button>'; ov.classList.remove('hide'); }
  else if (state === 'paused') { state = 'play'; ov.classList.add('hide'); }
}
function score(win) { return Math.round((P.next * 1000 + accScore + bonusScore + (win ? 2000 + Math.round(timeLeft) * 50 + Math.round(clamp(1 + P.touchVS / 6, 0, 1) * 1500) : 0)) * D.mult); }
function showEnd(kind) {
  lastKind = kind;
  if (document.exitPointerLock) document.exitPointerLock();
  const win = kind === 'win', sc = score(win);
  const isBest = sc > best; if (isBest) { best = sc; try { localStorage.setItem(bestKey(), String(best)); } catch (e) { } }
  const title = win ? 'WHEELS DOWN' : kind === 'timeout' ? 'DEADLINE MISSED' : 'CRASHED';
  const sub = win ? 'MISSION COMPLETE' : kind === 'timeout' ? 'THE CLOCK RAN OUT' : crashWhy.toUpperCase();
  ovc.innerHTML = `<h1>${title}</h1><h2>${sub}</h2><div class="stats">
    <span>Difficulty · route</span><span style="color:${D.col}">${D.name} · ${routeRandom ? 'RANDOM' : 'CLASSIC'}</span>
    <span>Rings threaded</span><span>${P.next} / ${NR}</span>
    <span>Perfect · great passes</span><span>${perfects} · ${greats}</span>
    <span>Gold bonus rings</span><span>${bonusGot} / ${NB}</span>
    <span>Time left</span><span>${fmtT(timeLeft)}</span>
    ${win ? `<span>Touchdown sink rate</span><span>${Math.round(-P.touchVS * 196.85)} fpm</span>` : ''}
    <span>Flight time</span><span>${fmtT(flightT)}</span>
    <span>Score</span><span>${sc}</span></div>
    <button class="go" data-act="go">FLY AGAIN ▸</button>${rec.length > 30 ? '<button class="go alt" data-act="replay">▶ REPLAY</button>' : ''}${newGhost ? '<div class="best" style="color:#9fdcff">NEW GHOST SAVED — RACE IT NEXT RUN</div>' : ''}<div class="best">${isBest ? 'NEW BEST · ' : ''}BEST ${D.name}  ${best}</div>`;
  ov.classList.remove('hide');
}
function endGame(kind) { state = 'end'; P.thr = 0; recFrame(); if (kind === 'win') newGhost = saveGhost(score(true)); showEnd(kind); }
function crash(why) {
  recFrame(); P.alive = false; state = 'crash'; crashT = 0; crashPos = P.pos.slice(); crashWhy = why; endShown = false; boom();
  if (document.exitPointerLock) document.exitPointerLock();
}
function recFrame() { if (rec.length < 20000) rec.push([P.pos[0], P.pos[1], P.pos[2], P.f[0], P.f[1], P.f[2], P.u[0], P.u[1], P.u[2], P.thr, P.spd, P.next, P.ground ? 1 : 0, flightT]); }
function saveGhost(sc) {
  const gk = ghostKey(); if (!gk || rec.length < 60 || (ghost && ghost.score >= sc)) return false;
  const fr = [], n = Math.floor(rec[rec.length - 1][13] * 10); let j = 0;
  for (let k = 0; k <= n; k++) { const t = k / 10; while (j < rec.length - 2 && rec[j + 1][13] < t) j++; const a = rec[j]; for (let q = 0; q < 9; q++) fr.push(+a[q].toFixed(q < 3 ? 1 : 3)); }
  ghost = { score: sc, fr, rings: ringTimes.slice() }; ghosts[gk] = ghost;
  try { localStorage.setItem('skylark_ghosts', JSON.stringify(ghosts)); } catch (e) { }
  return true;
}
function ghostPose(t) {
  const F = ghost.fr, n = F.length / 9; if (n < 2) return null;
  const x = clamp(t * 10, 0, n - 1.001), i = Math.floor(x), k = x - i, a = i * 9, b = a + 9;
  const l3 = o => [F[a + o] + (F[b + o] - F[a + o]) * k, F[a + o + 1] + (F[b + o + 1] - F[a + o + 1]) * k, F[a + o + 2] + (F[b + o + 2] - F[a + o + 2]) * k];
  const f = V.norm(l3(3)), r = V.norm(V.cross(l3(6), f)), u = V.cross(f, r);
  return { p: l3(0), f, u, r };
}
let rpT0 = 0, rpT = 0, rpI = 0, rpTime = 0, rpShot = -1, rpAnchor = [0, 0, 0], snap = null;
const RP_SHOTS = ['CHASE', 'FLYBY', 'WING CAM', 'TOWER'];
function startReplay() {
  if (rec.length < 30) return;
  snap = { next: P.next, touchVS: P.touchVS, alive: P.alive, pos: P.pos.slice() };
  let ai = rec.findIndex(f => !f[12]); rpT0 = ai > 0 ? Math.max(rec[0][13], rec[ai][13] - 3) : rec[0][13];
  state = 'replay'; rpT = 0; rpI = 0; rpShot = -1; P.alive = true; trail.length = 0; lastEmit = null; ov.classList.add('hide'); replayStep(0);
}
function replayStep(dt) {
  rpT += dt; const tt = rpT0 + rpT;
  while (rpI < rec.length - 2 && rec[rpI + 1][13] < tt) rpI++;
  if (tt >= rec[rec.length - 1][13]) { endReplay(); return; }
  const a = rec[rpI], b = rec[rpI + 1], k = clamp((tt - a[13]) / Math.max(1e-4, b[13] - a[13]), 0, 1), lp = o => [a[o] + (b[o] - a[o]) * k, a[o + 1] + (b[o + 1] - a[o + 1]) * k, a[o + 2] + (b[o + 2] - a[o + 2]) * k];
  P.pos = lp(0); P.f = V.norm(lp(3)); P.u = lp(6); ortho();
  P.thr = a[9]; P.spd = a[10]; P.next = a[11]; P.ground = !!a[12]; P.vs = (b[1] - a[1]) / Math.max(1e-3, b[13] - a[13]); rpTime = tt;
}
function endReplay() {
  if (state !== 'replay') return;
  P.next = snap.next; P.touchVS = snap.touchVS; trail.length = 0; lastEmit = null;
  if (lastKind === 'crash') { P.alive = false; crashPos = snap.pos; crashT = 0; endShown = false; state = 'crash'; boom(); }
  else { P.alive = snap.alive; state = 'end'; showEnd(lastKind); }
}
function replayCam() {
  const sh = Math.floor(rpT / 4.5) % 4, gclamp = e => { const g = Math.max(groundH(e[0], e[2]), 0) + 3; if (e[1] < g) e[1] = g; return e; };
  if (sh !== rpShot) { rpShot = sh; rpAnchor = gclamp(V.add(V.add(P.pos, V.mul(P.f, Math.max(P.spd, 20) * 2.6)), V.add(V.mul(P.r, 26), [0, 6, 0]))); }
  CAM.up = [0, 1, 0];
  if (sh === 0) { const a = rpT * 0.25; CAM.e = gclamp(V.add(P.pos, V.add(V.add(V.mul(P.f, -16 * Math.cos(a)), V.mul(P.r, 14 * Math.sin(a) + 6)), [0, 4, 0]))); CAM.c = P.pos; CAM.fov = 55; }
  else if (sh === 1) { CAM.e = rpAnchor; CAM.c = P.pos; CAM.fov = clamp(2 * Math.atan(24 / Math.max(V.len(V.sub(P.pos, rpAnchor)), 1)) * DEG, 10, 60); }
  else if (sh === 2) { CAM.e = V.add(V.add(P.pos, V.mul(P.r, -8.5)), V.add(V.mul(P.u, 1.6), V.mul(P.f, -3))); CAM.c = V.add(V.add(P.pos, V.mul(P.f, 10)), V.mul(P.r, -1)); CAM.up = P.u; CAM.fov = 62; }
  else { const tw = [75, RW.y + 40, -150], dt = V.len(V.sub(P.pos, tw)); CAM.e = dt < 3000 ? tw : gclamp(V.add(P.pos, [Math.sin(rpT * 0.2) * 60, 25, Math.cos(rpT * 0.2) * 60])); CAM.c = P.pos; CAM.fov = clamp(2 * Math.atan(30 / Math.max(V.len(V.sub(P.pos, CAM.e)), 1)) * DEG, 10, 60); }
}
const fmtT = s => { s = Math.max(0, s); const m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ':' + String(r).padStart(2, '0'); };

// ---------------------------------------------------------------- input
const keys = {};
const stick = { x: 0, y: 0, active: 0 };
addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!e.repeat) onKey(e.code); keys[e.code] = true;
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
function onKey(c) {
  if (state === 'replay') { if (c === 'Enter' || c === 'Escape' || c === 'Space') endReplay(); return; }
  if (c === 'KeyV') setWX((wxI + 1) % 3);
  if (c === 'KeyG') { setGhostOn(!ghostOn); if (state === 'play') flash(ghostOn ? 'GHOST ON' : 'GHOST OFF', 1.2); }
  if (c === 'Enter' && state !== 'play' && state !== 'paused' && state !== 'crash') startGame();
  if (c === 'KeyC' && (state === 'play' || state === 'end')) camMode ^= 1;
  if (c === 'KeyP' || (c === 'Escape' && state === 'play')) togglePause();
  if (c === 'KeyM') muted = !muted;
  if (c === 'KeyT') setTOD((todI + 1) % 3);
  if (c === 'KeyX') { smokeOn = !smokeOn; flash(smokeOn ? 'SMOKE ON' : 'SMOKE OFF', 1.2); }
}
ov.addEventListener('click', e => { const a = e.target && e.target.dataset ? e.target.dataset.act : null; if (a === 'go') startGame(); if (a === 'resume') togglePause(); if (a === 'tod') setTOD((todI + 1) % 3); if (a === 'wx') setWX((wxI + 1) % 3); if (a === 'ghost') setGhostOn(!ghostOn); if (a === 'replay') startReplay(); if (a === 'diff') { setDiff((diffI + 1) % 3); pickGhost(); showBest(); } if (a === 'route') { setRoute(!routeRandom); pickGhost(); showBest(); } });
cv.addEventListener('mousedown', () => { initAudio(); if (state === 'replay') { endReplay(); return; } if (state === 'play' && document.pointerLockElement !== cv && cv.requestPointerLock) cv.requestPointerLock(); });
addEventListener('mousemove', e => {
  if (document.pointerLockElement === cv && state === 'play') { stick.x = clamp(stick.x + e.movementX * 0.0035, -1, 1); stick.y = clamp(stick.y + e.movementY * 0.0035, -1, 1); stick.active = 0.35; }
});
addEventListener('wheel', e => { if (state === 'play') P.thr = clamp(P.thr - e.deltaY * 0.0006, 0, 1); }, { passive: true });
if ('ontouchstart' in window) {
  $('touch').style.display = 'block';
  let tid = null, t0 = [0, 0];
  cv.addEventListener('touchstart', e => { initAudio(); const t = e.changedTouches[0]; tid = t.identifier; t0 = [t.clientX, t.clientY]; e.preventDefault(); }, { passive: false });
  cv.addEventListener('touchmove', e => { for (const t of e.changedTouches) if (t.identifier === tid) { stick.x = clamp((t.clientX - t0[0]) / 70, -1, 1); stick.y = clamp((t.clientY - t0[1]) / 70, -1, 1); stick.active = 1e9; } e.preventDefault(); }, { passive: false });
  cv.addEventListener('touchend', e => { for (const t of e.changedTouches) if (t.identifier === tid) { tid = null; stick.active = 0; } });
  for (const b of document.querySelectorAll('#touch button')) {
    const k = b.dataset.k;
    b.addEventListener('touchstart', e => { e.preventDefault(); keys[k] = true; onKey(k); }, { passive: false });
    b.addEventListener('touchend', e => { e.preventDefault(); keys[k] = false; }, { passive: false });
  }
}

// ---------------------------------------------------------------- flight model
function rotPair(a, b, ang) { const c = Math.cos(ang), s = Math.sin(ang); return [V.add(V.mul(a, c), V.mul(b, s)), V.sub(V.mul(b, c), V.mul(a, s))]; }
const pitchBy = a => { [P.f, P.u] = rotPair(P.f, P.u, a); };
const rollBy = a => { [P.u, P.r] = rotPair(P.u, P.r, a); };
const yawBy = a => { [P.f, P.r] = rotPair(P.f, P.r, a); };
const rotY = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; };
const turnBy = a => { P.f = rotY(P.f, a); P.u = rotY(P.u, a); P.r = rotY(P.r, a); };
function ortho() { P.f = V.norm(P.f); P.r = V.norm(V.cross(P.u, P.f)); P.u = V.cross(P.f, P.r); }
function levelGround() { if (P.f[1] < 0) P.f = V.norm([P.f[0], 0, P.f[2]]); P.u = [0, 1, 0]; ortho(); }
const onRunway = p => Math.abs(p[0]) < RW.hx + 12 && Math.abs(p[2]) < RW.hz + 40;

function update(dt) {
  if (countdown > 0) {
    countdown -= dt; const c = Math.ceil(countdown);
    if (c !== cdLast && c >= 0) { cdLast = c; if (c > 0) tone(660, 0.18, 'square', 0.12); else { tone(1320, 0.45, 'square', 0.14); flash('GO! THROTTLE UP — TAKE OFF', 2.5); } }
    if (keys.KeyR || keys.ShiftLeft || keys.ShiftRight || keys.Equal) P.thr = Math.min(1, P.thr + dt * 0.55);
    if (keys.KeyF || keys.Minus) P.thr = Math.max(0, P.thr - dt * 0.55);
    P.spd = 0; P.vs = 0; return;
  }
  flightT += dt;
  recAcc += dt; if (recAcc >= 1 / 30) { recAcc -= 1 / 30; recFrame(); }
  let pi = 0, ri = 0, yi = 0;
  if (keys.KeyS || keys.ArrowDown) pi += 1; if (keys.KeyW || keys.ArrowUp) pi -= 1;
  if (keys.KeyD || keys.ArrowRight) ri += 1; if (keys.KeyA || keys.ArrowLeft) ri -= 1;
  if (keys.KeyE) yi += 1; if (keys.KeyQ) yi -= 1;
  if (keys.KeyR || keys.ShiftLeft || keys.ShiftRight || keys.Equal) P.thr = Math.min(1, P.thr + dt * 0.55);
  if (keys.KeyF || keys.Minus) P.thr = Math.max(0, P.thr - dt * 0.55);
  const brake = keys.KeyB || keys.Space;
  if (stick.active > 0) stick.active -= dt; else { const d = Math.exp(-dt * 2.5); stick.x *= d; stick.y *= d; }
  pi = clamp(pi + stick.y, -1, 1); ri = clamp(ri + stick.x, -1, 1);
  const sm = 1 - Math.exp(-dt * 6); P.cp += (pi - P.cp) * sm; P.cr += (ri - P.cr) * sm; P.cy += (yi - P.cy) * sm;
  const auth = clamp((P.spd - 12) / 40, 0, 1), lift = clamp((P.spd - 26) / 20, 0, 1);
  let sink = 0, gustV = 0;
  if (!P.ground) {
    const a2 = Math.max(auth, 0.2) * D.auth;
    pitchBy(P.cp * 1.15 * a2 * dt); rollBy(P.cr * 2.1 * a2 * dt); yawBy(P.cy * 0.45 * a2 * dt);
    turnBy(-P.r[1] * 0.85 * a2 * dt);
    const ti = WX[wxI].turb * D.turb * (0.6 + 0.6 * clamp(1 - (P.pos[1] - Math.max(groundH(P.pos[0], P.pos[2]), 0)) / 400, 0, 1));
    pitchBy((vn(flightT * 1.6, 3.3) - 0.5) * 0.9 * ti * dt); rollBy((vn(flightT * 2.1, 7.7) - 0.5) * 1.7 * ti * dt);
    gustV = (vn(flightT * 1.2, 11.1) - 0.5) * 5 * ti;
    if (lift < 1 && P.f[1] > -0.7) pitchBy(-(1 - lift) * 0.7 * dt);
    sink = (1 - lift) * 16;
  } else {
    turnBy((yi + ri) * 0.6 * dt * clamp(P.spd / 8, 0, 1));
    if (P.spd > 30 && P.cp > 0) pitchBy(P.cp * 0.7 * dt * auth);
    levelGround();
  }
  ortho();
  const drag = 0.0013 * P.spd * P.spd * (1 + (P.ground ? 0 : Math.abs(P.cp) * 0.25));
  let acc = P.thr * 9.5 - drag - 9.81 * P.f[1];
  if (P.ground) acc -= 0.5 + (brake ? 7 : 0);
  P.spd = clamp(P.spd + acc * dt, 0, 160);
  const vel = V.add(V.mul(P.f, P.spd), [0, -sink + gustV, 0]);
  P.vs = vel[1];
  const prev = P.pos; P.pos = V.add(P.pos, V.mul(P.ground ? vel : V.add(vel, windV), dt));
  const gh = groundH(P.pos[0], P.pos[2]), onRw = onRunway(P.pos), floor = Math.max(gh, 0);
  if (P.ground) {
    if (!onRw && P.spd > 14) { crash('Ran off the runway'); return; }
    if (P.f[1] > 0.02 && P.spd > 33) { P.ground = false; flash('POSITIVE CLIMB — GEAR STAYS DOWN', 2); }
    else P.pos[1] = gh + GEAR;
  } else if (P.pos[1] - GEAR <= floor) {
    if (gh < 0.5) { crash('Splashed into the sea'); return; }
    if (!onRw) { crash('Flew into the terrain'); return; }
    if (P.u[1] > 0.93 && P.f[1] > -0.2 && P.vs > D.hard) {
      P.ground = true; P.pos[1] = gh + GEAR; P.touchVS = P.vs; levelGround(); tone(90, 0.25, 'triangle', 0.4);
      flash(P.vs > -2.5 ? 'BUTTER! SMOOTH TOUCHDOWN' : 'TOUCHDOWN', 2);
      if (P.vs < -4) P.spd *= 0.85;
    } else { crash('Hard landing'); return; }
  }
  if (P.pos[1] > 3200) P.pos[1] = 3200;
  // rings
  const R = rings[P.next];
  if (R) {
    const da = V.dot(V.sub(prev, R.c), R.n), db = V.dot(V.sub(P.pos, R.c), R.n);
    if ((da < 0) !== (db < 0)) {
      const hit = V.lerp(prev, P.pos, da / (da - db));
      const off = V.len(V.sub(hit, R.c)) / D.ringR;
      if (off < 1) {
        P.next++; timeLeft += D.bonus;
        let acc = rings[P.next - 1].valley === 'sea' ? '   SEA PASS' : '';
        if (off < 0.25) { perfects++; accScore += 500; timeLeft += 3; acc = '   PERFECT +500 +3s'; tone(1760, 0.3, 'sine', 0.12, 0.16); }
        else if (off < 0.5) { greats++; accScore += 250; acc = '   GREAT +250'; }
        tone(880, 0.25, 'sine', 0.18); tone(1320, 0.4, 'sine', 0.14, 0.08);
        let gs = ''; if (ghostOn && ghost && ghost.rings && ghost.rings[P.next - 1] !== undefined) { const d = flightT - ghost.rings[P.next - 1]; gs = `   GHOST ${d <= 0 ? '−' : '+'}${Math.abs(d).toFixed(1)}s`; }
        ringTimes.push(flightT);
        flash((P.next >= NR ? 'ALL RINGS! LAND ON THE RUNWAY' : `RING ${P.next}/${NR}  +${D.bonus}s`) + acc + gs, 2.4);
      }
    }
  }
  for (const B of bonusRings) {
    if (B.got) continue;
    const da = V.dot(V.sub(prev, B.c), B.n), db = V.dot(V.sub(P.pos, B.c), B.n);
    if ((da < 0) !== (db < 0) && V.len(V.sub(V.lerp(prev, P.pos, da / (da - db)), B.c)) < D.bonusR) {
      B.got = true; bonusGot++; bonusScore += 750; timeLeft += D.gold;
      tone(1175, 0.2, 'triangle', 0.16); tone(1568, 0.25, 'triangle', 0.14, 0.09); tone(2093, 0.45, 'triangle', 0.12, 0.18);
      flash(`GOLD RING ${bonusGot}/${NB}   +${D.gold}s +750`, 2.4);
    }
  }
  timeLeft -= dt;
  if (timeLeft <= 0) { timeLeft = 0; endGame('timeout'); return; }
  if (P.next >= NR && P.ground && onRw && P.spd < 2.5) { endGame('win'); tone(660, 0.3, 'sine', 0.2); tone(990, 0.5, 'sine', 0.18, 0.15); }
  // warnings
  beepT -= dt;
  if (!P.ground && P.spd < 30 && beepT <= 0) { tone(1400, 0.12, 'square', 0.06); beepT = 0.45; }
}

function trailUpdate(dt) {
  for (const p of trail) { p.age += dt; p.pos[1] += dt * 0.6; }
  while (trail.length && trail[0].age > TRAIL_LIFE) trail.shift();
  if (P.alive && !P.ground && smokeOn && (state === 'play' || state === 'replay')) {
    const src = V.add(P.pos, V.add(V.mul(P.f, -4.9), V.mul(P.u, 0.4)));
    if (!lastEmit) lastEmit = src;
    const d = V.len(V.sub(src, lastEmit)), n = Math.min(30, Math.floor(d / 2.6));
    for (let k = 1; k <= n; k++) trail.push({ pos: V.lerp(lastEmit, src, k / n), age: (n - k) / n * dt, s: 0.6 + Math.random() * 0.35 });
    if (n) lastEmit = src;
    while (trail.length > 320) trail.shift();
  } else lastEmit = null;
}

// ---------------------------------------------------------------- camera & render
function updateCam(dt, t) {
  CAM.fov = 0;
  if (state === 'replay') { replayCam(); return; }
  if (state === 'title') {
    const a = t * 0.12; CAM.e = V.add(P.pos, [Math.sin(a) * 26, 5.5 + Math.sin(t * 0.3) * 1.5, Math.cos(a) * 26]); CAM.c = V.add(P.pos, [0, 0.6, 0]); CAM.up = [0, 1, 0]; return;
  }
  if (!P.alive) { const a = crashT * 0.35 + 1; CAM.c = crashPos; CAM.e = V.add(crashPos, [Math.sin(a) * 90, 35 + crashT * 6, Math.cos(a) * 90]); CAM.e[1] = Math.max(CAM.e[1], groundH(CAM.e[0], CAM.e[2]) + 10); CAM.up = [0, 1, 0]; return; }
  if (camMode === 1) { CAM.e = V.add(V.add(P.pos, V.mul(P.u, 0.95)), V.mul(P.f, -0.2)); CAM.c = V.add(CAM.e, P.f); CAM.up = P.u; return; }
  const want = V.add(V.add(P.pos, V.mul(P.f, -24)), V.add(V.mul(P.u, 5.5), [0, 2, 0]));
  chase = V.lerp(chase, want, 1 - Math.exp(-dt * 5));
  const g = Math.max(groundH(chase[0], chase[2]), 0); if (chase[1] < g + 2.5) chase[1] = g + 2.5;
  CAM.e = chase; CAM.c = V.add(P.pos, V.mul(P.f, 25)); CAM.up = V.norm(V.lerp([0, 1, 0], P.u, 0.5));
}
let DPR = 1, CW = 1, CH = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 1.75);
  const w = innerWidth, h = innerHeight;
  if (w !== CW || h !== CH || cv.width !== Math.round(w * DPR)) { CW = w; CH = h; cv.width = hud.width = Math.round(w * DPR); cv.height = hud.height = Math.round(h * DPR); }
}
function draw(mesh, model, o = {}) {
  gl.uniformMatrix4fv(U.uM, false, model); gl.uniform1f(U.uEmis, o.e || 0); gl.uniform3fv(U.uTint, o.t || [1, 1, 1]);
  gl.uniform1f(U.uAlpha, o.a === undefined ? 1 : o.a); gl.uniform1f(U.uWater, o.w || 0);
  gl.uniform1f(U.uSpec, o.s === undefined ? 0.14 : o.s); gl.uniform1f(U.uDetail, o.d || 0);
  gl.bindVertexArray(mesh.vao); gl.drawElements(gl.TRIANGLES, mesh.count, mesh.type, 0);
}
function sockMatrix() {
  const k = clamp(windSpd / 9, 0.15, 1), dir = windSpd > 0.2 ? V.norm([windV[0], 0, windV[2]]) : [0, 0, 1], fl = Math.sin(tNow * 7.3) * 0.05 * k;
  const f = V.norm([dir[0] * k + dir[2] * fl, -(1 - k) * 1.3 - 0.04, dir[2] * k - dir[0] * fl]), r = V.norm(V.cross([0, 1, 0], f)), u = V.cross(f, r);
  return basisM(V.mul(r, 1.2), V.mul(u, 1.2), V.mul(f, 1.2), [40, RW.y + 7.7, -480]);
}
function drawPlane(pm, ck, ang, tint, alpha) {
  const gh = alpha !== undefined, o = { s: 0.35 }; if (tint) o.t = tint; if (gh) { o.a = alpha; o.e = 0.35; }
  draw(M.body, pm, o);
  if (!ck) {
    draw(M.canopy, pm, gh ? { s: 1.6, a: alpha, t: tint } : { s: 1.6 });
    const c = Math.cos(ang), s = Math.sin(ang);
    draw(M.prop, mmul(pm, new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, -0.05, 3.62, 1])), gh ? { s: 0.3, a: alpha } : { s: 0.3 });
  }
}
function render(t) {
  resize(); E = envNow();
  const W = cv.width, H = cv.height, F = E.fog; gl.viewport(0, 0, W, H);
  gl.clearColor(F[0], F[1], F[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const ck = camMode === 1 && P.alive && state !== 'title' && state !== 'replay';
  const fov = (CAM.fov || (ck ? 72 : 62)) * RAD, asp = W / H;
  const proj = persp(fov, asp, ck ? 0.3 : 1.2, 45000), view = lookAt(CAM.e, CAM.c, CAM.up);
  VPm = mmul(proj, view);
  CAM.f = V.norm(V.sub(CAM.c, CAM.e)); CAM.r = V.norm(V.cross(CAM.f, CAM.up)); CAM.u = V.cross(CAM.r, CAM.f);
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
  gl.useProgram(skyP); gl.uniform3fv(SU.uR, CAM.r); gl.uniform3fv(SU.uU, CAM.u); gl.uniform3fv(SU.uF, CAM.f); gl.uniform3fv(SU.uSun, E.sun);
  gl.uniform3fv(SU.uHor, E.fog); gl.uniform3fv(SU.uZen, E.zen); gl.uniform3fv(SU.uSunC, E.sunC); gl.uniform1f(SU.uStars, E.stars); gl.uniform1f(SU.uFlash, flashV);
  gl.uniform2f(SU.uT, Math.tan(fov / 2) * asp, Math.tan(fov / 2));
  gl.bindVertexArray(skyVAO); gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  gl.useProgram(mainP);
  gl.uniformMatrix4fv(U.uVP, false, VPm); gl.uniform3fv(U.uSun, E.sun); gl.uniform3fv(U.uCam, CAM.e); gl.uniform3fv(U.uFog, E.fog);
  gl.uniform3fv(U.uSunC, E.sunC); gl.uniform3fv(U.uAmbS, E.ambS); gl.uniform3fv(U.uAmbG, E.ambG);
  gl.uniform1f(U.uFogD, E.fogD); gl.uniform1f(U.uTime, t);
  gl.uniform3fv(U.uLLP, V.add(P.pos, V.mul(P.f, 3))); gl.uniform3fv(U.uLLD, V.norm(V.add(P.f, [0, -0.1, 0])));
  gl.uniform1f(U.uLL, (E.night ? 1.4 : wxI ? 0.45 : 0) * (P.alive && state !== 'title' ? 1 : 0)); gl.uniform1f(U.uFlash, flashV);
  draw(terrain, I4, { d: 1 });
  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.polygonOffset(-1, -2); draw(M.runway, I4, { d: 1 });
  gl.polygonOffset(-2, -4); draw(M.marks, I4);
  gl.disable(gl.POLYGON_OFFSET_FILL);
  draw(M.trees, I4); draw(M.rocks, I4, { d: 1 }); draw(M.blds, I4);
  draw(M.lights, I4, { e: 1 });
  if (E.night) draw(M.wins, I4, { e: 1 });
  draw(M.sock, sockMatrix(), { s: 0.1 });
  for (const pk of PARKED) drawPlane(pk.M, false, 0.6, pk.t);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  draw(water, I4, { w: 1, a: 0.84 });
  gl.disable(gl.BLEND);
  draw(M.clouds, I4, { e: 0.5, t: E.cloud });
  const pulse = 0.5 + 0.5 * Math.sin(t * 6);
  for (let i = 0; i < NR; i++) {
    let o;
    if (i < P.next) o = { t: [0.3, 0.9, 0.4], e: 0.3 };
    else if (i === P.next) o = { t: [1, 0.78 + 0.1 * pulse, 0.2], e: 0.75 + 0.25 * pulse };
    else if (i === P.next + 1) o = { t: [0.4, 0.85, 1], e: 0.45 };
    else o = { t: [0.85, 0.9, 1], e: 0.2 };
    o.s = 0.4;
    draw(M.ring, rings[i].M, o);
  }
  for (const B of bonusRings) if (!B.got) {
    const k = 1 + 0.06 * Math.sin(t * 4 + B.c[0]);
    draw(M.ring, mmul(B.M, basisM([k, 0, 0], [0, k, 0], [0, 0, 1], [0, 0, 0])), { t: [1.15, 0.82, 0.18], e: 0.6 + 0.3 * Math.sin(t * 5), s: 1.2 });
  }
  if (P.alive || crashT < 0.15) {
    const pm = basisM(P.r, P.u, P.f, P.pos);
    drawPlane(pm, ck, propA, null);
    draw(M.plights, pm, { e: 1 });
    if ((t % 1.3) < 0.07) draw(M.strobe, pm, { e: 1 });
    if (!ck && (P.thr > 0.15 || state === 'play')) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); draw(M.propDisc, mmul(pm, basisM([1, 0, 0], [0, 1, 0], [0, 0, 1], [0, -0.05, 3.62])), { a: 0.1 + 0.16 * P.thr }); gl.depthMask(true); gl.disable(gl.BLEND); }
    const gh = groundH(P.pos[0], P.pos[2]), gy = Math.max(gh, 0), agl = P.pos[1] - gy;
    if (agl < 450) {
      const hf = V.norm([P.f[0], 0, P.f[2]]), hr = V.cross([0, 1, 0], hf), so = Math.min(agl / Math.max(E.sun[1], 0.25), 600);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-4, -8);
      draw(M.shadow, basisM(V.mul(hr, 5.8), [0, 1, 0], V.mul(hf, 4.2), [P.pos[0] - E.sun[0] * so * 0.3, gy + (gh > 0 && onRunway(P.pos) ? 0.5 : 0.3), P.pos[2] - E.sun[2] * so * 0.3]), { a: 0.38 * (1 - agl / 450) });
      gl.disable(gl.POLYGON_OFFSET_FILL); gl.depthMask(true); gl.disable(gl.BLEND);
    }
  }
  if (ghostOn && ghost && (state === 'play' || state === 'replay')) {
    const g = ghostPose(state === 'replay' ? rpTime : flightT);
    if (g && V.len(V.sub(g.p, CAM.e)) > 8) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); drawPlane(basisM(g.r, g.u, g.f, g.p), false, propA, [0.55, 0.85, 1.35], 0.42); gl.depthMask(true); gl.disable(gl.BLEND); }
  }
  if (trail.length) {
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    const arr = trail.map(p => [V.len(V.sub(p.pos, CAM.e)), p]).sort((a, b) => b[0] - a[0]), tc = V.mul(E.cloud, 0.97);
    for (const [d, p] of arr) {
      const sz = p.s * (0.6 + p.age * 1.0), a = 0.42 * (1 - p.age / TRAIL_LIFE) * Math.min(1, 0.4 + p.age * 3) * ss(8, 30, d);
      if (a > 0.01) draw(M.puff, basisM([sz, 0, 0], [0, sz, 0], [0, 0, sz], p.pos), { t: tc, e: 0.45, a, s: 0 });
    }
    gl.depthMask(true); gl.disable(gl.BLEND);
  }
  if (!P.alive) {
    const k = Math.min(1, crashT / 1.2), s = 4 + k * 30;
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    draw(M.ball, basisM([s * 1.6, 0, 0], [0, s * 1.8, 0], [0, 0, s * 1.6], V.add(crashPos, [0, s * 0.8 + crashT * 6, 0])), { t: [0.18, 0.17, 0.17], e: 0.2, a: Math.max(0, 0.75 * (1 - crashT / 6)) });
    draw(M.ball, basisM([s, 0, 0], [0, s, 0], [0, 0, s], crashPos), { t: [1, 0.55 - k * 0.25, 0.12], e: 1, a: Math.max(0, 1 - crashT / 2.2) });
    gl.depthMask(true); gl.disable(gl.BLEND);
  }
  gl.bindVertexArray(null);
}

// ---------------------------------------------------------------- HUD
const HGC = 'rgba(130,255,175,0.95)', GOLD = '#ffd27a', AMB = '#ffcf7a';
const font = (s, w = 600) => `${w} ${s}px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`;
function txt(s, x, y, al = 'left', size = 13, col = HGC, w = 600) { hx.font = font(size, w); hx.textAlign = al; hx.textBaseline = 'middle'; hx.fillStyle = col; hx.fillText(s, x, y); }
function project(p) {
  const m = VPm, x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  if (w <= 0.1) return null; return { x: (x / w * 0.5 + 0.5) * CW, y: (0.5 - y / w * 0.5) * CH };
}
function gauge(x, y, r, kind, pitch, roll, hdg) {
  hx.save(); hx.translate(x, y); hx.shadowBlur = 0;
  hx.beginPath(); hx.arc(0, 0, r + 5, 0, 7); hx.fillStyle = '#0b0d0f'; hx.fill();
  hx.lineWidth = 2.5; hx.strokeStyle = '#50565c'; hx.beginPath(); hx.arc(0, 0, r + 3, 0, 7); hx.stroke();
  const g = hx.createRadialGradient(0, -r * 0.35, r * 0.05, 0, 0, r); g.addColorStop(0, '#26332d'); g.addColorStop(1, '#050807');
  hx.beginPath(); hx.arc(0, 0, r, 0, 7); hx.fillStyle = g; hx.fill();
  hx.shadowColor = 'rgba(255,185,80,0.95)'; hx.shadowBlur = r * 0.2; hx.strokeStyle = AMB; hx.fillStyle = AMB; hx.lineWidth = Math.max(1, r * 0.03);
  const fs = Math.max(8, r * 0.19) | 0; hx.font = font(fs, 700); hx.textAlign = 'center'; hx.textBaseline = 'middle';
  const tick = (a, r0, r1) => { hx.beginPath(); hx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); hx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); hx.stroke(); };
  const at = (a, rr, s) => hx.fillText(s, Math.cos(a) * rr, Math.sin(a) * rr);
  const needle = (a, len, w, col = '#ffffff') => { hx.save(); hx.rotate(a); hx.fillStyle = col; hx.shadowColor = 'rgba(255,255,255,0.8)'; hx.beginPath(); hx.moveTo(-r * 0.14, -w); hx.lineTo(len, 0); hx.lineTo(-r * 0.14, w); hx.closePath(); hx.fill(); hx.restore(); };
  const lab = s => { hx.save(); hx.font = font(Math.max(7, r * 0.13) | 0); hx.globalAlpha = 0.85; hx.fillText(s, 0, r * 0.34); hx.restore(); };
  const hub = () => { hx.beginPath(); hx.arc(0, 0, r * 0.07, 0, 7); hx.fillStyle = '#ddd'; hx.fill(); };
  const kt = P.spd * 1.944, ft = Math.max(0, P.pos[1] * 3.281);
  if (kind === 'asi') {
    const A = v => -Math.PI / 2 + (v / 200 * 300 - 150) * RAD;
    hx.lineWidth = r * 0.07; hx.strokeStyle = '#3fd46a'; hx.beginPath(); hx.arc(0, 0, r * 0.86, A(55), A(130)); hx.stroke();
    hx.strokeStyle = '#ffd23f'; hx.beginPath(); hx.arc(0, 0, r * 0.86, A(130), A(165)); hx.stroke();
    hx.strokeStyle = '#ff4a3a'; tick(A(165), r * 0.78, r * 0.95);
    hx.lineWidth = Math.max(1, r * 0.03); hx.strokeStyle = AMB;
    for (let v = 0; v <= 200; v += 10) { tick(A(v), r * (v % 50 ? 0.84 : 0.74), r * 0.93); if (v % 50 === 0 && v) at(A(v), r * 0.56, String(v)); }
    lab('KNOTS'); needle(A(clamp(kt, 0, 200)), r * 0.84, r * 0.05); hub();
  } else if (kind === 'alt') {
    for (let k = 0; k < 50; k++) tick(-Math.PI / 2 + k / 50 * Math.PI * 2, r * (k % 5 ? 0.86 : 0.76), r * 0.93);
    for (let k = 0; k < 10; k++) at(-Math.PI / 2 + k / 10 * Math.PI * 2, r * 0.6, String(k));
    lab('ALT FT'); needle(-Math.PI / 2 + (ft % 10000) / 10000 * Math.PI * 2, r * 0.48, r * 0.09); needle(-Math.PI / 2 + (ft % 1000) / 1000 * Math.PI * 2, r * 0.86, r * 0.045); hub();
  } else if (kind === 'att') {
    hx.save(); hx.beginPath(); hx.arc(0, 0, r * 0.95, 0, 7); hx.clip(); hx.shadowBlur = 0; hx.rotate(-roll * RAD);
    const off = clamp(pitch, -40, 40) * r / 45;
    hx.fillStyle = '#2f78d8'; hx.fillRect(-r * 2, -r * 2 + off, r * 4, r * 2); hx.fillStyle = '#8a5a2b'; hx.fillRect(-r * 2, off, r * 4, r * 2);
    hx.strokeStyle = '#fff'; hx.lineWidth = Math.max(1, r * 0.035); hx.beginPath(); hx.moveTo(-r, off); hx.lineTo(r, off); hx.stroke();
    hx.lineWidth = Math.max(1, r * 0.02);
    for (const d of [-20, -10, 10, 20]) { const yy = off - d * r / 45, w = r * (Math.abs(d) === 10 ? 0.22 : 0.34); hx.beginPath(); hx.moveTo(-w, yy); hx.lineTo(w, yy); hx.stroke(); }
    hx.restore();
    hx.save(); hx.rotate(-roll * RAD); hx.strokeStyle = '#fff'; for (const b of [-60, -30, -20, -10, 0, 10, 20, 30, 60]) tick(-Math.PI / 2 + b * RAD, r * 0.82, r * (b % 30 ? 0.9 : 0.97)); hx.restore();
    hx.fillStyle = AMB; hx.beginPath(); hx.moveTo(0, -r * 0.8); hx.lineTo(-r * 0.07, -r * 0.68); hx.lineTo(r * 0.07, -r * 0.68); hx.closePath(); hx.fill();
    hx.strokeStyle = AMB; hx.lineWidth = Math.max(2, r * 0.07); hx.beginPath(); hx.moveTo(-r * 0.6, 0); hx.lineTo(-r * 0.2, 0); hx.lineTo(-r * 0.1, r * 0.1); hx.moveTo(r * 0.6, 0); hx.lineTo(r * 0.2, 0); hx.lineTo(r * 0.1, r * 0.1); hx.stroke();
    hx.beginPath(); hx.arc(0, 0, r * 0.05, 0, 7); hx.fill();
  } else if (kind === 'hdg') {
    hx.save(); hx.rotate(-hdg * RAD);
    for (let d = 0; d < 360; d += 10) tick(-Math.PI / 2 + d * RAD, r * (d % 30 ? 0.84 : 0.74), r * 0.93);
    for (let d = 0; d < 360; d += 30) { hx.save(); hx.rotate(d * RAD); hx.translate(0, -r * 0.6); hx.fillStyle = d % 90 ? AMB : '#ffffff'; hx.fillText(d % 90 ? String(d / 10) : 'NESW'[d / 90], 0, 0); hx.restore(); }
    hx.restore();
    hx.strokeStyle = '#fff'; hx.lineWidth = Math.max(1.5, r * 0.05);
    hx.beginPath(); hx.moveTo(0, -r * 0.35); hx.lineTo(0, r * 0.3); hx.moveTo(-r * 0.28, -r * 0.02); hx.lineTo(r * 0.28, -r * 0.02); hx.moveTo(-r * 0.12, r * 0.26); hx.lineTo(r * 0.12, r * 0.26); hx.stroke();
    tick(-Math.PI / 2, r * 0.94, r * 1.0);
  } else if (kind === 'vsi') {
    const A = v => Math.PI + clamp(v, -2000, 2000) / 2000 * Math.PI * 0.9;
    for (let v = -2000; v <= 2000; v += 100) tick(A(v), r * (v % 500 ? 0.86 : 0.74), r * 0.93);
    for (let v = -2000; v <= 2000; v += 500) at(A(v), r * 0.58, String(Math.abs(v / 100)));
    lab('FPM x100'); needle(A(P.vs * 196.85), r * 0.84, r * 0.05); hub();
  } else if (kind === 'rpm') {
    const A = v => -Math.PI / 2 + (v / 2700 * 270 - 135) * RAD, rpm = state === 'play' || state === 'end' ? 700 + P.thr * 1900 : 0;
    hx.lineWidth = r * 0.07; hx.strokeStyle = '#3fd46a'; hx.beginPath(); hx.arc(0, 0, r * 0.86, A(2100), A(2500)); hx.stroke(); hx.strokeStyle = AMB; hx.lineWidth = Math.max(1, r * 0.03);
    for (let v = 0; v <= 2700; v += 100) tick(A(v), r * (v % 500 ? 0.84 : 0.74), r * 0.93);
    for (let v = 0; v <= 2500; v += 500) at(A(v), r * 0.56, String(v / 100));
    lab('RPM x100'); needle(A(rpm), r * 0.84, r * 0.05); hub();
  }
  hx.restore();
}
function cockpitFrame(W, H, pitch, roll, hdg) {
  const top = H * 0.7;
  hx.save(); hx.shadowBlur = 0; hx.strokeStyle = '#121416'; hx.lineCap = 'round';
  hx.lineWidth = Math.max(10, W * 0.012); hx.beginPath(); hx.moveTo(W * 0.13, top); hx.lineTo(W * 0.04, -10); hx.moveTo(W * 0.87, top); hx.lineTo(W * 0.96, -10); hx.stroke();
  hx.lineWidth = Math.max(14, H * 0.03); hx.beginPath(); hx.moveTo(-10, H * 0.02); hx.quadraticCurveTo(W / 2, H * 0.075, W + 10, H * 0.02); hx.stroke();
  const g = hx.createLinearGradient(0, top - H * 0.06, 0, H); g.addColorStop(0, '#2c3136'); g.addColorStop(0.15, '#1a1d20'); g.addColorStop(1, '#070809');
  hx.fillStyle = g; hx.beginPath(); hx.moveTo(0, top + H * 0.02); hx.quadraticCurveTo(W / 2, top - H * 0.07, W, top + H * 0.02); hx.lineTo(W, H); hx.lineTo(0, H); hx.closePath(); hx.fill();
  hx.strokeStyle = 'rgba(255,190,110,0.3)'; hx.lineWidth = 2; hx.beginPath(); hx.moveTo(0, top + H * 0.035); hx.quadraticCurveTo(W / 2, top - H * 0.055, W, top + H * 0.035); hx.stroke();
  hx.restore();
  const r = Math.min(H * 0.095, W * 0.062), y = top + (H - top) * 0.55, sp = r * 2.42, x0 = W / 2 - sp * 2.5;
  ['asi', 'att', 'alt', 'rpm', 'hdg', 'vsi'].forEach((k, i) => gauge(x0 + i * sp, y, r, k, pitch, roll, hdg));
  hx.save(); hx.shadowColor = 'rgba(255,60,40,0.9)'; hx.shadowBlur = 8;
  const lamp = (lx, on, label, col) => { hx.fillStyle = on ? col : '#2a1a18'; hx.beginPath(); hx.arc(lx, top + H * 0.06, 5, 0, 7); hx.fill(); txt(label, lx + 10, top + H * 0.06, 'left', 10, on ? col : '#5a4a48'); };
  lamp(W * 0.18, !P.ground && P.spd < 30, 'STALL', '#ff4a3a'); lamp(W * 0.18 + 90, true, 'GEAR DN', '#5dff8a'); lamp(W * 0.74, keys.KeyB || keys.Space, 'BRAKE', '#ffcf3a');
  hx.restore();
}
function tape(x, y, val, step, every, side, title, unit) {
  const h = 210, px = 19, edge = side < 0 ? x + 34 : x - 34, dir = side < 0 ? -1 : 1;
  hx.save(); hx.shadowBlur = 0; hx.fillStyle = 'rgba(0,20,10,0.28)'; hx.fillRect(x - 36, y - h / 2, 72, h); hx.restore(); hx.save();
  hx.beginPath(); hx.rect(x - 36, y - h / 2, 72, h); hx.clip(); hx.shadowBlur = 0;
  const b = Math.floor(val / step) * step;
  for (let k = -7; k <= 7; k++) {
    const v = b + k * step; if (v < 0 && title === 'SPD') continue;
    const yy = y - (v - val) / step * px, maj = Math.round(v / step) % every === 0;
    hx.beginPath(); hx.moveTo(edge, yy); hx.lineTo(edge + dir * (maj ? 12 : 6), yy); hx.stroke();
    if (maj) txt(String(Math.round(v)), edge + dir * 16, yy, side < 0 ? 'right' : 'left', 12);
  }
  hx.restore();
  hx.save(); hx.shadowBlur = 0; hx.fillStyle = 'rgba(0,15,8,0.8)'; hx.fillRect(x - 38, y - 13, 76, 26); hx.restore(); hx.strokeRect(x - 38, y - 13, 76, 26);
  txt(String(Math.round(val)), x, y + 1, 'center', 16, '#eafff1', 700);
  txt(title + ' ' + unit, x, y - h / 2 - 12, 'center', 11);
}
const glowCache = new Map();
function glowSprite(col) {
  let sp = glowCache.get(col); if (sp) return sp;
  sp = document.createElement('canvas'); sp.width = sp.height = 64; const c = sp.getContext('2d'), g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.12, `rgba(${col},0.95)`); g.addColorStop(0.4, `rgba(${col},0.25)`); g.addColorStop(1, `rgba(${col},0)`);
  c.fillStyle = g; c.fillRect(0, 0, 64, 64); glowCache.set(col, sp); return sp;
}
function postFX(W, H) {
  hx.save(); hx.shadowBlur = 0; hx.shadowColor = 'rgba(0,0,0,0)'; hx.globalAlpha = 1; hx.globalCompositeOperation = 'source-over';
  // light glows (night, or murk)
  const nk = E.night ? 1 : (wxI ? 0.45 : 0);
  if (nk > 0) {
    hx.globalCompositeOperation = 'lighter';
    const pts = LGLOW.slice();
    if (P.alive && state !== 'title') {
      const navs = [[[-5.82, -0.03, 0.55], '255,60,50'], [[5.82, -0.03, 0.55], '60,255,110'], [[0, 0.5, -4.8], '255,255,255']];
      if ((tNow % 1.3) < 0.07) navs.push([[-5.82, -0.03, -0.2], '255,255,255'], [[5.82, -0.03, -0.2], '255,255,255']);
      for (const [m, col] of navs) pts.push({ p: V.add(P.pos, V.add(V.add(V.mul(P.r, m[0]), V.mul(P.u, m[1])), V.mul(P.f, m[2]))), col, big: 1 });
    }
    for (const L0 of pts) {
      const d = V.len(V.sub(L0.p, CAM.e)); if (d > 6000 || d < 2) continue;
      const s = project(L0.p); if (!s || s.x < -20 || s.y < -20 || s.x > W + 20 || s.y > H + 20) continue;
      let occ = false; for (let k = 1; k <= 5 && !occ; k++) { const q = V.lerp(CAM.e, L0.p, k / 6); if (groundH(q[0], q[2]) > q[1] + 1) occ = true; }
      if (occ) continue;
      const r = clamp(900 / d, 2.5, L0.big ? 26 : 14) * (0.6 + 0.4 * nk), a = nk * Math.exp(-d / (E.fogD * 1.1));
      if (a < 0.03) continue; hx.globalAlpha = Math.min(1, a); hx.drawImage(glowSprite(L0.col), s.x - r, s.y - r, r * 2, r * 2);
    }
    hx.globalAlpha = 1; hx.globalCompositeOperation = 'source-over';
  }
  // sun glare + lens flare
  const sd = E.sun, sp = project(V.add(CAM.e, V.mul(sd, 20000))), fd = V.dot(CAM.f, sd);
  if (E.flare && sp && fd > 0.2) {
    let occ = false; for (let k = 1; k <= 30 && !occ; k++) { const q = V.add(CAM.e, V.mul(sd, k * 220)); if (groundH(q[0], q[2]) > q[1]) occ = true; }
    if (!occ) {
      const vis = clamp((fd - 0.2) / 0.6, 0, 1), sc = E.sunC.map(v => Math.round(clamp(v / 1.45, 0, 1) * 255)).join(',');
      hx.globalCompositeOperation = 'lighter';
      const g = hx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, H * 0.5);
      g.addColorStop(0, `rgba(${sc},${0.5 * vis})`); g.addColorStop(0.12, `rgba(${sc},${0.2 * vis})`); g.addColorStop(1, `rgba(${sc},0)`);
      hx.fillStyle = g; hx.fillRect(0, 0, W, H);
      [[0.35, 18, 0.1], [0.62, 34, 0.06], [1.25, 52, 0.07], [1.55, 16, 0.1], [1.9, 70, 0.04]].forEach(([k, r, a], i) => {
        const x = sp.x + (W / 2 - sp.x) * k, y = sp.y + (H / 2 - sp.y) * k, gg = hx.createRadialGradient(x, y, 0, x, y, r), col = i % 2 ? '120,200,255' : sc;
        gg.addColorStop(0, `rgba(${col},${a * vis})`); gg.addColorStop(0.7, `rgba(${col},${a * 0.6 * vis})`); gg.addColorStop(1, `rgba(${col},0)`);
        hx.fillStyle = gg; hx.beginPath(); hx.arc(x, y, r, 0, 7); hx.fill();
      });
      hx.globalCompositeOperation = 'source-over';
    }
  }
  // lightning
  if (flashV > 0) { hx.fillStyle = `rgba(220,225,255,${flashV * 0.16})`; hx.fillRect(0, 0, W, H); }
  if (flashV > 0.22 && boltPts) {
    hx.save(); hx.strokeStyle = `rgba(235,240,255,${Math.min(1, flashV + 0.2)})`; hx.lineWidth = 2.6; hx.shadowColor = 'rgba(190,205,255,1)'; hx.shadowBlur = 18; hx.lineJoin = 'round';
    hx.beginPath(); boltPts.forEach(([x, y], i) => i ? hx.lineTo(x * W, y * H) : hx.moveTo(x * W, y * H)); hx.stroke();
    hx.lineWidth = 1.2; hx.beginPath(); const b = boltPts[Math.floor(boltPts.length / 2)]; hx.moveTo(b[0] * W, b[1] * H); hx.lineTo((b[0] + 0.05) * W, (b[1] + 0.12) * H); hx.stroke(); hx.restore();
  }
  // rain
  const rn = WX[wxI].rain;
  if (rn) {
    const n = Math.round(rn * 130); while (drops.length < n) drops.push({ x: Math.random(), y: Math.random(), l: 0.03 + Math.random() * 0.05, s: 1.6 + Math.random() * 1.4 }); drops.length = n;
    const sl = -0.18 - (P.cr || 0) * 0.1;
    hx.strokeStyle = E.night ? `rgba(150,165,190,${0.3 + flashV * 0.4})` : 'rgba(215,225,240,0.38)'; hx.lineWidth = 1.2; hx.beginPath();
    for (const d of drops) { d.y += d.s * FDT; d.x += sl * d.s * FDT * 0.3; if (d.y > 1.05) { d.y = -0.1; d.x = Math.random(); } const x = d.x * W, y = d.y * H; hx.moveTo(x, y); hx.lineTo(x + sl * d.l * H * 0.4, y + d.l * H); }
    hx.stroke();
  }
  const vg = hx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.hypot(W, H) * 0.6);
  vg.addColorStop(0, `rgba(${E.vig},0)`); vg.addColorStop(1, `rgba(${E.vig},${E.vigA})`);
  hx.fillStyle = vg; hx.fillRect(0, 0, W, H);
  hx.restore();
}
function drawReplayHUD(W, H, t) {
  const bh = H * 0.085, n = rec.length ? rec[rec.length - 1][13] - rpT0 : 1;
  hx.save(); hx.shadowBlur = 0; hx.fillStyle = '#000'; hx.fillRect(0, 0, W, bh); hx.fillRect(0, H - bh, W, bh);
  if ((t * 1.5) % 1 < 0.65) { hx.fillStyle = '#ff3b30'; hx.beginPath(); hx.arc(22, bh / 2, 6, 0, 7); hx.fill(); }
  txt('REPLAY', 36, bh / 2, 'left', 15, '#ffffff', 800);
  txt(RP_SHOTS[Math.max(0, rpShot)] + ' · ' + fmtT(rpT) + ' / ' + fmtT(n), W - 16, bh / 2, 'right', 12, GOLD, 700);
  hx.fillStyle = 'rgba(255,255,255,0.18)'; hx.fillRect(16, H - bh / 2 - 2, W - 32, 4); hx.fillStyle = GOLD; hx.fillRect(16, H - bh / 2 - 2, (W - 32) * clamp(rpT / n, 0, 1), 4);
  txt('ENTER / CLICK TO SKIP', W / 2, H - bh / 2 - 13, 'center', 10, 'rgba(255,255,255,0.7)', 600);
  txt(`ALT ${Math.round(P.pos[1] * 3.281)} FT · ${Math.round(P.spd * 1.944)} KT · RINGS ${P.next}/${NR}`, 16, H - bh / 2 + 14, 'left', 11, 'rgba(255,255,255,0.85)', 600);
  hx.restore();
}
function drawHUD(t) {
  const W = CW, H = CH;
  hx.setTransform(DPR, 0, 0, DPR, 0, 0); hx.clearRect(0, 0, W, H);
  postFX(W, H);
  if (state === 'title') return;
  if (state === 'replay') { drawReplayHUD(W, H, t); return; }
  const ck = camMode === 1 && P.alive;
  const pitch = Math.asin(clamp(P.f[1], -1, 1)) * DEG, roll = Math.atan2(-P.r[1], P.u[1]) * DEG, hdg = (Math.atan2(P.f[0], P.f[2]) * DEG + 360) % 360;
  const kt = P.spd * 1.944, ft = P.pos[1] * 3.281, gh = Math.max(groundH(P.pos[0], P.pos[2]), 0), agl = (P.pos[1] - GEAR - gh) * 3.281, fpm = P.vs * 196.85;
  if (ck) cockpitFrame(W, H, pitch, roll, hdg);
  hx.lineWidth = 1.6; hx.strokeStyle = HGC; hx.fillStyle = HGC; hx.shadowColor = 'rgba(60,255,140,0.75)'; hx.shadowBlur = 5;
  const cx = W / 2, cy = ck ? H * 0.42 : H * 0.44, ppd = H / 62;
  if (P.alive) {
    // pitch ladder
    hx.save(); hx.beginPath(); hx.rect(cx - 170, cy - 145, 340, 290); hx.clip(); hx.translate(cx, cy); hx.rotate(-roll * RAD);
    for (let d = -80; d <= 80; d += 10) {
      const yy = (pitch - d) * ppd; if (Math.abs(yy) > 210) continue;
      hx.beginPath();
      if (d === 0) { hx.moveTo(-230, yy); hx.lineTo(-45, yy); hx.moveTo(45, yy); hx.lineTo(230, yy); hx.stroke(); continue; }
      const w = 62, tk = d > 0 ? 8 : -8; hx.setLineDash(d < 0 ? [7, 5] : []);
      hx.moveTo(-w - 30, yy + tk); hx.lineTo(-w - 30, yy); hx.lineTo(-30, yy); hx.moveTo(30, yy); hx.lineTo(w + 30, yy); hx.lineTo(w + 30, yy + tk); hx.stroke(); hx.setLineDash([]);
      txt(String(Math.abs(d)), -w - 46, yy, 'center', 11); txt(String(Math.abs(d)), w + 46, yy, 'center', 11);
    }
    hx.restore();
    // bank scale
    hx.save(); hx.translate(cx, cy); const br = 150;
    hx.beginPath(); hx.arc(0, 0, br, -Math.PI / 2 - 60 * RAD, -Math.PI / 2 + 60 * RAD); hx.stroke();
    for (const b of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) { const a = -Math.PI / 2 + b * RAD, l = b % 30 ? 7 : 13; hx.beginPath(); hx.moveTo(Math.cos(a) * br, Math.sin(a) * br); hx.lineTo(Math.cos(a) * (br + l), Math.sin(a) * (br + l)); hx.stroke(); }
    hx.rotate(-roll * RAD); hx.beginPath(); hx.moveTo(0, -br + 2); hx.lineTo(-7, -br + 14); hx.lineTo(7, -br + 14); hx.closePath(); hx.fill();
    hx.restore();
    // aircraft symbol
    hx.lineWidth = 2.2; hx.beginPath(); hx.moveTo(cx - 40, cy); hx.lineTo(cx - 14, cy); hx.lineTo(cx - 7, cy + 9); hx.lineTo(cx, cy); hx.lineTo(cx + 7, cy + 9); hx.lineTo(cx + 14, cy); hx.lineTo(cx + 40, cy); hx.stroke(); hx.lineWidth = 1.6;
    // flight path marker
    const vel = V.add(V.mul(P.f, Math.max(P.spd, 1)), [0, P.vs - P.f[1] * P.spd, 0]), fp = project(V.add(CAM.e, V.mul(V.norm(vel), 500)));
    if (fp && P.spd > 5) { hx.beginPath(); hx.arc(fp.x, fp.y, 6, 0, 7); hx.moveTo(fp.x - 16, fp.y); hx.lineTo(fp.x - 6, fp.y); hx.moveTo(fp.x + 6, fp.y); hx.lineTo(fp.x + 16, fp.y); hx.moveTo(fp.x, fp.y - 6); hx.lineTo(fp.x, fp.y - 13); hx.stroke(); }
    // heading tape
    const ty = ck ? H * 0.085 : 26;
    hx.save(); hx.beginPath(); hx.rect(cx - 170, ty - 4, 340, 34); hx.clip();
    for (let d = Math.floor(hdg / 5) * 5 - 45; d <= hdg + 45; d += 5) {
      const xx = cx + (d - hdg) * 3.8, v = ((d % 360) + 360) % 360, maj = v % 10 === 0;
      hx.beginPath(); hx.moveTo(xx, ty); hx.lineTo(xx, ty + (maj ? 10 : 5)); hx.stroke();
      if (maj) txt(v % 90 === 0 ? 'NESW'[v / 90] : String(v / 10).padStart(2, '0'), xx, ty + 20, 'center', v % 90 === 0 ? 14 : 11, v % 90 === 0 ? '#eafff1' : HGC);
    }
    hx.restore();
    hx.beginPath(); hx.moveTo(cx, ty - 2); hx.lineTo(cx - 6, ty - 10); hx.lineTo(cx + 6, ty - 10); hx.closePath(); hx.fill();
    txt(String(Math.round(hdg)).padStart(3, '0') + '°', cx, ty - 18 < 8 ? ty + 40 : ty - 18, 'center', 13, '#eafff1', 700);
    // tapes
    const off = Math.min(235, W * 0.34);
    tape(cx - off, cy, kt, 10, 2, -1, 'SPD', 'KT');
    tape(cx + off, cy, ft, 50, 2, 1, 'ALT', 'FT');
    txt(`V/S ${fpm >= 0 ? '+' : ''}${Math.round(fpm / 10) * 10}`, cx + off, cy + 125, 'center', 12);
    txt(`AGL ${Math.max(0, Math.round(agl))}`, cx + off, cy + 141, 'center', 12);
    txt(`THR ${Math.round(P.thr * 100)}%`, cx - off, cy + 125, 'center', 12);
    txt(`G ${(1 + Math.abs(P.cp) * P.spd / 60).toFixed(1)}`, cx - off, cy + 141, 'center', 12);
    // warnings
    const blink = (t * 3 % 1) < 0.6;
    const ahead = V.add(P.pos, V.mul([P.f[0] * P.spd, P.vs, P.f[2] * P.spd], 4));
    const warnY = cy + 60;
    if (!P.ground && P.spd < 30 && blink) txt('STALL', cx, warnY, 'center', 20, '#ff5a4a', 800);
    else if (!P.ground && P.pos[1] > 0 && ahead[1] < (() => { const g = groundH(ahead[0], ahead[2]); return g < 0 ? 6 : g + 25; })() && !onRunway(ahead) && blink) { txt('PULL UP', cx, warnY, 'center', 20, '#ff5a4a', 800); if (beepT <= 0) { tone(700, 0.15, 'square', 0.06); beepT = 0.35; } }
    else if (Math.hypot(P.pos[0], P.pos[2]) > 7000 && blink) txt('TURN BACK — LEAVING THE ISLAND', cx, warnY, 'center', 16, GOLD, 800);
    // target guidance
    const tg = P.next < NR ? { p: rings[P.next].c, l: `RING ${P.next + 1}${rings[P.next].valley === 'sea' ? ' · SEA' : rings[P.next].valley ? ' · VALLEY' : ''}` } : { p: [0, RW.y + 3, P.pos[2] < 0 ? -RW.hz : RW.hz], l: 'RUNWAY' };
    const dist = V.len(V.sub(tg.p, P.pos)), ds = dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(1)} km`;
    const s = project(tg.p);
    hx.save(); hx.strokeStyle = GOLD; hx.fillStyle = GOLD; hx.shadowColor = 'rgba(255,190,80,0.9)'; hx.lineWidth = 2;
    if (s && s.x > 40 && s.x < W - 40 && s.y > 40 && s.y < H - 40) {
      const q = 13; hx.beginPath(); hx.moveTo(s.x, s.y - q); hx.lineTo(s.x + q, s.y); hx.lineTo(s.x, s.y + q); hx.lineTo(s.x - q, s.y); hx.closePath(); hx.stroke();
      txt(`${tg.l} · ${ds}`, s.x, s.y + q + 13, 'center', 12, GOLD, 700);
    } else {
      const d = V.sub(tg.p, CAM.e), a = Math.atan2(-V.dot(d, CAM.u), V.dot(d, CAM.r));
      const ex = cx + Math.cos(a) * W * 0.36, ey = H * 0.45 + Math.sin(a) * H * 0.33;
      hx.save(); hx.translate(ex, ey); hx.rotate(a); hx.beginPath(); hx.moveTo(18, 0); hx.lineTo(-8, -11); hx.lineTo(-3, 0); hx.lineTo(-8, 11); hx.closePath(); hx.fill(); hx.restore();
      txt(`${tg.l} · ${ds}`, ex, ey + 24, 'center', 12, GOLD, 700);
    }
    hx.restore();
  }
  if (P.alive && ghostOn && ghost && state === 'play') {
    const g = ghostPose(flightT), gs = g && project(g.p), gd = g ? V.len(V.sub(g.p, P.pos)) : 0;
    if (gs && gd > 15 && gd < 3000 && gs.x > 0 && gs.x < W && gs.y > 0 && gs.y < H) { hx.save(); hx.shadowColor = 'rgba(120,200,255,0.9)'; hx.shadowBlur = 8; txt(`GHOST · ${Math.round(gd)} m`, gs.x, gs.y - 20, 'center', 11, '#9fdcff', 700); hx.restore(); }
  }
  // timer & rings
  const tY = ck ? H * 0.135 : 78, low = timeLeft < 30;
  hx.save(); hx.shadowColor = low ? 'rgba(255,80,60,0.9)' : 'rgba(255,190,80,0.8)'; hx.shadowBlur = 10;
  txt('DEADLINE', cx - 8, tY, 'right', 12, low ? '#ff6a5a' : GOLD, 700);
  txt(fmtT(timeLeft), cx, tY, 'left', 24, low && (t * 2 % 1) < 0.5 ? '#ff6a5a' : '#fff3d6', 800);
  txt(`RINGS ${P.next}/${NR}  ·  GOLD ${bonusGot}/${NB}`, cx, tY + 24, 'center', 13, GOLD, 700);
  txt(`${D.name}${routeRandom ? ' · RANDOM ROUTE' : ''}  ·  SCORE ${score(false)}`, cx, tY + 42, 'center', 11, D.col, 700);
  hx.restore();
  if (countdown > 0 && state === 'play') {
    const c = Math.ceil(countdown), fr = countdown - Math.floor(countdown), sz = 90 + 50 * fr;
    hx.save(); hx.globalAlpha = Math.min(1, 0.35 + fr); hx.shadowColor = 'rgba(255,190,80,0.95)'; hx.shadowBlur = 24;
    txt(String(c), cx, H * 0.4, 'center', sz, '#fff3d6', 900);
    hx.globalAlpha = 1; hx.shadowBlur = 8; txt('GET READY — SET THROTTLE (R)', cx, H * 0.4 + 80, 'center', 15, GOLD, 800);
    hx.restore();
  }
  // message
  if (msgT > 0) { hx.save(); hx.globalAlpha = Math.min(1, msgT); hx.shadowColor = 'rgba(255,200,90,0.9)'; hx.shadowBlur = 14; txt(msg, cx, H * (ck ? 0.25 : 0.27), 'center', Math.min(26, W / 22), '#fff3d6', 800); hx.restore(); }
  // minimap
  const ms = Math.min(150, W * 0.26), mx = W - ms - 12, my = 12;
  hx.save(); hx.shadowBlur = 0; hx.globalAlpha = 0.92; hx.beginPath(); hx.rect(mx, my, ms, ms); hx.clip(); hx.drawImage(mini, mx, my, ms, ms);
  const mp = (x, z) => [mx + (x + MR) / (2 * MR) * ms, my + (MR - z) / (2 * MR) * ms];
  hx.strokeStyle = '#fff'; hx.lineWidth = 2; let a = mp(0, -RW.hz), b = mp(0, RW.hz); hx.beginPath(); hx.moveTo(a[0], a[1]); hx.lineTo(b[0], b[1]); hx.stroke();
  bonusRings.forEach(B => { if (B.got) return; const p = mp(B.c[0], B.c[2]); hx.fillStyle = '#ffb21f'; hx.beginPath(); hx.moveTo(p[0], p[1] - 4); hx.lineTo(p[0] + 3, p[1]); hx.lineTo(p[0], p[1] + 4); hx.lineTo(p[0] - 3, p[1]); hx.closePath(); hx.fill(); });
  rings.forEach((rg, i) => { const p = mp(rg.c[0], rg.c[2]); hx.fillStyle = i < P.next ? '#5dff8a' : i === P.next ? GOLD : 'rgba(255,255,255,0.8)'; hx.beginPath(); hx.arc(p[0], p[1], i === P.next ? 4 : 2.5, 0, 7); hx.fill(); });
  const pp = mp(P.pos[0], P.pos[2]); hx.translate(pp[0], pp[1]); hx.rotate(hdg * RAD); hx.fillStyle = '#ff4a3a'; hx.beginPath(); hx.moveTo(0, -7); hx.lineTo(5, 5); hx.lineTo(0, 2); hx.lineTo(-5, 5); hx.closePath(); hx.fill();
  hx.restore(); hx.save(); hx.strokeStyle = 'rgba(255,210,130,0.7)'; hx.lineWidth = 1.5; hx.strokeRect(mx, my, ms, ms); txt('N', mx + ms / 2, my + 9, 'center', 10, '#fff'); hx.restore();
  {
    const wy = my + ms + 14; hx.save(); hx.shadowBlur = 0;
    txt(`${L.name} · ${WX[wxI].name}`, mx + ms, wy, 'right', 10, 'rgba(234,242,248,0.85)', 700);
    txt(`WIND ${String(Math.round(windFrom)).padStart(3, '0')}° ${Math.round(windSpd * 1.944)} KT`, mx + ms, wy + 15, 'right', 11, '#9fdcff', 700);
    hx.translate(mx + 10, wy + 10); hx.rotate((windFrom + 180 - hdg) * RAD); hx.strokeStyle = '#9fdcff'; hx.fillStyle = '#9fdcff'; hx.lineWidth = 2;
    hx.beginPath(); hx.moveTo(0, 9); hx.lineTo(0, -6); hx.stroke(); hx.beginPath(); hx.moveTo(0, -11); hx.lineTo(-5, -3); hx.lineTo(5, -3); hx.closePath(); hx.fill(); hx.restore();
  }
  // chase-view instrument cluster
  if (!ck && P.alive) {
    const r = Math.min(H * 0.062, W * 0.05, 46), y = H - r - 16, sp = r * 2.4, x0 = cx - sp * 1.5;
    hx.save(); hx.shadowBlur = 0; hx.fillStyle = 'rgba(8,10,12,0.72)'; hx.strokeStyle = 'rgba(255,200,120,0.35)';
    const bx = x0 - r * 1.3, bw = sp * 3 + r * 2.6, by = y - r * 1.25, bh = r * 2.5, rr = 12;
    hx.beginPath(); hx.moveTo(bx + rr, by); hx.lineTo(bx + bw - rr, by); hx.quadraticCurveTo(bx + bw, by, bx + bw, by + rr); hx.lineTo(bx + bw, by + bh); hx.lineTo(bx, by + bh); hx.lineTo(bx, by + rr); hx.quadraticCurveTo(bx, by, bx + rr, by); hx.closePath(); hx.fill(); hx.stroke();
    hx.restore();
    ['asi', 'att', 'alt', 'hdg'].forEach((k, i) => gauge(x0 + i * sp, y, r, k, pitch, roll, hdg));
  }
  if (flightT < 14 && state === 'play') txt('R/Shift throttle · S pull up · W push · A/D roll · Q/E rudder · C cockpit · mouse: click & fly · X smoke · T time · V weather · G ghost', 14, H - 14 - (ck ? 0 : 0), 'left', 11, 'rgba(230,240,250,0.8)');
  if (state === 'paused') { }
}

// ---------------------------------------------------------------- loop
let last = performance.now(), tNow = 0;
function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now; tNow += dt;
  FDT = dt; windAt(tNow); stormUpdate(dt);
  if (state === 'replay') replayStep(dt);
  if (state === 'play') { for (let k = 0; k < 2 && state === 'play'; k++) update(dt / 2); }
  if (state === 'crash') { crashT += dt; if (crashT > 2.6 && !endShown) { endShown = true; state = 'over'; showEnd('crash'); } }
  if (state === 'over') crashT += dt;
  if (state !== 'title' && state !== 'paused') trailUpdate(dt);
  if (msgT > 0) msgT -= dt;
  propA += dt * (state === 'title' ? 0 : (P.alive ? 8 + P.thr * 70 : 0));
  updateCam(dt, tNow); audioUpdate(); render(tNow); drawHUD(tNow);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__skylark = { P, rings, bonusRings, setDiff, setRoute, buildRoute, get countdown() { return countdown; }, set countdown(v) { countdown = v; }, get timeLeft() { return timeLeft; }, score, startGame, groundH, setTOD, setWX, startReplay, endReplay, ghostPose, setGhost: g => { ghost = g; }, bolt: bt => { makeBolt(); boltT = bt; nextBolt = 99; }, get flightT() { return flightT; }, get rec() { return rec; }, get ghost() { return ghost; }, endGame, trail, clearTrail: () => { trail.length = 0; lastEmit = null; }, get state() { return state; } };
})();
