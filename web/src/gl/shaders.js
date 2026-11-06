// Shared GLSL. Every instrument's fragment shader is prefixed with HEADER,
// so it gets the phosphor palette, helpers and the common uniforms for free.

export const VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.,1.); }
`;

export const HEADER = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 fragColor;
uniform vec2 uRes;     // target size in device pixels
uniform float uTime;   // seconds, wraps hourly
uniform float uDpr;    // device pixels per css pixel

// Phosphors. Colour is a signal, never decoration:
// mint = nominal, amber = warn, orange = critical.
const vec3 PH_OK   = vec3(0.50, 1.00, 0.72);
const vec3 PH_WARN = vec3(1.00, 0.70, 0.26);
const vec3 PH_CRIT = vec3(1.00, 0.33, 0.10);

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx)*.1031);
  p3 += dot(p3, p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z);
}
float sdRoundBox(vec2 p, vec2 b, float r){
  vec2 q = abs(p)-b+r;
  return length(max(q,0.))+min(max(q.x,q.y),0.)-r;
}
float sdSegment(vec2 p, vec2 a, vec2 b){
  vec2 pa = p-a, ba = b-a;
  float h = clamp(dot(pa,ba)/dot(ba,ba),0.,1.);
  return length(pa-ba*h);
}
// Palette indices used by the dot-matrix bitmaps.
// 0 off, 1 ok, 2 warn, 3 crit, 4 dim, 5 hot, 6 unlit segment
vec3 palette(float i){
  if(i<1.5) return PH_OK;
  if(i<2.5) return PH_WARN;
  if(i<3.5) return PH_CRIT;
  if(i<4.5) return PH_OK*0.36;
  if(i<5.5) return mix(PH_OK, vec3(1.), 0.45)*1.2;
  return PH_OK*0.10;
}
`;

// Phosphor persistence: the new frame is max(scene, decayed previous frame).
// The small subtraction keeps 8-bit targets from getting stuck at a residue.
export const PERSIST = `${HEADER}
uniform sampler2D uScene;
uniform sampler2D uPrev;
uniform float uDecay;
void main(){
  vec3 s = texture(uScene, vUv).rgb;
  vec3 p = max(texture(uPrev, vUv).rgb*uDecay - vec3(1.5/255.), 0.);
  fragColor = vec4(max(s,p), 1.);
}
`;

// 4x4 box downsample to quarter resolution (four bilinear taps).
export const DOWN = `${HEADER}
uniform sampler2D uSrc;
uniform vec2 uTexel;
void main(){
  vec3 c = texture(uSrc, vUv+uTexel*vec2(-1.,-1.)).rgb
         + texture(uSrc, vUv+uTexel*vec2( 1.,-1.)).rgb
         + texture(uSrc, vUv+uTexel*vec2(-1., 1.)).rgb
         + texture(uSrc, vUv+uTexel*vec2( 1., 1.)).rgb;
  fragColor = vec4(c*0.25, 1.);
}
`;

export const BLUR = `${HEADER}
uniform sampler2D uSrc;
uniform vec2 uDir;
void main(){
  vec3 c = texture(uSrc, vUv).rgb*0.227027;
  c += (texture(uSrc, vUv+uDir).rgb    + texture(uSrc, vUv-uDir).rgb)*0.1945946;
  c += (texture(uSrc, vUv+uDir*2.).rgb + texture(uSrc, vUv-uDir*2.).rgb)*0.1216216;
  c += (texture(uSrc, vUv+uDir*3.).rgb + texture(uSrc, vUv-uDir*3.).rgb)*0.054054;
  c += (texture(uSrc, vUv+uDir*4.).rgb + texture(uSrc, vUv-uDir*4.).rgb)*0.016216;
  fragColor = vec4(c, 1.);
}
`;

// The tube: curvature, bloom, scanlines, slight convergence error, vignette,
// grain, a breath of flicker and a rounded faceplate mask.
export const COMPOSITE = `${HEADER}
uniform sampler2D uImg;
uniform sampler2D uBloom;
uniform float uCurve;
uniform float uScan;
uniform float uBloomAmt;
uniform float uRadius;
uniform float uAge;    // seconds since this screen powered on
void main(){
  vec2 c = vUv*2.-1.;
  // power-on: the raster opens from a bright horizontal line
  float on = smoothstep(0., .55, uAge);
  float open = mix(.004, 1., on*on*on);
  c.y /= open;
  if(abs(c.y) > 1. || uAge < 0.){ fragColor = vec4(0.,0.,0.,1.); return; }
  vec2 cw = c*(1.+uCurve*vec2(c.y*c.y, c.x*c.x));
  vec2 uv = cw*.5+.5;
  vec2 p = (uv-.5)*uRes;
  float d = sdRoundBox(p, uRes*.5, uRadius);
  float inside = clamp(.5-d, 0., 1.);

  float ca = (0.9*uDpr/uRes.x)*dot(cw,cw);
  vec3 img = vec3(texture(uImg, uv+vec2(ca,0.)).r, texture(uImg, uv).g, texture(uImg, uv-vec2(ca,0.)).b);
  vec3 bl = texture(uBloom, uv).rgb;
  vec3 col = img + bl*uBloomAmt;

  float sl = .5+.5*cos(6.2831853*gl_FragCoord.y/(3.*uDpr));
  col *= mix(1., .62+.38*sl, uScan);
  col = 1.-exp(-col*1.5);

  float vig = clamp(1.-.3*dot(cw,cw), 0., 1.);
  col = vec3(.014,.022,.018) + col*vig + bl*0.04;
  col += (hash12(gl_FragCoord.xy + fract(uTime*7.)*91.)-.5)*.02;
  col *= 1.+.01*sin(uTime*8.3)*sin(uTime*2.9);
  col *= .5+.5*smoothstep(0., 16.*uDpr, -d);
  col = col*(1.+3.*(1.-on)) + vec3(.6,1.,.8)*(1.-on)*step(0., uAge)*.5;
  fragColor = vec4(col*inside, 1.);
}
`;

// 3x5 dot numerals for shaders that need scale markings (meter).
const DIGIT_ROWS = [
  '111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
  '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111',
];
export const DIGITS = `
const int DIG[10] = int[10](${DIGIT_ROWS.map((b) => parseInt(b, 2)).join(',')});
float digitDots(vec2 p, float cell, int d){
  vec2 g = p/cell;
  if(g.x<0.||g.y<0.||g.x>=3.||g.y>=5.) return 0.;
  ivec2 c = ivec2(floor(g));
  int bit = (DIG[d] >> (c.y*3 + (2-c.x))) & 1;
  return float(bit)*smoothstep(.5,.3,length(fract(g)-.5));
}
// centered integer 0..999
float numberDots(vec2 p, vec2 center, float cell, int n){
  int nd = n>=100 ? 3 : (n>=10 ? 2 : 1);
  float w = float(nd)*4.*cell - cell;
  vec2 o = center - vec2(w*.5, 2.5*cell);
  float acc = 0.;
  int v = n;
  for(int i=0;i<3;i++){
    if(i>=nd) break;
    acc += digitDots(p - o - vec2(float(nd-1-i)*4.*cell, 0.), cell, v-(v/10)*10);
    v /= 10;
  }
  return acc;
}
`;
