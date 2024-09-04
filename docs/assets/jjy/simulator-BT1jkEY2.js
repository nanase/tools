import{d as ce,o as ie,k as de,f as P,C as R,G as fe,Y as ke,a as F,E as ye,F as pe,c as ge,b as V,e as v,n as me,u as G,r as q,h as xe,a5 as he,w as Te,V as oe,W as Ve,X as re,_ as He,g as Ce}from"../tools-AppBase.vue_vue_type_script_setup_true_lang-D3a-CPUg.js";import{c as te,g as ae}from"../tools-_commonjsHelpers-Cpj98o6Y.js";import{n as je,_ as ze,s as Ue,d as Ne,M as Je}from"../tools-SignalIndicator.vue_vue_type_style_index_0_lang-D_SPiBUe.js";import{_ as ve}from"../tools-InputRow.vue_vue_type_script_setup_true_lang-BNmQSYF_.js";import"../tools-SIValueInput.vue_vue_type_script_setup_true_lang-B6rsi961.js";var _e={exports:{}};(function(r,e){(function(_,p){r.exports=p()})(te,function(){var _=1e3,p=6e4,H=36e5,k="millisecond",$="second",b="minute",h="hour",C="day",L="week",j="month",O="quarter",x="year",g="date",l="Invalid Date",w=/^(\d{4})[-/]?(\d{1,2})?[-/]?(\d{0,2})[Tt\s]*(\d{1,2})?:?(\d{1,2})?:?(\d{1,2})?[.:]?(\d+)?$/,z=/\[([^\]]+)]|Y{1,4}|M{1,4}|D{1,2}|d{1,4}|H{1,2}|h{1,2}|a|A|m{1,2}|s{1,2}|Z{1,2}|SSS/g,A={name:"en",weekdays:"Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday".split("_"),months:"January_February_March_April_May_June_July_August_September_October_November_December".split("_"),ordinal:function(c){var i=["th","st","nd","rd"],s=c%100;return"["+c+(i[(s-20)%10]||i[s]||i[0])+"]"}},T=function(c,i,s){var d=String(c);return!d||d.length>=i?c:""+Array(i+1-d.length).join(s)+c},N={s:T,z:function(c){var i=-c.utcOffset(),s=Math.abs(i),d=Math.floor(s/60),u=s%60;return(i<=0?"+":"-")+T(d,2,"0")+":"+T(u,2,"0")},m:function c(i,s){if(i.date()<s.date())return-c(s,i);var d=12*(s.year()-i.year())+(s.month()-i.month()),u=i.clone().add(d,j),Y=s-u<0,D=i.clone().add(d+(Y?-1:1),j);return+(-(d+(s-u)/(Y?u-D:D-u))||0)},a:function(c){return c<0?Math.ceil(c)||0:Math.floor(c)},p:function(c){return{M:j,y:x,w:L,d:C,D:g,h,m:b,s:$,ms:k,Q:O}[c]||String(c||"").toLowerCase().replace(/s$/,"")},u:function(c){return c===void 0}},n="en",o={};o[n]=A;var a="$isDayjsObject",t=function(c){return c instanceof W||!(!c||!c[a])},M=function c(i,s,d){var u;if(!i)return n;if(typeof i=="string"){var Y=i.toLowerCase();o[Y]&&(u=Y),s&&(o[Y]=s,u=Y);var D=i.split("-");if(!u&&D.length>1)return c(D[0])}else{var U=i.name;o[U]=i,u=U}return!d&&u&&(n=u),u||!d&&n},y=function(c,i){if(t(c))return c.clone();var s=typeof i=="object"?i:{};return s.date=c,s.args=arguments,new W(s)},m=N;m.l=M,m.i=t,m.w=function(c,i){return y(c,{locale:i.$L,utc:i.$u,x:i.$x,$offset:i.$offset})};var W=function(){function c(s){this.$L=M(s.locale,null,!0),this.parse(s),this.$x=this.$x||s.x||{},this[a]=!0}var i=c.prototype;return i.parse=function(s){this.$d=function(d){var u=d.date,Y=d.utc;if(u===null)return new Date(NaN);if(m.u(u))return new Date;if(u instanceof Date)return new Date(u);if(typeof u=="string"&&!/Z$/i.test(u)){var D=u.match(w);if(D){var U=D[2]-1||0,f=(D[7]||"0").substring(0,3);return Y?new Date(Date.UTC(D[1],U,D[3]||1,D[4]||0,D[5]||0,D[6]||0,f)):new Date(D[1],U,D[3]||1,D[4]||0,D[5]||0,D[6]||0,f)}}return new Date(u)}(s),this.init()},i.init=function(){var s=this.$d;this.$y=s.getFullYear(),this.$M=s.getMonth(),this.$D=s.getDate(),this.$W=s.getDay(),this.$H=s.getHours(),this.$m=s.getMinutes(),this.$s=s.getSeconds(),this.$ms=s.getMilliseconds()},i.$utils=function(){return m},i.isValid=function(){return this.$d.toString()!==l},i.isSame=function(s,d){var u=y(s);return this.startOf(d)<=u&&u<=this.endOf(d)},i.isAfter=function(s,d){return y(s)<this.startOf(d)},i.isBefore=function(s,d){return this.endOf(d)<y(s)},i.$g=function(s,d,u){return m.u(s)?this[d]:this.set(u,s)},i.unix=function(){return Math.floor(this.valueOf()/1e3)},i.valueOf=function(){return this.$d.getTime()},i.startOf=function(s,d){var u=this,Y=!!m.u(d)||d,D=m.p(s),U=function(ee,Z){var X=m.w(u.$u?Date.UTC(u.$y,Z,ee):new Date(u.$y,Z,ee),u);return Y?X:X.endOf(C)},f=function(ee,Z){return m.w(u.toDate()[ee].apply(u.toDate("s"),(Y?[0,0,0,0]:[23,59,59,999]).slice(Z)),u)},J=this.$W,E=this.$M,B=this.$D,ne="set"+(this.$u?"UTC":"");switch(D){case x:return Y?U(1,0):U(31,11);case j:return Y?U(1,E):U(0,E+1);case L:var K=this.$locale().weekStart||0,se=(J<K?J+7:J)-K;return U(Y?B-se:B+(6-se),E);case C:case g:return f(ne+"Hours",0);case h:return f(ne+"Minutes",1);case b:return f(ne+"Seconds",2);case $:return f(ne+"Milliseconds",3);default:return this.clone()}},i.endOf=function(s){return this.startOf(s,!1)},i.$set=function(s,d){var u,Y=m.p(s),D="set"+(this.$u?"UTC":""),U=(u={},u[C]=D+"Date",u[g]=D+"Date",u[j]=D+"Month",u[x]=D+"FullYear",u[h]=D+"Hours",u[b]=D+"Minutes",u[$]=D+"Seconds",u[k]=D+"Milliseconds",u)[Y],f=Y===C?this.$D+(d-this.$W):d;if(Y===j||Y===x){var J=this.clone().set(g,1);J.$d[U](f),J.init(),this.$d=J.set(g,Math.min(this.$D,J.daysInMonth())).$d}else U&&this.$d[U](f);return this.init(),this},i.set=function(s,d){return this.clone().$set(s,d)},i.get=function(s){return this[m.p(s)]()},i.add=function(s,d){var u,Y=this;s=Number(s);var D=m.p(d),U=function(E){var B=y(Y);return m.w(B.date(B.date()+Math.round(E*s)),Y)};if(D===j)return this.set(j,this.$M+s);if(D===x)return this.set(x,this.$y+s);if(D===C)return U(1);if(D===L)return U(7);var f=(u={},u[b]=p,u[h]=H,u[$]=_,u)[D]||1,J=this.$d.getTime()+s*f;return m.w(J,this)},i.subtract=function(s,d){return this.add(-1*s,d)},i.format=function(s){var d=this,u=this.$locale();if(!this.isValid())return u.invalidDate||l;var Y=s||"YYYY-MM-DDTHH:mm:ssZ",D=m.z(this),U=this.$H,f=this.$m,J=this.$M,E=u.weekdays,B=u.months,ne=u.meridiem,K=function(Z,X,ue,le){return Z&&(Z[X]||Z(d,Y))||ue[X].slice(0,le)},se=function(Z){return m.s(U%12||12,Z,"0")},ee=ne||function(Z,X,ue){var le=Z<12?"AM":"PM";return ue?le.toLowerCase():le};return Y.replace(z,function(Z,X){return X||function(ue){switch(ue){case"YY":return String(d.$y).slice(-2);case"YYYY":return m.s(d.$y,4,"0");case"M":return J+1;case"MM":return m.s(J+1,2,"0");case"MMM":return K(u.monthsShort,J,B,3);case"MMMM":return K(B,J);case"D":return d.$D;case"DD":return m.s(d.$D,2,"0");case"d":return String(d.$W);case"dd":return K(u.weekdaysMin,d.$W,E,2);case"ddd":return K(u.weekdaysShort,d.$W,E,3);case"dddd":return E[d.$W];case"H":return String(U);case"HH":return m.s(U,2,"0");case"h":return se(1);case"hh":return se(2);case"a":return ee(U,f,!0);case"A":return ee(U,f,!1);case"m":return String(f);case"mm":return m.s(f,2,"0");case"s":return String(d.$s);case"ss":return m.s(d.$s,2,"0");case"SSS":return m.s(d.$ms,3,"0");case"Z":return D}return null}(Z)||D.replace(":","")})},i.utcOffset=function(){return 15*-Math.round(this.$d.getTimezoneOffset()/15)},i.diff=function(s,d,u){var Y,D=this,U=m.p(d),f=y(s),J=(f.utcOffset()-this.utcOffset())*p,E=this-f,B=function(){return m.m(D,f)};switch(U){case x:Y=B()/12;break;case j:Y=B();break;case O:Y=B()/3;break;case L:Y=(E-J)/6048e5;break;case C:Y=(E-J)/864e5;break;case h:Y=E/H;break;case b:Y=E/p;break;case $:Y=E/_;break;default:Y=E}return u?Y:m.a(Y)},i.daysInMonth=function(){return this.endOf(j).$D},i.$locale=function(){return o[this.$L]},i.locale=function(s,d){if(!s)return this.$L;var u=this.clone(),Y=M(s,d,!0);return Y&&(u.$L=Y),u},i.clone=function(){return m.w(this.$d,this)},i.toDate=function(){return new Date(this.valueOf())},i.toJSON=function(){return this.isValid()?this.toISOString():null},i.toISOString=function(){return this.$d.toISOString()},i.toString=function(){return this.$d.toUTCString()},c}(),I=W.prototype;return y.prototype=I,[["$ms",k],["$s",$],["$m",b],["$H",h],["$W",C],["$M",j],["$y",x],["$D",g]].forEach(function(c){I[c[1]]=function(i){return this.$g(i,c[0],c[1])}}),y.extend=function(c,i){return c.$i||(c(i,W,y),c.$i=!0),y},y.locale=M,y.isDayjs=t,y.unix=function(c){return y(1e3*c)},y.en=o[n],y.Ls=o,y.p={},y})})(_e);var Se=_e.exports;const Q=ae(Se);var Me={exports:{}};(function(r,e){(function(_,p){r.exports=p()})(te,function(){var _="minute",p=/[+-]\d\d(?::?\d\d)?/g,H=/([+-]|\d\d)/g;return function(k,$,b){var h=$.prototype;b.utc=function(l){var w={date:l,utc:!0,args:arguments};return new $(w)},h.utc=function(l){var w=b(this.toDate(),{locale:this.$L,utc:!0});return l?w.add(this.utcOffset(),_):w},h.local=function(){return b(this.toDate(),{locale:this.$L,utc:!1})};var C=h.parse;h.parse=function(l){l.utc&&(this.$u=!0),this.$utils().u(l.$offset)||(this.$offset=l.$offset),C.call(this,l)};var L=h.init;h.init=function(){if(this.$u){var l=this.$d;this.$y=l.getUTCFullYear(),this.$M=l.getUTCMonth(),this.$D=l.getUTCDate(),this.$W=l.getUTCDay(),this.$H=l.getUTCHours(),this.$m=l.getUTCMinutes(),this.$s=l.getUTCSeconds(),this.$ms=l.getUTCMilliseconds()}else L.call(this)};var j=h.utcOffset;h.utcOffset=function(l,w){var z=this.$utils().u;if(z(l))return this.$u?0:z(this.$offset)?j.call(this):this.$offset;if(typeof l=="string"&&(l=function(n){n===void 0&&(n="");var o=n.match(p);if(!o)return null;var a=(""+o[0]).match(H)||["-",0,0],t=a[0],M=60*+a[1]+ +a[2];return M===0?0:t==="+"?M:-M}(l),l===null))return this;var A=Math.abs(l)<=16?60*l:l,T=this;if(w)return T.$offset=A,T.$u=l===0,T;if(l!==0){var N=this.$u?this.toDate().getTimezoneOffset():-1*this.utcOffset();(T=this.local().add(A+N,_)).$offset=A,T.$x.$localOffset=N}else T=this.utc();return T};var O=h.format;h.format=function(l){var w=l||(this.$u?"YYYY-MM-DDTHH:mm:ss[Z]":"");return O.call(this,w)},h.valueOf=function(){var l=this.$utils().u(this.$offset)?0:this.$offset+(this.$x.$localOffset||this.$d.getTimezoneOffset());return this.$d.valueOf()-6e4*l},h.isUTC=function(){return!!this.$u},h.toISOString=function(){return this.toDate().toISOString()},h.toString=function(){return this.toDate().toUTCString()};var x=h.toDate;h.toDate=function(l){return l==="s"&&this.$offset?b(this.format("YYYY-MM-DD HH:mm:ss:SSS")).toDate():x.call(this)};var g=h.diff;h.diff=function(l,w,z){if(l&&this.$u===l.$u)return g.call(this,l,w,z);var A=this.local(),T=b(l).local();return g.call(A,T,w,z)}}})})(Me);var Le=Me.exports;const Pe=ae(Le);var Ye={exports:{}};(function(r,e){(function(_,p){r.exports=p()})(te,function(){var _={year:0,month:1,day:2,hour:3,minute:4,second:5},p={};return function(H,k,$){var b,h=function(O,x,g){g===void 0&&(g={});var l=new Date(O),w=function(z,A){A===void 0&&(A={});var T=A.timeZoneName||"short",N=z+"|"+T,n=p[N];return n||(n=new Intl.DateTimeFormat("en-US",{hour12:!1,timeZone:z,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",timeZoneName:T}),p[N]=n),n}(x,g);return w.formatToParts(l)},C=function(O,x){for(var g=h(O,x),l=[],w=0;w<g.length;w+=1){var z=g[w],A=z.type,T=z.value,N=_[A];N>=0&&(l[N]=parseInt(T,10))}var n=l[3],o=n===24?0:n,a=l[0]+"-"+l[1]+"-"+l[2]+" "+o+":"+l[4]+":"+l[5]+":000",t=+O;return($.utc(a).valueOf()-(t-=t%1e3))/6e4},L=k.prototype;L.tz=function(O,x){O===void 0&&(O=b);var g,l=this.utcOffset(),w=this.toDate(),z=w.toLocaleString("en-US",{timeZone:O}),A=Math.round((w-new Date(z))/1e3/60),T=15*-Math.round(w.getTimezoneOffset()/15)-A;if(!Number(T))g=this.utcOffset(0,x);else if(g=$(z,{locale:this.$L}).$set("millisecond",this.$ms).utcOffset(T,!0),x){var N=g.utcOffset();g=g.add(l-N,"minute")}return g.$x.$timezone=O,g},L.offsetName=function(O){var x=this.$x.$timezone||$.tz.guess(),g=h(this.valueOf(),x,{timeZoneName:O}).find(function(l){return l.type.toLowerCase()==="timezonename"});return g&&g.value};var j=L.startOf;L.startOf=function(O,x){if(!this.$x||!this.$x.$timezone)return j.call(this,O,x);var g=$(this.format("YYYY-MM-DD HH:mm:ss:SSS"),{locale:this.$L});return j.call(g,O,x).tz(this.$x.$timezone,!0)},$.tz=function(O,x,g){var l=g&&x,w=g||x||b,z=C(+$(),w);if(typeof O!="string")return $(O).tz(w);var A=function(o,a,t){var M=o-60*a*1e3,y=C(M,t);if(a===y)return[M,a];var m=C(M-=60*(y-a)*1e3,t);return y===m?[M,y]:[o-60*Math.min(y,m)*1e3,Math.max(y,m)]}($.utc(O,l).valueOf(),z,w),T=A[0],N=A[1],n=$(T).utcOffset(N);return n.$x.$timezone=w,n},$.tz.guess=function(){return Intl.DateTimeFormat().resolvedOptions().timeZone},$.tz.setDefault=function(O){b=O}}})})(Ye);var Ae=Ye.exports;const We=ae(Ae);var De={exports:{}};(function(r,e){(function(_,p){r.exports=p()})(te,function(){return function(_,p){var H=p.prototype,k=H.format;H.format=function($){var b=this,h=this.$locale();if(!this.isValid())return k.bind(this)($);var C=this.$utils(),L=($||"YYYY-MM-DDTHH:mm:ssZ").replace(/\[([^\]]+)]|Q|wo|ww|w|WW|W|zzz|z|gggg|GGGG|Do|X|x|k{1,2}|S/g,function(j){switch(j){case"Q":return Math.ceil((b.$M+1)/3);case"Do":return h.ordinal(b.$D);case"gggg":return b.weekYear();case"GGGG":return b.isoWeekYear();case"wo":return h.ordinal(b.week(),"W");case"w":case"ww":return C.s(b.week(),j==="w"?1:2,"0");case"W":case"WW":return C.s(b.isoWeek(),j==="W"?1:2,"0");case"k":case"kk":return C.s(String(b.$H===0?24:b.$H),j==="k"?1:2,"0");case"X":return Math.floor(b.$d.getTime()/1e3);case"x":return b.$d.getTime();case"z":return"["+b.offsetName()+"]";case"zzz":return"["+b.offsetName("long")+"]";default:return j}});return k.bind(this)(L)}}})})(De);var Ie=De.exports;const Fe=ae(Ie);var be={exports:{}};(function(r,e){(function(_,p){r.exports=p()})(te,function(){var _,p,H=1e3,k=6e4,$=36e5,b=864e5,h=/\[([^\]]+)]|Y{1,4}|M{1,4}|D{1,2}|d{1,4}|H{1,2}|h{1,2}|a|A|m{1,2}|s{1,2}|Z{1,2}|SSS/g,C=31536e6,L=2628e6,j=/^(-|\+)?P(?:([-+]?[0-9,.]*)Y)?(?:([-+]?[0-9,.]*)M)?(?:([-+]?[0-9,.]*)W)?(?:([-+]?[0-9,.]*)D)?(?:T(?:([-+]?[0-9,.]*)H)?(?:([-+]?[0-9,.]*)M)?(?:([-+]?[0-9,.]*)S)?)?$/,O={years:C,months:L,days:b,hours:$,minutes:k,seconds:H,milliseconds:1,weeks:6048e5},x=function(o){return o instanceof N},g=function(o,a,t){return new N(o,t,a.$l)},l=function(o){return p.p(o)+"s"},w=function(o){return o<0},z=function(o){return w(o)?Math.ceil(o):Math.floor(o)},A=function(o){return Math.abs(o)},T=function(o,a){return o?w(o)?{negative:!0,format:""+A(o)+a}:{negative:!1,format:""+o+a}:{negative:!1,format:""}},N=function(){function o(t,M,y){var m=this;if(this.$d={},this.$l=y,t===void 0&&(this.$ms=0,this.parseFromMilliseconds()),M)return g(t*O[l(M)],this);if(typeof t=="number")return this.$ms=t,this.parseFromMilliseconds(),this;if(typeof t=="object")return Object.keys(t).forEach(function(c){m.$d[l(c)]=t[c]}),this.calMilliseconds(),this;if(typeof t=="string"){var W=t.match(j);if(W){var I=W.slice(2).map(function(c){return c!=null?Number(c):0});return this.$d.years=I[0],this.$d.months=I[1],this.$d.weeks=I[2],this.$d.days=I[3],this.$d.hours=I[4],this.$d.minutes=I[5],this.$d.seconds=I[6],this.calMilliseconds(),this}}return this}var a=o.prototype;return a.calMilliseconds=function(){var t=this;this.$ms=Object.keys(this.$d).reduce(function(M,y){return M+(t.$d[y]||0)*O[y]},0)},a.parseFromMilliseconds=function(){var t=this.$ms;this.$d.years=z(t/C),t%=C,this.$d.months=z(t/L),t%=L,this.$d.days=z(t/b),t%=b,this.$d.hours=z(t/$),t%=$,this.$d.minutes=z(t/k),t%=k,this.$d.seconds=z(t/H),t%=H,this.$d.milliseconds=t},a.toISOString=function(){var t=T(this.$d.years,"Y"),M=T(this.$d.months,"M"),y=+this.$d.days||0;this.$d.weeks&&(y+=7*this.$d.weeks);var m=T(y,"D"),W=T(this.$d.hours,"H"),I=T(this.$d.minutes,"M"),c=this.$d.seconds||0;this.$d.milliseconds&&(c+=this.$d.milliseconds/1e3,c=Math.round(1e3*c)/1e3);var i=T(c,"S"),s=t.negative||M.negative||m.negative||W.negative||I.negative||i.negative,d=W.format||I.format||i.format?"T":"",u=(s?"-":"")+"P"+t.format+M.format+m.format+d+W.format+I.format+i.format;return u==="P"||u==="-P"?"P0D":u},a.toJSON=function(){return this.toISOString()},a.format=function(t){var M=t||"YYYY-MM-DDTHH:mm:ss",y={Y:this.$d.years,YY:p.s(this.$d.years,2,"0"),YYYY:p.s(this.$d.years,4,"0"),M:this.$d.months,MM:p.s(this.$d.months,2,"0"),D:this.$d.days,DD:p.s(this.$d.days,2,"0"),H:this.$d.hours,HH:p.s(this.$d.hours,2,"0"),m:this.$d.minutes,mm:p.s(this.$d.minutes,2,"0"),s:this.$d.seconds,ss:p.s(this.$d.seconds,2,"0"),SSS:p.s(this.$d.milliseconds,3,"0")};return M.replace(h,function(m,W){return W||String(y[m])})},a.as=function(t){return this.$ms/O[l(t)]},a.get=function(t){var M=this.$ms,y=l(t);return y==="milliseconds"?M%=1e3:M=y==="weeks"?z(M/O[y]):this.$d[y],M||0},a.add=function(t,M,y){var m;return m=M?t*O[l(M)]:x(t)?t.$ms:g(t,this).$ms,g(this.$ms+m*(y?-1:1),this)},a.subtract=function(t,M){return this.add(t,M,!0)},a.locale=function(t){var M=this.clone();return M.$l=t,M},a.clone=function(){return g(this.$ms,this)},a.humanize=function(t){return _().add(this.$ms,"ms").locale(this.$l).fromNow(!t)},a.valueOf=function(){return this.asMilliseconds()},a.milliseconds=function(){return this.get("milliseconds")},a.asMilliseconds=function(){return this.as("milliseconds")},a.seconds=function(){return this.get("seconds")},a.asSeconds=function(){return this.as("seconds")},a.minutes=function(){return this.get("minutes")},a.asMinutes=function(){return this.as("minutes")},a.hours=function(){return this.get("hours")},a.asHours=function(){return this.as("hours")},a.days=function(){return this.get("days")},a.asDays=function(){return this.as("days")},a.weeks=function(){return this.get("weeks")},a.asWeeks=function(){return this.as("weeks")},a.months=function(){return this.get("months")},a.asMonths=function(){return this.as("months")},a.years=function(){return this.get("years")},a.asYears=function(){return this.as("years")},o}(),n=function(o,a,t){return o.add(a.years()*t,"y").add(a.months()*t,"M").add(a.days()*t,"d").add(a.hours()*t,"h").add(a.minutes()*t,"m").add(a.seconds()*t,"s").add(a.milliseconds()*t,"ms")};return function(o,a,t){_=t,p=t().$utils(),t.duration=function(m,W){var I=t.locale();return g(m,{$l:I},W)},t.isDuration=x;var M=a.prototype.add,y=a.prototype.subtract;a.prototype.add=function(m,W){return x(m)?n(this,m,1):M.bind(this)(m,W)},a.prototype.subtract=function(m,W){return x(m)?n(this,m,-1):y.bind(this)(m,W)}}})})(be);var Ee=be.exports;const Ze=ae(Ee);var Oe={exports:{}};(function(r,e){(function(_,p){r.exports=p()})(te,function(){return function(_,p,H){p.prototype.dayOfYear=function(k){var $=Math.round((H(this).startOf("day")-H(this).startOf("year"))/864e5)+1;return k==null?$:this.add(k-$,"day")}}})})(Oe);var Ge=Oe.exports;const Be=ae(Ge);var qe={exports:{}};(function(r,e){(function(_,p){r.exports=p(Se)})(te,function(_){function p($){return $&&typeof $=="object"&&"default"in $?$:{default:$}}var H=p(_),k={name:"ja",weekdays:"日曜日_月曜日_火曜日_水曜日_木曜日_金曜日_土曜日".split("_"),weekdaysShort:"日_月_火_水_木_金_土".split("_"),weekdaysMin:"日_月_火_水_木_金_土".split("_"),months:"1月_2月_3月_4月_5月_6月_7月_8月_9月_10月_11月_12月".split("_"),monthsShort:"1月_2月_3月_4月_5月_6月_7月_8月_9月_10月_11月_12月".split("_"),ordinal:function($){return $+"日"},formats:{LT:"HH:mm",LTS:"HH:mm:ss",L:"YYYY/MM/DD",LL:"YYYY年M月D日",LLL:"YYYY年M月D日 HH:mm",LLLL:"YYYY年M月D日 dddd HH:mm",l:"YYYY/MM/DD",ll:"YYYY年M月D日",lll:"YYYY年M月D日 HH:mm",llll:"YYYY年M月D日(ddd) HH:mm"},meridiem:function($){return $<12?"午前":"午後"},relativeTime:{future:"%s後",past:"%s前",s:"数秒",m:"1分",mm:"%d分",h:"1時間",hh:"%d時間",d:"1日",dd:"%d日",M:"1ヶ月",MM:"%dヶ月",y:"1年",yy:"%d年"}};return H.default.locale(k,null,!0),k})})(qe);Q.extend(Pe);Q.extend(We);Q.extend(Fe);Q.extend(Ze);Q.extend(Be);const Qe=[{title:"予定なし",value:0},{title:"7日以内に実施",value:1},{title:"3～6日以内に実施",value:2},{title:"2日以内に実施",value:3},{title:"24時間以内に実施",value:4},{title:"12時間以内に実施",value:5},{title:"2時間以内に実施",value:6}],Xe=[{title:"予定なし",value:0},{title:"7日間以上または期限未定",value:1},{title:"2～6日間",value:2},{title:"2日間以内",value:3}],Re=[{title:"毎時15分および45分",value:"default"},{title:"強制",value:"force"},{title:"なし",value:"disable"}],Ke={P:"ポジションマーカー",0:"ビット 0",1:"ビット 1",S:"JJY コールサイン"},et={P:"高出力 0.2秒、低出力 0.8秒",0:"高出力 0.8秒、低出力 0.2秒",1:"高出力 0.5秒、低出力 0.5秒",S:"・－－－ ・－－－ －・－－（モールスで2回以内）"},S=r=>(r??!1)==0?"0":"1";function $e(r){let e=!1;for(;r!==0;)r&1&&(e=!e),r>>=1;return e}function tt(r,e){const _=Q(r).startOf("minute"),p=[];r.subtract;for(let H=0;H<60;H++)p[H]=nt(_.add(H,"seconds"),e);return p}function we(r,e){return((e==null?void 0:e.callSign)==="force"||r.minute()===15||r.minute()===45)&&(e==null?void 0:e.callSign)!=="disable"}function nt(r,e){const _=we(r,e);switch(r.second()){case 0:return"P";case 1:return S(r.minute()/10&4);case 2:return S(r.minute()/10&2);case 3:return S(r.minute()/10&1);case 4:return"0";case 5:return S(r.minute()%10&8);case 6:return S(r.minute()%10&4);case 7:return S(r.minute()%10&2);case 8:return S(r.minute()%10&1);case 9:return"P";case 10:case 11:return"0";case 12:return S(r.hour()/10&2);case 13:return S(r.hour()/10&1);case 14:return"0";case 15:return S(r.hour()%10&8);case 16:return S(r.hour()%10&4);case 17:return S(r.hour()%10&2);case 18:return S(r.hour()%10&1);case 19:return"P";case 20:case 21:return"0";case 22:return S(r.dayOfYear()/100&2);case 23:return S(r.dayOfYear()/100&1);case 24:return"0";case 25:return S(r.dayOfYear()/10%10&8);case 26:return S(r.dayOfYear()/10%10&4);case 27:return S(r.dayOfYear()/10%10&2);case 28:return S(r.dayOfYear()/10%10&1);case 29:return"P";case 30:return S(r.dayOfYear()%10&8);case 31:return S(r.dayOfYear()%10&4);case 32:return S(r.dayOfYear()%10&2);case 33:return S(r.dayOfYear()%10&1);case 34:return"0";case 35:return"0";case 36:return S($e(r.hour()/10<<4|r.hour()%10));case 37:return S($e(r.minute()/10<<4|r.minute()%10));case 38:return S(e==null?void 0:e.summerTimeNotice);case 39:return"P";case 40:return _?"S":S(e==null?void 0:e.summerTime);case 41:return _?"S":S(r.year()%100/10&8);case 42:return _?"S":S(r.year()%100/10&4);case 43:return _?"S":S(r.year()%100/10&2);case 44:return _?"S":S(r.year()%100/10&1);case 45:return _?"S":S(r.year()%10&8);case 46:return _?"S":S(r.year()%10&4);case 47:return _?"S":S(r.year()%10&2);case 48:return _?"S":S(r.year()%10&1);case 49:return"P";case 50:return S(_?((e==null?void 0:e.stopAfter)??0)&4:r.day()&4);case 51:return S(_?((e==null?void 0:e.stopAfter)??0)&2:r.day()&2);case 52:return S(_?((e==null?void 0:e.stopAfter)??0)&1:r.day()&1);case 53:return _&&(e==null?void 0:e.stopAfter)!==0?S(e==null?void 0:e.stopType):S(e==null?void 0:e.leapSecondNotice);case 54:return _&&(e==null?void 0:e.stopAfter)!==0?S(((e==null?void 0:e.stopDuration)??0)&2):S((e==null?void 0:e.leapSecondNotice)&&(e==null?void 0:e.leapSecondType));case 55:return _&&(e==null?void 0:e.stopAfter)!==0?S(((e==null?void 0:e.stopDuration)??0)&1):"0";case 56:case 57:case 58:return"0";case 59:return"P";default:return console.info("invalid time",r),"0"}}function rt(r,e){switch(r){case 0:return"M: 開始を表すポジションマーカー（固定）";case 1:return"分の重み（40）";case 2:return"分の重み（20）";case 3:return"分の重み（10）";case 4:return"未使用（常にビット 0）";case 5:return"分の重み（8）";case 6:return"分の重み（4）";case 7:return"分の重み（2）";case 8:return"分の重み（1）";case 9:return"P1: ポジションマーカー（固定）";case 10:case 11:return"未使用（常にビット 0）";case 12:return"時の重み（20）";case 13:return"時の重み（10）";case 14:return"未使用（常にビット 0）";case 15:return"時の重み（8）";case 16:return"時の重み（4）";case 17:return"時の重み（2）";case 18:return"時の重み（1）";case 19:return"P2: ポジションマーカー（固定）";case 20:case 21:return"未使用（常にビット 0）";case 22:return"年の通算日の重み（200）";case 23:return"年の通算日の重み（100）";case 24:return"未使用（常にビット 0）";case 25:return"年の通算日の重み（80）";case 26:return"年の通算日の重み（40）";case 27:return"年の通算日の重み（20）";case 28:return"年の通算日の重み（10）";case 29:return"P3: ポジションマーカー（固定）";case 30:return"年の通算日の重み（8）";case 31:return"年の通算日の重み（4）";case 32:return"年の通算日の重み（2）";case 33:return"年の通算日の重み（1）";case 34:case 35:return"未使用（常にビット 0）";case 36:return"PA1: 「時」部のビットの偶数パリティ";case 37:return"PA2: 「分」部のビットの偶数パリティ";case 38:return"SU1: 6日以内に夏時間開始または終了のときビット 1";case 39:return"P4: ポジションマーカー（固定）";case 40:return e?"「JJY」を表すコールサイン":"SU2: 夏時間実施中のときビット 1";case 41:return e?"「JJY」を表すコールサイン":"年の重み（80）";case 42:return e?"「JJY」を表すコールサイン":"年の重み（40）";case 43:return e?"「JJY」を表すコールサイン":"年の重み（20）";case 44:return e?"「JJY」を表すコールサイン":"年の重み（10）";case 45:return e?"「JJY」を表すコールサイン":"年の重み（8）";case 46:return e?"「JJY」を表すコールサイン":"年の重み（4）";case 47:return e?"「JJY」を表すコールサイン":"年の重み（2）";case 48:return e?"「JJY」を表すコールサイン":"年の重み（1）";case 49:return"P5: ポジションマーカー（固定）";case 50:return e?"ST1: 停波が開始するまでの時間の上位1ビット目":"日曜日を起点とした曜日の上位1ビット目";case 51:return e?"ST2: 停波が開始するまでの時間の上位2ビット目":"日曜日を起点とした曜日の上位2ビット目";case 52:return e?"ST3: 停波が開始するまでの時間の上位3ビット目":"日曜日を起点とした曜日の上位3ビット目";case 53:return e?"ST4: 停波が昼間のみのときビット 1":"LS1: 月末に閏秒が実施されるときビット 1";case 54:return e?"ST5: 停波の期間の上位1ビット目":"LS2: 実施される閏秒の種別が挿入のときビット 1、削除のときビット 0";case 55:return e?"ST6: 停波の期間の上位2ビット目":"未使用（常にビット 0）";case 56:case 57:case 58:return"未使用（常にビット 0）";case 59:return"P0: ポジションマーカー（固定）";default:return console.info("invalid time",r),""}}const at={class:"animated-clock"},st={class:"date"},ut={class:"time"},it=ce({__name:"AnimatedClock",props:{time:null},setup(r){return(e,_)=>(ie(),de("div",at,[P("span",st,R(r.time.format("YYYY-MM-DD")),1),P("span",ut,[P("span",null,R(r.time.format("HH")),1),P("span",{style:fe(`visibility:${r.time.millisecond()<666?"visible":"hidden"}`)},":",4),P("span",null,R(r.time.format("mm")),1),P("span",{style:fe(`visibility:${r.time.millisecond()<666?"visible":"hidden"}`)},":",4),P("span",null,R(r.time.format("ss")),1)])]))}}),lt={class:"title"},ot=ce({__name:"TimeBars",props:ke({timeCodes:null,time:null,jjyOptions:null,length:null,offset:null},{offset:0}),setup(r){return(e,_)=>{const p=F("v-tooltip"),H=F("v-sheet");return ie(!0),de(pe,null,ye(e.timeCodes.slice(e.offset,e.length+e.offset),(k,$)=>(ie(),ge(H,{key:$,class:me(["timebar d-inline-flex justify-center align-center",{now:e.time.second()===e.offset+$,"marker-position":k==="P","marker-zero":k==="0","marker-one":k==="1","marker-sign":k==="S"}])},{default:V(()=>[v(p,{activator:"parent",location:"bottom","open-delay":"100",class:"timebar-tooltip"},{default:V(()=>[P("div",lt,[P("div",{class:me(["legend",{"marker-position":k==="P","marker-zero":k==="0","marker-one":k==="1","marker-sign":k==="S"}])},null,2),P("span",null,R(e.offset+$)+": "+R(G(Ke)[k]),1)]),P("div",null,R(G(rt)(e.offset+$,G(we)(e.time,e.jjyOptions))),1),P("div",null,R(G(et)[k]),1)]),_:2},1024)]),_:2},1032,["class"]))),128)}}}),ct=ce({__name:"SimulatorApp",setup(r){const e=q(Q()),_=q(Q().startOf("second")),p=q(Q().startOf("minute")),H=q(),k=q(!0),$=q(0),b=xe(()=>tt(p.value,h.value)),h=q({callSign:"default",leapSecondType:!0,stopAfter:0,stopDuration:3}),C=q(),L=q(),j=q(440),O=q(.5),x=q(-1/0);let g=null,l=null,w=!1;he(async()=>(H.value||(e.value=Q().subtract($.value,"milliseconds")),_.value.unix()!=e.value.unix()&&(_.value=e.value.startOf("second"),e.value.diff(p.value,"seconds")>=60&&(p.value=e.value.startOf("minute"))),.05)),Te(()=>_.value,()=>{if(!C.value)return;let N=je();function n(t,M){const y=L.value?13333.333:Number.isFinite(Number(j.value))?Math.min(Math.max(Number(j.value),20),24e3):440;g!=null&&(g.oscillator.type=L.value?"square":"sine",g.triggerAttackRelease(y,t,N,O.value*(M?1:.1))),N+=t}function o(){n(.25,!0),n(.1,!1)}function a(){n(.1,!0),n(.1,!1)}switch(b.value[_.value.second()]){case"P":{w=!1,n(.2,!0),n(.8+1,!1);break}case"0":{w=!1,n(.8,!0),n(.2+1,!1);break}case"1":{w=!1,n(.5,!0),n(.5+1,!1);break}case"S":{if(!w){w=!0;for(let t=0;t<2;t++)n(.3,!1),a(),o(),o(),o(),n(.05,!1),a(),o(),o(),o(),n(.05,!1),o(),a(),o(),o(),n(.05,!1);n(.6+.1,!1)}break}}});function z(){k.value||($.value=0,H.value=!1)}function A(){H.value?$.value=Q().diff(e.value,"milliseconds"):k.value=!1}async function T(){!C.value&&g==null?(await Ue(),g=new Ne({envelope:{attack:.05,decay:.05,sustain:.8,release:.05}}).toDestination(),l=new Je({smoothing:0}),g.connect(l)):g==null||g.triggerRelease()}return he(async()=>{if(l==null)return .1;const N=l.getValue();return x.value=Array.isArray(N)?N[0]:N,.1}),(N,n)=>{const o=F("v-col"),a=F("v-checkbox"),t=F("v-row"),M=F("v-select"),y=F("v-radio"),m=F("v-radio-group"),W=F("v-divider"),I=F("v-btn"),c=F("v-card-text"),i=F("v-slider"),s=F("v-container"),d=F("v-spacer"),u=F("v-card-actions"),Y=F("v-card"),D=F("v-dialog"),U=F("v-footer");return ie(),ge(He,{"page-id":"jjy/simulator","toolbar-title":"JJY シミュレータ"},{footer:V(()=>[v(W),v(U,null,{default:V(()=>[v(s,null,{default:V(()=>n[20]||(n[20]=[P("h4",null,"参考文献",-1),P("ul",null,[P("li",null,[P("a",{href:"https://jjy.nict.go.jp/jjy/trans/index.html",target:"_blank"},"標準電波の出し方"),oe(" - 情報通信研究機構 日本標準時グループ ")]),P("li",null,[P("a",{href:"https://ja.wikipedia.org/wiki/JJY",target:"_blank"},"JJY"),oe(" - Wikipedia")]),P("li",null,[P("a",{href:"https://shogo82148.github.io/web-jjy/",target:"_blank"},"JJYシミュレータWeb版")])],-1)])),_:1})]),_:1})]),default:V(()=>[v(t,{"no-gutters":"",align:"center",justify:"center"},{default:V(()=>[v(o,{cols:"5",sm:"7"},{default:V(()=>[v(it,{time:e.value,style:{"font-size":"125%"}},null,8,["time"])]),_:1}),v(o,{cols:"3",sm:"2"},{default:V(()=>[v(a,{modelValue:H.value,"onUpdate:modelValue":n[0]||(n[0]=f=>H.value=f),label:"停止",color:"red","hide-details":"",onClick:A},null,8,["modelValue"])]),_:1}),v(o,{cols:"4",sm:"3"},{default:V(()=>[v(a,{modelValue:k.value,"onUpdate:modelValue":n[1]||(n[1]=f=>k.value=f),label:"現在の時刻","hide-details":"",onClick:z,readonly:k.value},null,8,["modelValue","readonly"])]),_:1})]),_:1}),v(t,{"no-gutters":""},{default:V(()=>[(ie(),de(pe,null,ye(2,f=>v(o,{cols:"12",key:f,class:"d-flex justify-center"},{default:V(()=>[v(ot,{"time-codes":b.value,time:_.value,jjyOptions:h.value,length:30,offset:(f-1)*30},null,8,["time-codes","time","jjyOptions","offset"])]),_:2},1024)),64))]),_:1}),v(t,null,{default:V(()=>[v(o,{cols:"6",sm:"4",lg:"3"},{default:V(()=>[v(M,{label:"コールサイン",density:"compact",variant:"underlined",modelValue:h.value.callSign,"onUpdate:modelValue":n[2]||(n[2]=f=>h.value.callSign=f),items:G(Re)},null,8,["modelValue","items"])]),_:1}),v(o,{cols:"6",sm:"4",lg:"3"},{default:V(()=>[v(a,{modelValue:h.value.summerTime,"onUpdate:modelValue":n[3]||(n[3]=f=>h.value.summerTime=f),label:"夏時間実施中","hide-details":"",density:"compact"},null,8,["modelValue"]),v(a,{modelValue:h.value.summerTimeNotice,"onUpdate:modelValue":n[4]||(n[4]=f=>h.value.summerTimeNotice=f),label:"6日以内に夏時間を開始または終了","hide-details":"",density:"compact"},null,8,["modelValue"])]),_:1}),v(o,{cols:"6",sm:"4",lg:"3"},{default:V(()=>[v(a,{modelValue:h.value.leapSecondNotice,"onUpdate:modelValue":n[5]||(n[5]=f=>h.value.leapSecondNotice=f),label:"月末に閏秒を実施","hide-details":"",density:"compact"},null,8,["modelValue"]),v(m,{modelValue:h.value.leapSecondType,"onUpdate:modelValue":n[6]||(n[6]=f=>h.value.leapSecondType=f),disabled:!(h.value.leapSecondNotice??!1),direction:"horizontal",density:"compact"},{default:V(()=>[v(y,{label:"挿入",value:!0}),v(y,{label:"削除",value:!1})]),_:1},8,["modelValue","disabled"])]),_:1}),v(o,{cols:"6",sm:"4",lg:"3"},{default:V(()=>[v(M,{label:"停波",density:"compact",variant:"underlined",modelValue:h.value.stopAfter,"onUpdate:modelValue":n[7]||(n[7]=f=>h.value.stopAfter=f),items:G(Qe)},null,8,["modelValue","items"]),v(M,{label:"停波期間",density:"compact",variant:"underlined",modelValue:h.value.stopDuration,"onUpdate:modelValue":n[8]||(n[8]=f=>h.value.stopDuration=f),items:G(Xe).slice(1)},null,8,["modelValue","items"]),v(a,{modelValue:h.value.stopType,"onUpdate:modelValue":n[9]||(n[9]=f=>h.value.stopType=f),label:"停波は昼間のみ","hide-details":"",density:"compact"},null,8,["modelValue"])]),_:1}),v(W)]),_:1}),v(t,null,{default:V(()=>[v(o,{cols:"6",sm:"4",lg:"3"},{default:V(()=>[v(a,{modelValue:C.value,"onUpdate:modelValue":n[10]||(n[10]=f=>C.value=f),label:"音の再生","hide-details":"",onClick:T,density:"compact"},{append:V(()=>[v(ze,{value:x.value,max:-10,min:-30,disabled:!C.value},null,8,["value","disabled"])]),_:1},8,["modelValue"]),v(a,{modelValue:L.value,"onUpdate:modelValue":n[11]||(n[11]=f=>L.value=f),label:"時刻合わせモード","hide-details":"",density:"compact"},null,8,["modelValue"]),v(D,{"max-width":"640"},{activator:V(({props:f})=>[v(I,Ve(f,{"prepend-icon":"mdi-help",variant:"outlined"}),{default:V(()=>n[17]||(n[17]=[oe("時刻合わせのやりかた")])),_:2},1040)]),default:V(({isActive:f})=>[v(Y,{title:"時刻合わせのやりかた"},{default:V(()=>[v(c,null,{default:V(()=>n[18]||(n[18]=[P("p",null," お使いのデバイスにスピーカーまたはイヤホンを接続して「音の再生」と「時刻合わせモード」を有効にしてください。スピーカーまたはイヤホンの配線部分に電波時計を近づけると受信が始まります。 ",-1),P("p",null," サウンドデバイスによってはローパスフィルターによって 40kHz の信号が生成できず時刻合わせができない場合があります。時刻合わせによって生じた問題について責任は負いかねます。ご了承ください。 ",-1)])),_:1}),v(s,{class:"py-0"},{default:V(()=>[v(t,{"no-gutters":""},{default:V(()=>[v(o,{cols:"6"},{default:V(()=>[v(a,{modelValue:C.value,"onUpdate:modelValue":n[12]||(n[12]=J=>C.value=J),label:"音の再生","hide-details":"",onClick:T,density:"compact"},null,8,["modelValue"])]),_:1}),v(o,{cols:"6"},{default:V(()=>[v(a,{modelValue:L.value,"onUpdate:modelValue":n[13]||(n[13]=J=>L.value=J),label:"時刻合わせモード","hide-details":"",density:"compact"},null,8,["modelValue"])]),_:1}),v(o,{cols:"12"},{default:V(()=>[n[19]||(n[19]=P("div",{class:"text-caption"},"ボリューム",-1)),v(i,{modelValue:O.value,"onUpdate:modelValue":n[14]||(n[14]=J=>O.value=J),min:"0",max:"1","thumb-label":""},null,8,["modelValue"])]),_:1})]),_:1})]),_:1}),v(u,null,{default:V(()=>[v(d),v(I,{text:"閉じる",onClick:J=>f.value=!1},null,8,["onClick"])]),_:2},1024)]),_:2},1024)]),_:1})]),_:1}),v(o,{cols:"6",sm:"4",lg:"3"},{default:V(()=>[v(ve,{modelValue:j.value,"onUpdate:modelValue":n[15]||(n[15]=f=>j.value=f),label:"音の周波数",variant:"underlined",density:"compact",max:24e3,min:20,scale:"log",unit:"Hz",rule:[G(re).required,G(re).value,G(re).notNegative],cols:"5","hide-details":""},null,8,["modelValue","rule"]),v(ve,{modelValue:O.value,"onUpdate:modelValue":n[16]||(n[16]=f=>O.value=f),label:"ボリューム",variant:"underlined",density:"compact",max:1,min:0,"fraction-digits":3,rule:[G(re).required,G(re).value,G(re).notNegative],cols:"5","hide-details":""},null,8,["modelValue","rule"])]),_:1})]),_:1})]),_:1})}}});Ce("#app",ct);
