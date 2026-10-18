// NOTE: In a web app, ANY public function in this project can be called from a visitor's browser
// (google.script.run) and it runs with YOUR permissions. Every function below that touches your
// spreadsheet therefore starts with assertOwner_() (defined in Privacy.gs), so only you can run it.

/**
* MTG Deck Builder & Scryfall API Bridge for Google Sheets
*/


const HEADERS = [
 'rowId', 'scryfall_id', 'printing_id', 'card_name', 'quantity', 'deck_section',
 'set_code', 'set_name', 'collector_number', 'mana_cost', 'cmc', 'type_line',
 'oracle_text', 'color_identity', 'image_url', 'price_usd', 'last_updated'
];


// ==========================================
// 1. MENU & SHEET INITIALIZATION
// ==========================================


function onOpen() {
 SpreadsheetApp.getUi()
   .createMenu('AntiDeck Tools')
   .addItem('Import Deck (Paste)', 'openImportDialog')
   .addItem('Export Deck to Clipboard', 'openExportDialog')
   .addSeparator()
   .addItem('Clear Deck Sheet', 'menuClearDeck')
   .addItem('Initialize / Repair Sheet', 'ensureDeckSheet')
   .addToUi();
}


function doGet() {
 return HtmlService.createTemplateFromFile('index')
   .evaluate()
   .setTitle('AntiDeck')
   .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
   .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}


// Helper to include separate HTML/CSS/JS component files
function include(filename) {
 return HtmlService.createHtmlOutputFromFile(filename).getContent();
}




function ensureDeckSheet() {
 assertOwner_(); // blocks other web-app users from calling this via google.script.run
 const ss = SpreadsheetApp.getActiveSpreadsheet();
 let sheet = ss.getSheetByName('Deck') || ss.getSheetByName('Deck Data');
 if (!sheet) {
   sheet = ss.insertSheet('Deck');
 }
 sheet.showSheet();


 const lastRow = sheet.getLastRow();
 const currentHeaders = lastRow > 0 ? sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0] : [];
 if (currentHeaders.join('|') !== HEADERS.join('|')) {
   sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
   sheet.setFrozenRows(1);
 }
 return sheet;
}


// ==========================================
// 2. LINE PARSER & SCRYFALL BATCH FETCH
// ==========================================


function parseDeckLine(line) {
 let clean = (line || '').trim();
 if (!clean || clean.startsWith('#')) return null;


 // Detect Commander tags like "// Commander" or "*CMDR*"
 let isCommander = false;
 if (/(\/\/|\*)\s*(commander|cmdr)/i.test(clean)) {
   isCommander = true;
   clean = clean.replace(/(\/\/|\*)\s*(commander|cmdr)\s*\*?/gi, '').trim();
 }


 // Matches: "1 Sol Ring", "4x Lightning Bolt (LEA) 161", "1 Arcane Signet [CLB] 298"
 const match = clean.match(/^(\d+)x?\s+(.+?)(?:\s+[\[\(]([A-Za-z0-9]{3,5})[\]\)]\s*(\S+)?)?$/i);
 if (match) {
   return {
     qty: parseInt(match[1], 10),
     name: match[2].trim(),
     set: match[3] ? match[3].toLowerCase() : null,
     collector_number: match[4] ? match[4].trim() : null,
     isCommander: isCommander,
     raw: line
   };
 }


 // Fallback for card names entered without quantities
 if (clean && !clean.startsWith('//')) {
   return { qty: 1, name: clean, set: null, collector_number: null, isCommander: isCommander, raw: line };
 }
 return null;
}


function fetchScryfallCollection(identifiers) {
 assertOwner_(); // blocks other web-app users from calling this via google.script.run
 const results = [];
 const notFound = [];
 const BATCH_SIZE = 75;


 for (let i = 0; i < identifiers.length; i += BATCH_SIZE) {
   const chunk = identifiers.slice(i, i + BATCH_SIZE);
   try {
     const resp = UrlFetchApp.fetch('https://api.scryfall.com/cards/collection', {
       method: 'post',
       contentType: 'application/json',
       headers: { 'User-Agent': 'AntiDeckSheets/3.0', 'Accept': 'application/json' },
       payload: JSON.stringify({ identifiers: chunk }),
       muteHttpExceptions: true
     });


     if (resp.getResponseCode() === 200) {
       const json = JSON.parse(resp.getContentText());
       if (json.data) results.push(...json.data);
       if (json.not_found) notFound.push(...json.not_found);
     } else {
       console.warn(`Scryfall batch error ${resp.getResponseCode()}: ${resp.getContentText()}`);
     }
   } catch (e) {
     console.error(`Scryfall request error: ${e.message}`);
   }


   if (i + BATCH_SIZE < identifiers.length) {
     Utilities.sleep(100); // Polite Scryfall delay
   }
 }


 return { data: results, notFound };
}


function extractCardDetails(card) {
 const img = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || '';
 const artCrop = card.image_uris?.art_crop || card.card_faces?.[0]?.image_uris?.art_crop || img;
 const manaCost = card.mana_cost || card.card_faces?.map(f => f.mana_cost).filter(Boolean).join(' // ') || '';
 const oracleText = card.oracle_text || card.card_faces?.map(f => f.oracle_text).filter(Boolean).join('\n---\n') || '';
 const price = parseFloat(card.prices?.usd || card.prices?.usd_foil || card.prices?.usd_etched || 0);


 return {
   id: card.id,
   name: card.name,
   set: (card.set || '').toUpperCase(),
   setName: card.set_name || '',
   collectorNumber: card.collector_number || '',
   manaCost: manaCost,
   cmc: card.cmc || 0,
   typeLine: card.type_line || '',
   oracleText: oracleText,
   colorIdentity: (card.color_identity || []).join(''),
   image: img,
   artCrop: artCrop,
   price: price
 };
}


// ==========================================
// 3. SHEET IMPORT & EXPORT
// ==========================================


function importDeckList(text) {
 assertOwner_(); // blocks other web-app users from calling this via google.script.run
 if (!text || !text.trim()) {
   return { success: false, message: 'Card list is empty.' };
 }


 const lines = text.split(/\r?\n/);
 const parsedItems = lines.map(parseDeckLine).filter(Boolean);
 if (!parsedItems.length) {
   return { success: false, message: 'No valid card lines recognized.' };
 }


 const identifiers = parsedItems.map(item => {
   if (item.set && item.collector_number) return { set: item.set, collector_number: item.collector_number };
   if (item.set) return { name: item.name, set: item.set };
   return { name: item.name };
 });


 const { data: cards, notFound } = fetchScryfallCollection(identifiers);


 const cardMap = new Map();
 for (const card of cards) {
   cardMap.set(card.name.toLowerCase(), card);
   if (card.card_faces?.[0]?.name) cardMap.set(card.card_faces[0].name.toLowerCase(), card);
   if (card.set && card.collector_number) {
     cardMap.set(`${card.set.toLowerCase()}:${card.collector_number.toLowerCase()}`, card);
   }
 }


 const ss = SpreadsheetApp.getActiveSpreadsheet();
 const sheet = ensureDeckSheet();
 const lastRow = sheet.getLastRow();
 const existingRows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues() : [];


 const deckRowsMap = new Map();
 for (const row of existingRows) {
   const scryId = row[1];
   if (scryId) deckRowsMap.set(scryId, row);
 }


 let importedCount = 0;
 const resolvedList = [];
 const missingList = [];
 const now = new Date().toISOString();


 for (const item of parsedItems) {
   const lookupKey = (item.set && item.collector_number)
     ? `${item.set}:${item.collector_number}`
     : item.name.toLowerCase();


   const cardRaw = cardMap.get(lookupKey) || cardMap.get(item.name.toLowerCase());
   if (!cardRaw) {
     missingList.push(item.raw);
     continue;
   }


   const c = extractCardDetails(cardRaw);
   const section = item.isCommander ? 'commander' : 'main';


   if (deckRowsMap.has(c.id)) {
     const existing = deckRowsMap.get(c.id);
     existing[4] = Number(existing[4] || 0) + item.qty;
     existing[5] = item.isCommander ? 'commander' : existing[5];
     existing[16] = now;
   } else {
     const newRow = [
       Date.now().toString() + Math.floor(Math.random() * 1000),
       c.id,
       c.id,
       c.name,
       item.qty,
       section,
       c.set,
       c.setName,
       c.collectorNumber,
       c.manaCost,
       c.cmc,
       c.typeLine,
       c.oracleText,
       c.colorIdentity,
       c.image,
       c.price,
       now
     ];
     deckRowsMap.set(c.id, newRow);
   }


   importedCount += item.qty;
   resolvedList.push(`${item.qty}x ${c.name}`);
 }


 const allRows = Array.from(deckRowsMap.values());
 if (lastRow > 1) {
   sheet.getRange(2, 1, lastRow - 1, HEADERS.length).clearContent();
 }
 if (allRows.length > 0) {
   sheet.getRange(2, 1, allRows.length, HEADERS.length).setValues(allRows);
 }


 SpreadsheetApp.flush();
 try { ss.setActiveSheet(sheet); } catch (e) {}


 return {
   success: true,
   imported: importedCount,
   resolved: resolvedList,
   notFound: missingList
 };
}


function exportDeckText() {
 assertOwner_(); // blocks other web-app users from calling this via google.script.run
 const sheet = ensureDeckSheet();
 const lastRow = sheet.getLastRow();
 if (lastRow <= 1) return '// Deck is empty';


 const rows = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
 const lines = [];


 for (const r of rows) {
   const qty = r[4] || 1;
   const name = r[3] || 'Unknown Card';
   const set = r[6] ? ` (${r[6]})` : '';
   const num = r[8] ? ` ${r[8]}` : '';
   const section = (r[5] || '').toString().toLowerCase();


   const line = `${qty} ${name}${set}${num}` + (section === 'commander' ? ' // Commander' : '');
   lines.push(line);
 }


 return lines.join('\n');
}


// ==========================================
// 4. BI-DIRECTIONAL WEB APP SYNC
// ==========================================


function syncDeckToSheet(deckData) {
 assertOwner_(); // blocks other web-app users from calling this via google.script.run
 if (!deckData || !Array.isArray(deckData.cards)) {
   throw new Error('Invalid deck structure supplied.');
 }


 const sheet = ensureDeckSheet();
 const lastRow = sheet.getLastRow();
 if (lastRow > 1) {
   sheet.getRange(2, 1, lastRow - 1, HEADERS.length).clearContent();
 }


 if (deckData.cards.length === 0) return { success: true, count: 0 };


 const now = new Date().toISOString();
 const rows = deckData.cards.map(c => [
   c.id || Date.now().toString(),
   c.id || '',
   c.id || '',
   c.name || '',
   Number(c.qty) || 1,
   c.isCommander ? 'commander' : 'main',
   (c.set || '').toUpperCase(),
   c.setName || '',
   c.collector_number || '',
   c.mana_cost || '',
   Number(c.cmc) || 0,
   c.type || '',
   c.oracle_text || '',
   c.color_identity || '',
   c.image || '',
   Number(c.price) || 0,
   now
 ]);


 sheet.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
 SpreadsheetApp.flush();
 return { success: true, count: rows.length };
}


function loadDeckFromSheet() {
 assertOwner_(); // blocks other web-app users from calling this via google.script.run
 const sheet = ensureDeckSheet();
 const lastRow = sheet.getLastRow();
 if (lastRow <= 1) return { name: 'Sheet Deck', format: 'Commander', cards: [] };


 const rawRows = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
 const cards = rawRows.map(r => ({
   id: String(r[1] || r[0]),
   name: String(r[3]),
   qty: Number(r[4]) || 1,
   isCommander: String(r[5]).toLowerCase() === 'commander',
   set: String(r[6] || '').toUpperCase(),
   setName: String(r[7] || ''),
   collector_number: String(r[8] || ''),
   mana_cost: String(r[9] || ''),
   cmc: Number(r[10]) || 0,
   type: String(r[11] || ''),
   oracle_text: String(r[12] || ''),
   color_identity: String(r[13] || ''),
   image: String(r[14] || ''),
   art_crop: String(r[14] || ''),
   price: Number(r[15]) || 0
 }));


 return { name: 'Google Sheet Deck', format: 'Commander', cards: cards };
}


// UI Dialogs
function openImportDialog() {
 assertOwner_(); // blocks other web-app users from calling this via google.script.run
 const html = HtmlService.createHtmlOutputFromFile('DeckImportHtml').setWidth(560).setHeight(440);
 SpreadsheetApp.getUi().showModalDialog(html, 'Import MTG Decklist');
}


function openExportDialog() {
 assertOwner_(); // blocks other web-app users from calling this via google.script.run
 const text = exportDeckText();
 const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
 const html = HtmlService.createHtmlOutput(`
   <style>body { font-family: -apple-system, sans-serif; padding: 12px; margin: 0; background: #f8f9fa; }</style>
   <p style="font-size:13px; margin: 0 0 8px;">Copy your deck list below:</p>
   <textarea style="width:100%; height:280px; font-family: monospace; font-size:12px; padding:8px; box-sizing:border-box;" readonly onclick="this.select()">${escaped}</textarea>
 `).setWidth(520).setHeight(360);
 SpreadsheetApp.getUi().showModalDialog(html, 'Export Deck');
}


function menuClearDeck() {
 assertOwner_(); // blocks other web-app users from calling this via google.script.run
 const ui = SpreadsheetApp.getUi();
 const res = ui.alert('Clear Deck', 'Permanently delete all card rows from the Deck sheet?', ui.ButtonSet.YES_NO);
 if (res === ui.Button.YES) {
   const sheet = ensureDeckSheet();
   const lastRow = sheet.getLastRow();
   if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, HEADERS.length).clearContent();
   ui.alert('Deck cleared.');
 }
}
