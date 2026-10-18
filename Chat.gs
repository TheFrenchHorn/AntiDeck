/**
 * AntiDeck AI assistant (Gemini and/or Grok). Add this as a file in Apps Script, e.g. "Chat.gs".
 *
 * SETUP (Project Settings -> Script Properties):
 *   GEMINI_API_KEY   your Gemini key   (needed if you use Gemini)
 *   XAI_API_KEY      your xAI/Grok key (needed if you use Grok)
 *   AI_PROVIDER      "grok" or "gemini" (default: grok if XAI_API_KEY is set, else gemini)
 *                    If BOTH keys are set, the other provider is used automatically when the first fails or is rate-limited.
 *   GEMINI_MODEL     optional, default "gemini-3.5-flash" (falls back to "gemini-2.5-flash")
 *   XAI_MODEL        optional, default "grok-4.7" (falls back to "grok-4.1-fast"). For speed, set a fast
 *                    NON-reasoning model ID copied from your xAI console's model list.
 *   CHAT_USER_CAP    messages per person per day (default 30)
 *   CHAT_GLOBAL_CAP  messages for everyone per day (default 300)
 * Then run setupChat() once from the editor to grant permissions and test.
 */

var CHAT_HEADERS_ = { 'User-Agent': 'AntiDeck/0.19 (Google Apps Script)', 'Accept': 'application/json' };
var CHAT_MAX_ROUNDS_ = 3; // tool-use rounds; after this the model MUST answer with what it has

function chatProviders_(props) {
  var hasG = !!props.getProperty('GEMINI_API_KEY'), hasX = !!props.getProperty('XAI_API_KEY');
  var primary = props.getProperty('AI_PROVIDER') || (hasX ? 'grok' : 'gemini'), out = [];
  [primary, primary === 'grok' ? 'gemini' : 'grok'].forEach(function (p) { if ((p === 'grok' && hasX) || (p === 'gemini' && hasG)) out.push(p); });
  return out;
}

function chatWithAssistant(json) {
  try {
    var req = JSON.parse(json), props = PropertiesService.getScriptProperties(), order = chatProviders_(props);
    if (!order.length) return { ok: false, error: 'The assistant is not set up yet: the owner needs to add GEMINI_API_KEY or XAI_API_KEY in Script Properties.' };
    var cid = String(req.clientId || 'anon').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'anon';
    var q = chatCheck_(cid); if (!q.ok) return { ok: false, error: q.msg, left: 0 };

    var pk = req.deck && req.deck.game === 'pokemon';
    var msgs = (req.messages || []).slice(-12).map(function (m) { return { role: m.role === 'user' ? 'user' : 'model', text: String(m.text || '').slice(0, 4000) }; });
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return { ok: false, error: 'Empty message.' };

    var system = chatSystem_(req.deck || {}, pk), decls = chatTools_(pk), reply = '', via = '', errs = [], rate = 0;
    for (var i = 0; i < order.length && !reply; i++) {
      var label = order[i] === 'grok' ? 'Grok' : 'Gemini';
      try { reply = order[i] === 'grok' ? chatRunGrok_(system, msgs, decls) : chatRunGemini_(system, msgs, decls); via = label; }
      catch (e) { var em = String(e && e.message || e); if (em === 'RATE') { rate++; errs.push(label + ': rate-limited'); } else errs.push(em.slice(0, 220)); }
    }
    if (!reply) throw new Error(rate === order.length ? 'RATE' : errs.join('  |  '));
    return { ok: true, reply: reply, via: via, left: chatCount_(cid) };
  } catch (e) {
    var m = String(e && e.message || e);
    if (m === 'RATE') return { ok: false, error: 'The AI provider is rate-limited right now. Wait a minute and try again.' };
    return { ok: false, error: 'Assistant error: ' + m.slice(0, 220) };
  }
}

// ---------- Gemini loop ----------
function chatRunGemini_(system, msgs, decls) {
  var contents = msgs.map(function (m) { return { role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }; });
  for (var i = 0; i <= CHAT_MAX_ROUNDS_; i++) {
    var last = i === CHAT_MAX_ROUNDS_;
    var body = { systemInstruction: { parts: [{ text: system }] }, contents: contents, tools: [{ functionDeclarations: decls }], generationConfig: { maxOutputTokens: 1400 } };
    if (last) body.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
    var r = chatGemini_(body), cand = r.candidates && r.candidates[0];
    if (!cand || !cand.content || !cand.content.parts) return 'I could not produce an answer (' + ((cand && cand.finishReason) || 'no response') + '). Try rephrasing.';
    contents.push(cand.content); // keep parts verbatim (Gemini 3 needs thought signatures echoed back)
    var calls = cand.content.parts.filter(function (p) { return p.functionCall; });
    if (!calls.length || last) {
      var t = cand.content.parts.filter(function (p) { return p.text && !p.thought; }).map(function (p) { return p.text; }).join('').trim();
      return t || 'I gathered some results but could not summarize them. Please ask again.';
    }
    contents.push({ role: 'user', parts: calls.map(function (p) { return { functionResponse: { name: p.functionCall.name, response: { result: chatRunTool_(p.functionCall.name, p.functionCall.args || {}) } } }; }) });
  }
}
function chatGemini_(body) {
  var p = PropertiesService.getScriptProperties(), key = p.getProperty('GEMINI_API_KEY'), custom = p.getProperty('GEMINI_MODEL');
  var models = [custom || 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'].filter(function (m, i, a) { return a.indexOf(m) === i; });
  function post(m, thinking) {
    var b = JSON.parse(JSON.stringify(body));
    if (thinking) b.generationConfig.thinkingConfig = /^gemini-3/.test(m) ? { thinkingLevel: 'low' } : { thinkingBudget: 0 }; // faster answers
    return UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + m + ':generateContent', {
      method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key }, payload: JSON.stringify(b), muteHttpExceptions: true });
  }
  var last = 'no model tried', rateOnly = true;
  for (var i = 0; i < models.length; i++) {
    var res, code, tries = 0;
    for (;;) {
      res = post(models[i], true); code = res.getResponseCode();
      if (code === 400) { res = post(models[i], false); code = res.getResponseCode(); } // model rejected the thinking setting
      if ((code === 500 || code === 502 || code === 503 || code === 504) && tries < 2) { tries++; Utilities.sleep(1500 * tries); continue; } // temporary overload: retry
      break;
    }
    if (code === 200) return JSON.parse(res.getContentText());
    if (code !== 429) rateOnly = false;
    last = 'Gemini ' + code + ' (' + models[i] + '): ' + res.getContentText().slice(0, 160);
    if (code === 400 || code === 401 || code === 403) throw new Error(last); // key/request problem: other models won't help
    // 404 / 429 / 5xx after retries -> try the next model
  }
  throw new Error(rateOnly ? 'RATE' : last);
}

// ---------- Grok (xAI, OpenAI-compatible) loop ----------
function chatRunGrok_(system, msgs, decls) {
  var m = [{ role: 'system', content: system }].concat(msgs.map(function (x) { return { role: x.role === 'user' ? 'user' : 'assistant', content: x.text }; }));
  var tools = decls.map(function (d) { return { type: 'function', function: d }; });
  for (var i = 0; i <= CHAT_MAX_ROUNDS_; i++) {
    var last = i === CHAT_MAX_ROUNDS_;
    var r = chatXai_({ messages: m, tools: tools, tool_choice: last ? 'none' : 'auto' }), msg = r.choices && r.choices[0] && r.choices[0].message;
    if (!msg) return 'I could not produce an answer. Try rephrasing.';
    var calls = msg.tool_calls || [];
    if (!calls.length || last) return String(msg.content || '').trim() || 'I gathered some results but could not summarize them. Please ask again.';
    m.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
    calls.forEach(function (c) {
      var args = {}; try { args = JSON.parse(c.function.arguments || '{}'); } catch (e) {}
      m.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(chatRunTool_(c.function.name, args)) });
    });
  }
}
function chatXai_(body) {
  var p = PropertiesService.getScriptProperties(), key = p.getProperty('XAI_API_KEY'), custom = p.getProperty('XAI_MODEL');
  var models = custom ? [custom] : ['grok-4.7', 'grok-4.1-fast'];
  for (var i = 0; i < models.length; i++) {
    var b = JSON.parse(JSON.stringify(body)); b.model = models[i];
    var res, code, txt, tries = 0;
    for (;;) {
      res = UrlFetchApp.fetch('https://api.x.ai/v1/chat/completions', { method: 'post', contentType: 'application/json', headers: { 'Authorization': 'Bearer ' + key }, payload: JSON.stringify(b), muteHttpExceptions: true });
      code = res.getResponseCode(); txt = res.getContentText();
      if (code >= 500 && tries < 1) { tries++; Utilities.sleep(1500); continue; } // temporary overload: retry once
      break;
    }
    if (code === 200) return JSON.parse(txt);
    if ((code === 404 || code >= 500 || (code === 400 && /model/i.test(txt))) && i < models.length - 1) continue;
    if (code === 429) throw new Error('RATE');
    throw new Error('Grok ' + code + ': ' + txt.slice(0, 200));
  }
}

// ---------- quota (per client id + global, resets daily UTC) ----------
function chatUsage_() {
  var p = PropertiesService.getScriptProperties(), today = Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd');
  var u = {}; try { u = JSON.parse(p.getProperty('CHAT_USAGE') || '{}'); } catch (e) {}
  if (u.d !== today) u = { d: today, g: 0, u: {} };
  return { p: p, u: u, userCap: Number(p.getProperty('CHAT_USER_CAP')) || 30, globalCap: Number(p.getProperty('CHAT_GLOBAL_CAP')) || 300 };
}
function chatCheck_(cid) {
  var s = chatUsage_();
  if (s.u.g >= s.globalCap) return { ok: false, msg: 'The assistant hit its daily limit for everyone. Try again tomorrow.' };
  if ((s.u.u[cid] || 0) >= s.userCap) return { ok: false, msg: 'You have used all ' + s.userCap + ' assistant messages for today.' };
  return { ok: true };
}
function chatCount_(cid) {
  var lock = LockService.getScriptLock(); lock.waitLock(5000);
  try {
    var s = chatUsage_(); s.u.g++; s.u.u[cid] = (s.u.u[cid] || 0) + 1;
    if (Object.keys(s.u.u).length > 150) s.u.u = {};
    s.p.setProperty('CHAT_USAGE', JSON.stringify(s.u));
    return Math.max(0, s.userCap - s.u.u[cid]);
  } finally { lock.releaseLock(); }
}

// ---------- prompt ----------
function chatSystem_(d, pk) {
  var s = 'You are AntiDeck Assistant, a deck-building helper inside a trading card deck builder.\n' +
    (pk ? 'Game: Pokémon TCG. Standard format = exactly 60 cards, max 4 copies of any card name (basic Energy is unlimited), and only Standard-legal cards (tools report standard_legal).\n'
        : 'Game: Magic: The Gathering. Commander = 100 cards, singleton (except basic lands), cards must be within the commander\'s color identity.\n') +
    'RULES:\n1. Use your tools to look cards up. Never rely on memory for card text, legality or prices.\n' +
    '2. Write EVERY card name in double square brackets exactly as printed, like [[Sol Ring]]. Never use double brackets for anything else. Only recommend cards a tool returned or that you are certain exist.\n' +
    '3. Do not suggest cards already in the deck unless the user asks what to cut.\n' +
    '4. Be concise: a one or two sentence read on the deck\'s plan, then at most 10 suggestions with a one-line reason each. Prices are rough USD from the tools.\n' +
    '5. BE EFFICIENT: use at most 2 tool calls in total, then answer. One well-built search beats many. If a search returns good candidates, answer right away instead of searching more.\n' +
    (pk ? '' : '6. search_cards takes Scryfall syntax, e.g. "id<=wubg f:commander otag:ramp usd<5". Use id<=COLORS for color identity, f:commander for legality, otag:removal / otag:card-draw / otag:ramp for roles.\n') +
    '\nCURRENT DECK: "' + (d.name || 'Untitled') + '" — ' + (d.format || '') + ', ' + (d.total || 0) + ' cards.\n';
  if (!pk && d.commanders && d.commanders.length) s += 'Commander(s): ' + d.commanders.join(' & ') + '. Color identity: ' + (d.identity || 'colorless') + '.\n';
  s += 'Cards:\n' + (d.cards || []).slice(0, 160).map(function (c) { return c.q + ' ' + c.n; }).join('\n');
  return s;
}

// ---------- tools ----------
function chatTools_(pk) {
  var str = function (d) { return { type: 'string', description: d }; };
  if (pk) return [
    { name: 'search_pokemon_cards', description: 'Search Pokémon TCG cards (TCGdex). Returns up to 8 distinct cards with stats, attacks and Standard legality.',
      parameters: { type: 'object', properties: { name: str('Card name or part of it'), category: { type: 'string', enum: ['Pokemon', 'Trainer', 'Energy'] }, type: str('Energy type, e.g. Fire, Water, Colorless'), stage: str('Basic, Stage1, Stage2, VMAX, VSTAR...'), standard_only: { type: 'boolean', description: 'Only Standard-legal cards' } } } },
    { name: 'get_pokemon_card', description: 'Get the newest Standard-legal printing of a Pokémon card by exact name.', parameters: { type: 'object', properties: { name: str('Exact card name') }, required: ['name'] } }
  ];
  return [
    { name: 'search_cards', description: 'Search Magic cards with Scryfall syntax. Returns up to 12 cards.',
      parameters: { type: 'object', properties: { query: str('Scryfall query'), order: { type: 'string', enum: ['edhrec', 'usd', 'cmc', 'name'] } }, required: ['query'] } },
    { name: 'get_card', description: 'Look up one Magic card by (fuzzy) name.', parameters: { type: 'object', properties: { name: str('Card name') }, required: ['name'] } }
  ];
}
function chatGet_(url) {
  var res = UrlFetchApp.fetch(url, { headers: CHAT_HEADERS_, muteHttpExceptions: true });
  var code = res.getResponseCode(), body = res.getContentText();
  return { code: code, json: (function () { try { return JSON.parse(body); } catch (e) { return null; } })() };
}
function chatRunTool_(name, a) {
  try {
    var out;
    if (name === 'search_cards') {
      var r = chatGet_('https://api.scryfall.com/cards/search?unique=cards&order=' + encodeURIComponent(a.order || 'edhrec') + '&q=' + encodeURIComponent(String(a.query || '').slice(0, 300)));
      if (r.code === 404) out = { cards: [], note: 'No cards matched.' };
      else if (r.code !== 200) out = { error: (r.json && r.json.details) || 'Search failed, check the query syntax.' };
      else out = { total: r.json.total_cards, cards: r.json.data.slice(0, 12).map(chatSlimMtg_) };
    } else if (name === 'get_card') {
      var g = chatGet_('https://api.scryfall.com/cards/named?fuzzy=' + encodeURIComponent(String(a.name || '')));
      out = g.code === 200 ? chatSlimMtg_(g.json) : { error: 'Card not found.' };
    } else if (name === 'search_pokemon_cards') {
      var p = ['pagination:page=1', 'pagination:itemsPerPage=40'];
      if (a.name) p.push('name=' + encodeURIComponent(a.name)); if (a.category) p.push('category=' + encodeURIComponent(a.category));
      if (a.type) p.push('types=' + encodeURIComponent(a.type)); if (a.stage) p.push('stage=' + encodeURIComponent(a.stage)); if (a.standard_only) p.push('legal.standard=true');
      var l = chatGet_('https://api.tcgdex.net/v2/en/cards?' + p.join('&'));
      if (l.code !== 200 || !Array.isArray(l.json)) out = { cards: [], note: 'No cards matched.' };
      else out = { cards: chatPkDetails_(chatNewestUnique_(l.json, 8)) };
    } else if (name === 'get_pokemon_card') {
      var n = String(a.name || ''), lst = chatGet_('https://api.tcgdex.net/v2/en/cards?name=' + encodeURIComponent(n));
      var m = (lst.json || []).filter(function (x) { return String(x.name).toLowerCase() === n.toLowerCase(); });
      var ds = m.length ? chatPkDetails_(m.slice(-3).reverse()) : [];
      out = ds.filter(function (d) { return d.standard_legal; })[0] || ds[0] || { error: 'Card not found.' };
    } else out = { error: 'Unknown tool.' };
    var s = JSON.stringify(out); return s.length > 7000 ? { truncated: true, data: s.slice(0, 7000) } : out;
  } catch (e) { return { error: String(e.message || e).slice(0, 150) }; }
}
function chatSlimMtg_(c) {
  var f = c.card_faces || [];
  return { name: c.name, mana_cost: c.mana_cost || (f[0] && f[0].mana_cost) || '', type_line: c.type_line, color_identity: (c.color_identity || []).join(''),
    text: String(c.oracle_text || f.map(function (x) { return x.oracle_text; }).join(' // ')).slice(0, 220), usd: (c.prices && c.prices.usd) || null, commander_legal: c.legalities && c.legalities.commander };
}
function chatNewestUnique_(list, n) { // list is oldest -> newest; keep newest printing per name
  var seen = {}, out = [];
  for (var i = list.length - 1; i >= 0 && out.length < n; i--) { var k = String(list[i].name).toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(list[i]); } }
  return out;
}
function chatPkDetails_(items) {
  var reqs = items.map(function (x) { return { url: 'https://api.tcgdex.net/v2/en/cards/' + encodeURIComponent(x.id), headers: CHAT_HEADERS_, muteHttpExceptions: true }; });
  if (!reqs.length) return [];
  return UrlFetchApp.fetchAll(reqs).map(function (r) { try { return r.getResponseCode() === 200 ? JSON.parse(r.getContentText()) : null; } catch (e) { return null; } })
    .filter(Boolean).map(function (d) {
      return { name: d.name, category: d.category, hp: d.hp, types: d.types, stage: d.stage, evolves_from: d.evolveFrom, retreat: d.retreat, trainer_type: d.trainerType,
        attacks: (d.attacks || []).map(function (a) { return { name: a.name, cost: (a.cost || []).join(''), damage: a.damage, effect: String(a.effect || '').slice(0, 160) }; }),
        abilities: (d.abilities || []).map(function (a) { return { name: a.name, effect: String(a.effect || '').slice(0, 160) }; }),
        weakness: (d.weaknesses || []).map(function (w) { return w.type + w.value; }).join(','), text: String(d.effect || '').slice(0, 200),
        standard_legal: !!(d.legal && d.legal.standard), regulation: d.regulationMark, set: d.set && d.set.name };
    });
}

/** Run from the editor (select setupChat -> Run). Shows which providers are configured and tests each one separately. */
function setupChat() {
  assertOwner_(); // owner only (defined in Privacy.gs)
  var p = PropertiesService.getScriptProperties();
  Logger.log('AI_PROVIDER = ' + p.getProperty('AI_PROVIDER') + ' | XAI_API_KEY set: ' + !!p.getProperty('XAI_API_KEY') + ' | GEMINI_API_KEY set: ' + !!p.getProperty('GEMINI_API_KEY'));
  Logger.log('Providers will be tried in this order: ' + JSON.stringify(chatProviders_(p)));
  [['grok', chatRunGrok_], ['gemini', chatRunGemini_]].forEach(function (x) {
    if (!p.getProperty(x[0] === 'grok' ? 'XAI_API_KEY' : 'GEMINI_API_KEY')) { Logger.log(x[0] + ': no key set, skipped'); return; }
    try { Logger.log(x[0] + ' works -> ' + x[1]('Reply with the single word OK.', [{ role: 'user', text: 'Say OK' }], chatTools_(false))); }
    catch (e) { Logger.log(x[0] + ' FAILED -> ' + e.message); }
  });
}
