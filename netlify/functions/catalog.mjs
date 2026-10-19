// Grand Line Portfolio v0.5 — read-only Japanese official card catalog.
// No fabricated prices or names. Source: https://onepiece-cardgame.com/cardlist/
const ROOT = 'https://onepiece-cardgame.com';
const ID = /^(?:(?:OP|EB|ST)\d{2}-\d{3}|P-\d{3})$/i;
const TOKEN_ID = /^(?:(?:OP|EB|ST)\d{2}-\d{3}|P-\d{3})$/i;
const TYPE = /^(LEADER|CHARACTER|EVENT|STAGE)(?:\s+(.+))?$/i;
const RARITY = /^(L|C|UC|R|SR|SEC|SP|P|TR|SPカード)$/i;
const SEP = /^[|｜¦│！!×•·\s]+$/u;
const json = (body, status=200) => Response.json(body,{status,headers:{'Cache-Control':'public, max-age=900','X-Content-Type-Options':'nosniff'}});
function decode(s){return String(s||'').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&apos;|&#39;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,s)=>{const n=s[0]==='x'?parseInt(s.slice(1),16):Number(s);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';});}
function flatten(html){return decode(html.replace(/<!--[^]*?-->/g,'').replace(/<(script|style|noscript|svg)\b[^>]*>[^]*?<\/\1>/gi,'').replace(/<[^>]*>/g,'\n')).split(/\n/).flatMap(s=>s.split(/([|｜])/)).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);}
function cardName(s,id){return s&&s.length>1&&s.length<140&&s!==id&&!SEP.test(s)&&!RARITY.test(s)&&!TYPE.test(s)&&!/検索|フリーワード|条件クリア|CARD VIEW|TEXT VIEW|件\s*HIT/.test(s);}
function artwork(html){
  const result = new Map();
  const rx = /(?:https?:\/\/(?:www\.)?onepiece-cardgame\.com)?\/?images\/cardlist\/card\/((?:(?:OP|EB|ST)\d{2}-\d{3}|P-\d{3})(?:_[a-z0-9]+)*\.(?:png|jpe?g|webp))(?:\?(\d{4,12})=?)?/gi;
  for(const m of html.matchAll(rx)){
    const filename=m[1],id=filename.match(/^(?:(?:OP|EB|ST)\d{2}-\d{3}|P-\d{3})/i)?.[0].toUpperCase();
    if(!id||!ID.test(id))continue;
    let arr=result.get(id);if(!arr){arr=[];result.set(id,arr);}
    if(arr.some(x=>x.filename.toLowerCase()===filename.toLowerCase()))continue;
    const version=m[2]||'';
    const officialImageUrl=ROOT+'/images/cardlist/card/'+filename+(version?'?'+version+'=':'');
    const url='/.netlify/functions/card-lookup?id='+encodeURIComponent(id)+'&image='+encodeURIComponent(filename)+(version?'&v='+version:'');
    const p=filename.match(/_p(\d+)/i);
    const label=p?'异画 / 平行版 p'+p[1]:filename.toLowerCase()===id.toLowerCase()+'.png'?'标准版':'其他官方印刷版本（需核对）';
    arr.push({filename,url,imageUrl:url,officialImageUrl,label,variantKey:filename.toLowerCase()});
  }
  return result;
}
const FIELD_TITLES = new Map([['コスト','cost'],['パワー','power'],['色','color'],['特徴','trait'],['ライフ','life'],['カウンター','counter']]);
function inspectFields(tokens,begin){
  const result={};
  for(let i=begin;i<Math.min(begin+65,tokens.length-1);i++){
    const t=tokens[i].replace(/[：:]$/,'');
    if(TOKEN_ID.test(t))break;
    const key=FIELD_TITLES.get(t);
    if(key && !result[key]){
      const next=tokens[i+1];
      if(next && next!=='-' && next.length<=80 && !FIELD_TITLES.has(next))result[key]=next;
    }
  }
  return result;
}
export function parseCatalog(html){
  const tokens=flatten(html), images=artwork(html), byId=new Map();
  const hitText=tokens.find(t=>/^\d+\s*件\s*HIT$/i.test(t));
  const totalHits=hitText?Number(hitText.match(/^\d+/)[0]):null;
  const firstHit=tokens.findIndex(t=>/^\d+\s*件\s*HIT$/i.test(t));
  let parsedOccurrences=0;
  for(let i=Math.max(0,firstHit+1);i<tokens.length;i++){
    const id=tokens[i].toUpperCase(); if(!TOKEN_ID.test(id))continue;
    let j=i+1;
    while(j<i+10 && SEP.test(tokens[j]||''))j++;
    const rarityRaw=tokens[j]||'';
    if(!RARITY.test(rarityRaw))continue;
    j++;while(j<i+12 && SEP.test(tokens[j]||''))j++;
    const m=(tokens[j]||'').match(TYPE);if(!m)continue;
    let name=m[2]||'';
    if(!name){j++;while(j<i+16 && SEP.test(tokens[j]||''))j++;name=tokens[j]||'';}
    if(!cardName(name,id))continue;
    parsedOccurrences++;
    if(!byId.has(id))byId.set(id,{cardId:id,name,rarity:rarityRaw==='SPカード'?'SP':rarityRaw,type:m[1].toUpperCase(),...inspectFields(tokens,j+1)});
  }
  const cards=[];
  for(const entry of byId.values()){
    const imgs=images.get(entry.cardId)||[];
    if(imgs.length){
      for(const img of imgs) cards.push({...entry,variant:img.label,imageUrl:img.url,officialImageUrl:img.officialImageUrl,filename:img.filename,variants:imgs});
    }else cards.push({...entry,variant:'版本未核实',imageUrl:null,officialImageUrl:null,variants:[]});
  }
  return {cards,totalHits,parsedOccurrences,uniqueCards:byId.size};
}
function makeSearch(series,term){
  const url=new URL(ROOT+'/cardlist/');
  if(series==='ALL'){
    if(term.length<2 || term.length>90)throw Error('全系列搜索至少输入2个字符（最多90个）');
    url.searchParams.set('freewords',term);url.searchParams.set('search','true');
  }else if(/^OP(?:0[1-9]|1[0-6])$/.test(series)&&!term){
    // Bandai series identifiers; OP16 verified as 550116. Other sets checked at runtime.
    url.searchParams.set('series',String(550100+Number(series.slice(2))));
  }else{
    // EB/ST may have different Bandai series keys. Use official card-number search as fallback.
    url.searchParams.set('freewords',term||series+'-');url.searchParams.set('search','true');
  }
  return url;
}
export default async function handler(request){
  const search=new URL(request.url).searchParams;
  const series=(search.get('series')||'OP16').trim().toUpperCase();
  const q=(search.get('q')||'').trim();
  if(!(/^(?:OP(?:0[1-9]|1[0-6])|EB0[1-4]|ST(?:0[1-9]|[12]\d|3[0-6])|ALL)$/.test(series)))return json({error:'暂不支持这个系列'},400);
  let official;
  try{official=makeSearch(series,q);}catch(e){return json({error:e.message},400);}
  let html;
  try{
    const response=await fetch(official,{headers:{Accept:'text/html'},signal:AbortSignal.timeout(16000)});
    if(!response.ok)return json({error:'官方卡表暂时不可访问',upstreamStatus:response.status},502);
    const len=Number(response.headers.get('content-length')||0);if(len>8_000_000)return json({error:'上游结果过大'},502);
    html=await response.text();if(html.length>8_000_000)return json({error:'上游结果过大'},502);
  }catch{return json({error:'连接万代日版卡表失败，请稍后重试'},502);}
  let parsed=parseCatalog(html);
  // Never display a completely unrelated set when an upstream series ID changes.
  if(/^OP/.test(series) && !q && parsed.cards.length &&
    !parsed.cards.some(c=>c.cardId.startsWith(series+'-'))){
    const fallback=new URL(ROOT+'/cardlist/');
    fallback.searchParams.set('freewords',series+'-');fallback.searchParams.set('search','true');
    try{
      const r=await fetch(fallback,{headers:{Accept:'text/html'},signal:AbortSignal.timeout(16000)});
      if(!r.ok)throw Error('fallback upstream status '+r.status);
      const alternate=await r.text();if(alternate.length>8_000_000)throw Error('fallback size limit');
      parsed=parseCatalog(alternate);official=fallback;
    }catch{return json({error:'未能验证官方系列与所选补充包一致，请到官方卡表核对'},502);}
  }
  if(!parsed.cards.length)return json({error:'官方页面未返回可确认的卡牌记录，请更换系列或查询词',officialUrl:official.toString()},404);
  const warning=parsed.totalHits!==null && parsed.parsedOccurrences<parsed.totalHits
    ? '官方显示 '+parsed.totalHits+' 条结果，当前识别了 '+parsed.parsedOccurrences+' 条页面记录；某些版本可能未能识别，请以官网为准。'
    : null;
  return json({series,query:q,cards:parsed.cards,totalHits:parsed.totalHits,uniqueCards:parsed.uniqueCards,source:'万代 ONE PIECE CARD GAME 日版官方卡表',officialUrl:official.toString(),warning});
}
