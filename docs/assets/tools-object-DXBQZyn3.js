class i{constructor(e){this.obj=e}}function s(f,e){if(typeof f<"u"&&f!=null)for(const n of Object.keys(e))e[n]instanceof i?f[n]=e[n].obj:e[n]===null?f[n]=null:!Array.isArray(e[n])&&typeof e[n]=="object"?f[n]=s(f[n],e[n]):f[n]=e[n];return f}function y(f,e,n,l){return typeof f>"u"||f==null?l:f?e:n}export{i as R,s as d,y as t};
