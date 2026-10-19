
const BASE = "https://onepiece-cardgame.com";

const TYPES = new Set([
  "CHARACTER", "LEADER", "EVENT", "STAGE"
]);

const RARITIES = new Set([
  "C", "UC", "R", "SR", "SEC", "L", "P", "SP", "TR"
]);

function decodeHTML(text) {
  return String(text || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    });
}

function textLines(html) {
  return decodeHTML(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]+>/g, "\n")
  )
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function getCardInfo(html, id) {
  const lines = textLines(html);

  const hitIndex = lines.findIndex(line =>
    /^\d+\s*件\s*HIT$/i.test(line)
  );

  if (
    hitIndex >= 0 &&
    /^0\s*件\s*HIT$/i.test(lines[hitIndex])
  ) {
    return null;
  }

  const start = hitIndex >= 0 ? hitIndex + 1 : 0;

  // Find exact card number inside search results.
  for (let i = start; i < lines.length; i++) {
    if (lines[i] !== id) continue;

    // Official result format:
    // OP16-053 | C | CHARACTER ロロノア・ゾロ
    const end = Math.min(i + 12, lines.length);

    for (let j = i + 1; j < end; j++) {
      const type = lines[j].toUpperCase();

      if (!TYPES.has(type)) continue;

      // Name is the first meaningful line after card type.
      let name = "";

      for (let k = j + 1; k < Math.min(j + 4, end); k++) {
        const candidate = lines[k];

        if (
          !candidate ||
          candidate === "|" ||
          candidate === "｜" ||
          candidate.length < 2 ||
          /検索|テキスト表示|CARD VIEW/i.test(candidate)
        ) {
          continue;
        }

        name = candidate;
        break;
      }

      if (!name) continue;

      let rarity = "";

      // Read rarity between the card number and card type.
      for (let k = i + 1; k < j; k++) {
        const value = lines[k].toUpperCase();

        if (RARITIES.has(value)) {
          rarity = value;
          break;
        }
      }

      return {
        name,
        rarity,
        type
      };
    }
  }

  return null;
}

function getImages(html, id) {
  const images = [];
  const seen = new Set();

  // Use actual image filenames in the official page.
  const pattern = new RegExp(
    "images/cardlist/card/(" +
      id +
      "(?:_[a-z0-9]+)*\\.(?:png|jpg|jpeg|webp))" +
      "(?:\\?([^\"'<>\\s]*))?",
    "gi"
  );

  for (const match of html.matchAll(pattern)) {
    const filename = match[1];

    if (seen.has(filename.toLowerCase())) continue;
    seen.add(filename.toLowerCase());

    const query = match[2]
      ? "?" + decodeHTML(match[2])
      : "";

    const url =
      BASE +
      "/images/cardlist/card/" +
      filename +
      query;

    const parallel = filename.match(/_p(\d+)/i);

    const label = parallel
      ? "平行版 / 异画 p" + parallel[1]
      : filename.includes("_")
        ? "其他官方印刷版本"
        : "标准版";

    images.push({
      url,
      imageUrl: url,
      label,
      filename
    });
  }

  // Standard card before parallel cards.
  images.sort((a, b) => {
    const aBase = a.filename.toLowerCase() ===
      (id + ".png").toLowerCase();
    const bBase = b.filename.toLowerCase() ===
      (id + ".png").toLowerCase();

    return Number(bBase) - Number(aBase);
  });

  return images;
}

export default async function handler(request) {
  const params = new URL(request.url).searchParams;

  const id = (params.get("id") || "")
    .trim()
    .toUpperCase();

  if (!/^(?:(?:OP|EB|ST)\d{2}-\d{3}|P-\d{3})$/.test(id)) {
    return Response.json(
      { error: "卡号格式不正确，例如 OP16-053" },
      { status: 400 }
    );
  }

  const official = new URL(BASE + "/cardlist/");
  official.searchParams.set("freewords", id);
  official.searchParams.set("search", "true");

  let html;

  try {
    const response = await fetch(official.toString(), {
      headers: {
        Accept: "text/html"
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    html = await response.text();
  } catch (error) {
    return Response.json({
      error: "无法获取万代官方卡表",
      detail: String(error.message || error)
    }, { status: 502 });
  }

  const card = getCardInfo(html, id);

  if (!card) {
    const lines = textLines(html);
    const index = lines.findIndex(x => x === id);

    return Response.json({
      error: "无法可靠解析卡牌资料",
      cardId: id,
      ...(params.get("debug") === "1" ? {
        debug: {
          htmlLength: html.length,
          nearbyLines: index >= 0
            ? lines.slice(
                Math.max(0, index - 3),
                index + 12
              )
            : []
        }
      } : {})
    }, { status: 404 });
  }

  const images = getImages(html, id);

  const variants = images.map((image, index) => ({
    id: index,
    label: image.label,
    url: image.url,
    imageUrl: image.url,
    image: image.url
  }));

  return Response.json({
    cardId: id,
    name: card.name,
    rarity: card.rarity,
    type: card.type,
    imageUrl: images[0]?.url || null,
    image: images[0]?.url || null,
    images,
    variants,
    officialUrl: official.toString(),
    language: "ja",
    source: "ONE PIECE CARD GAME Japanese Official",
    warning: images.length === 0
      ? "找到了卡名，但未提取到官方图片"
      : null
  }, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
