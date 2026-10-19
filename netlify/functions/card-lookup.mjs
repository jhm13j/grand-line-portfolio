// Grand Line Portfolio: Japanese Bandai card lookup for Netlify.
// The original source is the official JP card list. Never guess card names or image URLs.
const ORIGIN = 'https://onepiece-cardgame.com';
const VALID_ID = /^(?:(?:OP|EB|ST)\d{2}-\d{3}|P-\d{3})$/;
const RARITIES = new Set(['C', 'UC', 'R', 'SR', 'SEC', 'L', 'P', 'SP', 'TR']);
const TYPES = new Set(['CHARACTER', 'LEADER', 'EVENT', 'STAGE']);
const reply = (payload, status = 200) => Response.json(payload, {
  status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}
});

function decodeEntities(input) {
  return String(input || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (whole, number) => {
      const n = number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    });
}
function tokensFromHTML(html) {
  return decodeEntities(html
    .replace(/<!--[^]*?-->/g, '')
    .replace(/<(script|style|noscript|svg)\b[^>]*>[^]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, '\n'))
    .split(/\n/).flatMap(line => line.split(/([|｜])/))
    .map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
function separator(value) { return /^[|｜¦│！!×•·\s]+$/u.test(value || ''); }
function plausibleName(value, id) {
  return Boolean(value && value !== id && value.length >= 2 && value.length <= 140 &&
    !separator(value) && !/^(?:C|UC|R|SR|SEC|L|P|SP|TR|CHARACTER|LEADER|EVENT|STAGE)$/i.test(value) &&
    !/検索|フリーワード|条件クリア|CARD VIEW|TEXT VIEW|件\s*HIT/i.test(value));
}
function parseCard(html, id) {
  const tokens = tokensFromHTML(html);
  const hit = tokens.findIndex(s => /^\d+\s*件\s*HIT$/i.test(s));
  if (hit >= 0 && /^0\s*件\s*HIT$/i.test(tokens[hit])) return null;
  // Ignore the search input in the header; only search after the hit count.
  const start = hit >= 0 ? hit + 1 : 0;
  for (let i = start; i < tokens.length; i++) {
    if (tokens[i] !== id) continue;
    const limit = Math.min(i + 18, tokens.length);
    let j = i + 1;
    while (j < limit && separator(tokens[j])) j++;
    const rarity = (tokens[j] || '').toUpperCase();
    if (!RARITIES.has(rarity)) continue;
    j++;
    while (j < limit && separator(tokens[j])) j++;
    const typeMatch = (tokens[j] || '').match(/^(CHARACTER|LEADER|EVENT|STAGE)(?:\s+(.+))?$/i);
    if (!typeMatch || !TYPES.has(typeMatch[1].toUpperCase())) continue;
    let name = (typeMatch[2] || '').trim();
    if (!name) {
      j++;
      while (j < limit && separator(tokens[j])) j++;
      name = tokens[j] || '';
    }
    if (!plausibleName(name, id)) continue;
    return {name, rarity, type: typeMatch[1].toUpperCase()};
  }
  return null;
}
function getImages(html, id) {
  const images = [], seen = new Set();
  // Only include file names actually present in the official response.
  const expression = new RegExp('(?:https?:\\/\\/(?:www\\.)?onepiece-cardgame\\.com)?\\/?images\\/cardlist\\/card\\/(' + id + '(?:_[a-z0-9]+)*\\.(?:png|jpe?g|webp))(?:\\?([0-9]{4,12})(?:=)?)?', 'gi');
  for (const m of html.matchAll(expression)) {
    const filename = m[1];
    if (seen.has(filename.toLowerCase())) continue;
    seen.add(filename.toLowerCase());
    const version = m[2] || '';
    const officialImageUrl = ORIGIN + '/images/cardlist/card/' + filename + (version ? '?' + version + '=' : '');
    const url = '/.netlify/functions/card-lookup?id=' + encodeURIComponent(id) + '&image=' + encodeURIComponent(filename) + (version ? '&v=' + version : '');
    const parallel = filename.match(/_p(\d+)/i);
    images.push({url, imageUrl: url, officialImageUrl, filename, label: parallel
      ? '平行版 / 异画 p' + parallel[1]
      : filename.toLowerCase() === id.toLowerCase() + '.png' ? '标准版' : '其他官方印刷版本（请核对）'});
  }
  images.sort((a,b) => Number(b.filename.toLowerCase() === id.toLowerCase() + '.png') - Number(a.filename.toLowerCase() === id.toLowerCase() + '.png'));
  return images;
}
async function getImage(id, filename, version) {
  const allowed = new RegExp('^' + id + '(?:_[a-z0-9]+)*\\.(?:png|jpe?g|webp)$', 'i');
  if (!allowed.test(filename) || (version && !/^\d{4,12}$/.test(version))) return reply({error:'非法图片参数'},400);
  const official = ORIGIN + '/images/cardlist/card/' + filename + (version ? '?' + version + '=' : '');
  try {
    const upstream = await fetch(official, {headers:{Accept:'image/png,image/webp,image/jpeg,*/*'}, signal:AbortSignal.timeout(12000)});
    const type = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const length = Number(upstream.headers.get('content-length') || 0);
    if (!upstream.ok || !['image/png','image/webp','image/jpeg'].includes(type) || length > 5_000_000) {
      return reply({error:'官方图片暂时无法加载',upstreamStatus:upstream.status},502);
    }
    const image = await upstream.arrayBuffer();
    if (image.byteLength > 5_000_000) return reply({error:'图片尺寸超限'},502);
    return new Response(image, {headers:{'Content-Type':type,'Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'}});
  } catch { return reply({error:'无法访问官方卡图'},502); }
}
export default async function handler(request) {
  const params = new URL(request.url).searchParams;
  const id = (params.get('id') || '').trim().toUpperCase();
  if (!VALID_ID.test(id)) return reply({error:'卡号格式不正确，例如 OP16-053'},400);
  if (params.has('image')) return getImage(id, params.get('image') || '', params.get('v') || '');
  const search = new URL(ORIGIN + '/cardlist/');
  search.searchParams.set('freewords',id); search.searchParams.set('search','true');
  let html;
  try {
    const res = await fetch(search, {headers:{Accept:'text/html'}, signal:AbortSignal.timeout(15000)});
    if (!res.ok) return reply({error:'万代卡表暂时无法访问',upstreamStatus:res.status},502);
    html = await res.text();
  } catch { return reply({error:'万代卡表访问超时或网络错误'},502); }
  const card = parseCard(html,id);
  if (!card) {
    const tokens = tokensFromHTML(html); const where = tokens.indexOf(id, tokens.findIndex(x => /\d+\s*件\s*HIT/.test(x)) + 1);
    return reply({error:'未能可靠解析该卡牌的日文名称',cardId:id,
      ...(params.get('debug')==='1'?{debugTokens:where>=0?tokens.slice(where,where+15):[],htmlLength:html.length}:{})},502);
  }
  const images = getImages(html,id);
  return reply({cardId:id,...card,imageUrl:images[0]?.url||null,image:images[0]?.url||null,
    images,variants:images.map((x,i)=>({id:i,label:x.label,url:x.url,imageUrl:x.url,image:x.url})),
    officialUrl:search.toString(),language:'ja',source:'ONE PIECE CARD GAME Japanese Official',
    warning:images.length?null:'官方卡名已获取，但没有匹配到可靠的 SAMPLE 图片地址'});
}
