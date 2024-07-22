import{z as be,h as we,d as oe,o as ue,i as ce,f as N,t as R,B as de,k as Oe,a as F,C as he,F as ve,c as $e,b as H,e as v,D as fe,q as ee,r as G,p as ke,w as xe,s as Te,l as le,_ as Ve,g as He}from"../tools-AppBase.vue_vue_type_script_setup_true_lang-CtLU3Mb_.js";import{n as Ce,s as je,d as ze}from"../tools-index-DFWBQmQS.js";function Ue(t,e){let p,f;const V=async function(){try{f=await t(),typeof f<"u"&&(p=setTimeout(V,f*1e3))}catch(b){e&&(f=await e(b),typeof f<"u"&&(p=setTimeout(V,f*1e3)))}};be(async()=>{await V()}),we(()=>{clearTimeout(p)})}var te=typeof globalThis<"u"?globalThis:typeof window<"u"?window:typeof global<"u"?global:typeof self<"u"?self:{};function re(t){return t&&t.__esModule&&Object.prototype.hasOwnProperty.call(t,"default")?t.default:t}var pe={exports:{}};(function(t,e){(function(p,f){t.exports=f()})(te,function(){var p=1e3,f=6e4,V=36e5,b="millisecond",y="second",x="minute",h="hour",z="day",L="week",j="month",T="quarter",w="year",O="date",i="Invalid Date",C=/^(\d{4})[-/]?(\d{1,2})?[-/]?(\d{0,2})[Tt\s]*(\d{1,2})?:?(\d{1,2})?:?(\d{1,2})?[.:]?(\d+)?$/,U=/\[([^\]]+)]|Y{1,4}|M{1,4}|D{1,2}|d{1,4}|H{1,2}|h{1,2}|a|A|m{1,2}|s{1,2}|Z{1,2}|SSS/g,J={name:"en",weekdays:"Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday".split("_"),months:"January_February_March_April_May_June_July_August_September_October_November_December".split("_"),ordinal:function(c){var u=["th","st","nd","rd"],a=c%100;return"["+c+(u[(a-20)%10]||u[a]||u[0])+"]"}},n=function(c,u,a){var d=String(c);return!d||d.length>=u?c:""+Array(u+1-d.length).join(a)+c},D={s:n,z:function(c){var u=-c.utcOffset(),a=Math.abs(u),d=Math.floor(a/60),s=a%60;return(u<=0?"+":"-")+n(d,2,"0")+":"+n(s,2,"0")},m:function c(u,a){if(u.date()<a.date())return-c(a,u);var d=12*(a.year()-u.year())+(a.month()-u.month()),s=u.clone().add(d,j),S=a-s<0,M=u.clone().add(d+(S?-1:1),j);return+(-(d+(a-s)/(S?s-M:M-s))||0)},a:function(c){return c<0?Math.ceil(c)||0:Math.floor(c)},p:function(c){return{M:j,y:w,w:L,d:z,D:O,h,m:x,s:y,ms:b,Q:T}[c]||String(c||"").toLowerCase().replace(/s$/,"")},u:function(c){return c===void 0}},k="en",$={};$[k]=J;var l="$isDayjsObject",r=function(c){return c instanceof A||!(!c||!c[l])},Y=function c(u,a,d){var s;if(!u)return k;if(typeof u=="string"){var S=u.toLowerCase();$[S]&&(s=S),a&&($[S]=a,s=S);var M=u.split("-");if(!s&&M.length>1)return c(M[0])}else{var o=u.name;$[o]=u,s=o}return!d&&s&&(k=s),s||!d&&k},_=function(c,u){if(r(c))return c.clone();var a=typeof u=="object"?u:{};return a.date=c,a.args=arguments,new A(a)},m=D;m.l=Y,m.i=r,m.w=function(c,u){return _(c,{locale:u.$L,utc:u.$u,x:u.$x,$offset:u.$offset})};var A=function(){function c(a){this.$L=Y(a.locale,null,!0),this.parse(a),this.$x=this.$x||a.x||{},this[l]=!0}var u=c.prototype;return u.parse=function(a){this.$d=function(d){var s=d.date,S=d.utc;if(s===null)return new Date(NaN);if(m.u(s))return new Date;if(s instanceof Date)return new Date(s);if(typeof s=="string"&&!/Z$/i.test(s)){var M=s.match(C);if(M){var o=M[2]-1||0,P=(M[7]||"0").substring(0,3);return S?new Date(Date.UTC(M[1],o,M[3]||1,M[4]||0,M[5]||0,M[6]||0,P)):new Date(M[1],o,M[3]||1,M[4]||0,M[5]||0,M[6]||0,P)}}return new Date(s)}(a),this.init()},u.init=function(){var a=this.$d;this.$y=a.getFullYear(),this.$M=a.getMonth(),this.$D=a.getDate(),this.$W=a.getDay(),this.$H=a.getHours(),this.$m=a.getMinutes(),this.$s=a.getSeconds(),this.$ms=a.getMilliseconds()},u.$utils=function(){return m},u.isValid=function(){return this.$d.toString()!==i},u.isSame=function(a,d){var s=_(a);return this.startOf(d)<=s&&s<=this.endOf(d)},u.isAfter=function(a,d){return _(a)<this.startOf(d)},u.isBefore=function(a,d){return this.endOf(d)<_(a)},u.$g=function(a,d,s){return m.u(a)?this[d]:this.set(s,a)},u.unix=function(){return Math.floor(this.valueOf()/1e3)},u.valueOf=function(){return this.$d.getTime()},u.startOf=function(a,d){var s=this,S=!!m.u(d)||d,M=m.p(a),o=function(K,E){var Q=m.w(s.$u?Date.UTC(s.$y,E,K):new Date(s.$y,E,K),s);return S?Q:Q.endOf(z)},P=function(K,E){return m.w(s.toDate()[K].apply(s.toDate("s"),(S?[0,0,0,0]:[23,59,59,999]).slice(E)),s)},I=this.$W,Z=this.$M,B=this.$D,ne="set"+(this.$u?"UTC":"");switch(M){case w:return S?o(1,0):o(31,11);case j:return S?o(1,Z):o(0,Z+1);case L:var X=this.$locale().weekStart||0,ae=(I<X?I+7:I)-X;return o(S?B-ae:B+(6-ae),Z);case z:case O:return P(ne+"Hours",0);case h:return P(ne+"Minutes",1);case x:return P(ne+"Seconds",2);case y:return P(ne+"Milliseconds",3);default:return this.clone()}},u.endOf=function(a){return this.startOf(a,!1)},u.$set=function(a,d){var s,S=m.p(a),M="set"+(this.$u?"UTC":""),o=(s={},s[z]=M+"Date",s[O]=M+"Date",s[j]=M+"Month",s[w]=M+"FullYear",s[h]=M+"Hours",s[x]=M+"Minutes",s[y]=M+"Seconds",s[b]=M+"Milliseconds",s)[S],P=S===z?this.$D+(d-this.$W):d;if(S===j||S===w){var I=this.clone().set(O,1);I.$d[o](P),I.init(),this.$d=I.set(O,Math.min(this.$D,I.daysInMonth())).$d}else o&&this.$d[o](P);return this.init(),this},u.set=function(a,d){return this.clone().$set(a,d)},u.get=function(a){return this[m.p(a)]()},u.add=function(a,d){var s,S=this;a=Number(a);var M=m.p(d),o=function(Z){var B=_(S);return m.w(B.date(B.date()+Math.round(Z*a)),S)};if(M===j)return this.set(j,this.$M+a);if(M===w)return this.set(w,this.$y+a);if(M===z)return o(1);if(M===L)return o(7);var P=(s={},s[x]=f,s[h]=V,s[y]=p,s)[M]||1,I=this.$d.getTime()+a*P;return m.w(I,this)},u.subtract=function(a,d){return this.add(-1*a,d)},u.format=function(a){var d=this,s=this.$locale();if(!this.isValid())return s.invalidDate||i;var S=a||"YYYY-MM-DDTHH:mm:ssZ",M=m.z(this),o=this.$H,P=this.$m,I=this.$M,Z=s.weekdays,B=s.months,ne=s.meridiem,X=function(E,Q,se,ie){return E&&(E[Q]||E(d,S))||se[Q].slice(0,ie)},ae=function(E){return m.s(o%12||12,E,"0")},K=ne||function(E,Q,se){var ie=E<12?"AM":"PM";return se?ie.toLowerCase():ie};return S.replace(U,function(E,Q){return Q||function(se){switch(se){case"YY":return String(d.$y).slice(-2);case"YYYY":return m.s(d.$y,4,"0");case"M":return I+1;case"MM":return m.s(I+1,2,"0");case"MMM":return X(s.monthsShort,I,B,3);case"MMMM":return X(B,I);case"D":return d.$D;case"DD":return m.s(d.$D,2,"0");case"d":return String(d.$W);case"dd":return X(s.weekdaysMin,d.$W,Z,2);case"ddd":return X(s.weekdaysShort,d.$W,Z,3);case"dddd":return Z[d.$W];case"H":return String(o);case"HH":return m.s(o,2,"0");case"h":return ae(1);case"hh":return ae(2);case"a":return K(o,P,!0);case"A":return K(o,P,!1);case"m":return String(P);case"mm":return m.s(P,2,"0");case"s":return String(d.$s);case"ss":return m.s(d.$s,2,"0");case"SSS":return m.s(d.$ms,3,"0");case"Z":return M}return null}(E)||M.replace(":","")})},u.utcOffset=function(){return 15*-Math.round(this.$d.getTimezoneOffset()/15)},u.diff=function(a,d,s){var S,M=this,o=m.p(d),P=_(a),I=(P.utcOffset()-this.utcOffset())*f,Z=this-P,B=function(){return m.m(M,P)};switch(o){case w:S=B()/12;break;case j:S=B();break;case T:S=B()/3;break;case L:S=(Z-I)/6048e5;break;case z:S=(Z-I)/864e5;break;case h:S=Z/V;break;case x:S=Z/f;break;case y:S=Z/p;break;default:S=Z}return s?S:m.a(S)},u.daysInMonth=function(){return this.endOf(j).$D},u.$locale=function(){return $[this.$L]},u.locale=function(a,d){if(!a)return this.$L;var s=this.clone(),S=Y(a,d,!0);return S&&(s.$L=S),s},u.clone=function(){return m.w(this.$d,this)},u.toDate=function(){return new Date(this.valueOf())},u.toJSON=function(){return this.isValid()?this.toISOString():null},u.toISOString=function(){return this.$d.toISOString()},u.toString=function(){return this.$d.toUTCString()},c}(),W=A.prototype;return _.prototype=W,[["$ms",b],["$s",y],["$m",x],["$H",h],["$W",z],["$M",j],["$y",w],["$D",O]].forEach(function(c){W[c[1]]=function(u){return this.$g(u,c[0],c[1])}}),_.extend=function(c,u){return c.$i||(c(u,A,_),c.$i=!0),_},_.locale=Y,_.isDayjs=r,_.unix=function(c){return _(1e3*c)},_.en=$[k],_.Ls=$,_.p={},_})})(pe);var ye=pe.exports;const q=re(ye);var _e={exports:{}};(function(t,e){(function(p,f){t.exports=f()})(te,function(){var p="minute",f=/[+-]\d\d(?::?\d\d)?/g,V=/([+-]|\d\d)/g;return function(b,y,x){var h=y.prototype;x.utc=function(i){var C={date:i,utc:!0,args:arguments};return new y(C)},h.utc=function(i){var C=x(this.toDate(),{locale:this.$L,utc:!0});return i?C.add(this.utcOffset(),p):C},h.local=function(){return x(this.toDate(),{locale:this.$L,utc:!1})};var z=h.parse;h.parse=function(i){i.utc&&(this.$u=!0),this.$utils().u(i.$offset)||(this.$offset=i.$offset),z.call(this,i)};var L=h.init;h.init=function(){if(this.$u){var i=this.$d;this.$y=i.getUTCFullYear(),this.$M=i.getUTCMonth(),this.$D=i.getUTCDate(),this.$W=i.getUTCDay(),this.$H=i.getUTCHours(),this.$m=i.getUTCMinutes(),this.$s=i.getUTCSeconds(),this.$ms=i.getUTCMilliseconds()}else L.call(this)};var j=h.utcOffset;h.utcOffset=function(i,C){var U=this.$utils().u;if(U(i))return this.$u?0:U(this.$offset)?j.call(this):this.$offset;if(typeof i=="string"&&(i=function(k){k===void 0&&(k="");var $=k.match(f);if(!$)return null;var l=(""+$[0]).match(V)||["-",0,0],r=l[0],Y=60*+l[1]+ +l[2];return Y===0?0:r==="+"?Y:-Y}(i),i===null))return this;var J=Math.abs(i)<=16?60*i:i,n=this;if(C)return n.$offset=J,n.$u=i===0,n;if(i!==0){var D=this.$u?this.toDate().getTimezoneOffset():-1*this.utcOffset();(n=this.local().add(J+D,p)).$offset=J,n.$x.$localOffset=D}else n=this.utc();return n};var T=h.format;h.format=function(i){var C=i||(this.$u?"YYYY-MM-DDTHH:mm:ss[Z]":"");return T.call(this,C)},h.valueOf=function(){var i=this.$utils().u(this.$offset)?0:this.$offset+(this.$x.$localOffset||this.$d.getTimezoneOffset());return this.$d.valueOf()-6e4*i},h.isUTC=function(){return!!this.$u},h.toISOString=function(){return this.toDate().toISOString()},h.toString=function(){return this.toDate().toUTCString()};var w=h.toDate;h.toDate=function(i){return i==="s"&&this.$offset?x(this.format("YYYY-MM-DD HH:mm:ss:SSS")).toDate():w.call(this)};var O=h.diff;h.diff=function(i,C,U){if(i&&this.$u===i.$u)return O.call(this,i,C,U);var J=this.local(),n=x(i).local();return O.call(J,n,C,U)}}})})(_e);var Je=_e.exports;const Pe=re(Je);var ge={exports:{}};(function(t,e){(function(p,f){t.exports=f()})(te,function(){var p={year:0,month:1,day:2,hour:3,minute:4,second:5},f={};return function(V,b,y){var x,h=function(T,w,O){O===void 0&&(O={});var i=new Date(T),C=function(U,J){J===void 0&&(J={});var n=J.timeZoneName||"short",D=U+"|"+n,k=f[D];return k||(k=new Intl.DateTimeFormat("en-US",{hour12:!1,timeZone:U,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",timeZoneName:n}),f[D]=k),k}(w,O);return C.formatToParts(i)},z=function(T,w){for(var O=h(T,w),i=[],C=0;C<O.length;C+=1){var U=O[C],J=U.type,n=U.value,D=p[J];D>=0&&(i[D]=parseInt(n,10))}var k=i[3],$=k===24?0:k,l=i[0]+"-"+i[1]+"-"+i[2]+" "+$+":"+i[4]+":"+i[5]+":000",r=+T;return(y.utc(l).valueOf()-(r-=r%1e3))/6e4},L=b.prototype;L.tz=function(T,w){T===void 0&&(T=x);var O=this.utcOffset(),i=this.toDate(),C=i.toLocaleString("en-US",{timeZone:T}),U=Math.round((i-new Date(C))/1e3/60),J=y(C,{locale:this.$L}).$set("millisecond",this.$ms).utcOffset(15*-Math.round(i.getTimezoneOffset()/15)-U,!0);if(w){var n=J.utcOffset();J=J.add(O-n,"minute")}return J.$x.$timezone=T,J},L.offsetName=function(T){var w=this.$x.$timezone||y.tz.guess(),O=h(this.valueOf(),w,{timeZoneName:T}).find(function(i){return i.type.toLowerCase()==="timezonename"});return O&&O.value};var j=L.startOf;L.startOf=function(T,w){if(!this.$x||!this.$x.$timezone)return j.call(this,T,w);var O=y(this.format("YYYY-MM-DD HH:mm:ss:SSS"),{locale:this.$L});return j.call(O,T,w).tz(this.$x.$timezone,!0)},y.tz=function(T,w,O){var i=O&&w,C=O||w||x,U=z(+y(),C);if(typeof T!="string")return y(T).tz(C);var J=function($,l,r){var Y=$-60*l*1e3,_=z(Y,r);if(l===_)return[Y,l];var m=z(Y-=60*(_-l)*1e3,r);return _===m?[Y,_]:[$-60*Math.min(_,m)*1e3,Math.max(_,m)]}(y.utc(T,i).valueOf(),U,C),n=J[0],D=J[1],k=y(n).utcOffset(D);return k.$x.$timezone=C,k},y.tz.guess=function(){return Intl.DateTimeFormat().resolvedOptions().timeZone},y.tz.setDefault=function(T){x=T}}})})(ge);var Ne=ge.exports;const Le=re(Ne);var Se={exports:{}};(function(t,e){(function(p,f){t.exports=f()})(te,function(){return function(p,f){var V=f.prototype,b=V.format;V.format=function(y){var x=this,h=this.$locale();if(!this.isValid())return b.bind(this)(y);var z=this.$utils(),L=(y||"YYYY-MM-DDTHH:mm:ssZ").replace(/\[([^\]]+)]|Q|wo|ww|w|WW|W|zzz|z|gggg|GGGG|Do|X|x|k{1,2}|S/g,function(j){switch(j){case"Q":return Math.ceil((x.$M+1)/3);case"Do":return h.ordinal(x.$D);case"gggg":return x.weekYear();case"GGGG":return x.isoWeekYear();case"wo":return h.ordinal(x.week(),"W");case"w":case"ww":return z.s(x.week(),j==="w"?1:2,"0");case"W":case"WW":return z.s(x.isoWeek(),j==="W"?1:2,"0");case"k":case"kk":return z.s(String(x.$H===0?24:x.$H),j==="k"?1:2,"0");case"X":return Math.floor(x.$d.getTime()/1e3);case"x":return x.$d.getTime();case"z":return"["+x.offsetName()+"]";case"zzz":return"["+x.offsetName("long")+"]";default:return j}});return b.bind(this)(L)}}})})(Se);var Ae=Se.exports;const We=re(Ae);var Me={exports:{}};(function(t,e){(function(p,f){t.exports=f()})(te,function(){var p,f,V=1e3,b=6e4,y=36e5,x=864e5,h=/\[([^\]]+)]|Y{1,4}|M{1,4}|D{1,2}|d{1,4}|H{1,2}|h{1,2}|a|A|m{1,2}|s{1,2}|Z{1,2}|SSS/g,z=31536e6,L=2628e6,j=/^(-|\+)?P(?:([-+]?[0-9,.]*)Y)?(?:([-+]?[0-9,.]*)M)?(?:([-+]?[0-9,.]*)W)?(?:([-+]?[0-9,.]*)D)?(?:T(?:([-+]?[0-9,.]*)H)?(?:([-+]?[0-9,.]*)M)?(?:([-+]?[0-9,.]*)S)?)?$/,T={years:z,months:L,days:x,hours:y,minutes:b,seconds:V,milliseconds:1,weeks:6048e5},w=function($){return $ instanceof D},O=function($,l,r){return new D($,r,l.$l)},i=function($){return f.p($)+"s"},C=function($){return $<0},U=function($){return C($)?Math.ceil($):Math.floor($)},J=function($){return Math.abs($)},n=function($,l){return $?C($)?{negative:!0,format:""+J($)+l}:{negative:!1,format:""+$+l}:{negative:!1,format:""}},D=function(){function $(r,Y,_){var m=this;if(this.$d={},this.$l=_,r===void 0&&(this.$ms=0,this.parseFromMilliseconds()),Y)return O(r*T[i(Y)],this);if(typeof r=="number")return this.$ms=r,this.parseFromMilliseconds(),this;if(typeof r=="object")return Object.keys(r).forEach(function(c){m.$d[i(c)]=r[c]}),this.calMilliseconds(),this;if(typeof r=="string"){var A=r.match(j);if(A){var W=A.slice(2).map(function(c){return c!=null?Number(c):0});return this.$d.years=W[0],this.$d.months=W[1],this.$d.weeks=W[2],this.$d.days=W[3],this.$d.hours=W[4],this.$d.minutes=W[5],this.$d.seconds=W[6],this.calMilliseconds(),this}}return this}var l=$.prototype;return l.calMilliseconds=function(){var r=this;this.$ms=Object.keys(this.$d).reduce(function(Y,_){return Y+(r.$d[_]||0)*T[_]},0)},l.parseFromMilliseconds=function(){var r=this.$ms;this.$d.years=U(r/z),r%=z,this.$d.months=U(r/L),r%=L,this.$d.days=U(r/x),r%=x,this.$d.hours=U(r/y),r%=y,this.$d.minutes=U(r/b),r%=b,this.$d.seconds=U(r/V),r%=V,this.$d.milliseconds=r},l.toISOString=function(){var r=n(this.$d.years,"Y"),Y=n(this.$d.months,"M"),_=+this.$d.days||0;this.$d.weeks&&(_+=7*this.$d.weeks);var m=n(_,"D"),A=n(this.$d.hours,"H"),W=n(this.$d.minutes,"M"),c=this.$d.seconds||0;this.$d.milliseconds&&(c+=this.$d.milliseconds/1e3,c=Math.round(1e3*c)/1e3);var u=n(c,"S"),a=r.negative||Y.negative||m.negative||A.negative||W.negative||u.negative,d=A.format||W.format||u.format?"T":"",s=(a?"-":"")+"P"+r.format+Y.format+m.format+d+A.format+W.format+u.format;return s==="P"||s==="-P"?"P0D":s},l.toJSON=function(){return this.toISOString()},l.format=function(r){var Y=r||"YYYY-MM-DDTHH:mm:ss",_={Y:this.$d.years,YY:f.s(this.$d.years,2,"0"),YYYY:f.s(this.$d.years,4,"0"),M:this.$d.months,MM:f.s(this.$d.months,2,"0"),D:this.$d.days,DD:f.s(this.$d.days,2,"0"),H:this.$d.hours,HH:f.s(this.$d.hours,2,"0"),m:this.$d.minutes,mm:f.s(this.$d.minutes,2,"0"),s:this.$d.seconds,ss:f.s(this.$d.seconds,2,"0"),SSS:f.s(this.$d.milliseconds,3,"0")};return Y.replace(h,function(m,A){return A||String(_[m])})},l.as=function(r){return this.$ms/T[i(r)]},l.get=function(r){var Y=this.$ms,_=i(r);return _==="milliseconds"?Y%=1e3:Y=_==="weeks"?U(Y/T[_]):this.$d[_],Y||0},l.add=function(r,Y,_){var m;return m=Y?r*T[i(Y)]:w(r)?r.$ms:O(r,this).$ms,O(this.$ms+m*(_?-1:1),this)},l.subtract=function(r,Y){return this.add(r,Y,!0)},l.locale=function(r){var Y=this.clone();return Y.$l=r,Y},l.clone=function(){return O(this.$ms,this)},l.humanize=function(r){return p().add(this.$ms,"ms").locale(this.$l).fromNow(!r)},l.valueOf=function(){return this.asMilliseconds()},l.milliseconds=function(){return this.get("milliseconds")},l.asMilliseconds=function(){return this.as("milliseconds")},l.seconds=function(){return this.get("seconds")},l.asSeconds=function(){return this.as("seconds")},l.minutes=function(){return this.get("minutes")},l.asMinutes=function(){return this.as("minutes")},l.hours=function(){return this.get("hours")},l.asHours=function(){return this.as("hours")},l.days=function(){return this.get("days")},l.asDays=function(){return this.as("days")},l.weeks=function(){return this.get("weeks")},l.asWeeks=function(){return this.as("weeks")},l.months=function(){return this.get("months")},l.asMonths=function(){return this.as("months")},l.years=function(){return this.get("years")},l.asYears=function(){return this.as("years")},$}(),k=function($,l,r){return $.add(l.years()*r,"y").add(l.months()*r,"M").add(l.days()*r,"d").add(l.hours()*r,"h").add(l.minutes()*r,"m").add(l.seconds()*r,"s").add(l.milliseconds()*r,"ms")};return function($,l,r){p=r,f=r().$utils(),r.duration=function(m,A){var W=r.locale();return O(m,{$l:W},A)},r.isDuration=w;var Y=l.prototype.add,_=l.prototype.subtract;l.prototype.add=function(m,A){return w(m)?k(this,m,1):Y.bind(this)(m,A)},l.prototype.subtract=function(m,A){return w(m)?k(this,m,-1):_.bind(this)(m,A)}}})})(Me);var Fe=Me.exports;const Ie=re(Fe);var Ye={exports:{}};(function(t,e){(function(p,f){t.exports=f()})(te,function(){return function(p,f,V){f.prototype.dayOfYear=function(b){var y=Math.round((V(this).startOf("day")-V(this).startOf("year"))/864e5)+1;return b==null?y:this.add(b-y,"day")}}})})(Ye);var Ze=Ye.exports;const Ee=re(Ze);var Be={exports:{}};(function(t,e){(function(p,f){t.exports=f(ye)})(te,function(p){function f(y){return y&&typeof y=="object"&&"default"in y?y:{default:y}}var V=f(p),b={name:"ja",weekdays:"日曜日_月曜日_火曜日_水曜日_木曜日_金曜日_土曜日".split("_"),weekdaysShort:"日_月_火_水_木_金_土".split("_"),weekdaysMin:"日_月_火_水_木_金_土".split("_"),months:"1月_2月_3月_4月_5月_6月_7月_8月_9月_10月_11月_12月".split("_"),monthsShort:"1月_2月_3月_4月_5月_6月_7月_8月_9月_10月_11月_12月".split("_"),ordinal:function(y){return y+"日"},formats:{LT:"HH:mm",LTS:"HH:mm:ss",L:"YYYY/MM/DD",LL:"YYYY年M月D日",LLL:"YYYY年M月D日 HH:mm",LLLL:"YYYY年M月D日 dddd HH:mm",l:"YYYY/MM/DD",ll:"YYYY年M月D日",lll:"YYYY年M月D日 HH:mm",llll:"YYYY年M月D日(ddd) HH:mm"},meridiem:function(y){return y<12?"午前":"午後"},relativeTime:{future:"%s後",past:"%s前",s:"数秒",m:"1分",mm:"%d分",h:"1時間",hh:"%d時間",d:"1日",dd:"%d日",M:"1ヶ月",MM:"%dヶ月",y:"1年",yy:"%d年"}};return V.default.locale(b,null,!0),b})})(Be);q.extend(Pe);q.extend(Le);q.extend(We);q.extend(Ie);q.extend(Ee);const Ge=[{title:"予定なし",value:0},{title:"7日以内に実施",value:1},{title:"3～6日以内に実施",value:2},{title:"2日以内に実施",value:3},{title:"24時間以内に実施",value:4},{title:"12時間以内に実施",value:5},{title:"2時間以内に実施",value:6}],qe=[{title:"予定なし",value:0},{title:"7日間以上または期限未定",value:1},{title:"2～6日間",value:2},{title:"2日間以内",value:3}],Qe=[{title:"毎時15分および45分",value:"default"},{title:"強制",value:"force"},{title:"なし",value:"disable"}],Re={P:"ポジションマーカー",0:"ビット 0",1:"ビット 1",S:"JJY コールサイン"},Xe={P:"高出力 0.2秒、低出力 0.8秒",0:"高出力 0.8秒、低出力 0.2秒",1:"高出力 0.5秒、低出力 0.5秒",S:"・－－－ ・－－－ －・－－（モールスで2回以内）"},g=t=>(t??!1)==0?"0":"1";function me(t){let e=!1;for(;t!==0;)t&1&&(e=!e),t>>=1;return e}function Ke(t,e){const p=q(t).startOf("minute"),f=[];t.subtract;for(let V=0;V<60;V++)f[V]=et(p.add(V,"seconds"),e);return f}function De(t,e){return((e==null?void 0:e.callSign)==="force"||t.minute()===15||t.minute()===45)&&(e==null?void 0:e.callSign)!=="disable"}function et(t,e){const p=De(t,e);switch(t.second()){case 0:return"P";case 1:return g(t.minute()/10&4);case 2:return g(t.minute()/10&2);case 3:return g(t.minute()/10&1);case 4:return"0";case 5:return g(t.minute()%10&8);case 6:return g(t.minute()%10&4);case 7:return g(t.minute()%10&2);case 8:return g(t.minute()%10&1);case 9:return"P";case 10:case 11:return"0";case 12:return g(t.hour()/10&2);case 13:return g(t.hour()/10&1);case 14:return"0";case 15:return g(t.hour()%10&8);case 16:return g(t.hour()%10&4);case 17:return g(t.hour()%10&2);case 18:return g(t.hour()%10&1);case 19:return"P";case 20:case 21:return"0";case 22:return g(t.dayOfYear()/100&2);case 23:return g(t.dayOfYear()/100&1);case 24:return"0";case 25:return g(t.dayOfYear()/10%10&8);case 26:return g(t.dayOfYear()/10%10&4);case 27:return g(t.dayOfYear()/10%10&2);case 28:return g(t.dayOfYear()/10%10&1);case 29:return"P";case 30:return g(t.dayOfYear()%10&8);case 31:return g(t.dayOfYear()%10&4);case 32:return g(t.dayOfYear()%10&2);case 33:return g(t.dayOfYear()%10&1);case 34:return"0";case 35:return"0";case 36:return g(me(t.hour()/10<<4|t.hour()%10));case 37:return g(me(t.minute()/10<<4|t.minute()%10));case 38:return g(e==null?void 0:e.summerTimeNotice);case 39:return"P";case 40:return p?"S":g(e==null?void 0:e.summerTime);case 41:return p?"S":g(t.year()%100/10&8);case 42:return p?"S":g(t.year()%100/10&4);case 43:return p?"S":g(t.year()%100/10&2);case 44:return p?"S":g(t.year()%100/10&1);case 45:return p?"S":g(t.year()%10&8);case 46:return p?"S":g(t.year()%10&4);case 47:return p?"S":g(t.year()%10&2);case 48:return p?"S":g(t.year()%10&1);case 49:return"P";case 50:return g(p?((e==null?void 0:e.stopAfter)??0)&4:t.day()&4);case 51:return g(p?((e==null?void 0:e.stopAfter)??0)&2:t.day()&2);case 52:return g(p?((e==null?void 0:e.stopAfter)??0)&1:t.day()&1);case 53:return p&&(e==null?void 0:e.stopAfter)!==0?g(e==null?void 0:e.stopType):g(e==null?void 0:e.leapSecondNotice);case 54:return p&&(e==null?void 0:e.stopAfter)!==0?g(((e==null?void 0:e.stopDuration)??0)&2):g((e==null?void 0:e.leapSecondNotice)&&(e==null?void 0:e.leapSecondType));case 55:return p&&(e==null?void 0:e.stopAfter)!==0?g(((e==null?void 0:e.stopDuration)??0)&1):"0";case 56:case 57:case 58:return"0";case 59:return"P";default:return console.info("invalid time",t),"0"}}function tt(t,e){switch(t){case 0:return"M: 開始を表すポジションマーカー（固定）";case 1:return"分の重み（40）";case 2:return"分の重み（20）";case 3:return"分の重み（10）";case 4:return"未使用（常にビット 0）";case 5:return"分の重み（8）";case 6:return"分の重み（4）";case 7:return"分の重み（2）";case 8:return"分の重み（1）";case 9:return"P1: ポジションマーカー（固定）";case 10:case 11:return"未使用（常にビット 0）";case 12:return"時の重み（20）";case 13:return"時の重み（10）";case 14:return"未使用（常にビット 0）";case 15:return"時の重み（8）";case 16:return"時の重み（4）";case 17:return"時の重み（2）";case 18:return"時の重み（1）";case 19:return"P2: ポジションマーカー（固定）";case 20:case 21:return"未使用（常にビット 0）";case 22:return"年の通算日の重み（200）";case 23:return"年の通算日の重み（100）";case 24:return"未使用（常にビット 0）";case 25:return"年の通算日の重み（80）";case 26:return"年の通算日の重み（40）";case 27:return"年の通算日の重み（20）";case 28:return"年の通算日の重み（10）";case 29:return"P3: ポジションマーカー（固定）";case 30:return"年の通算日の重み（8）";case 31:return"年の通算日の重み（4）";case 32:return"年の通算日の重み（2）";case 33:return"年の通算日の重み（1）";case 34:case 35:return"未使用（常にビット 0）";case 36:return"PA1: 「時」部のビットの偶数パリティ";case 37:return"PA2: 「分」部のビットの偶数パリティ";case 38:return"SU1: 6日以内に夏時間開始または終了のときビット 1";case 39:return"P4: ポジションマーカー（固定）";case 40:return e?"「JJY」を表すコールサイン":"SU2: 夏時間実施中のときビット 1";case 41:return e?"「JJY」を表すコールサイン":"年の重み（80）";case 42:return e?"「JJY」を表すコールサイン":"年の重み（40）";case 43:return e?"「JJY」を表すコールサイン":"年の重み（20）";case 44:return e?"「JJY」を表すコールサイン":"年の重み（10）";case 45:return e?"「JJY」を表すコールサイン":"年の重み（8）";case 46:return e?"「JJY」を表すコールサイン":"年の重み（4）";case 47:return e?"「JJY」を表すコールサイン":"年の重み（2）";case 48:return e?"「JJY」を表すコールサイン":"年の重み（1）";case 49:return"P5: ポジションマーカー（固定）";case 50:return e?"ST1: 停波が開始するまでの時間の上位1ビット目":"日曜日を起点とした曜日の上位1ビット目";case 51:return e?"ST2: 停波が開始するまでの時間の上位2ビット目":"日曜日を起点とした曜日の上位2ビット目";case 52:return e?"ST3: 停波が開始するまでの時間の上位3ビット目":"日曜日を起点とした曜日の上位3ビット目";case 53:return e?"ST4: 停波が昼間のみのときビット 1":"LS1: 月末に閏秒が実施されるときビット 1";case 54:return e?"ST5: 停波の期間の上位1ビット目":"LS2: 実施される閏秒の種別が挿入のときビット 1、削除のときビット 0";case 55:return e?"ST6: 停波の期間の上位2ビット目":"未使用（常にビット 0）";case 56:case 57:case 58:return"未使用（常にビット 0）";case 59:return"P0: ポジションマーカー（固定）";default:return console.info("invalid time",t),""}}const nt={class:"animated-clock"},rt={class:"date"},at={class:"time"},st=oe({__name:"AnimatedClock",props:{time:null},setup(t){return(e,p)=>(ue(),ce("div",nt,[N("span",rt,R(t.time.format("YYYY-MM-DD")),1),N("span",at,[N("span",null,R(t.time.format("HH")),1),N("span",{style:de(`visibility:${t.time.millisecond()<666?"visible":"hidden"}`)},":",4),N("span",null,R(t.time.format("mm")),1),N("span",{style:de(`visibility:${t.time.millisecond()<666?"visible":"hidden"}`)},":",4),N("span",null,R(t.time.format("ss")),1)])]))}}),ut={class:"title"},it=oe({__name:"TimeBars",props:Oe({timeCodes:null,time:null,jjyOptions:null,length:null,offset:null},{offset:0}),setup(t){return(e,p)=>{const f=F("v-tooltip"),V=F("v-sheet");return ue(!0),ce(ve,null,he(e.timeCodes.slice(e.offset,e.length+e.offset),(b,y)=>(ue(),$e(V,{key:y,class:fe(["timebar d-inline-flex justify-center align-center",{now:e.time.second()===e.offset+y,"marker-position":b==="P","marker-zero":b==="0","marker-one":b==="1","marker-sign":b==="S"}])},{default:H(()=>[v(f,{activator:"parent",location:"bottom","open-delay":"100",class:"timebar-tooltip"},{default:H(()=>[N("div",ut,[N("div",{class:fe(["legend",{"marker-position":b==="P","marker-zero":b==="0","marker-one":b==="1","marker-sign":b==="S"}])},null,2),N("span",null,R(e.offset+y)+": "+R(ee(Re)[b]),1)]),N("div",null,R(ee(tt)(e.offset+y,ee(De)(e.time,e.jjyOptions))),1),N("div",null,R(ee(Xe)[b]),1)]),_:2},1024)]),_:2},1032,["class"]))),128)}}}),lt=N("p",null," お使いのデバイスにスピーカーまたはイヤホンを接続して「音の再生」と「時刻合わせモード」を有効にしてください。スピーカーまたはイヤホンの配線部分に電波時計を近づけると受信が始まります。 ",-1),ot=N("p",null," サウンドデバイスによってはローパスフィルターによって 40kHz の信号が生成できず時刻合わせができない場合があります。時刻合わせによって生じた問題について責任は負いかねます。ご了承ください。 ",-1),ct=N("div",{class:"text-caption"},"ボリューム",-1),dt=N("div",{class:"text-caption"},"音の周波数（Hz）",-1),ft=N("div",{class:"text-caption"},"ボリューム",-1),mt=N("h4",null,"参考文献",-1),ht=N("ul",null,[N("li",null,[N("a",{href:"https://jjy.nict.go.jp/jjy/trans/index.html",target:"_blank"},"標準電波の出し方"),le(" - 情報通信研究機構 日本標準時グループ ")]),N("li",null,[N("a",{href:"https://ja.wikipedia.org/wiki/JJY",target:"_blank"},"JJY"),le(" - Wikipedia")]),N("li",null,[N("a",{href:"https://shogo82148.github.io/web-jjy/",target:"_blank"},"JJYシミュレータWeb版")])],-1),vt=oe({__name:"SimulatorApp",setup(t){const e=G(q()),p=G(q().startOf("second")),f=G(q().startOf("minute")),V=G(),b=G(!0),y=G(0),x=ke(()=>Ke(f.value,h.value)),h=G({callSign:"default",leapSecondType:!0,stopAfter:0,stopDuration:3}),z=G(),L=G(),j=G(440),T=G(.5);let w=null,O=!1;Ue(async()=>(V.value||(e.value=q().subtract(y.value,"milliseconds")),p.value.unix()!=e.value.unix()&&(p.value=e.value.startOf("second"),e.value.diff(f.value,"seconds")>=60&&(f.value=e.value.startOf("minute"))),.05)),xe(()=>p.value,()=>{if(!z.value)return;let J=Ce();function n($,l){const r=L.value?13333.333:Number.isFinite(Number(j.value))?Math.min(Math.max(Number(j.value),20),24e3):440;w!=null&&(w.oscillator.type=L.value?"square":"sine",w.triggerAttackRelease(r,$,J,T.value*(l?1:.1))),J+=$}function D(){n(.25,!0),n(.1,!1)}function k(){n(.1,!0),n(.1,!1)}switch(x.value[p.value.second()]){case"P":{O=!1,n(.2,!0),n(.8+1,!1);break}case"0":{O=!1,n(.8,!0),n(.2+1,!1);break}case"1":{O=!1,n(.5,!0),n(.5+1,!1);break}case"S":{if(!O){O=!0;for(let $=0;$<2;$++)n(.3,!1),k(),D(),D(),D(),n(.05,!1),k(),D(),D(),D(),n(.05,!1),D(),k(),D(),D(),n(.05,!1);n(.6+.1,!1)}break}}});function i(){b.value||(y.value=0,V.value=!1)}function C(){V.value?y.value=q().diff(e.value,"milliseconds"):b.value=!1}async function U(){!z.value&&w==null?(await je(),w=new ze({envelope:{attack:.05,decay:.05,sustain:.8,release:.05}}).toDestination()):w==null||w.triggerRelease()}return(J,n)=>{const D=F("v-col"),k=F("v-checkbox"),$=F("v-row"),l=F("v-select"),r=F("v-radio"),Y=F("v-radio-group"),_=F("v-divider"),m=F("v-btn"),A=F("v-card-text"),W=F("v-slider"),c=F("v-container"),u=F("v-spacer"),a=F("v-card-actions"),d=F("v-card"),s=F("v-dialog"),S=F("v-text-field"),M=F("v-footer");return ue(),$e(Ve,{"page-id":"jjy/simulator","toolbar-title":"JJY シミュレータ"},{footer:H(()=>[v(_),v(M,null,{default:H(()=>[v(c,null,{default:H(()=>[mt,ht]),_:1})]),_:1})]),default:H(()=>[v($,{"no-gutters":"",align:"center",justify:"center"},{default:H(()=>[v(D,{cols:"5",sm:"7"},{default:H(()=>[v(st,{time:e.value,style:{"font-size":"125%"}},null,8,["time"])]),_:1}),v(D,{cols:"3",sm:"2"},{default:H(()=>[v(k,{modelValue:V.value,"onUpdate:modelValue":n[0]||(n[0]=o=>V.value=o),label:"停止",color:"red","hide-details":"",onClick:C},null,8,["modelValue"])]),_:1}),v(D,{cols:"4",sm:"3"},{default:H(()=>[v(k,{modelValue:b.value,"onUpdate:modelValue":n[1]||(n[1]=o=>b.value=o),label:"現在の時刻","hide-details":"",onClick:i,readonly:b.value},null,8,["modelValue","readonly"])]),_:1})]),_:1}),v($,{"no-gutters":""},{default:H(()=>[(ue(),ce(ve,null,he(2,o=>v(D,{cols:"12",key:o,class:"d-flex justify-center"},{default:H(()=>[v(it,{"time-codes":x.value,time:p.value,jjyOptions:h.value,length:30,offset:(o-1)*30},null,8,["time-codes","time","jjyOptions","offset"])]),_:2},1024)),64))]),_:1}),v($,null,{default:H(()=>[v(D,{cols:"6",sm:"4",lg:"3"},{default:H(()=>[v(l,{label:"コールサイン",density:"compact",variant:"underlined",modelValue:h.value.callSign,"onUpdate:modelValue":n[2]||(n[2]=o=>h.value.callSign=o),items:ee(Qe)},null,8,["modelValue","items"])]),_:1}),v(D,{cols:"6",sm:"4",lg:"3"},{default:H(()=>[v(k,{modelValue:h.value.summerTime,"onUpdate:modelValue":n[3]||(n[3]=o=>h.value.summerTime=o),label:"夏時間実施中","hide-details":"",density:"compact"},null,8,["modelValue"]),v(k,{modelValue:h.value.summerTimeNotice,"onUpdate:modelValue":n[4]||(n[4]=o=>h.value.summerTimeNotice=o),label:"6日以内に夏時間を開始または終了","hide-details":"",density:"compact"},null,8,["modelValue"])]),_:1}),v(D,{cols:"6",sm:"4",lg:"3"},{default:H(()=>[v(k,{modelValue:h.value.leapSecondNotice,"onUpdate:modelValue":n[5]||(n[5]=o=>h.value.leapSecondNotice=o),label:"月末に閏秒を実施","hide-details":"",density:"compact"},null,8,["modelValue"]),v(Y,{modelValue:h.value.leapSecondType,"onUpdate:modelValue":n[6]||(n[6]=o=>h.value.leapSecondType=o),disabled:!(h.value.leapSecondNotice??!1),direction:"horizontal",density:"compact"},{default:H(()=>[v(r,{label:"挿入",value:!0}),v(r,{label:"削除",value:!1})]),_:1},8,["modelValue","disabled"])]),_:1}),v(D,{cols:"6",sm:"4",lg:"3"},{default:H(()=>[v(l,{label:"停波",density:"compact",variant:"underlined",modelValue:h.value.stopAfter,"onUpdate:modelValue":n[7]||(n[7]=o=>h.value.stopAfter=o),items:ee(Ge)},null,8,["modelValue","items"]),v(l,{label:"停波期間",density:"compact",variant:"underlined",modelValue:h.value.stopDuration,"onUpdate:modelValue":n[8]||(n[8]=o=>h.value.stopDuration=o),items:ee(qe).slice(1)},null,8,["modelValue","items"]),v(k,{modelValue:h.value.stopType,"onUpdate:modelValue":n[9]||(n[9]=o=>h.value.stopType=o),label:"停波は昼間のみ","hide-details":"",density:"compact"},null,8,["modelValue"])]),_:1}),v(_)]),_:1}),v($,null,{default:H(()=>[v(D,{cols:"6",sm:"4",lg:"3"},{default:H(()=>[v(k,{modelValue:z.value,"onUpdate:modelValue":n[10]||(n[10]=o=>z.value=o),label:"音の再生","hide-details":"",onClick:U,density:"compact"},null,8,["modelValue"]),v(k,{modelValue:L.value,"onUpdate:modelValue":n[11]||(n[11]=o=>L.value=o),label:"時刻合わせモード","hide-details":"",density:"compact"},null,8,["modelValue"]),v(s,{"max-width":"640"},{activator:H(({props:o})=>[v(m,Te(o,{"prepend-icon":"mdi-help",variant:"outlined"}),{default:H(()=>[le("時刻合わせのやりかた")]),_:2},1040)]),default:H(({isActive:o})=>[v(d,{title:"時刻合わせのやりかた"},{default:H(()=>[v(A,null,{default:H(()=>[lt,ot]),_:1}),v(c,{class:"py-0"},{default:H(()=>[v($,{"no-gutters":""},{default:H(()=>[v(D,{cols:"6"},{default:H(()=>[v(k,{modelValue:z.value,"onUpdate:modelValue":n[12]||(n[12]=P=>z.value=P),label:"音の再生","hide-details":"",onClick:U,density:"compact"},null,8,["modelValue"])]),_:1}),v(D,{cols:"6"},{default:H(()=>[v(k,{modelValue:L.value,"onUpdate:modelValue":n[13]||(n[13]=P=>L.value=P),label:"時刻合わせモード","hide-details":"",density:"compact"},null,8,["modelValue"])]),_:1}),v(D,{cols:"12"},{default:H(()=>[ct,v(W,{modelValue:T.value,"onUpdate:modelValue":n[14]||(n[14]=P=>T.value=P),min:"0",max:"1","thumb-label":""},null,8,["modelValue"])]),_:1})]),_:1})]),_:1}),v(a,null,{default:H(()=>[v(u),v(m,{text:"閉じる",onClick:P=>o.value=!1},null,8,["onClick"])]),_:2},1024)]),_:2},1024)]),_:1})]),_:1}),v(D,{cols:"6",sm:"4",lg:"3"},{default:H(()=>[N("div",null,[dt,v(W,{modelValue:j.value,"onUpdate:modelValue":n[16]||(n[16]=o=>j.value=o),min:"20",max:"24000",step:"1","thumb-label":"",disabled:L.value},{append:H(()=>[v(S,{modelValue:j.value,"onUpdate:modelValue":n[15]||(n[15]=o=>j.value=o),density:"compact",variant:"underlined",style:{width:"100px"},type:"number",prefix:"Hz",class:"text-align-right",inputmode:"numeric",reverse:"","hide-details":"","single-line":""},null,8,["modelValue"])]),_:1},8,["modelValue","disabled"])]),N("div",null,[ft,v(W,{modelValue:T.value,"onUpdate:modelValue":n[17]||(n[17]=o=>T.value=o),min:"0",max:"1","thumb-label":""},null,8,["modelValue"])])]),_:1})]),_:1})]),_:1})}}});He("#app",vt);
