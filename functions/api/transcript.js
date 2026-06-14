const YOUTUBE_WATCH_URL = 'https://www.youtube.com/watch?v=';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

function decodeHtmlEntities(text = '') {
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
  };
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (m) => entities[m] || m);
}

function stripJsonPrefix(text) {
  return text.replace(/^\)\]\}'\s*/, '');
}

function parseBalancedJson(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return text.slice(startIndex, i + 1);
    }
  }

  return null;
}

function extractInitialPlayerResponse(html) {
  const patterns = ['ytInitialPlayerResponse = ', 'ytInitialPlayerResponse='];

  for (const marker of patterns) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex === -1) continue;

    const braceIndex = html.indexOf('{', markerIndex + marker.length);
    if (braceIndex === -1) continue;

    const raw = parseBalancedJson(html, braceIndex);
    if (!raw) continue;

    try {
      return JSON.parse(raw);
    } catch (err) {}
  }

  return null;
}

async function fetchPlayerResponseFromInnertube(videoId, preferredLang) {
  const clientPayloads = [
    { clientName: 'WEB', clientVersion: '2.20260612.01.00' },
    { clientName: 'TVHTML5', clientVersion: '7.20260612.16.00' },
    { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 35 },
  ];

  for (const client of clientPayloads) {
    try {
      const res = await fetch('https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
          'Accept-Language': preferredLang ? `${preferredLang},en;q=0.8` : 'en-US,en;q=0.9',
        },
        body: JSON.stringify({
          context: {
            client: {
              hl: preferredLang || 'en',
              gl: 'US',
              ...client,
            },
          },
          videoId,
        }),
      });

      if (!res.ok) continue;
      const data = await res.json();
      if (data?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length) return data;
    } catch (err) {}
  }

  return null;
}

function pickCaptionTrack(captionTracks, preferredLang) {
  if (!Array.isArray(captionTracks) || captionTracks.length === 0) return null;

  if (preferredLang) {
    const lower = preferredLang.toLowerCase();
    const exact = captionTracks.find(t => (t.languageCode || '').toLowerCase() === lower);
    if (exact) return exact;

    const prefix = captionTracks.find(t => (t.languageCode || '').toLowerCase().startsWith(lower.split('-')[0]));
    if (prefix) return prefix;
  }

  const english = captionTracks.find(t => (t.languageCode || '').toLowerCase().startsWith('en'));
  return english || captionTracks[0];
}

function formatTime(seconds) {
  const total = Math.floor(Number(seconds) || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function normalizeTranscriptEvents(events = []) {
  return events
    .filter(event => event?.segs?.length)
    .map(event => {
      const startSeconds = (Number(event.tStartMs) || 0) / 1000;
      const text = event.segs
        .map(seg => seg.utf8 || '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim();

      return text ? { start: startSeconds, time: formatTime(startSeconds), text: decodeHtmlEntities(text) } : null;
    })
    .filter(Boolean);
}

function normalizeXmlTranscript(xml = '') {
  const segments = [];
  const textTagRegex = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  let match;

  while ((match = textTagRegex.exec(xml)) !== null) {
    const attrs = match[1] || '';
    const start = Number(attrs.match(/start="([^"]+)"/)?.[1] || 0);
    const text = decodeHtmlEntities(match[2] || '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (text) segments.push({ start, time: formatTime(start), text });
  }

  return segments;
}

export async function onRequestGet(context) {
  const { request } = context;
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get('video_id');
  const preferredLang = searchParams.get('lang') || '';

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return jsonResponse({ error: 'A valid video_id is required' }, 400);
  }

  try {
    const watchRes = await fetch(`${YOUTUBE_WATCH_URL}${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        'Accept-Language': preferredLang ? `${preferredLang},en;q=0.8` : 'en-US,en;q=0.9',
      },
    });

    if (!watchRes.ok) {
      return jsonResponse({ error: `Failed to load YouTube page: ${watchRes.status}` }, 502);
    }

    const html = await watchRes.text();
    let playerResponse = extractInitialPlayerResponse(html);
    let captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

    if (captionTracks.length === 0) {
      playerResponse = await fetchPlayerResponseFromInnertube(videoId, preferredLang);
      captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    }

    const selectedTrack = pickCaptionTrack(captionTracks, preferredLang);

    if (!selectedTrack?.baseUrl) {
      const status = playerResponse?.playabilityStatus?.status || '';
      const reason = playerResponse?.playabilityStatus?.reason || '';
      const blockedByBot = /bot|sign in/i.test(`${status} ${reason}`);
      return jsonResponse({
        error: blockedByBot
          ? 'YouTube blocked server-side transcript fetching for this video. Please try another video or paste/import transcript manually.'
          : 'No YouTube caption track is available for this video.',
        details: reason || status,
        segments: [],
        text: '',
      }, 404);
    }

    let transcriptRes;
    let transcriptRaw = '';
    let segments = [];

    const jsonUrl = new URL(selectedTrack.baseUrl);
    jsonUrl.searchParams.set('fmt', 'json3');

    transcriptRes = await fetch(jsonUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      },
    });

    if (transcriptRes.ok) {
      transcriptRaw = stripJsonPrefix(await transcriptRes.text());
      try {
        const transcriptJson = JSON.parse(transcriptRaw);
        segments = normalizeTranscriptEvents(transcriptJson.events || []);
      } catch (err) {
        segments = [];
      }
    }

    if (segments.length === 0) {
      const xmlUrl = new URL(selectedTrack.baseUrl);
      xmlUrl.searchParams.delete('fmt');
      transcriptRes = await fetch(xmlUrl.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        },
      });

      if (!transcriptRes.ok) {
        return jsonResponse({ error: `Failed to load transcript: ${transcriptRes.status}` }, 502);
      }

      transcriptRaw = await transcriptRes.text();
      segments = normalizeXmlTranscript(transcriptRaw);
    }

    if (segments.length === 0) {
      return jsonResponse({ error: 'Transcript track was found, but it did not contain readable text.', segments: [], text: '' }, 404);
    }

    const text = segments.map(seg => seg.text).join('\n');

    return jsonResponse({
      video_id: videoId,
      language: selectedTrack.languageCode || '',
      language_name: selectedTrack.name?.simpleText || selectedTrack.name?.runs?.map(r => r.text).join('') || '',
      is_generated: selectedTrack.kind === 'asr',
      segments,
      text,
    });
  } catch (err) {
    return jsonResponse({ error: err.message || 'Failed to fetch transcript' }, 500);
  }
}
