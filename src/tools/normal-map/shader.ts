/**
 * 板を描くシェーダ。画素ごとに光線を飛ばし、板（箱）に当たった所で光を計算する。
 * MODE.FLAT と MODE.NMAP は上面が平らな箱で、NMAP は法線マップの色から向きを読む。
 * MODE.REAL は高さの画像どおりの凹凸を光線でたどり、影も落とす（三角形に分けた面と同じ形）
 */
import { RELIEF } from './heights';

export const MODE = { FLAT: 0, NMAP: 1, REAL: 2 } as const;
const f = (v: number): string => v.toFixed(4);

/** 本物の凹凸をたどる歩数と、当たった所を詰める回数 */
const STEPS = 200,
  REFINE = 8;

export const VERT = `#version 300 es
in vec2 aP;
out vec2 vP;
void main(){ vP=aP; gl_Position=vec4(aP,0.,1.); }`;

export const FRAG = `#version 300 es
precision highp float;
in vec2 vP;
out vec4 o;
uniform vec2 uRes;
uniform vec3 uCp, uCr, uCu, uCf;
uniform float uTh;
uniform vec2 uOff;
uniform vec3 uLp;
uniform int uMode;
uniform float uHs;
uniform sampler2D uHt;
uniform sampler2D uNm;
uniform vec3 uBg;
/* 板の厚さ・凹凸の高さ・画素の間隔 */
const float T=.06;
#define H (${f(RELIEF)}*uHs)
uniform float uDx;
float hgt(vec2 p){ return texture(uHt,(p+1.)*.5).r; }
/* 高さの画像から直接求めた向き（本物の凹凸） */
vec3 nReal(vec2 p){
  float e=uDx;
  float hx=(hgt(p+vec2(e,0.))-hgt(p-vec2(e,0.)))/(2.*e);
  float hz=(hgt(p+vec2(0.,e))-hgt(p-vec2(0.,e)))/(2.*e);
  return normalize(vec3(-hx*H,1.,-hz*H));
}
/* 法線マップの色から向きを読む。G は画像の上（奥、-z）。傾きは凹凸の高さの倍率を掛ける */
vec3 nMap(vec2 p){
  vec3 t=texture(uNm,(p+1.)*.5).rgb*2.-1.;
  t.xy*=uHs;
  t=normalize(t);
  return vec3(t.x,t.z,-t.y);
}
bool box(vec3 ro,vec3 rd,vec3 a,vec3 b,out float t0,out float t1,out vec3 n0){
  vec3 inv=1./(rd+vec3(1e-7));
  vec3 ta=(a-ro)*inv,tb=(b-ro)*inv,mn=min(ta,tb),mx=max(ta,tb);
  t0=max(max(mn.x,mn.y),mn.z); t1=min(min(mx.x,mx.y),mx.z);
  if(t1<max(t0,0.)) return false;
  n0= t0==mn.x?vec3(-sign(rd.x),0.,0.): t0==mn.y?vec3(0.,-sign(rd.y),0.):vec3(0.,0.,-sign(rd.z));
  return true;
}
void main(){
  vec2 uv=vP; uv.x*=uRes.x/uRes.y; uv+=uOff;
  vec3 rd=normalize(uCf+uv.x*uTh*uCr+uv.y*uTh*uCu), ro=uCp;
  vec3 col=uBg;
  float tHit=-1.; vec3 N=vec3(0.,1.,0.); bool top=false; float t0,t1; vec3 n0;
  if(uMode==${MODE.REAL}){
    if(box(ro,rd,vec3(-1.,-T,-1.),vec3(1.,H+1e-4,1.),t0,t1,n0)){
      vec3 p0=ro+rd*t0;
      if(p0.y<H*hgt(p0.xz)-1e-4){ tHit=t0; N=n0; }
      else{
        float dt=(t1-t0)/${STEPS}., t=t0;
        for(int i=0;i<${STEPS};i++){
          t+=dt; vec3 p=ro+rd*t;
          if(p.y-H*hgt(p.xz)<0.){
            float a=t-dt,b=t;
            for(int k=0;k<${REFINE};k++){ float m=.5*(a+b); vec3 q=ro+rd*m; if(q.y-H*hgt(q.xz)<0.) b=m; else a=m; }
            tHit=b; N=nReal((ro+rd*b).xz); top=true; break;
          }
        }
      }
    }
  } else if(box(ro,rd,vec3(-1.,-T,-1.),vec3(1.,H*.5,1.),t0,t1,n0)){
    tHit=t0; N=n0;
    if(n0.y>.5){ top=true; N= uMode==${MODE.NMAP}? nMap((ro+rd*t0).xz): vec3(0.,1.,0.); }
  }
  if(tHit>0.){
    vec3 P=ro+rd*tHit;
    vec3 alb= top? vec3(.80,.76,.70): vec3(.42,.40,.38);
    vec3 L=uLp-P; float d=length(L); L/=d;
    float ndl=max(dot(N,L),0.), sh=1.;
    /* 影: 光の方へ進み、凹凸の下に入ったら影（本物の凹凸だけ） */
    if(uMode==${MODE.REAL} && ndl>0.){
      for(int i=1;i<=80;i++){
        vec3 q=P+N*.002+L*(float(i)*.008);
        if(abs(q.x)>1.||abs(q.z)>1.||q.y>H) break;
        if(q.y<H*hgt(q.xz)){ sh=0.; break; }
      }
    }
    float att=2.4/(1.+1.3*d*d);
    vec3 hv=normalize(L-rd); float sp=pow(max(dot(N,hv),0.),48.)*.3*ndl;
    col=alb*(.045+ndl*att*sh)+vec3(sp*att*sh);
    col=pow(col,vec3(1./2.2));
  }
  /* 光の玉 */
  vec3 w=uLp-ro; float tl=dot(w,rd);
  if(tl>0. && (tHit<0.||tl<tHit)){ float dd=length(w-rd*tl); col+=vec3(1.,.86,.56)*smoothstep(.04,.025,dd)+vec3(1.,.8,.5)*.18*exp(-dd*dd/.006); }
  o=vec4(col,1.);
}`;
