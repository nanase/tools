/**
 * 映像を描くシェーダ。詳細度（LOD）と異方性の分け方は GPU に任せず、動作原理と式に書いた式でここで決める。
 * どの GPU でも同じ見え方にするため。段の中の補間だけを textureLod に任せる。
 * 道路（画面いっぱいの 1 枚）と木（1 本ごとの四角）の 2 つのプログラムで、フィルタの部分（FILT）を共有する
 */

/**
 * フィルタ。F は (フィルタ, ミップマップ, 異方性の倍率)。tex の一番上の段は maxL、wrap は 1 で横だけ・2 で縦横とも端で止める。
 * lu は使った段、li は詳細度（段の色と、段を光らせる工程に使う）
 */
const FILT = `
uniform sampler2D tex; uniform int maxL, wrap;
vec3 lvc(float l){
  vec3 c[8]=vec3[8](vec3(.92,.22,.2),vec3(.96,.56,.1),vec3(.92,.86,.12),vec3(.3,.8,.3),vec3(.2,.76,.86),vec3(.27,.42,.96),vec3(.66,.36,.9),vec3(.6));
  float x=clamp(l,0.,7.); int i=int(floor(x)); int j=min(i+1,7); return mix(c[i],c[j],fract(x));
}
vec4 fetchN(vec2 uv,int l){
  ivec2 sz=textureSize(tex,l);
  vec2 f=vec2(wrap>0? clamp(uv.x,0.,.99999): fract(uv.x), wrap>1? clamp(uv.y,0.,.99999): fract(uv.y));
  return texelFetch(tex,clamp(ivec2(floor(f*vec2(sz))),ivec2(0),sz-1),l);
}
vec4 filt(vec2 uv, ivec3 F, out float lu, out float li){
  vec2 ts=vec2(textureSize(tex,0)), tc=uv*ts, dx=dFdx(tc), dy=dFdy(tc);
  float top=float(maxL), lx=length(dx), ly=length(dy);
  li=clamp(log2(max(max(lx,ly),1e-6)),0.,top);
  vec4 col;
  if(F.x==0){ int l= F.y==1? int(round(li)):0; col=fetchN(uv,l); lu=float(l); }
  else if(F.x==1){ float l= F.y==1? round(li):0.; col=textureLod(tex,uv,l); lu=l; }
  else if(F.x==2){ col=textureLod(tex,uv,li); lu=li; }
  else{
    float pmax=max(lx,ly), pmin=max(min(lx,ly),1e-6); vec2 ax= lx>ly? dx: dy;
    float n=clamp(ceil(pmax/pmin-1e-6),1.,float(F.z)), l=clamp(log2(pmax/n),0.,top);
    col=vec4(0.);
    for(int i=0;i<16;i++){ if(float(i)>=n) break; float k=(float(i)+.5)/n-.5; col+=textureLod(tex,uv+ax*k/ts,l); }
    col/=n; lu=l;
  }
  return col;
}
/* 段の色を重ねる・選んだ段の所だけ明るくする */
vec3 mark(vec3 col, float lu, float li, int tint, int hi, float top){
  if(tint==1) col=mix(col,lvc(lu),.55);
  if(hi>=0){ bool on= float(hi)>=top? li>top-.001: floor(li)==float(hi) && li<top-.001; col= on? col: col*.16; }
  return col;
}`;

export const VERT = `#version 300 es
in vec2 a; out vec2 v; void main(){ v=a; gl_Position=vec4(a,0.,1.); }`;

/**
 * 道路・草・空・山。カメラは左車線の中心（laneX）にいて、前方 d の道は 0.5·curv·d² だけ横へずれる。
 * fA は split より左、fB は右。head は道の向きの変化（山を横へ流す）
 */
export const GROUND = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
uniform vec2 res; uniform float pitch, camY, th, roadW, roadL, z, curv, laneX, head, split;
uniform ivec3 fA, fB; uniform int tint, hi;
${FILT}
void main(){
  float asp=res.x/res.y;
  vec3 f=vec3(0.,-sin(pitch),cos(pitch)), u=vec3(0.,cos(pitch),sin(pitch));
  vec3 d=normalize(f+v.x*asp*th*vec3(1.,0.,0.)+v.y*th*u);
  float t=camY/max(-d.y,1e-5), wx=d.x*t, wz=d.z*t;
  vec2 uv=vec2((wx+laneX-.5*curv*wz*wz)/roadW+.5, (wz+z)/roadL);
  ivec3 F= gl_FragCoord.x>split? fB: fA;
  float lu, li;
  vec3 col=mark(filt(uv,F,lu,li).rgb, lu, li, tint, hi, float(maxL));
  if(d.y>-2e-3){
    float a=atan(d.x,d.z)+head, e=d.y;
    float hill=.035+.03*(.5+.5*sin(a*9.))+.012*sin(a*23.+1.);
    col= e<hill? vec3(.27,.42,.35): mix(vec3(.62,.78,.92),vec3(.30,.52,.86),clamp(e*3.,0.,1.));
    if(hi>=0) col*=.16;
  }
  if(split>.5 && split<res.x-.5 && abs(gl_FragCoord.x-split)<1.) col=vec3(1.);
  o=vec4(col,1.);
}`;

/** 木 1 本の四角。rect は画面（-1〜1）の左下と右上。uv の縦は上が 0 */
export const TREE_VERT = `#version 300 es
in vec2 a; out vec2 uv; uniform vec4 rect;
void main(){ vec2 p=a*.5+.5; uv=vec2(p.x,1.-p.y); gl_Position=vec4(mix(rect.xy,rect.zw,p),0.,1.); }`;

export const TREE_FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform vec2 res; uniform float split; uniform ivec3 fA, fB; uniform int tint, hi;
${FILT}
void main(){
  ivec3 F= gl_FragCoord.x>split? fB: fA;
  float lu, li;
  vec4 c=filt(uv,F,lu,li);
  if(c.a<.5) discard;
  vec3 col=mark(c.rgb, lu, li, tint, -1, float(maxL));
  if(hi>=0) col*=.16;
  if(split>.5 && split<res.x-.5 && abs(gl_FragCoord.x-split)<1.) col=vec3(1.);
  o=vec4(col,1.);
}`;
