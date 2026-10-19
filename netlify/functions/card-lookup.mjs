// Netlify server-side lookup: fixed official Japanese cardlist host only.
// No credentials or pricing endpoints are accessed.
export default async (request) => {
  const id = new URL(request.url).searchParams.get('id')?.trim().toUpperCase() || '';
  if (!/^(?:(?:OP|EB|ST)\d{2}-\d{3}|P-\d{3})$/.test(id)) return Response.json({ error: 'Invalid card number' }, {status:400});
  const official = new URL('https://www.onepiece-cardgame.com/cardlist/');
  official.searchParams.set('freewords', id);
  official.searchParams.set('search', 'true');
  let html;
  try {
    const response = await fetch(official, { headers: { 'user-agent':'GrandLinePortfolio/0.2 (+private card catalogue lookup)', 'accept':'text/html' }, signal:AbortSignal.timeout(9000) });
    if (!response.ok) throw new Error('Official catalogue unavailable');
    html = await response.text();
  } catch { return Response.json({error:'Official catalogue temporarily unavailable'}, {status:502}); }
  const plain = t => t.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
  const escaped=id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const index=html.indexOf(id);
  if(index<0) return Response.json({error:'Card not found'}, {status:404});
  // Official card list structures can change. Extract only the result container near the exact ID.
  const chunk=html.slice(Math.max(0,index-1700),Math.min(html.length,index+6500));
  const nameMatch=chunk.match(/class=["'][^"']*(?:cardName|card-name)[^"']*["'][^>]*>([\s\S]*?)<\//)
    || chunk.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
  let name = nameMatch ? plain(nameMatch[1]) : '';
  if (!name || name.length > 90) {
    const after=chunk.slice(chunk.indexOf(id)+id.length);
    const m=after.match(/\|\s*[A-Z]+\s*\|[^<]*<[^>]*>([^<]{2,90})</);
    if(m) name=plain(m[1]);
  }
  // Limit to image files matching exact requested card ID; official site hosts multiple prints with suffixes.
  const imageMatches=[...html.matchAll(/(?:https?:\/\/[^\s"']+)?\/images\/cardlist\/card\/([^"'\s<>]+?\.(?:png|jpg|webp))/gi)]
    .map(m=>m[0].replace(/^https?:\/\/[^/]+/,'https://www.onepiece-cardgame.com'))
    .filter(u=>new RegExp('/'+escaped+'(?:_[a-zA-Z0-9]+)?\\.(?:png|jpg|webp)$','i').test(u));
  const images=[...new Set(imageMatches)].slice(0,20).map((url,i)=>({url, label:i===0?'标准/官方展示版':'异画/再录版本 '+(i+1)}));
  const rarityMatch=chunk.match(new RegExp(escaped+'\\s*\\|\\s*([A-Z]{1,3})\\s*\\|'));
  return Response.json({cardId:id, name,rarity:rarityMatch?.[1]||'',images,officialUrl:official.toString(),source:'ONE PIECE CARD GAME Japanese official card list'}, {headers:{'cache-control':'public, max-age=1800'}});
};
