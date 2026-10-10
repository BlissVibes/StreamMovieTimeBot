// TMDB client. Accepts either a v4 "API Read Access Token" (a long JWT, sent
// as a Bearer header) or a v3 "API Key" (32 hex characters, sent as a query
// parameter), told apart by shape.

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/';
export const STALE_MS = 180 * 24 * 3600e3;   // TMDB terms: cached data ≤ 6 months

async function tmdb(env, path, params = {}) {
  const key = String(env.TMDB_TOKEN || '').trim();
  if (!key) throw new Error('TMDB_TOKEN is not set');
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, v);
  const headers = { accept: 'application/json' };
  if (/^[a-f0-9]{32}$/i.test(key)) url.searchParams.set('api_key', key);
  else headers.authorization = `Bearer ${key}`;
  const r = await fetch(url, { headers, cf: { cacheTtl: 3600 } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`TMDB ${r.status} on ${path}`);
  return r.json();
}

const yearOf = d => (d ? Number(String(d).slice(0, 4)) || null : null);
const poster = (p, size = 'w342') => (p ? IMG + size + p : null);

function summary(m) {
  return {
    tmdbId: m.id,
    title: m.title,
    year: yearOf(m.release_date),
    poster: poster(m.poster_path, 'w185'),
    overview: m.overview ? m.overview.slice(0, 300) : '',
  };
}

// "the matrix", "the matrix 1999", "the matrix (1999)", or an IMDb ID/link.
export async function searchMovies(env, query, limit = 10) {
  const q = String(query || '').trim().slice(0, 200);
  if (!q) return [];
  const imdb = q.match(/\b(tt\d{5,10})\b/);
  if (imdb) {
    const r = await tmdb(env, `/find/${imdb[1]}`, { external_source: 'imdb_id' });
    return (r?.movie_results || []).slice(0, limit).map(summary);
  }
  const ym = q.match(/^(.*?)[\s(]+((?:18|19|20)\d{2})\)?$/);
  if (ym) {
    const r = await tmdb(env, '/search/movie', { query: ym[1], primary_release_year: ym[2], include_adult: 'false' });
    if (r?.results?.length) return r.results.slice(0, limit).map(summary);
  }
  const r = await tmdb(env, '/search/movie', { query: q, include_adult: 'false' });
  return (r?.results || []).slice(0, limit).map(summary);
}

export async function movieDetails(env, id) {
  const m = await tmdb(env, `/movie/${Number(id)}`, { append_to_response: 'credits' });
  if (!m) return null;
  return {
    source: 'tmdb',
    tmdbId: m.id,
    title: m.title,
    year: yearOf(m.release_date),
    runtime: m.runtime || null,
    director: (m.credits?.crew || []).filter(c => c.job === 'Director').map(c => c.name).slice(0, 3),
    rating: m.vote_count ? Math.round(m.vote_average * 10) / 10 : null,
    genres: (m.genres || []).map(g => g.name),
    cast: (m.credits?.cast || []).slice(0, 5).map(c => c.name),
    tagline: m.tagline || '',
    imdbId: m.imdb_id || '',
    poster: poster(m.poster_path),
    fetchedAt: Date.now(),
  };
}

export function isStale(movie, now = Date.now()) {
  return movie?.source === 'tmdb' && (!movie.fetchedAt || now - movie.fetchedAt > STALE_MS);
}
