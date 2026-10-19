
const OFFICIAL_SITE = "https://onepiece-cardgame.com";

function decodeHtml(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => {
      const v = Number(n);
      return v >= 0 && v <= 0x10ffff
        ? String.fromCodePoint(v) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      const v = parseInt(n, 16);
      return v >= 0 && v <= 0x10ffff
        ? String.fromCodePoint(v) : "";
    });
}

function getTextLines(html) {
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]*>/g, "\n")
  )
    .split(/\r?\n/)
    .map(x => x.trim())
    .filter(Boolean);
}

function isCardName(value, cardId) {
  if (!value || value === cardId || value.length > 120) {
    return false;
  }

  if (/^(C|UC|R|SR|SEC|L|SP|P)$/i.test(value)) {
    return false;
  }

  if (/^(LEADER|CHARACTER|EVENT|STAGE)$/i.test(value)) {
    return false;
  }

  if (
    /^(コスト|属性|パワー|カウンター|色|特徴|テキスト|入手情報|ブロック)/.test(value)
  ) {
    return false;
  }

  if (/検索|SEARCH|条件クリア|件HIT|ボタン/i.test(value)) {
    return false;
  }

  return true;
}

function extractCard(html, cardId) {
  const lines = getTextLines(html);

  const hitIndex = lines.findIndex(
    line => /^\d+\s*件\s*HIT$/i.test(line)
  );

  if (hitIndex >= 0 && /^0\s*件\s*HIT$/i.test(lines[hitIndex])) {
    return null;
  }

  // Search the result area, not the search input.
  const start = hitIndex >= 0 ? hitIndex + 1 : 0;

  let foundIndex = -1;

  for (let i = start; i < lines.length; i++) {
    if (lines[i] === cardId) {
      foundIndex = i;
      break;
    }
  }

  if (foundIndex < 0) {
    return null;
  }

  // The actual card name appears beside the exact card ID.
  const candidates = [
    lines[foundIndex + 1],
    lines[foundIndex - 1]
  ];

  const name = candidates.find(
    value => isCardName(value, cardId)
  );

  if (!name) {
    return {
      error: "找到卡号，但未能可靠识别日文名称",
      nearbyLines: lines.slice(
        Math.max(0, foundIndex - 5),
        foundIndex + 7
      )
    };
  }

  // Rarity can be omitted rather than guessed.
  const previousLines = lines.slice(
    Math.max(start, foundIndex - 8),
    foundIndex
  );

  const validRarities = [
    "SEC", "SR", "UC", "SP", "R", "C", "L", "P"
  ];

  const rarity =
    previousLines.find(x => validRarities.includes(x)) || "";

  return { name, rarity };
}

function extractImages(html, cardId) {
  const images = [];
  const seen = new Set();

  // Extract only filenames actually present in official HTML.
  const pattern = new RegExp(
    "images/cardlist/card/(" +
      cardId +
      "(?:_[a-z0-9]+)*\\.(?:png|jpe?g|webp))" +
      "(?:\\?([^\"'<>\\s]*))?",
    "gi"
  );

  for (const match of html.matchAll(pattern)) {
    const filename = match[1];
    const key = filename.toLowerCase();

    if (seen.has(key)) continue;
    seen.add(key);

    const query = match[2]
      ? "?" + decodeHtml(match[2])
      : "";

    const url =
      OFFICIAL_SITE +
      "/images/cardlist/card/" +
      filename +
      query;

    const parallel = filename.match(/_p(\d+)/i);

    let label = "标准版";

    if (parallel) {
      label = "平行版 / 异画 p" + parallel[1];
    } else if (filename.includes("_")) {
      label = "其他官方印刷版本";
    }

    images.push({
      url,
      imageUrl: url,
      label,
      filename
    });
  }

  images.sort((a, b) => {
    const aBase = a.filename === cardId + ".png";
    const bBase = b.filename === cardId + ".png";
    return Number(bBase) - Number(aBase);
  });

  return images;
}

export default async function handler(request) {
  const params = new URL(request.url).searchParams;

  const cardId = (params.get("id") || "")
    .trim()
    .toUpperCase();

  if (!/^(?:(?:OP|EB|ST)\d{2}-\d{3}|P-\d{3})$/.test(cardId)) {
    return Response.json(
      { error: "卡号格式错误，例如 OP16-053" },
      { status: 400 }
    );
  }

  const officialUrl = new URL(
    OFFICIAL_SITE + "/cardlist/"
  );

  officialUrl.searchParams.set("freewords", cardId);
  officialUrl.searchParams.set("search", "true");

  let html;

  try {
    const response = await fetch(officialUrl, {
      headers: {
        Accept: "text/html",
        "User-Agent": "GrandLinePortfolio/0.3"
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      return Response.json({
        error: "官方卡牌网站请求失败",
        upstreamStatus: response.status
      }, { status: 502 });
    }

    html = await response.text();

  } catch (error) {
    return Response.json({
      error: "无法连接万代日版卡牌数据库",
      detail: String(error.message || error)
    }, { status: 502 });
  }

  const card = extractCard(html, cardId);

  if (!card || card.error) {
    return Response.json({
      error: card?.error ||
        "官方搜索结果中未找到对应卡牌",
      cardId,
      officialUrl: officialUrl.toString(),
      ...(params.get("debug") === "1"
        ? {
            debug: {
              htmlLength: html.length,
              containsCardId: html.includes(cardId),
              nearbyLines: card?.nearbyLines || [],
              title: html.match(
                /<title[^>]*>([^<]*)<\/title>/i
              )?.[1] || null
            }
          }
        : {})
    }, { status: card?.error ? 502 : 404 });
  }

  const images = extractImages(html, cardId);

  const variants = images.map((item, index) => ({
    id: index,
    label: item.label,
    url: item.url,
    imageUrl: item.url,
    image: item.url
  }));

  return Response.json({
    cardId,
    name: card.name,
    rarity: card.rarity,

    imageUrl: images[0]?.url || null,
    image: images[0]?.url || null,

    images,
    variants,

    officialUrl: officialUrl.toString(),
    source: "ONE PIECE CARD GAME Japanese Official",
    language: "ja",

    warning: images.length === 0
      ? "卡牌名称已识别，但未找到官方图片地址"
      : null
  }, {
    headers: {
      "Cache-Control": "public, max-age=1800"
    }
  });
}
