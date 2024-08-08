var j=Object.defineProperty;var G=(v,o,n)=>o in v?j(v,o,{enumerable:!0,configurable:!0,writable:!0,value:n}):v[o]=n;var V=(v,o,n)=>G(v,typeof o!="symbol"?o+"":o,n);import{d as H,r as s,w as J,a as U,o as L,c as O,b as p,e as i,u as a,f as I,_ as Q,g as T}from"../tools-AppBase.vue_vue_type_script_setup_true_lang-eFFrt3uz.js";import{d as N,_ as c,R as l,a as S,C as z}from"../tools-InputRow.vue_vue_type_script_setup_true_lang-ClZjpbSS.js";class W{constructor(o,n,r){V(this,"kp");V(this,"ki");V(this,"kd");V(this,"previousError");V(this,"integral");this.kp=o,this.ki=n,this.kd=r,this.previousError=0,this.integral=0}calculate(o,n,r){const d=o-n;this.integral+=d*r;const f=(d-this.previousError)/r,y=this.kp*d+this.ki*this.integral+this.kd*f;return this.previousError=d,y}}const X={style:{height:"250px"}},Y={style:{height:"250px"}},Z=H({__name:"PIDApp",setup(v){const o=s(),n=s(),r=s(0),d=s(0),f=s(50),y=s(-1),b=s(.05),k=s(1e-5),A=s(1e-5),q=s(1e-5);J(()=>[r.value,d.value,f.value,y.value,b.value,k.value,A.value,q.value,o.value,n.value],()=>{$()});function R(h){return new z(h,{type:"line",data:{datasets:[],labels:[]},options:{responsive:!0,maintainAspectRatio:!1,scales:{x:{type:"linear"},y:{type:"linear"}}}})}function K(h){return new z(h,{type:"line",data:{datasets:[],labels:[]},options:{responsive:!0,maintainAspectRatio:!1,scales:{x:{type:"linear"},y:{type:"linear"}}}})}function $(){var B,P,E,F;const h=new W(k.value,A.value,q.value),e=.1,C=1e3;let u=r.value,m=d.value,t=0;const w=Array(C),D=Array(C);w[0]={x:0,y:u},D[0]={x:0,y:m};for(let g=1;g<C;g++){const M=h.calculate(f.value,u,e);t+=(M*e-t)*b.value,m+=t,u+=(m+y.value)*e,w[g]={x:g*e,y:u},D[g]={x:g*e,y:m}}const _=(B=o.value)==null?void 0:B.getChart(),x=(P=n.value)==null?void 0:P.getChart();_&&_.ready&&N(_.chart,{data:{datasets:[{label:"位置 (m)",data:w,pointStyle:!1,yAxisID:"y",borderColor:"#36A2EB",backgroundColor:"#9BD0F5",hidden:typeof((E=_.chart.data.datasets[0])==null?void 0:E.hidden)>"u"?!1:!_.chart.isDatasetVisible(0)}]}}).update("none"),x&&x.ready&&N(x.chart,{data:{datasets:[{label:"速度 (m/s)",data:D,pointStyle:!1,yAxisID:"y",borderColor:"#FF6384",backgroundColor:"#FFB1C1",hidden:typeof((F=x.chart.data.datasets[0])==null?void 0:F.hidden)>"u"?!1:!x.chart.isDatasetVisible(0)}]}}).update("none")}return(h,e)=>{const C=U("v-divider"),u=U("v-col"),m=U("v-row");return L(),O(Q,{"page-id":"control/pid","toolbar-title":"PID制御"},{default:p(()=>[i(m,null,{default:p(()=>[i(u,{cols:"12",md:"6"},{default:p(()=>[i(c,{modelValue:r.value,"onUpdate:modelValue":e[0]||(e[0]=t=>r.value=t),label:"初期位置",variant:"underlined",density:"compact",max:100,min:-100,unit:"m","fraction-digits":3,rule:[a(l).required,a(l).value],cols:"4","hide-details":""},null,8,["modelValue","rule"]),i(c,{modelValue:f.value,"onUpdate:modelValue":e[1]||(e[1]=t=>f.value=t),label:"目標位置",variant:"underlined",density:"compact",max:100,min:-100,unit:"m","fraction-digits":3,rule:[a(l).required,a(l).value],cols:"4","hide-details":""},null,8,["modelValue","rule"]),i(c,{modelValue:d.value,"onUpdate:modelValue":e[2]||(e[2]=t=>d.value=t),label:"初速",variant:"underlined",density:"compact",max:100,min:-100,unit:"m/s","fraction-digits":3,rule:[a(l).required,a(l).value],cols:"4","hide-details":""},null,8,["modelValue","rule"]),i(c,{modelValue:y.value,"onUpdate:modelValue":e[3]||(e[3]=t=>y.value=t),label:"周囲の流速",variant:"underlined",density:"compact",max:100,min:-100,unit:"m/s","fraction-digits":3,rule:[a(l).required,a(l).value],cols:"4","hide-details":""},null,8,["modelValue","rule"]),i(c,{modelValue:b.value,"onUpdate:modelValue":e[4]||(e[4]=t=>b.value=t),label:"加速の応答性",variant:"underlined",density:"compact",max:1,min:1e-4,scale:"log","fraction-digits":4,rule:[a(l).required,a(l).value],cols:"4","hide-details":""},null,8,["modelValue","rule"]),i(C,{class:"my-5"}),i(c,{modelValue:k.value,"onUpdate:modelValue":e[5]||(e[5]=t=>k.value=t),label:"Kp",variant:"underlined",density:"compact",max:20.0001,min:1e-4,constant:1e-4,scale:"log","fraction-digits":4,rule:[a(l).required,a(l).value,a(l).notNegative],cols:"4","hide-details":""},null,8,["modelValue","rule"]),i(c,{modelValue:A.value,"onUpdate:modelValue":e[6]||(e[6]=t=>A.value=t),label:"Ki",variant:"underlined",density:"compact",max:20.0001,min:1e-4,constant:1e-4,scale:"log","fraction-digits":4,rule:[a(l).required,a(l).value,a(l).notNegative],cols:"4","hide-details":""},null,8,["modelValue","rule"]),i(c,{modelValue:q.value,"onUpdate:modelValue":e[7]||(e[7]=t=>q.value=t),label:"Kd",variant:"underlined",density:"compact",max:20.0001,min:1e-4,constant:1e-4,scale:"log","fraction-digits":4,rule:[a(l).required,a(l).value,a(l).notNegative],cols:"4","hide-details":""},null,8,["modelValue","rule"])]),_:1}),i(u,{cols:"12",md:"6",class:"text-center"},{default:p(()=>[i(m,null,{default:p(()=>[i(u,{cols:"12"},{default:p(()=>[I("div",X,[i(S,{ref_key:"positionChart",ref:o,initializer:R},null,512)])]),_:1}),i(u,{cols:"12"},{default:p(()=>[I("div",Y,[i(S,{ref_key:"velocityChart",ref:n,initializer:K},null,512)])]),_:1})]),_:1})]),_:1})]),_:1})]),_:1})}}});T("#app",Z);
