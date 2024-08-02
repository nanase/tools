import{x as be,C as we,d as oe,o as ue,D as ce,f as N,t as R,F as de,y as Oe,a as I,G as he,H as ve,c as $e,b as C,e as v,I as fe,u as ee,r as B,i as ke,w as xe,m as Te,k as le,_ as Ve,g as He}from"../tools-AppBase.vue_vue_type_script_setup_true_lang-2pEV9xKQ.js";import{n as Ce,s as je,d as ze}from"../tools-index-DFWBQmQS.js";function Ue(t,e){let y,f;const V=async function(){try{f=await t(),typeof f<"u"&&(y=setTimeout(V,f*1e3))}catch(O){e&&(f=await e(O),typeof f<"u"&&(y=setTimeout(V,f*1e3)))}};be(async()=>{await V()}),we(()=>{clearTimeout(y)})}var te=typeof globalThis<"u"?globalThis:typeof window<"u"?window:typeof global<"u"?global:typeof self<"u"?self:{};function re(t){return t&&t.__esModule&&Object.prototype.hasOwnProperty.call(t,"default")?t.default:t}var ye={exports:{}};(function(t,e){(function(y,f){t.exports=f()})(te,function(){var y=1e3,f=6e4,V=36e5,O="millisecond",p="second",x="minute",h="hour",z="day",P="week",j="month",T="quarter",w="year",S="date",l="Invalid Date",H=/^(\d{4})[-/]?(\d{1,2})?[-/]?(\d{0,2})[Tt\s]*(\d{1,2})?:?(\d{1,2})?:?(\d{1,2})?[.:]?(\d+)?$/,U=/\[([^\]]+)]|Y{1,4}|M{1,4}|D{1,2}|d{1,4}|H{1,2}|h{1,2}|a|A|m{1,2}|s{1,2}|Z{1,2}|SSS/g,L={name:"en",weekdays:"Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday".split("_"),months:"January_February_March_April_May_June_July_August_September_October_November_December".split("_"),ordinal:function(c){var u=["th","st","nd","rd"],a=c%100;return"["+c+(u[(a-20)%10]||u[a]||u[0])+"]"}},n=function(c,u,a){var d=String(c);return!d||d.length>=u?c:""+Array(u+1-d.length).join(a)+c},D={s:n,z:function(c){var u=-c.utcOffset(),a=Math.abs(u),d=Math.floor(a/60),s=a%60;return(u<=0?"+":"-")+n(d,2,"0")+":"+n(s,2,"0")},m:function c(u,a){if(u.date()<a.date())return-c(a,u);var d=12*(a.year()-u.year())+(a.month()-u.month()),s=u.clone().add(d,j),M=a-s<0,Y=u.clone().add(d+(M?-1:1),j);return+(-(d+(a-s)/(M?s-Y:Y-s))||0)},a:function(c){return c<0?Math.ceil(c)||0:Math.floor(c)},p:function(c){return{M:j,y:w,w:P,d:z,D:S,h,m:x,s:p,ms:O,Q:T}[c]||String(c||"").toLowerCase().replace(/s$/,"")},u:function(c){return c===void 0}},k="en",$={};$[k]=L;var i="$isDayjsObject",r=function(c){return c instanceof A||!(!c||!c[i])},b=function c(u,a,d){var s;if(!u)return k;if(typeof u=="string"){var M=u.toLowerCase();$[M]&&(s=M),a&&($[M]=a,s=M);var Y=u.split("-");if(!s&&Y.length>1)return c(Y[0])}else{var o=u.name;$[o]=u,s=o}return!d&&s&&(k=s),s||!d&&k},_=function(c,u){if(r(c))return c.clone();var a=typeof u=="object"?u:{};return a.date=c,a.args=arguments,new A(a)},m=D;m.l=b,m.i=r,m.w=function(c,u){return _(c,{locale:u.$L,utc:u.$u,x:u.$x,$offset:u.$offset})};var A=function(){function c(a){this.$L=b(a.locale,null,!0),this.parse(a),this.$x=this.$x||a.x||{},this[i]=!0}var u=c.prototype;return u.parse=function(a){this.$d=function(d){var s=d.date,M=d.utc;if(s===null)return new Date(NaN);if(m.u(s))return new Date;if(s instanceof Date)return new Date(s);if(typeof s=="string"&&!/Z$/i.test(s)){var Y=s.match(H);if(Y){var o=Y[2]-1||0,J=(Y[7]||"0").substring(0,3);return M?new Date(Date.UTC(Y[1],o,Y[3]||1,Y[4]||0,Y[5]||0,Y[6]||0,J)):new Date(Y[1],o,Y[3]||1,Y[4]||0,Y[5]||0,Y[6]||0,J)}}return new Date(s)}(a),this.init()},u.init=function(){var a=this.$d;this.$y=a.getFullYear(),this.$M=a.getMonth(),this.$D=a.getDate(),this.$W=a.getDay(),this.$H=a.getHours(),this.$m=a.getMinutes(),this.$s=a.getSeconds(),this.$ms=a.getMilliseconds()},u.$utils=function(){return m},u.isValid=function(){return this.$d.toString()!==l},u.isSame=function(a,d){var s=_(a);return this.startOf(d)<=s&&s<=this.endOf(d)},u.isAfter=function(a,d){return _(a)<this.startOf(d)},u.isBefore=function(a,d){return this.endOf(d)<_(a)},u.$g=function(a,d,s){return m.u(a)?this[d]:this.set(s,a)},u.unix=function(){return Math.floor(this.valueOf()/1e3)},u.valueOf=function(){return this.$d.getTime()},u.startOf=function(a,d){var s=this,M=!!m.u(d)||d,Y=m.p(a),o=function(K,E){var Q=m.w(s.$u?Date.UTC(s.$y,E,K):new Date(s.$y,E,K),s);return M?Q:Q.endOf(z)},J=function(K,E){return m.w(s.toDate()[K].apply(s.toDate("s"),(M?[0,0,0,0]:[23,59,59,999]).slice(E)),s)},F=this.$W,Z=this.$M,G=this.$D,ne="set"+(this.$u?"UTC":"");switch(Y){case w:return M?o(1,0):o(31,11);case j:return M?o(1,Z):o(0,Z+1);case P:var X=this.$locale().weekStart||0,ae=(F<X?F+7:F)-X;return o(M?G-ae:G+(6-ae),Z);case z:case S:return J(ne+"Hours",0);case h:return J(ne+"Minutes",1);case x:return J(ne+"Seconds",2);case p:return J(ne+"Milliseconds",3);default:return this.clone()}},u.endOf=function(a){return this.startOf(a,!1)},u.$set=function(a,d){var s,M=m.p(a),Y="set"+(this.$u?"UTC":""),o=(s={},s[z]=Y+"Date",s[S]=Y+"Date",s[j]=Y+"Month",s[w]=Y+"FullYear",s[h]=Y+"Hours",s[x]=Y+"Minutes",s[p]=Y+"Seconds",s[O]=Y+"Milliseconds",s)[M],J=M===z?this.$D+(d-this.$W):d;if(M===j||M===w){var F=this.clone().set(S,1);F.$d[o](J),F.init(),this.$d=F.set(S,Math.min(this.$D,F.daysInMonth())).$d}else o&&this.$d[o](J);return this.init(),this},u.set=function(a,d){return this.clone().$set(a,d)},u.get=function(a){return this[m.p(a)]()},u.add=function(a,d){var s,M=this;a=Number(a);var Y=m.p(d),o=function(Z){var G=_(M);return m.w(G.date(G.date()+Math.round(Z*a)),M)};if(Y===j)return this.set(j,this.$M+a);if(Y===w)return this.set(w,this.$y+a);if(Y===z)return o(1);if(Y===P)return o(7);var J=(s={},s[x]=f,s[h]=V,s[p]=y,s)[Y]||1,F=this.$d.getTime()+a*J;return m.w(F,this)},u.subtract=function(a,d){return this.add(-1*a,d)},u.format=function(a){var d=this,s=this.$locale();if(!this.isValid())return s.invalidDate||l;var M=a||"YYYY-MM-DDTHH:mm:ssZ",Y=m.z(this),o=this.$H,J=this.$m,F=this.$M,Z=s.weekdays,G=s.months,ne=s.meridiem,X=function(E,Q,se,ie){return E&&(E[Q]||E(d,M))||se[Q].slice(0,ie)},ae=function(E){return m.s(o%12||12,E,"0")},K=ne||function(E,Q,se){var ie=E<12?"AM":"PM";return se?ie.toLowerCase():ie};return M.replace(U,function(E,Q){return Q||function(se){switch(se){case"YY":return String(d.$y).slice(-2);case"YYYY":return m.s(d.$y,4,"0");case"M":return F+1;case"MM":return m.s(F+1,2,"0");case"MMM":return X(s.monthsShort,F,G,3);case"MMMM":return X(G,F);case"D":return d.$D;case"DD":return m.s(d.$D,2,"0");case"d":return String(d.$W);case"dd":return X(s.weekdaysMin,d.$W,Z,2);case"ddd":return X(s.weekdaysShort,d.$W,Z,3);case"dddd":return Z[d.$W];case"H":return String(o);case"HH":return m.s(o,2,"0");case"h":return ae(1);case"hh":return ae(2);case"a":return K(o,J,!0);case"A":return K(o,J,!1);case"m":return String(J);case"mm":return m.s(J,2,"0");case"s":return String(d.$s);case"ss":return m.s(d.$s,2,"0");case"SSS":return m.s(d.$ms,3,"0");case"Z":return Y}return null}(E)||Y.replace(":","")})},u.utcOffset=function(){return 15*-Math.round(this.$d.getTimezoneOffset()/15)},u.diff=function(a,d,s){var M,Y=this,o=m.p(d),J=_(a),F=(J.utcOffset()-this.utcOffset())*f,Z=this-J,G=function(){return m.m(Y,J)};switch(o){case w:M=G()/12;break;case j:M=G();break;case T:M=G()/3;break;case P:M=(Z-F)/6048e5;break;case z:M=(Z-F)/864e5;break;case h:M=Z/V;break;case x:M=Z/f;break;case p:M=Z/y;break;default:M=Z}return s?M:m.a(M)},u.daysInMonth=function(){return this.endOf(j).$D},u.$locale=function(){return $[this.$L]},u.locale=function(a,d){if(!a)return this.$L;var s=this.clone(),M=b(a,d,!0);return M&&(s.$L=M),s},u.clone=function(){return m.w(this.$d,this)},u.toDate=function(){return new Date(this.valueOf())},u.toJSON=function(){return this.isValid()?this.toISOString():null},u.toISOString=function(){return this.$d.toISOString()},u.toString=function(){return this.$d.toUTCString()},c}(),W=A.prototype;return _.prototype=W,[["$ms",O],["$s",p],["$m",x],["$H",h],["$W",z],["$M",j],["$y",w],["$D",S]].forEach(function(c){W[c[1]]=function(u){return this.$g(u,c[0],c[1])}}),_.extend=function(c,u){return c.$i||(c(u,A,_),c.$i=!0),_},_.locale=b,_.isDayjs=r,_.unix=function(c){return _(1e3*c)},_.en=$[k],_.Ls=$,_.p={},_})})(ye);var pe=ye.exports;const q=re(pe);var _e={exports:{}};(function(t,e){(function(y,f){t.exports=f()})(te,function(){var y="minute",f=/[+-]\d\d(?::?\d\d)?/g,V=/([+-]|\d\d)/g;return function(O,p,x){var h=p.prototype;x.utc=function(l){var H={date:l,utc:!0,args:arguments};return new p(H)},h.utc=function(l){var H=x(this.toDate(),{locale:this.$L,utc:!0});return l?H.add(this.utcOffset(),y):H},h.local=function(){return x(this.toDate(),{locale:this.$L,utc:!1})};var z=h.parse;h.parse=function(l){l.utc&&(this.$u=!0),this.$utils().u(l.$offset)||(this.$offset=l.$offset),z.call(this,l)};var P=h.init;h.init=function(){if(this.$u){var l=this.$d;this.$y=l.getUTCFullYear(),this.$M=l.getUTCMonth(),this.$D=l.getUTCDate(),this.$W=l.getUTCDay(),this.$H=l.getUTCHours(),this.$m=l.getUTCMinutes(),this.$s=l.getUTCSeconds(),this.$ms=l.getUTCMilliseconds()}else P.call(this)};var j=h.utcOffset;h.utcOffset=function(l,H){var U=this.$utils().u;if(U(l))return this.$u?0:U(this.$offset)?j.call(this):this.$offset;if(typeof l=="string"&&(l=function(k){k===void 0&&(k="");var $=k.match(f);if(!$)return null;var i=(""+$[0]).match(V)||["-",0,0],r=i[0],b=60*+i[1]+ +i[2];return b===0?0:r==="+"?b:-b}(l),l===null))return this;var L=Math.abs(l)<=16?60*l:l,n=this;if(H)return n.$offset=L,n.$u=l===0,n;if(l!==0){var D=this.$u?this.toDate().getTimezoneOffset():-1*this.utcOffset();(n=this.local().add(L+D,y)).$offset=L,n.$x.$localOffset=D}else n=this.utc();return n};var T=h.format;h.format=function(l){var H=l||(this.$u?"YYYY-MM-DDTHH:mm:ss[Z]":"");return T.call(this,H)},h.valueOf=function(){var l=this.$utils().u(this.$offset)?0:this.$offset+(this.$x.$localOffset||this.$d.getTimezoneOffset());return this.$d.valueOf()-6e4*l},h.isUTC=function(){return!!this.$u},h.toISOString=function(){return this.toDate().toISOString()},h.toString=function(){return this.toDate().toUTCString()};var w=h.toDate;h.toDate=function(l){return l==="s"&&this.$offset?x(this.format("YYYY-MM-DD HH:mm:ss:SSS")).toDate():w.call(this)};var S=h.diff;h.diff=function(l,H,U){if(l&&this.$u===l.$u)return S.call(this,l,H,U);var L=this.local(),n=x(l).local();return S.call(L,n,H,U)}}})})(_e);var Je=_e.exports;const Ne=re(Je);var ge={exports:{}};(function(t,e){(function(y,f){t.exports=f()})(te,function(){var y={year:0,month:1,day:2,hour:3,minute:4,second:5},f={};return function(V,O,p){var x,h=function(T,w,S){S===void 0&&(S={});var l=new Date(T),H=function(U,L){L===void 0&&(L={});var n=L.timeZoneName||"short",D=U+"|"+n,k=f[D];return k||(k=new Intl.DateTimeFormat("en-US",{hour12:!1,timeZone:U,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",timeZoneName:n}),f[D]=k),k}(w,S);return H.formatToParts(l)},z=function(T,w){for(var S=h(T,w),l=[],H=0;H<S.length;H+=1){var U=S[H],L=U.type,n=U.value,D=y[L];D>=0&&(l[D]=parseInt(n,10))}var k=l[3],$=k===24?0:k,i=l[0]+"-"+l[1]+"-"+l[2]+" "+$+":"+l[4]+":"+l[5]+":000",r=+T;return(p.utc(i).valueOf()-(r-=r%1e3))/6e4},P=O.prototype;P.tz=function(T,w){T===void 0&&(T=x);var S,l=this.utcOffset(),H=this.toDate(),U=H.toLocaleString("en-US",{timeZone:T}),L=Math.round((H-new Date(U))/1e3/60),n=15*-Math.round(H.getTimezoneOffset()/15)-L;if(!Number(n))S=this.utcOffset(0,w);else if(S=p(U,{locale:this.$L}).$set("millisecond",this.$ms).utcOffset(n,!0),w){var D=S.utcOffset();S=S.add(l-D,"minute")}return S.$x.$timezone=T,S},P.offsetName=function(T){var w=this.$x.$timezone||p.tz.guess(),S=h(this.valueOf(),w,{timeZoneName:T}).find(function(l){return l.type.toLowerCase()==="timezonename"});return S&&S.value};var j=P.startOf;P.startOf=function(T,w){if(!this.$x||!this.$x.$timezone)return j.call(this,T,w);var S=p(this.format("YYYY-MM-DD HH:mm:ss:SSS"),{locale:this.$L});return j.call(S,T,w).tz(this.$x.$timezone,!0)},p.tz=function(T,w,S){var l=S&&w,H=S||w||x,U=z(+p(),H);if(typeof T!="string")return p(T).tz(H);var L=function($,i,r){var b=$-60*i*1e3,_=z(b,r);if(i===_)return[b,i];var m=z(b-=60*(_-i)*1e3,r);return _===m?[b,_]:[$-60*Math.min(_,m)*1e3,Math.max(_,m)]}(p.utc(T,l).valueOf(),U,H),n=L[0],D=L[1],k=p(n).utcOffset(D);return k.$x.$timezone=H,k},p.tz.guess=function(){return Intl.DateTimeFormat().resolvedOptions().timeZone},p.tz.setDefault=function(T){x=T}}})})(ge);var Pe=ge.exports;const Le=re(Pe);var Se={exports:{}};(function(t,e){(function(y,f){t.exports=f()})(te,function(){return function(y,f){var V=f.prototype,O=V.format;V.format=function(p){var x=this,h=this.$locale();if(!this.isValid())return O.bind(this)(p);var z=this.$utils(),P=(p||"YYYY-MM-DDTHH:mm:ssZ").replace(/\[([^\]]+)]|Q|wo|ww|w|WW|W|zzz|z|gggg|GGGG|Do|X|x|k{1,2}|S/g,function(j){switch(j){case"Q":return Math.ceil((x.$M+1)/3);case"Do":return h.ordinal(x.$D);case"gggg":return x.weekYear();case"GGGG":return x.isoWeekYear();case"wo":return h.ordinal(x.week(),"W");case"w":case"ww":return z.s(x.week(),j==="w"?1:2,"0");case"W":case"WW":return z.s(x.isoWeek(),j==="W"?1:2,"0");case"k":case"kk":return z.s(String(x.$H===0?24:x.$H),j==="k"?1:2,"0");case"X":return Math.floor(x.$d.getTime()/1e3);case"x":return x.$d.getTime();case"z":return"["+x.offsetName()+"]";case"zzz":return"["+x.offsetName("long")+"]";default:return j}});return O.bind(this)(P)}}})})(Se);var Ae=Se.exports;const We=re(Ae);var Me={exports:{}};(function(t,e){(function(y,f){t.exports=f()})(te,function(){var y,f,V=1e3,O=6e4,p=36e5,x=864e5,h=/\[([^\]]+)]|Y{1,4}|M{1,4}|D{1,2}|d{1,4}|H{1,2}|h{1,2}|a|A|m{1,2}|s{1,2}|Z{1,2}|SSS/g,z=31536e6,P=2628e6,j=/^(-|\+)?P(?:([-+]?[0-9,.]*)Y)?(?:([-+]?[0-9,.]*)M)?(?:([-+]?[0-9,.]*)W)?(?:([-+]?[0-9,.]*)D)?(?:T(?:([-+]?[0-9,.]*)H)?(?:([-+]?[0-9,.]*)M)?(?:([-+]?[0-9,.]*)S)?)?$/,T={years:z,months:P,days:x,hours:p,minutes:O,seconds:V,milliseconds:1,weeks:6048e5},w=function($){return $ instanceof D},S=function($,i,r){return new D($,r,i.$l)},l=function($){return f.p($)+"s"},H=function($){return $<0},U=function($){return H($)?Math.ceil($):Math.floor($)},L=function($){return Math.abs($)},n=function($,i){return $?H($)?{negative:!0,format:""+L($)+i}:{negative:!1,format:""+$+i}:{negative:!1,format:""}},D=function(){function $(r,b,_){var m=this;if(this.$d={},this.$l=_,r===void 0&&(this.$ms=0,this.parseFromMilliseconds()),b)return S(r*T[l(b)],this);if(typeof r=="number")return this.$ms=r,this.parseFromMilliseconds(),this;if(typeof r=="object")return Object.keys(r).forEach(function(c){m.$d[l(c)]=r[c]}),this.calMilliseconds(),this;if(typeof r=="string"){var A=r.match(j);if(A){var W=A.slice(2).map(function(c){return c!=null?Number(c):0});return this.$d.years=W[0],this.$d.months=W[1],this.$d.weeks=W[2],this.$d.days=W[3],this.$d.hours=W[4],this.$d.minutes=W[5],this.$d.seconds=W[6],this.calMilliseconds(),this}}return this}var i=$.prototype;return i.calMilliseconds=function(){var r=this;this.$ms=Object.keys(this.$d).reduce(function(b,_){return b+(r.$d[_]||0)*T[_]},0)},i.parseFromMilliseconds=function(){var r=this.$ms;this.$d.years=U(r/z),r%=z,this.$d.months=U(r/P),r%=P,this.$d.days=U(r/x),r%=x,this.$d.hours=U(r/p),r%=p,this.$d.minutes=U(r/O),r%=O,this.$d.seconds=U(r/V),r%=V,this.$d.milliseconds=r},i.toISOString=function(){var r=n(this.$d.years,"Y"),b=n(this.$d.months,"M"),_=+this.$d.days||0;this.$d.weeks&&(_+=7*this.$d.weeks);var m=n(_,"D"),A=n(this.$d.hours,"H"),W=n(this.$d.minutes,"M"),c=this.$d.seconds||0;this.$d.milliseconds&&(c+=this.$d.milliseconds/1e3,c=Math.round(1e3*c)/1e3);var u=n(c,"S"),a=r.negative||b.negative||m.negative||A.negative||W.negative||u.negative,d=A.format||W.format||u.format?"T":"",s=(a?"-":"")+"P"+r.format+b.format+m.format+d+A.format+W.format+u.format;return s==="P"||s==="-P"?"P0D":s},i.toJSON=function(){return this.toISOString()},i.format=function(r){var b=r||"YYYY-MM-DDTHH:mm:ss",_={Y:this.$d.years,YY:f.s(this.$d.years,2,"0"),YYYY:f.s(this.$d.years,4,"0"),M:this.$d.months,MM:f.s(this.$d.months,2,"0"),D:this.$d.days,DD:f.s(this.$d.days,2,"0"),H:this.$d.hours,HH:f.s(this.$d.hours,2,"0"),m:this.$d.minutes,mm:f.s(this.$d.minutes,2,"0"),s:this.$d.seconds,ss:f.s(this.$d.seconds,2,"0"),SSS:f.s(this.$d.milliseconds,3,"0")};return b.replace(h,function(m,A){return A||String(_[m])})},i.as=function(r){return this.$ms/T[l(r)]},i.get=function(r){var b=this.$ms,_=l(r);return _==="milliseconds"?b%=1e3:b=_==="weeks"?U(b/T[_]):this.$d[_],b||0},i.add=function(r,b,_){var m;return m=b?r*T[l(b)]:w(r)?r.$ms:S(r,this).$ms,S(this.$ms+m*(_?-1:1),this)},i.subtract=function(r,b){return this.add(r,b,!0)},i.locale=function(r){var b=this.clone();return b.$l=r,b},i.clone=function(){return S(this.$ms,this)},i.humanize=function(r){return y().add(this.$ms,"ms").locale(this.$l).fromNow(!r)},i.valueOf=function(){return this.asMilliseconds()},i.milliseconds=function(){return this.get("milliseconds")},i.asMilliseconds=function(){return this.as("milliseconds")},i.seconds=function(){return this.get("seconds")},i.asSeconds=function(){return this.as("seconds")},i.minutes=function(){return this.get("minutes")},i.asMinutes=function(){return this.as("minutes")},i.hours=function(){return this.get("hours")},i.asHours=function(){return this.as("hours")},i.days=function(){return this.get("days")},i.asDays=function(){return this.as("days")},i.weeks=function(){return this.get("weeks")},i.asWeeks=function(){return this.as("weeks")},i.months=function(){return this.get("months")},i.asMonths=function(){return this.as("months")},i.years=function(){return this.get("years")},i.asYears=function(){return this.as("years")},$}(),k=function($,i,r){return $.add(i.years()*r,"y").add(i.months()*r,"M").add(i.days()*r,"d").add(i.hours()*r,"h").add(i.minutes()*r,"m").add(i.seconds()*r,"s").add(i.milliseconds()*r,"ms")};return function($,i,r){y=r,f=r().$utils(),r.duration=function(m,A){var W=r.locale();return S(m,{$l:W},A)},r.isDuration=w;var b=i.prototype.add,_=i.prototype.subtract;i.prototype.add=function(m,A){return w(m)?k(this,m,1):b.bind(this)(m,A)},i.prototype.subtract=function(m,A){return w(m)?k(this,m,-1):_.bind(this)(m,A)}}})})(Me);var Ie=Me.exports;const Fe=re(Ie);var Ye={exports:{}};(function(t,e){(function(y,f){t.exports=f()})(te,function(){return function(y,f,V){f.prototype.dayOfYear=function(O){var p=Math.round((V(this).startOf("day")-V(this).startOf("year"))/864e5)+1;return O==null?p:this.add(O-p,"day")}}})})(Ye);var Ze=Ye.exports;const Ee=re(Ze);var Ge={exports:{}};(function(t,e){(function(y,f){t.exports=f(pe)})(te,function(y){function f(p){return p&&typeof p=="object"&&"default"in p?p:{default:p}}var V=f(y),O={name:"ja",weekdays:"日曜日_月曜日_火曜日_水曜日_木曜日_金曜日_土曜日".split("_"),weekdaysShort:"日_月_火_水_木_金_土".split("_"),weekdaysMin:"日_月_火_水_木_金_土".split("_"),months:"1月_2月_3月_4月_5月_6月_7月_8月_9月_10月_11月_12月".split("_"),monthsShort:"1月_2月_3月_4月_5月_6月_7月_8月_9月_10月_11月_12月".split("_"),ordinal:function(p){return p+"日"},formats:{LT:"HH:mm",LTS:"HH:mm:ss",L:"YYYY/MM/DD",LL:"YYYY年M月D日",LLL:"YYYY年M月D日 HH:mm",LLLL:"YYYY年M月D日 dddd HH:mm",l:"YYYY/MM/DD",ll:"YYYY年M月D日",lll:"YYYY年M月D日 HH:mm",llll:"YYYY年M月D日(ddd) HH:mm"},meridiem:function(p){return p<12?"午前":"午後"},relativeTime:{future:"%s後",past:"%s前",s:"数秒",m:"1分",mm:"%d分",h:"1時間",hh:"%d時間",d:"1日",dd:"%d日",M:"1ヶ月",MM:"%dヶ月",y:"1年",yy:"%d年"}};return V.default.locale(O,null,!0),O})})(Ge);q.extend(Ne);q.extend(Le);q.extend(We);q.extend(Fe);q.extend(Ee);const Be=[{title:"予定なし",value:0},{title:"7日以内に実施",value:1},{title:"3～6日以内に実施",value:2},{title:"2日以内に実施",value:3},{title:"24時間以内に実施",value:4},{title:"12時間以内に実施",value:5},{title:"2時間以内に実施",value:6}],qe=[{title:"予定なし",value:0},{title:"7日間以上または期限未定",value:1},{title:"2～6日間",value:2},{title:"2日間以内",value:3}],Qe=[{title:"毎時15分および45分",value:"default"},{title:"強制",value:"force"},{title:"なし",value:"disable"}],Re={P:"ポジションマーカー",0:"ビット 0",1:"ビット 1",S:"JJY コールサイン"},Xe={P:"高出力 0.2秒、低出力 0.8秒",0:"高出力 0.8秒、低出力 0.2秒",1:"高出力 0.5秒、低出力 0.5秒",S:"・－－－ ・－－－ －・－－（モールスで2回以内）"},g=t=>(t??!1)==0?"0":"1";function me(t){let e=!1;for(;t!==0;)t&1&&(e=!e),t>>=1;return e}function Ke(t,e){const y=q(t).startOf("minute"),f=[];t.subtract;for(let V=0;V<60;V++)f[V]=et(y.add(V,"seconds"),e);return f}function De(t,e){return((e==null?void 0:e.callSign)==="force"||t.minute()===15||t.minute()===45)&&(e==null?void 0:e.callSign)!=="disable"}function et(t,e){const y=De(t,e);switch(t.second()){case 0:return"P";case 1:return g(t.minute()/10&4);case 2:return g(t.minute()/10&2);case 3:return g(t.minute()/10&1);case 4:return"0";case 5:return g(t.minute()%10&8);case 6:return g(t.minute()%10&4);case 7:return g(t.minute()%10&2);case 8:return g(t.minute()%10&1);case 9:return"P";case 10:case 11:return"0";case 12:return g(t.hour()/10&2);case 13:return g(t.hour()/10&1);case 14:return"0";case 15:return g(t.hour()%10&8);case 16:return g(t.hour()%10&4);case 17:return g(t.hour()%10&2);case 18:return g(t.hour()%10&1);case 19:return"P";case 20:case 21:return"0";case 22:return g(t.dayOfYear()/100&2);case 23:return g(t.dayOfYear()/100&1);case 24:return"0";case 25:return g(t.dayOfYear()/10%10&8);case 26:return g(t.dayOfYear()/10%10&4);case 27:return g(t.dayOfYear()/10%10&2);case 28:return g(t.dayOfYear()/10%10&1);case 29:return"P";case 30:return g(t.dayOfYear()%10&8);case 31:return g(t.dayOfYear()%10&4);case 32:return g(t.dayOfYear()%10&2);case 33:return g(t.dayOfYear()%10&1);case 34:return"0";case 35:return"0";case 36:return g(me(t.hour()/10<<4|t.hour()%10));case 37:return g(me(t.minute()/10<<4|t.minute()%10));case 38:return g(e==null?void 0:e.summerTimeNotice);case 39:return"P";case 40:return y?"S":g(e==null?void 0:e.summerTime);case 41:return y?"S":g(t.year()%100/10&8);case 42:return y?"S":g(t.year()%100/10&4);case 43:return y?"S":g(t.year()%100/10&2);case 44:return y?"S":g(t.year()%100/10&1);case 45:return y?"S":g(t.year()%10&8);case 46:return y?"S":g(t.year()%10&4);case 47:return y?"S":g(t.year()%10&2);case 48:return y?"S":g(t.year()%10&1);case 49:return"P";case 50:return g(y?((e==null?void 0:e.stopAfter)??0)&4:t.day()&4);case 51:return g(y?((e==null?void 0:e.stopAfter)??0)&2:t.day()&2);case 52:return g(y?((e==null?void 0:e.stopAfter)??0)&1:t.day()&1);case 53:return y&&(e==null?void 0:e.stopAfter)!==0?g(e==null?void 0:e.stopType):g(e==null?void 0:e.leapSecondNotice);case 54:return y&&(e==null?void 0:e.stopAfter)!==0?g(((e==null?void 0:e.stopDuration)??0)&2):g((e==null?void 0:e.leapSecondNotice)&&(e==null?void 0:e.leapSecondType));case 55:return y&&(e==null?void 0:e.stopAfter)!==0?g(((e==null?void 0:e.stopDuration)??0)&1):"0";case 56:case 57:case 58:return"0";case 59:return"P";default:return console.info("invalid time",t),"0"}}function tt(t,e){switch(t){case 0:return"M: 開始を表すポジションマーカー（固定）";case 1:return"分の重み（40）";case 2:return"分の重み（20）";case 3:return"分の重み（10）";case 4:return"未使用（常にビット 0）";case 5:return"分の重み（8）";case 6:return"分の重み（4）";case 7:return"分の重み（2）";case 8:return"分の重み（1）";case 9:return"P1: ポジションマーカー（固定）";case 10:case 11:return"未使用（常にビット 0）";case 12:return"時の重み（20）";case 13:return"時の重み（10）";case 14:return"未使用（常にビット 0）";case 15:return"時の重み（8）";case 16:return"時の重み（4）";case 17:return"時の重み（2）";case 18:return"時の重み（1）";case 19:return"P2: ポジションマーカー（固定）";case 20:case 21:return"未使用（常にビット 0）";case 22:return"年の通算日の重み（200）";case 23:return"年の通算日の重み（100）";case 24:return"未使用（常にビット 0）";case 25:return"年の通算日の重み（80）";case 26:return"年の通算日の重み（40）";case 27:return"年の通算日の重み（20）";case 28:return"年の通算日の重み（10）";case 29:return"P3: ポジションマーカー（固定）";case 30:return"年の通算日の重み（8）";case 31:return"年の通算日の重み（4）";case 32:return"年の通算日の重み（2）";case 33:return"年の通算日の重み（1）";case 34:case 35:return"未使用（常にビット 0）";case 36:return"PA1: 「時」部のビットの偶数パリティ";case 37:return"PA2: 「分」部のビットの偶数パリティ";case 38:return"SU1: 6日以内に夏時間開始または終了のときビット 1";case 39:return"P4: ポジションマーカー（固定）";case 40:return e?"「JJY」を表すコールサイン":"SU2: 夏時間実施中のときビット 1";case 41:return e?"「JJY」を表すコールサイン":"年の重み（80）";case 42:return e?"「JJY」を表すコールサイン":"年の重み（40）";case 43:return e?"「JJY」を表すコールサイン":"年の重み（20）";case 44:return e?"「JJY」を表すコールサイン":"年の重み（10）";case 45:return e?"「JJY」を表すコールサイン":"年の重み（8）";case 46:return e?"「JJY」を表すコールサイン":"年の重み（4）";case 47:return e?"「JJY」を表すコールサイン":"年の重み（2）";case 48:return e?"「JJY」を表すコールサイン":"年の重み（1）";case 49:return"P5: ポジションマーカー（固定）";case 50:return e?"ST1: 停波が開始するまでの時間の上位1ビット目":"日曜日を起点とした曜日の上位1ビット目";case 51:return e?"ST2: 停波が開始するまでの時間の上位2ビット目":"日曜日を起点とした曜日の上位2ビット目";case 52:return e?"ST3: 停波が開始するまでの時間の上位3ビット目":"日曜日を起点とした曜日の上位3ビット目";case 53:return e?"ST4: 停波が昼間のみのときビット 1":"LS1: 月末に閏秒が実施されるときビット 1";case 54:return e?"ST5: 停波の期間の上位1ビット目":"LS2: 実施される閏秒の種別が挿入のときビット 1、削除のときビット 0";case 55:return e?"ST6: 停波の期間の上位2ビット目":"未使用（常にビット 0）";case 56:case 57:case 58:return"未使用（常にビット 0）";case 59:return"P0: ポジションマーカー（固定）";default:return console.info("invalid time",t),""}}const nt={class:"animated-clock"},rt={class:"date"},at={class:"time"},st=oe({__name:"AnimatedClock",props:{time:null},setup(t){return(e,y)=>(ue(),ce("div",nt,[N("span",rt,R(t.time.format("YYYY-MM-DD")),1),N("span",at,[N("span",null,R(t.time.format("HH")),1),N("span",{style:de(`visibility:${t.time.millisecond()<666?"visible":"hidden"}`)},":",4),N("span",null,R(t.time.format("mm")),1),N("span",{style:de(`visibility:${t.time.millisecond()<666?"visible":"hidden"}`)},":",4),N("span",null,R(t.time.format("ss")),1)])]))}}),ut={class:"title"},it=oe({__name:"TimeBars",props:Oe({timeCodes:null,time:null,jjyOptions:null,length:null,offset:null},{offset:0}),setup(t){return(e,y)=>{const f=I("v-tooltip"),V=I("v-sheet");return ue(!0),ce(ve,null,he(e.timeCodes.slice(e.offset,e.length+e.offset),(O,p)=>(ue(),$e(V,{key:p,class:fe(["timebar d-inline-flex justify-center align-center",{now:e.time.second()===e.offset+p,"marker-position":O==="P","marker-zero":O==="0","marker-one":O==="1","marker-sign":O==="S"}])},{default:C(()=>[v(f,{activator:"parent",location:"bottom","open-delay":"100",class:"timebar-tooltip"},{default:C(()=>[N("div",ut,[N("div",{class:fe(["legend",{"marker-position":O==="P","marker-zero":O==="0","marker-one":O==="1","marker-sign":O==="S"}])},null,2),N("span",null,R(e.offset+p)+": "+R(ee(Re)[O]),1)]),N("div",null,R(ee(tt)(e.offset+p,ee(De)(e.time,e.jjyOptions))),1),N("div",null,R(ee(Xe)[O]),1)]),_:2},1024)]),_:2},1032,["class"]))),128)}}}),lt=N("p",null," お使いのデバイスにスピーカーまたはイヤホンを接続して「音の再生」と「時刻合わせモード」を有効にしてください。スピーカーまたはイヤホンの配線部分に電波時計を近づけると受信が始まります。 ",-1),ot=N("p",null," サウンドデバイスによってはローパスフィルターによって 40kHz の信号が生成できず時刻合わせができない場合があります。時刻合わせによって生じた問題について責任は負いかねます。ご了承ください。 ",-1),ct=N("div",{class:"text-caption"},"ボリューム",-1),dt=N("div",{class:"text-caption"},"音の周波数（Hz）",-1),ft=N("div",{class:"text-caption"},"ボリューム",-1),mt=N("h4",null,"参考文献",-1),ht=N("ul",null,[N("li",null,[N("a",{href:"https://jjy.nict.go.jp/jjy/trans/index.html",target:"_blank"},"標準電波の出し方"),le(" - 情報通信研究機構 日本標準時グループ ")]),N("li",null,[N("a",{href:"https://ja.wikipedia.org/wiki/JJY",target:"_blank"},"JJY"),le(" - Wikipedia")]),N("li",null,[N("a",{href:"https://shogo82148.github.io/web-jjy/",target:"_blank"},"JJYシミュレータWeb版")])],-1),vt=oe({__name:"SimulatorApp",setup(t){const e=B(q()),y=B(q().startOf("second")),f=B(q().startOf("minute")),V=B(),O=B(!0),p=B(0),x=ke(()=>Ke(f.value,h.value)),h=B({callSign:"default",leapSecondType:!0,stopAfter:0,stopDuration:3}),z=B(),P=B(),j=B(440),T=B(.5);let w=null,S=!1;Ue(async()=>(V.value||(e.value=q().subtract(p.value,"milliseconds")),y.value.unix()!=e.value.unix()&&(y.value=e.value.startOf("second"),e.value.diff(f.value,"seconds")>=60&&(f.value=e.value.startOf("minute"))),.05)),xe(()=>y.value,()=>{if(!z.value)return;let L=Ce();function n($,i){const r=P.value?13333.333:Number.isFinite(Number(j.value))?Math.min(Math.max(Number(j.value),20),24e3):440;w!=null&&(w.oscillator.type=P.value?"square":"sine",w.triggerAttackRelease(r,$,L,T.value*(i?1:.1))),L+=$}function D(){n(.25,!0),n(.1,!1)}function k(){n(.1,!0),n(.1,!1)}switch(x.value[y.value.second()]){case"P":{S=!1,n(.2,!0),n(.8+1,!1);break}case"0":{S=!1,n(.8,!0),n(.2+1,!1);break}case"1":{S=!1,n(.5,!0),n(.5+1,!1);break}case"S":{if(!S){S=!0;for(let $=0;$<2;$++)n(.3,!1),k(),D(),D(),D(),n(.05,!1),k(),D(),D(),D(),n(.05,!1),D(),k(),D(),D(),n(.05,!1);n(.6+.1,!1)}break}}});function l(){O.value||(p.value=0,V.value=!1)}function H(){V.value?p.value=q().diff(e.value,"milliseconds"):O.value=!1}async function U(){!z.value&&w==null?(await je(),w=new ze({envelope:{attack:.05,decay:.05,sustain:.8,release:.05}}).toDestination()):w==null||w.triggerRelease()}return(L,n)=>{const D=I("v-col"),k=I("v-checkbox"),$=I("v-row"),i=I("v-select"),r=I("v-radio"),b=I("v-radio-group"),_=I("v-divider"),m=I("v-btn"),A=I("v-card-text"),W=I("v-slider"),c=I("v-container"),u=I("v-spacer"),a=I("v-card-actions"),d=I("v-card"),s=I("v-dialog"),M=I("v-text-field"),Y=I("v-footer");return ue(),$e(Ve,{"page-id":"jjy/simulator","toolbar-title":"JJY シミュレータ"},{footer:C(()=>[v(_),v(Y,null,{default:C(()=>[v(c,null,{default:C(()=>[mt,ht]),_:1})]),_:1})]),default:C(()=>[v($,{"no-gutters":"",align:"center",justify:"center"},{default:C(()=>[v(D,{cols:"5",sm:"7"},{default:C(()=>[v(st,{time:e.value,style:{"font-size":"125%"}},null,8,["time"])]),_:1}),v(D,{cols:"3",sm:"2"},{default:C(()=>[v(k,{modelValue:V.value,"onUpdate:modelValue":n[0]||(n[0]=o=>V.value=o),label:"停止",color:"red","hide-details":"",onClick:H},null,8,["modelValue"])]),_:1}),v(D,{cols:"4",sm:"3"},{default:C(()=>[v(k,{modelValue:O.value,"onUpdate:modelValue":n[1]||(n[1]=o=>O.value=o),label:"現在の時刻","hide-details":"",onClick:l,readonly:O.value},null,8,["modelValue","readonly"])]),_:1})]),_:1}),v($,{"no-gutters":""},{default:C(()=>[(ue(),ce(ve,null,he(2,o=>v(D,{cols:"12",key:o,class:"d-flex justify-center"},{default:C(()=>[v(it,{"time-codes":x.value,time:y.value,jjyOptions:h.value,length:30,offset:(o-1)*30},null,8,["time-codes","time","jjyOptions","offset"])]),_:2},1024)),64))]),_:1}),v($,null,{default:C(()=>[v(D,{cols:"6",sm:"4",lg:"3"},{default:C(()=>[v(i,{label:"コールサイン",density:"compact",variant:"underlined",modelValue:h.value.callSign,"onUpdate:modelValue":n[2]||(n[2]=o=>h.value.callSign=o),items:ee(Qe)},null,8,["modelValue","items"])]),_:1}),v(D,{cols:"6",sm:"4",lg:"3"},{default:C(()=>[v(k,{modelValue:h.value.summerTime,"onUpdate:modelValue":n[3]||(n[3]=o=>h.value.summerTime=o),label:"夏時間実施中","hide-details":"",density:"compact"},null,8,["modelValue"]),v(k,{modelValue:h.value.summerTimeNotice,"onUpdate:modelValue":n[4]||(n[4]=o=>h.value.summerTimeNotice=o),label:"6日以内に夏時間を開始または終了","hide-details":"",density:"compact"},null,8,["modelValue"])]),_:1}),v(D,{cols:"6",sm:"4",lg:"3"},{default:C(()=>[v(k,{modelValue:h.value.leapSecondNotice,"onUpdate:modelValue":n[5]||(n[5]=o=>h.value.leapSecondNotice=o),label:"月末に閏秒を実施","hide-details":"",density:"compact"},null,8,["modelValue"]),v(b,{modelValue:h.value.leapSecondType,"onUpdate:modelValue":n[6]||(n[6]=o=>h.value.leapSecondType=o),disabled:!(h.value.leapSecondNotice??!1),direction:"horizontal",density:"compact"},{default:C(()=>[v(r,{label:"挿入",value:!0}),v(r,{label:"削除",value:!1})]),_:1},8,["modelValue","disabled"])]),_:1}),v(D,{cols:"6",sm:"4",lg:"3"},{default:C(()=>[v(i,{label:"停波",density:"compact",variant:"underlined",modelValue:h.value.stopAfter,"onUpdate:modelValue":n[7]||(n[7]=o=>h.value.stopAfter=o),items:ee(Be)},null,8,["modelValue","items"]),v(i,{label:"停波期間",density:"compact",variant:"underlined",modelValue:h.value.stopDuration,"onUpdate:modelValue":n[8]||(n[8]=o=>h.value.stopDuration=o),items:ee(qe).slice(1)},null,8,["modelValue","items"]),v(k,{modelValue:h.value.stopType,"onUpdate:modelValue":n[9]||(n[9]=o=>h.value.stopType=o),label:"停波は昼間のみ","hide-details":"",density:"compact"},null,8,["modelValue"])]),_:1}),v(_)]),_:1}),v($,null,{default:C(()=>[v(D,{cols:"6",sm:"4",lg:"3"},{default:C(()=>[v(k,{modelValue:z.value,"onUpdate:modelValue":n[10]||(n[10]=o=>z.value=o),label:"音の再生","hide-details":"",onClick:U,density:"compact"},null,8,["modelValue"]),v(k,{modelValue:P.value,"onUpdate:modelValue":n[11]||(n[11]=o=>P.value=o),label:"時刻合わせモード","hide-details":"",density:"compact"},null,8,["modelValue"]),v(s,{"max-width":"640"},{activator:C(({props:o})=>[v(m,Te(o,{"prepend-icon":"mdi-help",variant:"outlined"}),{default:C(()=>[le("時刻合わせのやりかた")]),_:2},1040)]),default:C(({isActive:o})=>[v(d,{title:"時刻合わせのやりかた"},{default:C(()=>[v(A,null,{default:C(()=>[lt,ot]),_:1}),v(c,{class:"py-0"},{default:C(()=>[v($,{"no-gutters":""},{default:C(()=>[v(D,{cols:"6"},{default:C(()=>[v(k,{modelValue:z.value,"onUpdate:modelValue":n[12]||(n[12]=J=>z.value=J),label:"音の再生","hide-details":"",onClick:U,density:"compact"},null,8,["modelValue"])]),_:1}),v(D,{cols:"6"},{default:C(()=>[v(k,{modelValue:P.value,"onUpdate:modelValue":n[13]||(n[13]=J=>P.value=J),label:"時刻合わせモード","hide-details":"",density:"compact"},null,8,["modelValue"])]),_:1}),v(D,{cols:"12"},{default:C(()=>[ct,v(W,{modelValue:T.value,"onUpdate:modelValue":n[14]||(n[14]=J=>T.value=J),min:"0",max:"1","thumb-label":""},null,8,["modelValue"])]),_:1})]),_:1})]),_:1}),v(a,null,{default:C(()=>[v(u),v(m,{text:"閉じる",onClick:J=>o.value=!1},null,8,["onClick"])]),_:2},1024)]),_:2},1024)]),_:1})]),_:1}),v(D,{cols:"6",sm:"4",lg:"3"},{default:C(()=>[N("div",null,[dt,v(W,{modelValue:j.value,"onUpdate:modelValue":n[16]||(n[16]=o=>j.value=o),min:"20",max:"24000",step:"1","thumb-label":"",disabled:P.value},{append:C(()=>[v(M,{modelValue:j.value,"onUpdate:modelValue":n[15]||(n[15]=o=>j.value=o),density:"compact",variant:"underlined",style:{width:"100px"},type:"number",prefix:"Hz",class:"text-align-right",inputmode:"numeric",reverse:"","hide-details":"","single-line":""},null,8,["modelValue"])]),_:1},8,["modelValue","disabled"])]),N("div",null,[ft,v(W,{modelValue:T.value,"onUpdate:modelValue":n[17]||(n[17]=o=>T.value=o),min:"0",max:"1","thumb-label":""},null,8,["modelValue"])])]),_:1})]),_:1})]),_:1})}}});He("#app",vt);