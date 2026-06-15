const YOUTUBE_WATCH_URL = 'https://www.youtube.com/watch?v=';

function jsonResponse(data, status = 200, cacheSeconds = 300) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${cacheSeconds}`,
    },
  });
}

async function ensureManualTranscriptTable(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS manual_transcripts (
      video_id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

async function getManualTranscript(env, videoId) {
  await ensureManualTranscriptTable(env);
  return env.DB.prepare('SELECT video_id, text, updated_at FROM manual_transcripts WHERE video_id = ?')
    .bind(videoId)
    .first();
}

async function saveManualTranscript(env, videoId, text) {
  await ensureManualTranscriptTable(env);
  await env.DB.prepare(`
    INSERT INTO manual_transcripts (video_id, text, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(video_id) DO UPDATE SET text = excluded.text, updated_at = CURRENT_TIMESTAMP
  `).bind(videoId, text).run();
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

function extractInnertubeApiKey(html) {
  const match = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
  return match?.[1] || '';
}

async function fetchPlayerResponseFromInnertube(videoId, preferredLang, apiKey) {
  if (!apiKey) return null;

  const clientPayloads = [
    { clientName: 'WEB', clientVersion: '2.20260612.01.00' },
    { clientName: 'TVHTML5', clientVersion: '7.20260612.16.00' },
    { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 35 },
  ];

  for (const client of clientPayloads) {
    try {
      const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}`, {
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

function parseManualTranscript(text = '') {
  const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return [];

  const regex = /(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*\d+秒钟)?\s*([\s\S]*?)(?=\n?\d{1,2}:\d{2}(?::\d{2})?(?:\s*\d+秒钟)?|$)/g;
  const segments = [];
  let match;

  while ((match = regex.exec(normalized)) !== null) {
    const time = match[1];
    const body = (match[2] || '').replace(/\s+/g, ' ').trim();
    if (!body) continue;

    const parts = time.split(':').map(Number);
    const start = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
    segments.push({ start, time: formatTime(start), text: body });
  }

  if (segments.length) return segments;

  return normalized.split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => ({ start: index, time: formatTime(index), text: line }));
}

function manualTranscriptPayload(row) {
  const segments = parseManualTranscript(row.text || '');
  return {
    video_id: row.video_id,
    language: '',
    language_name: 'Manual paste',
    is_generated: false,
    source: 'manual',
    updated_at: row.updated_at,
    segments,
    text: row.text || '',
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const data = await request.json().catch(() => ({}));
  const videoId = data.video_id;
  const text = String(data.text || '').trim();

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return jsonResponse({ error: 'A valid video_id is required' }, 400, 0);
  }

  if (!text) {
    return jsonResponse({ error: 'Transcript text is required' }, 400, 0);
  }

  try {
    await saveManualTranscript(env, videoId, text);
    const row = await getManualTranscript(env, videoId);
    return jsonResponse({ success: true, ...manualTranscriptPayload(row) }, 201, 0);
  } catch (err) {
    return jsonResponse({ error: err.message || 'Failed to save manual transcript' }, 500, 0);
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get('video_id');
  const preferredLang = searchParams.get('lang') || '';
  const source = searchParams.get('source') || 'auto';

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return jsonResponse({ error: 'A valid video_id is required' }, 400);
  }

  try {
    if (source === 'manual') {
      const manual = await getManualTranscript(env, videoId);
      if (!manual) return jsonResponse({ error: 'No manual transcript saved for this video', segments: [], text: '' }, 404, 0);
      return jsonResponse(manualTranscriptPayload(manual), 200, 0);
    }

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
      const innertubeApiKey = extractInnertubeApiKey(html);
      playerResponse = await fetchPlayerResponseFromInnertube(videoId, preferredLang, innertubeApiKey);
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
