/**
 * AntiDeck "Popular Commanders" — EDHREC proxy. Add as a NEW file in Apps Script, e.g. "Popular.gs".
 * Uses EDHREC's public (unofficial) JSON feed, so field names can change without notice.
 * Everything is cached (CacheService) to keep it fast and to be polite to EDHREC. Inputs are validated.
 */

var POP_HEADERS_ = { 'User-Agent': 'AntiDeck/0.19 (Google Apps Script)', 'Accept': 'application/json' };

function popGet_(url) {
  var res = UrlFetchApp.fetch(url, { headers: POP_HEADERS_, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  try { return JSON.parse(res.getContentText()); } catch (e) { return null; }
}
function popCached_(key, ttl, build) {
  var c = CacheService.getScriptCache(), hit = c.get(key);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var out = build();
  if (out && out.ok) { var s = JSON.stringify(out); if (s.length < 98000) c.put(key, s, ttl); }
  return out;
}
function popRoot_(j) { return (j && j.container && j.container.json_dict) || j || {}; }

// ---------- 1. top commanders (week / month / 2 years) ----------
function getTopCommanders(period) {
  try {
    var map = { week: ['week'], month: ['month'], year: ['year', '2years', 'past2years'] }, tries = map[String(period)];
    if (!tries) return { ok: false, error: 'Bad period.' };
    return popCached_('pop:top:' + period, 21600, function () {
      var j = null; for (var i = 0; i < tries.length && !j; i++) j = popGet_('https://json.edhrec.com/pages/commanders/' + tries[i] + '.json');
      if (!j) return { ok: false, error: 'EDHREC did not return a commander ranking.' };
      var lists = popRoot_(j).cardlists || [], best = [];
      lists.forEach(function (l) { var cv = l.cardviews || l.cards || []; if (cv.length > best.length) best = cv; });
      var out = best.slice(0, 100).map(function (c) {
        var url = String(c.url || ''), slug = url.indexOf('/commanders/') >= 0 ? url.split('/commanders/')[1].split(/[?#]/)[0] : (c.sanitized || '');
        var d = Number(c.num_decks); if (!d && c.label) { var m = String(c.label).match(/([\d,]+)\s*decks?/i); if (m) d = Number(m[1].replace(/,/g, '')); }
        return { n: c.name, s: slug, d: d || 0 };
      }).filter(function (c) { return c.n && c.s; });
      return out.length ? { ok: true, list: out } : { ok: false, error: 'EDHREC ranking had an unexpected format.', keys: Object.keys(popRoot_(j)) };
    });
  } catch (e) { return { ok: false, error: String(e && e.message || e).slice(0, 200) }; }
}

// ---------- 2. real decks for one commander ----------
function getCommanderDecks(slug) {
  try {
    slug = String(slug || ''); if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(slug)) return { ok: false, error: 'Bad commander.' };
    return popCached_('pop:decks:' + slug, 21600, function () {
      var j = popGet_('https://json.edhrec.com/pages/decks/' + slug + '.json');
      if (!j) return { ok: false, error: 'EDHREC has no deck list for this commander.' };
      var r = popRoot_(j), rows = j.table || r.table || r.decks || j.decks || [];
      var decks = rows.slice(0, 80).map(function (d, i) {
        var tags = d.edhrec_tags || d.tags || []; if (typeof tags === 'string') tags = [tags];
        var h = d.urlhash || d.url_hash || d.hash || '';
        return { h: h, p: Number(d.price) || 0, d: String(d.savedate || d.deckage || d.created_at || d.date || ''), i: i,
          t: String(d.theme || d.tribe || d.title || d.deckname || d.name || '').slice(0, 80), g: tags.slice(0, 6).map(String), s: d.salt != null ? Number(d.salt) : null };
      }).filter(function (d) { return /^[A-Za-z0-9_-]{4,80}$/.test(d.h); });
      return decks.length ? { ok: true, slug: slug, total: rows.length, decks: decks } : { ok: false, error: 'No decks found for this commander.', keys: Object.keys(r) };
    });
  } catch (e) { return { ok: false, error: String(e && e.message || e).slice(0, 200) }; }
}

// ---------- 3. one deck's card list ----------
function getEdhrecDeck(hash) {
  try {
    hash = String(hash || ''); if (!/^[A-Za-z0-9_-]{4,80}$/.test(hash)) return { ok: false, error: 'Bad deck id.' };
    return popCached_('pop:deck:' + hash, 43200, function () {
      var j = popGet_('https://json.edhrec.com/pages/deckpreview/' + hash + '.json') || popGet_('https://edhrec.com/api/deckpreview/' + hash);
      if (!j) return { ok: false, error: 'Could not load that deck from EDHREC.' };
      var r = popRoot_(j), found = null;
      [j.items, r.items, j.cards, r.cards, j.deck, r.deck, j.cardlist, r.cardlist].forEach(function (c) { if (!found && Array.isArray(c) && c.length >= 20) found = c; });
      if (!found) return { ok: false, error: 'EDHREC deck had an unexpected format.', keys: Object.keys(r) };
      var counts = {}, order = [];
      found.forEach(function (it) {
        var n = typeof it === 'string' ? it : (it && (it.name || (it.card && it.card.name))) || '', q = 1;
        var m = String(n).match(/^(\d+)x?\s+(.+)$/i); if (m) { q = Number(m[1]); n = m[2]; }
        if (it && typeof it === 'object' && it.quantity) q = Number(it.quantity) || 1;
        n = String(n).trim(); if (!n) return;
        if (!counts[n]) { counts[n] = 0; order.push(n); } counts[n] += q;
      });
      var cmds = (j.commanders || r.commanders || []).map(function (c) { return typeof c === 'string' ? c : (c && c.name); }).filter(Boolean);
      return { ok: true, hash: hash, commanders: cmds, cards: order.map(function (n) { return { n: n, q: counts[n] }; }) };
    });
  } catch (e) { return { ok: false, error: String(e && e.message || e).slice(0, 200) }; }
}
