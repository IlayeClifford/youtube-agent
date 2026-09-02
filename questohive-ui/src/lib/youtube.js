const YT_REGEX =
  /(https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)[\w-]+(?:[&?]t=\d+s?)?)/g;

export function parseYoutubeUrl(url) {
  try {
    const u = new URL(url);
    let id = null;
    let short = false;

    if (u.hostname.includes("youtu.be")) {
      id = u.pathname.slice(1);
    } else if (u.pathname.startsWith("/shorts/")) {
      id = u.pathname.split("/shorts/")[1];
      short = true;
    } else {
      id = u.searchParams.get("v");
    }

    const tParam = u.searchParams.get("t");
    const start = tParam ? parseInt(tParam.replace("s", ""), 10) : 0;
    return id ? { id, start, short } : null;
  } catch {
    return null;
  }
}

export function extractVideos(text) {
  const matches = text.match(YT_REGEX) || [];
  return matches
    .map((url) => {
      const parsed = parseYoutubeUrl(url);
      return parsed ? { url, ...parsed } : null;
    })
    .filter(Boolean);
}

export function stripVideoUrls(text) {
  return text.replace(YT_REGEX, "").trim();
}

// Drops exact duplicates by (video id + timestamp) together — the same
// video cited twice at the same moment is noise. Two different videos that
// happen to share a timestamp number, or the same video at two different
// moments, are NOT duplicates and both are kept.
export function dedupeVideos(videos) {
  const seen = new Set();
  const result = [];
  for (const v of videos) {
    const key = `${v.id}-${v.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(v);
  }
  return result;
}

export function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

export { YT_REGEX };