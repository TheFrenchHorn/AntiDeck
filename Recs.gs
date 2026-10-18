/**
 * AntiDeck recommendations — EDHREC proxy. Add as a NEW file in Apps Script, e.g. "Recs.gs".
 * Uses EDHREC's public (unofficial) JSON feed, so it can change without notice; the app falls
 * back to Scryfall automatically if this returns an error.
 * Results are cached for 6 hours per commander to keep things fast and be polite to EDHREC.
 */

function recsSlug_(name) {
  return String(name || '').split(' // ')[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['’,]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function getEdhrecRecs(json) {
  try {
    var names = (JSON.parse(json).commanders || []).slice(0, 2);
    if (!names.length) return { ok: false, error: 'No commander.' };
    var slugs = names.map(recsSlug_).filter(Boolean), tries = [];
    if (slugs.length === 2) { var s = slugs.slice().sort(); tries = [s.join('-'), s.reverse().join('-')]; } else tries = [slugs[0]];
    var cache = CacheService.getScriptCache(), hit = cache.get('edhrec:' + tries[0]);
    if (hit) return JSON.parse(hit);

    var j = null, used = '';
    for (var i = 0; i < tries.length && !j; i++) {
      var res = UrlFetchApp.fetch('https://json.edhrec.com/pages/commanders/' + tries[i] + '.json',
        { headers: { 'User-Agent': 'AntiDeck/0.19 (Google Apps Script)', 'Accept': 'application/json' }, muteHttpExceptions: true });
      if (res.getResponseCode() === 200) { try { j = JSON.parse(res.getContentText()); used = tries[i]; } catch (e) {} }
    }
    if (!j) return { ok: false, error: 'EDHREC has no page for ' + tries[0] + '.' };

    var out = recsSlim_(j); out.slug = used;
    if (!out.top.length && !out.syn.length && !out.lands.length) return { ok: false, error: 'EDHREC data had an unexpected format.', headers: out.headers };
    var str = JSON.stringify(out);
    if (str.length > 95000) { var keys = Object.keys(out.pool).slice(0, 350), p2 = {}; keys.forEach(function (k) { p2[k] = out.pool[k]; }); out.pool = p2; str = JSON.stringify(out); }
    if (str.length < 98000) cache.put('edhrec:' + tries[0], str, 21600);
    return out;
  } catch (e) { return { ok: false, error: String(e && e.message || e).slice(0, 200) }; }
}

function recsSlim_(j) {
  var lists = (((j.container || {}).json_dict || {}).cardlists) || j.cardlists || [];
  var out = { ok: true, source: 'edhrec', top: [], syn: [], lands: [], pool: {}, headers: [] };
  var seenLand = {};
  lists.forEach(function (l) {
    var h = String(l.header || l.tag || '').toLowerCase(); out.headers.push(h);
    var cards = (l.cardviews || l.cards || []).slice(0, 60).map(function (c) {
      var pd = Number(c.potential_decks) || 0, nd = Number(c.num_decks != null ? c.num_decks : c.inclusion) || 0;
      var lift = c.lift != null ? Number(c.lift) : (c.synergy != null ? Number(c.synergy) : null);
      return { n: c.name, i: pd ? Math.round(1000 * nd / pd) / 10 : 0, l: lift == null ? null : Math.round(lift * 100) / 100, t: c.lift != null ? 'lift' : 'syn' };
    }).filter(function (c) { return c.n; });
    cards.forEach(function (c) { if (!out.pool[c.n] || out.pool[c.n][0] < c.i) out.pool[c.n] = [c.i, c.l, c.t]; });
    if (/^top cards/.test(h) || h === 'topcards') out.top = cards;
    else if (/synergy|lift/.test(h)) out.syn = cards;
    else if (/lands/.test(h)) cards.forEach(function (c) { if (!seenLand[c.n] && !/^(plains|island|swamp|mountain|forest|wastes)$/i.test(c.n)) { seenLand[c.n] = 1; out.lands.push(c); } });
  });
  out.lands.sort(function (a, b) { return b.i - a.i; });
  return out;
}
