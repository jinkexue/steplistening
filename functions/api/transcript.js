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

function extractInitialPlayerResponse(html) {
  const marker = 'ytInitialPlayerResponse = ';
  const start = html.indexOf(marker);
  if (start === -1) return null;

  const jsonStart = start + marker.length;
  const endMarker = ';</script>';
  const end = html.indexOf(endMarker, jsonStart);
  if (end === -1) return null;

  const raw = html.slice(jsonStart, end).trim();
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
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
    const playerResponse = extractInitialPlayerResponse(html);
    const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const selectedTrack = pickCaptionTrack(captionTracks, preferredLang);

    if (!selectedTrack?.baseUrl) {
      return jsonResponse({
        error: 'No transcript is available for this video',
        segments: [],
        text: '',
      }, 404);
    }

    const transcriptUrl = new URL(selectedTrack.baseUrl);
    transcriptUrl.searchParams.set('fmt', 'json3');

    const transcriptRes = await fetch(transcriptUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      },
    });

    if (!transcriptRes.ok) {
      return jsonResponse({ error: `Failed to load transcript: ${transcriptRes.status}` }, 502);
    }

    const transcriptRaw = stripJsonPrefix(await transcriptRes.text());
    const transcriptJson = JSON.parse(transcriptRaw);
    const segments = normalizeTranscriptEvents(transcriptJson.events || []);
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
