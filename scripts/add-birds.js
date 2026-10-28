#!/usr/bin/env node
// Batch-insert curated bird species into the Airtable Species table.
//
// Usage:
//   AIRTABLE_API_KEY=... ANTHROPIC_API_KEY=... node scripts/add-birds.js scripts/birds-gorilla-countries.json
//
// For each species in the JSON:
//   1. Calls production /api/species-generate to get sciName, description,
//      habitat, conservation status, best months from Claude
//   2. Fetches a photo URL from the iNaturalist API
//   3. POSTs to the Species table with typecast:true so multi-select fields
//      auto-create options if missing
//
// Rate limits it with a 2-second delay per species to be gentle on APIs.

const fs   = require('fs');
const path = require('path');
const https = require('https');

const BASE_ID       = 'appdlxcWb45dIqNK2';
const SPECIES_TABLE = 'tblYtFaj6UYMUEwFQ'; // TBT Wildlife
const APP_ORIGIN    = 'https://app.transformedbytravels.com';

const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error('Usage: node scripts/add-birds.js <path-to-json>');
  process.exit(1);
}
const apiKey = process.env.AIRTABLE_API_KEY;
if (!apiKey) {
  console.error('AIRTABLE_API_KEY env var required');
  process.exit(1);
}

const species = JSON.parse(fs.readFileSync(path.resolve(jsonPath), 'utf8'));
console.log(`Loaded ${species.length} species from ${jsonPath}`);

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
      hostname: u.hostname,
      path:     u.pathname + u.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...headers,
      },
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

async function enrichViaClaude(name, category) {
  try {
    const r = await post(`${APP_ORIGIN}/api/species-generate`, {
      name, type: 'Bird', category,
    });
    return r.body && !r.body.error ? r.body : null;
  } catch(e) {
    console.warn(`  [claude fail] ${name}: ${e.message}`);
    return null;
  }
}

async function fetchInatPhoto(name) {
  try {
    const q = encodeURIComponent(name);
    const d = await get(`https://api.inaturalist.org/v1/taxa?q=${q}&rank=species&per_page=1`);
    const t = (d.results || [])[0];
    if (!t) return null;
    const photo = t.default_photo || {};
    return { url: photo.medium_url || photo.url || null, taxonId: t.id };
  } catch(e) {
    console.warn(`  [inat fail] ${name}: ${e.message}`);
    return null;
  }
}

function airtableGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { 'Authorization': 'Bearer ' + apiKey },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { reject(new Error('parse: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function airtablePatch(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'PATCH',
      headers: {
        'Authorization':  'Bearer ' + apiKey,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
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

async function findExistingByName(name) {
  const safe = name.replace(/"/g, '\\"');
  const filter = encodeURIComponent(`LOWER({Species Name})=LOWER("${safe}")`);
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(SPECIES_TABLE)}?filterByFormula=${filter}&maxRecords=1`;
  const r = await airtableGet(url);
  if (r.body.error) throw new Error(r.body.error.message || JSON.stringify(r.body.error));
  return (r.body.records || [])[0] || null;
}

async function airtablePost(fields) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(SPECIES_TABLE)}`;
  const r = await post(url, { fields, typecast: true }, {
    'Authorization': 'Bearer ' + apiKey,
  });
  if (r.body.error) throw new Error(r.body.error.message || JSON.stringify(r.body.error));
  return r.body.id;
}

async function airtablePatchRecord(id, fields) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(SPECIES_TABLE)}/${id}`;
  const r = await airtablePatch(url, { fields, typecast: true });
  if (r.body.error) throw new Error(r.body.error.message || JSON.stringify(r.body.error));
  return r.body.id;
}

function mergeBestParks(existing, newParks) {
  const existingArr = Array.isArray(existing)
    ? existing
    : (typeof existing === 'string' && existing ? existing.split(',').map(s => s.trim()) : []);
  const set = new Set([...existingArr, ...(newParks || [])].map(p => p.trim()).filter(Boolean));
  return [...set];
}

async function run() {
  const results = { created: 0, merged: 0, failed: 0, errors: [] };
  for (let i = 0; i < species.length; i++) {
    const s = species[i];
    console.log(`[${i + 1}/${species.length}] ${s.name}`);
    try {
      // Dedup by Species Name (case-insensitive). If found, merge parks only.
      const existing = await findExistingByName(s.name);
      if (existing) {
        const existingParks = existing.fields['Best Parks'];
        const merged = mergeBestParks(existingParks, s.bestParks);
        // Only PATCH if parks actually changed
        const existingSet = new Set(
          Array.isArray(existingParks) ? existingParks : (existingParks || '').split(',').map(x => x.trim()).filter(Boolean)
        );
        const changed = merged.length !== existingSet.size || merged.some(p => !existingSet.has(p));
        if (changed) {
          await airtablePatchRecord(existing.id, { 'Best Parks': merged });
          console.log(`  ↻ merged parks into ${existing.id} (${existingSet.size} → ${merged.length})`);
        } else {
          console.log(`  = exists, no changes (${existing.id})`);
        }
        results.merged++;
        await new Promise(r => setTimeout(r, 500)); // shorter delay when no Claude/inat call
        continue;
      }

      // New species — enrich + create
      const [claude, inat] = await Promise.all([
        enrichViaClaude(s.name, s.category),
        fetchInatPhoto(s.name),
      ]);
      const fields = {
        'Species Name':  s.name,
        'Type':          'Bird',
        'Category':      s.category,
        'Best Parks':    s.bestParks || [],
      };
      if (claude) {
        if (claude.scientificName)     fields['Scientific Name']    = claude.scientificName;
        if (claude.description)        fields['Description']        = claude.description;
        if (claude.habitat)            fields['Habitat']            = claude.habitat;
        if (claude.conservationStatus) fields['Conservation Status'] = claude.conservationStatus;
        if (Array.isArray(claude.bestMonths) && claude.bestMonths.length) fields['Best Months'] = claude.bestMonths;
      }
      if (inat && inat.url)     fields['Photo URL']       = inat.url;
      if (inat && inat.taxonId) fields['iNaturalist ID']  = String(inat.taxonId);

      const id = await airtablePost(fields);
      console.log(`  ✓ created ${id}`);
      results.created++;
      await new Promise(r => setTimeout(r, 2000));
    } catch(e) {
      console.warn(`  ✗ ${e.message}`);
      results.failed++;
      results.errors.push({ name: s.name, error: e.message });
    }
  }
  console.log('\n=== Summary ===');
  console.log(`Created: ${results.created}`);
  console.log(`Merged:  ${results.merged} (already existed, parks merged if new)`);
  console.log(`Failed:  ${results.failed}`);
  if (results.errors.length) {
    console.log('\nErrors:');
    results.errors.forEach(e => console.log(`  ${e.name}: ${e.error}`));
  }
}

run();
