#!/usr/bin/env node
// Import the Top 100 (104) animals into the Species table.
//
// For each entry:
//   1. Dedup by name (case-insensitive) against existing Species records
//   2. If found: gently PATCH — set Type/Category/Fun Fact only if currently empty.
//      Never overwrites existing filled fields.
//   3. If new: create with Claude + iNaturalist enrichment + Fun Fact from hook.
//
// Usage:
//   AIRTABLE_API_KEY='...' node scripts/add-top100.js scripts/top100-animals.json
//   AIRTABLE_API_KEY='...' node scripts/add-top100.js scripts/top100-animals.json --dry-run

const fs   = require('fs');
const path = require('path');
const https = require('https');

const BASE_ID       = 'appdlxcWb45dIqNK2';
const SPECIES_TABLE = 'tblYtFaj6UYMUEwFQ';
const APP_ORIGIN    = 'https://app.transformedbytravels.com';

const args   = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const jsonPath = args.find(a => a.endsWith('.json'));
if (!jsonPath) {
  console.error('Usage: node scripts/add-top100.js <json> [--dry-run]');
  process.exit(1);
}
const apiKey = (process.env.AIRTABLE_API_KEY || '').trim().replace(/[\r\n\t]/g, '');
if (!apiKey) { console.error('AIRTABLE_API_KEY env var required'); process.exit(1); }
if (!/^pat[A-Za-z0-9]+\.[A-Za-z0-9]+$/.test(apiKey)) {
  console.error('AIRTABLE_API_KEY doesn\'t look like a valid PAT (should be pat...dots and alphanumerics). Got length ' + apiKey.length);
  process.exit(1);
}

const animals = JSON.parse(fs.readFileSync(path.resolve(jsonPath), 'utf8'));
console.log(`Loaded ${animals.length} animals from ${jsonPath}${dryRun ? ' (DRY RUN)' : ''}`);

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

function post(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...headers },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { reject(new Error('parse: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function airtableReq(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const headers = { 'Authorization': 'Bearer ' + apiKey };
    if (bodyStr) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }
    const req = https.request({
      hostname: 'api.airtable.com', path: urlPath, method, headers,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { reject(new Error('parse: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function findExistingByName(name) {
  const safe = name.replace(/"/g, '\\"');
  const filter = encodeURIComponent(`LOWER({Species Name})=LOWER("${safe}")`);
  const p = `/v0/${BASE_ID}/${encodeURIComponent(SPECIES_TABLE)}?filterByFormula=${filter}&maxRecords=1`;
  const r = await airtableReq('GET', p);
  if (r.body.error) throw new Error(r.body.error.message || JSON.stringify(r.body.error));
  return (r.body.records || [])[0] || null;
}

async function airtableCreate(fields) {
  const p = `/v0/${BASE_ID}/${encodeURIComponent(SPECIES_TABLE)}`;
  const r = await airtableReq('POST', p, { fields, typecast: true });
  if (r.body.error) throw new Error(r.body.error.message || JSON.stringify(r.body.error));
  return r.body.id;
}

async function airtableUpdate(id, fields) {
  const p = `/v0/${BASE_ID}/${encodeURIComponent(SPECIES_TABLE)}/${id}`;
  const r = await airtableReq('PATCH', p, { fields, typecast: true });
  if (r.body.error) throw new Error(r.body.error.message || JSON.stringify(r.body.error));
  return r.body.id;
}

async function enrichViaClaude(name, category) {
  try {
    const r = await post(`${APP_ORIGIN}/api/species-generate`, { name, type: 'Animal', category });
    return r.body && !r.body.error ? r.body : null;
  } catch(e) {
    console.warn(`  [claude fail] ${name}: ${e.message}`);
    return null;
  }
}

async function fetchInatPhoto(name) {
  try {
    const q = encodeURIComponent(name);
    const d = await get(`https://api.inaturalist.org/v1/taxa?q=${q}&per_page=1`);
    const t = (d.results || [])[0];
    if (!t) return null;
    const photo = t.default_photo || {};
    return { url: photo.medium_url || photo.url || null, taxonId: t.id };
  } catch(e) { return null; }
}

async function run() {
  const results = { created: 0, merged: 0, unchanged: 0, failed: 0, errors: [] };

  for (let i = 0; i < animals.length; i++) {
    const a = animals[i];
    console.log(`[${i + 1}/${animals.length}] ${a.name}`);
    try {
      const existing = await findExistingByName(a.name);
      if (existing) {
        const ef = existing.fields || {};
        const patchFields = {};
        // Only set fields that are currently empty — never overwrite
        if (!ef['Type']     && a.type)     patchFields['Type']     = a.type;
        if (!ef['Category'] && a.category) patchFields['Category'] = a.category;
        if (!ef['Fun Fact'] && a.hook)     patchFields['Fun Fact'] = a.hook;
        if (Object.keys(patchFields).length === 0) {
          console.log(`  = exists, already populated (${existing.id})`);
          results.unchanged++;
        } else {
          if (dryRun) {
            console.log(`  ↻ WOULD merge into ${existing.id}: ${Object.keys(patchFields).join(', ')}`);
          } else {
            await airtableUpdate(existing.id, patchFields);
            console.log(`  ↻ merged (${Object.keys(patchFields).join(', ')})`);
          }
          results.merged++;
        }
        await new Promise(r => setTimeout(r, 400));
        continue;
      }

      // New — enrich + create
      if (dryRun) {
        console.log(`  ✚ WOULD CREATE ${a.name} (${a.type}, ${a.category})`);
        results.created++;
        continue;
      }
      const [claude, inat] = await Promise.all([
        enrichViaClaude(a.name, a.category),
        fetchInatPhoto(a.name),
      ]);
      const fields = {
        'Species Name': a.name,
        'Type':         a.type,
        'Category':     a.category,
        'Fun Fact':     a.hook || '',
      };
      if (claude) {
        if (claude.scientificName)     fields['Scientific Name']    = claude.scientificName;
        if (claude.description)        fields['Description']        = claude.description;
        if (claude.habitat)            fields['Habitat']            = claude.habitat;
        if (claude.conservationStatus) fields['Conservation Status'] = claude.conservationStatus;
        if (Array.isArray(claude.bestMonths) && claude.bestMonths.length) fields['Best Months'] = claude.bestMonths;
      }
      if (inat && inat.url)     fields['Photo URL']      = inat.url;
      if (inat && inat.taxonId) fields['iNaturalist ID'] = String(inat.taxonId);

      const id = await airtableCreate(fields);
      console.log(`  ✚ created ${id}`);
      results.created++;
      await new Promise(r => setTimeout(r, 2000));
    } catch(e) {
      console.warn(`  ✗ ${e.message}`);
      results.failed++;
      results.errors.push({ name: a.name, error: e.message });
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Created:   ${results.created}`);
  console.log(`Merged:    ${results.merged} (fields added to existing)`);
  console.log(`Unchanged: ${results.unchanged}`);
  console.log(`Failed:    ${results.failed}`);
  if (results.errors.length) {
    console.log('\nErrors:');
    results.errors.forEach(e => console.log(`  ${e.name}: ${e.error}`));
  }
  if (dryRun) console.log('\n=== DRY RUN — no changes made. Re-run without --dry-run to apply. ===');
}

run().catch(e => { console.error(e); process.exit(1); });
