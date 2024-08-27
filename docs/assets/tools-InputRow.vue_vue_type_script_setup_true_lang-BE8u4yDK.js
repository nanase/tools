import{d as V,a5 as D,Y as h,a6 as S,r as g,w as c,a as i,o as v,c as p,b as o,m as f,W as B,C as M,e as u,h as w,X as y,D as k}from"./tools-SIValueInput.vue_vue_type_script_setup_true_lang-ysALgvjn.js";const C=V({__name:"LogSlider",props:D(h({max:null,min:null,step:null,constant:null},{constant:0}),{modelValue:{},modelModifiers:{}}),emits:["update:modelValue"],setup(d){const l=S(d,"modelValue"),e=g(0),a=g(!1);c(()=>l.value,()=>{l.value&&!a.value&&(e.value=Math.log(l.value+d.constant))},{immediate:!0});function m(){l.value=Math.exp(e.value)-d.constant}return(s,t)=>{const b=i("v-slider");return v(),p(b,{"model-value":e.value,"onUpdate:modelValue":[t[0]||(t[0]=r=>e.value=r),m],onStart:t[1]||(t[1]=r=>a.value=!0),onEnd:t[2]||(t[2]=r=>a.value=!1),max:Math.log(s.max),min:Math.log(s.min),step:typeof s.step<"u"?Math.log(s.step):void 0},{"thumb-label":o(()=>[f(s.$slots,"thumb-label",{linearValue:l.value,logarithmicValue:e.value},()=>[B(M(Number(l.value).toFixed(3)),1)])]),_:3},8,["model-value","max","min","step"])}}}),U=V({__name:"InputRow",props:D(h({label:null,cols:{type:[String,Boolean]},sm:{type:[String,Boolean]},md:{type:[String,Boolean]},lg:{type:[String,Boolean]},xl:{type:[String,Boolean]},xxl:{type:[String,Boolean]},scale:null,variant:null,density:null,disabled:{type:Boolean},hideDetails:{type:Boolean},max:null,min:null,constant:null,step:null,fractionDigits:null,unit:null,prefixSymbols:null,rule:null,menuIcon:null},{scale:"linear",max:1,min:0,constant:0,fractionDigits:0,menuIcon:"mdi-dots-horizontal"}),{modelValue:{},modelModifiers:{}}),emits:["update:modelValue"],setup(d){const l=S(d,"modelValue");return(e,a)=>{const m=i("v-col"),s=i("v-slider"),t=i("v-btn"),b=i("v-list"),r=i("v-menu"),$=i("v-row");return v(),p($,null,{default:o(()=>[u(m,{cols:e.cols,sm:e.sm,md:e.md,lg:e.lg,xl:e.xl,xxl:e.xxl},{default:o(()=>[u(w,y(e.$attrs,{value:l.value,"onUpdate:value":a[0]||(a[0]=n=>l.value=n),unit:e.unit,"prefix-symbols":e.prefixSymbols,rule:e.rule,label:e.label,density:e.density,variant:e.variant,disabled:e.disabled,hideDetails:e.hideDetails,fractionDigits:e.fractionDigits}),null,16,["value","unit","prefix-symbols","rule","label","density","variant","disabled","hideDetails","fractionDigits"])]),_:1},8,["cols","sm","md","lg","xl","xxl"]),u(m,null,{default:o(()=>[e.scale==="log"?(v(),p(C,{key:0,modelValue:l.value,"onUpdate:modelValue":a[1]||(a[1]=n=>l.value=n),max:e.max,min:e.min,constant:e.constant,density:e.density,disabled:e.disabled,hideDetails:e.hideDetails},null,8,["modelValue","max","min","constant","density","disabled","hideDetails"])):(v(),p(s,{key:1,modelValue:l.value,"onUpdate:modelValue":a[2]||(a[2]=n=>l.value=n),max:e.max,min:e.min,step:e.step,density:e.density,disabled:e.disabled,hideDetails:e.hideDetails},{"thumb-label":o(({modelValue:n})=>[B(M(Number(n).toFixed(e.fractionDigits)),1)]),_:1},8,["modelValue","max","min","step","density","disabled","hideDetails"]))]),_:1}),e.$slots["menu-list"]?(v(),p(m,{key:0,cols:"1"},{default:o(()=>[u(r,null,{activator:o(({props:n})=>[f(e.$slots,"menu-button",{props:n},()=>[u(t,y(n,{icon:e.menuIcon,variant:"plain",density:e.density,disabled:e.disabled}),null,16,["icon","density","disabled"])])]),default:o(()=>[u(b,null,{default:o(()=>[f(e.$slots,"menu-list")]),_:3})]),_:3})]),_:3})):k("",!0)]),_:3})}}});export{U as _};
