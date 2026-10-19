
export default async (request) => {
  const id = (new URL(request.url).searchParams.get("id") || "")
    .trim().toUpperCase();

  if (!/^(?:(?:OP|EB|ST)\d{2}-\d{3}|P-\d{3})$/.test(id)) {
    return Response.json({ error: "卡号格式错误" }, { status: 400 });
  }

  const official = new URL("https://onepiece-cardgame.com/cardlist/");
  official.searchParams.set("freewords", id);
  official.searchParams.set("search", "true");

  let html;
  try {
    const response = await fetch(official, {
      headers: { "Accept": "text/html" },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error("官方卡表无法访问");
    html = await response.text();
  } catch {
    return Response.json(
      { error: "暂时无法读取万代官方卡表" },
      { status: 502 }
    );
  }

  // Remove HTML elements while preserving text boundaries.
  const lines = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .split(/\r?\n/)
    .map(x => x.trim())
    .filter(Boolean);

  // Match the actual card result, not the search input.
  const recordPattern = new RegExp(
    "^" + id + "\\s*\\|\\s*([A-Z]{1,3})\\s*\\|\\s*" +
    "(LEADER|CHARACTER|EVENT|STAGE)$", "i"
  );

  let found = -1;
  let rarity = "";

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(recordPattern);
    if (match) {
      found = i;
      rarity = match[1];
      break;
    }
  }

  if (found < 0) {
    return Response.json(
      { error: "官方搜索结果中未找到对应卡牌" },
      { status: 404 }
    );
  }

  const name = lines[found + 1] || "";

  if (!name || /検索|フリーワード|CARDLIST/i.test(name)) {
    return Response.json(
      { error: "无法可靠识别卡牌名称" },
      { status: 502 }
    );
  }

  // Preserve the query string on official card images.
  const imagePattern = new RegExp(
    "images/cardlist/card/(" + id +
    "(?:_[a-z0-9]+)*\\.(?:png|jpg|webp))" +
    "(?:\\?([^\\s\"'<>]*))?", "gi"
  );

  const images = [];
  const seen = new Set();

  for (const match of html.matchAll(imagePattern)) {
    const filename = match[1];
    const suffix = match[2]
      ? "?" + match[2].replace(/&amp;/g, "&")
      : "";

    const url =
      "https://onepiece-cardgame.com/images/cardlist/card/" +
      filename + suffix;

    if (seen.has(filename)) continue;
    seen.add(filename);

    const parallel = filename.match(/_p(\d+)/i);
    images.push({
      url,
      label: parallel
        ? "异画版本 " + parallel[1]
        : "标准版"
    });
  }

  // Never pretend a missing image was successfully identified.
  if (!images.length) {
    return Response.json(
      { error: "已识别卡牌，但尚未解析出官方图片" },
      { status: 502 }
    );
  }

  return Response.json({
    cardId: id,
    name,
    rarity,
    images,
    officialUrl: official.toString(),
    source: "ONE PIECE CARD GAME Japanese official card list"
  }, {
    headers: { "Cache-Control": "public, max-age=1800" }
  });
};
