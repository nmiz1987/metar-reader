// ─── Entry points ─────────────────────────────────────────────────────────────

document.getElementById('codeInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') go();
});

function quick(code) {
  document.getElementById('codeInput').value = code;
  go();
}

async function go() {
  const code = document.getElementById('codeInput').value.trim().toUpperCase();
  if (!code) return;

  setLoading(true);
  hide('error');
  hide('results');

  try {
    const res = await fetch(`/metar?ids=${code}`);
    if (!res.ok) throw new Error(`Server returned ${res.status} — try again shortly.`);
    const text = (await res.text()).trim();

    if (!text || text.toLowerCase().includes('no data')) {
      throw new Error(
        `No METAR found for "<strong>${code}</strong>". ` +
        `Make sure you're using a 4-letter ICAO code (e.g. KLAX, not LAX).`
      );
    }

    const raw = text.split('\n')[0].trim();
    const parsed = parseMETAR(raw);
    render(parsed, raw);
    show('results');
  } catch (err) {
    document.getElementById('error').innerHTML = `&#9888;&#65039; ${err.message}`;
    show('error');
  } finally {
    setLoading(false);
  }
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function parseMETAR(raw) {
  let src = raw.replace(/^(METAR|SPECI)\s+/, '').trim();
  const tok = src.split(/\s+/);
  let i = 0;
  const r = { raw };

  r.station = tok[i++];

  // Date/time DDHHMMZ
  if (/^\d{6}Z$/.test(tok[i])) {
    const t = tok[i++];
    r.time = { day: t.slice(0,2), hour: t.slice(2,4), min: t.slice(4,6) };
  }

  // AUTO / COR
  if (tok[i] === 'AUTO' || tok[i] === 'COR') r.modifier = tok[i++];

  // Wind: 00000KT  27015G28KT  VRB05KT  27015MPS
  const windRE = /^(VRB|\d{3})(\d{2,3})(G(\d{2,3}))?(KT|MPS)$/;
  if (windRE.test(tok[i])) {
    const m = tok[i++].match(windRE);
    r.wind = {
      dir:   m[1] === 'VRB' ? 'VRB' : parseInt(m[1]),
      speed: parseInt(m[2]),
      gust:  m[4] ? parseInt(m[4]) : null,
      unit:  m[5],
    };
    // Variable sector  270V360
    if (/^\d{3}V\d{3}$/.test(tok[i])) {
      r.wind.varFrom = parseInt(tok[i].slice(0,3));
      r.wind.varTo   = parseInt(tok[i++].slice(4));
    }
  }

  // Visibility
  if (tok[i] === 'CAVOK') {
    r.cavok = true;
    r.visibility = { miles: 10, label: 'CAVOK' };
    i++;
  } else {
    // Could be: 10SM  1/2SM  M1/4SM  1 1/2SM (two tokens)  9999 (metric)
    let vs = tok[i] || '';
    if (vs && /^\d+$/.test(vs) && /^\d+\/\d+SM$/.test(tok[i+1] || '')) {
      vs = tok[i] + ' ' + tok[i+1]; i += 2;
    } else if (/^M?\d+(\.\d+)?(\/\d+)?SM$/.test(vs) || /^\d{4}$/.test(vs) || vs === '9999') {
      i++;
    } else {
      vs = null;
    }
    if (vs) r.visibility = parseVis(vs);
  }

  // RVR — skip
  while (tok[i] && /^R\d{2}[LCR]?\//.test(tok[i])) i++;

  // Weather phenomena
  const wxRE = /^[-+]?(VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)*(DZ|RA|SN|SG|IC|PL|GR|GS|UP|FG|VA|BR|HZ|DU|FU|SA|PY|PO|SQ|FC|SS|DS|TS)+$/;
  r.weather = [];
  while (tok[i] && wxRE.test(tok[i])) r.weather.push(tok[i++]);

  // Sky conditions
  r.sky = [];
  while (tok[i]) {
    const t = tok[i];
    if (/^(CLR|SKC|NSC|NCD)$/.test(t)) {
      r.sky.push({ cover: t }); i++;
    } else if (/^(FEW|SCT|BKN|OVC|VV)\d{3}(CB|TCU)?$/.test(t)) {
      const m = t.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?$/);
      r.sky.push({ cover: m[1], height: parseInt(m[2]) * 100, mod: m[3] || null }); i++;
    } else break;
  }

  // Temp / dewpoint  21/08  M02/M05
  if (tok[i] && /^M?\d{2}\/M?\d{2}$/.test(tok[i])) {
    const [ts, ds] = tok[i++].split('/');
    const c2n = s => (s[0]==='M' ? -1 : 1) * parseInt(s.replace('M',''));
    const tc = c2n(ts), dc = c2n(ds);
    r.temp = {
      c: tc, f: Math.round(tc * 9/5 + 32),
      dewC: dc, dewF: Math.round(dc * 9/5 + 32),
      humidity: humidity(tc, dc),
    };
  }

  // Altimeter  A3014  Q1013
  if (tok[i] && /^A\d{4}$/.test(tok[i])) {
    r.altimeter = { inHg: parseInt(tok[i++].slice(1)) / 100 };
  } else if (tok[i] && /^Q\d{4}$/.test(tok[i])) {
    const hpa = parseInt(tok[i++].slice(1));
    r.altimeter = { hPa: hpa, inHg: +(hpa * 0.02953).toFixed(2) };
  }

  return r;
}

function parseVis(s) {
  if (/^\d{4}$/.test(s) || s === '9999') {
    const m = parseInt(s); return { meters: m, miles: +(m / 1609.34).toFixed(1) };
  }
  const lt = s.startsWith('M');
  const clean = s.replace('M','').replace('SM','').trim();
  let miles;
  if (clean.includes(' ')) {
    const [w, f] = clean.split(' '), [n,d] = f.split('/');
    miles = parseInt(w) + parseInt(n)/parseInt(d);
  } else if (clean.includes('/')) {
    const [n,d] = clean.split('/'); miles = parseInt(n)/parseInt(d);
  } else {
    miles = parseFloat(clean);
  }
  return { miles, lessThan: lt };
}

// Relative humidity via Magnus formula approximation
function humidity(tc, dc) {
  return Math.min(100, Math.max(0,
    Math.round(100 * Math.exp(17.625*dc/(243.04+dc)) / Math.exp(17.625*tc/(243.04+tc)))
  ));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const COMPASS_16 = [
  'North','North-Northeast','Northeast','East-Northeast',
  'East','East-Southeast','Southeast','South-Southeast',
  'South','South-Southwest','Southwest','West-Southwest',
  'West','West-Northwest','Northwest','North-Northwest'
];
function deg2compass(d) { return COMPASS_16[Math.round(d / 22.5) % 16]; }
function kt2mph(kt) { return Math.round(kt * 1.15078); }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function windArrow(dir) {
  if (dir === 'VRB' || dir === 0) return '';
  // Arrow points the direction wind is COMING FROM
  return `<span class="wind-arrow" style="display:inline-block;transform:rotate(${dir}deg)">&#8593;</span>`;
}

// Sky cloud coverage rank
const COVER_RANK = { CLR:0, SKC:0, NSC:0, NCD:0, FEW:1, SCT:2, BKN:3, OVC:4, VV:4 };
function worstLayer(sky) {
  return sky.reduce((a,b) => (COVER_RANK[b.cover]||0) > (COVER_RANK[a.cover]||0) ? b : a);
}

function skyEmoji(sky, weather) {
  const hasTStorm = weather && weather.some(w => w.includes('TS'));
  const hasRain   = weather && weather.some(w => /RA|DZ/.test(w));
  const hasSnow   = weather && weather.some(w => /SN|SG|PL/.test(w));
  if (hasTStorm) return '&#9928;';
  if (hasSnow) return '&#127784;';
  if (hasRain) return '&#127783;';
  if (!sky || sky.length === 0) return '&#9728;';
  const w = worstLayer(sky);
  if (['CLR','SKC','NSC','NCD'].includes(w.cover)) return '&#9728;';
  if (w.cover === 'FEW') return '&#127780;';
  if (w.cover === 'SCT') return '&#9925;';
  if (w.cover === 'BKN') return '&#127745;';
  return '&#9729;';
}

const COVER_WORDS = {
  CLR:'Clear skies', SKC:'Clear skies', NSC:'Clear skies', NCD:'Clear skies',
  FEW:'A few clouds', SCT:'Partly cloudy', BKN:'Mostly cloudy', OVC:'Overcast', VV:'Sky obscured',
};

function describeSky(sky) {
  if (!sky || sky.length === 0) return 'Sky conditions not reported';
  return sky.map(s => {
    let t = COVER_WORDS[s.cover] || s.cover;
    if (s.height != null) t += ` at ${s.height.toLocaleString()} ft`;
    if (s.mod === 'CB')  t += ' — thunderstorm clouds (cumulonimbus)';
    if (s.mod === 'TCU') t += ' — developing storm towers (towering cumulus)';
    return t;
  }).join('; ');
}

function visQuality(vis) {
  const m = vis.miles;
  if (m >= 10) return 'Excellent';
  if (m >= 5)  return 'Good';
  if (m >= 3)  return 'Moderate';
  if (m >= 1)  return 'Reduced';
  return 'Very poor';
}

function describeWx(codes) {
  if (!codes || codes.length === 0) return null;
  const PHEN = {
    DZ:'drizzle', RA:'rain', SN:'snow', SG:'snow grains', IC:'ice crystals',
    PL:'ice pellets', GR:'hail', GS:'small hail', UP:'unknown precipitation',
    FG:'fog', VA:'volcanic ash', BR:'mist', HZ:'haze', DU:'dust',
    FU:'smoke', SA:'sand', PY:'spray', PO:'dust whirls', SQ:'squall',
    FC:'funnel cloud / tornado', SS:'sandstorm', DS:'dust storm', TS:'thunderstorm',
  };
  const DESC = {
    MI:'shallow', PR:'partial', BC:'patchy', DR:'drifting',
    BL:'blowing', SH:'shower', FZ:'freezing', TS:'thunderstorm with',
  };

  return codes.map(code => {
    let s = code, pfx = '', vc = '';
    if (s[0]==='-') { pfx='Light '; s=s.slice(1); }
    else if (s[0]==='+') { pfx='Heavy '; s=s.slice(1); }
    if (s.startsWith('VC')) { vc=' in the vicinity'; s=s.slice(2); }

    let dsc = '';
    for (const [k,v] of Object.entries(DESC)) {
      if (s.startsWith(k)) { dsc=v+' '; s=s.slice(k.length); break; }
    }

    const parts = [];
    while (s.length) {
      let hit = false;
      for (const [k,v] of Object.entries(PHEN)) {
        if (s.startsWith(k)) { parts.push(v); s=s.slice(k.length); hit=true; break; }
      }
      if (!hit) break;
    }
    return pfx + dsc + parts.join(' with ') + vc;
  }).join(', ');
}

// ─── Summary sentence ─────────────────────────────────────────────────────────

function buildSummary(r) {
  const parts = [];

  // Condition
  const wx = describeWx(r.weather);
  if (wx) {
    parts.push(cap(wx));
  } else if (r.sky && r.sky.length > 0) {
    const w = worstLayer(r.sky);
    const sky2short = { CLR:'Clear skies', SKC:'Clear skies', NSC:'Clear skies', NCD:'Clear skies',
                        FEW:'Mostly clear', SCT:'Partly cloudy', BKN:'Mostly cloudy', OVC:'Overcast', VV:'Obscured skies' };
    parts.push(sky2short[w.cover] || 'Cloudy');
  } else if (r.cavok) {
    parts.push('Clear skies and excellent visibility (CAVOK)');
  }

  // Temperature
  if (r.temp) parts.push(`${r.temp.f}°F (${r.temp.c}°C)`);

  // Wind
  if (r.wind) {
    const spd = kt2mph(r.wind.speed);
    if (spd === 0) {
      parts.push('calm winds');
    } else {
      const dir = r.wind.dir === 'VRB' ? 'variable' : deg2compass(r.wind.dir).toLowerCase();
      let w = `${dir} winds at ${spd} mph`;
      if (r.wind.gust) w += `, gusting to ${kt2mph(r.wind.gust)} mph`;
      parts.push(w);
    }
  }

  // Visibility (only mention if not excellent)
  if (r.visibility && !r.cavok) {
    const q = visQuality(r.visibility);
    if (q !== 'Excellent') {
      const dist = r.visibility.meters
        ? `${r.visibility.meters}m`
        : `${r.visibility.miles} mi`;
      parts.push(`${q.toLowerCase()} visibility (${dist})`);
    } else {
      parts.push('excellent visibility (10+ miles)');
    }
  }

  return parts.join(', ') + '.';
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render(r, rawMetar) {
  const el = document.getElementById('results');
  const wx = describeWx(r.weather);
  const hasCB = r.sky && r.sky.some(s => s.mod === 'CB');

  // Time string
  let timeStr = '';
  if (r.time) {
    const now = new Date();
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    timeStr = `Observation: ${months[now.getUTCMonth()]} ${r.time.day} at ${r.time.hour}:${r.time.min} UTC`;
  }

  let html = `
    <div class="raw-metar">
      <div class="raw-metar-label">Raw METAR</div>
      ${escHtml(rawMetar)}
    </div>

    <div class="summary-card">
      <div class="summary-top">
        <div class="summary-icon">${skyEmoji(r.sky, r.weather)}</div>
        <div>
          <div class="summary-station">${escHtml(r.station)}${r.modifier === 'AUTO' ? '<span class="badge">AUTO</span>' : ''}</div>
        </div>
      </div>
      <div class="summary-text">${escHtml(buildSummary(r))}</div>
      ${timeStr ? `<div class="summary-time">${escHtml(timeStr)}</div>` : ''}
    </div>

    <div class="cards-grid">
  `;

  // ── Temperature
  if (r.temp) {
    const fi = r.temp.f;
    let feel = '';
    if (fi >= 90 && r.temp.humidity >= 40) feel = 'Feels muggy / hot';
    else if (fi <= 32) feel = 'Freezing conditions';
    else if (fi <= 50) feel = 'Quite cold — bundle up';
    else if (fi <= 65) feel = 'Cool — light jacket recommended';
    else if (fi <= 80) feel = 'Comfortable';
    else feel = 'Warm';

    html += `
      <div class="card temp">
        <div class="card-head"><span class="card-emoji">&#127777;&#65039;</span><span class="card-label">Temperature</span></div>
        <div class="card-primary">${r.temp.f}°F</div>
        <div class="card-secondary">${r.temp.c}°C</div>
        <div class="card-detail">${feel}</div>
        <div class="card-detail">Humidity: ~${r.temp.humidity}%</div>
      </div>`;
  }

  // ── Wind
  if (r.wind !== undefined) {
    const spd = kt2mph(r.wind.speed);
    const dirLabel = r.wind.speed === 0 ? 'Calm' :
                     r.wind.dir === 'VRB' ? 'Variable' :
                     `${r.wind.dir}° (${deg2compass(r.wind.dir)})`;
    const beaufort = spd === 0 ? 'Calm' :
                     spd < 7  ? 'Light air' :
                     spd < 13 ? 'Light breeze' :
                     spd < 19 ? 'Gentle breeze' :
                     spd < 25 ? 'Moderate breeze' :
                     spd < 32 ? 'Fresh breeze' :
                     spd < 39 ? 'Strong breeze' :
                     spd < 47 ? 'Near gale' :
                     spd < 55 ? 'Gale' : 'Strong gale+';

    html += `
      <div class="card wind">
        <div class="card-head"><span class="card-emoji">&#128168;</span><span class="card-label">Wind</span></div>
        <div class="card-primary">${spd} mph ${r.wind.speed > 0 && r.wind.dir !== 'VRB' ? windArrow(r.wind.dir) : ''}</div>
        <div class="card-secondary">${dirLabel} &middot; ${r.wind.speed} kt</div>
        <div class="card-detail">${beaufort}</div>
        ${r.wind.gust ? `<div class="card-detail">&#9889; Gusts to ${kt2mph(r.wind.gust)} mph</div>` : ''}
        ${r.wind.varFrom != null ? `<div class="card-detail">Variable: ${deg2compass(r.wind.varFrom)} &rarr; ${deg2compass(r.wind.varTo)}</div>` : ''}
      </div>`;
  }

  // ── Visibility
  if (r.visibility) {
    const dist = r.visibility.meters
      ? `${r.visibility.meters} m`
      : `${r.visibility.lessThan ? '< ' : ''}${r.visibility.miles} mi`;
    const q = visQuality(r.visibility);
    const qColor = q === 'Excellent' || q === 'Good' ? '#2e7d32' :
                   q === 'Moderate' ? '#f57f17' : '#c62828';

    html += `
      <div class="card vis">
        <div class="card-head"><span class="card-emoji">&#128065;&#65039;</span><span class="card-label">Visibility</span></div>
        <div class="card-primary">${dist}</div>
        <div class="card-secondary" style="color:${qColor};font-weight:700">${q}</div>
      </div>`;
  }

  // ── Sky conditions
  if (r.sky && r.sky.length > 0) {
    html += `
      <div class="card sky">
        <div class="card-head"><span class="card-emoji">${skyEmoji(r.sky, [])}</span><span class="card-label">Sky Conditions</span></div>
        <div class="card-detail">${describeSky(r.sky)}</div>
        ${hasCB ? `<div class="card-alert">&#9928; Thunderstorm clouds present</div>` : ''}
        ${wx ? `<div class="card-alert">&#9888;&#65039; ${cap(wx)}</div>` : ''}
      </div>`;
  } else if (wx) {
    html += `
      <div class="card sky">
        <div class="card-head"><span class="card-emoji">&#9928;</span><span class="card-label">Weather</span></div>
        <div class="card-alert">&#9888;&#65039; ${cap(wx)}</div>
      </div>`;
  }

  // ── Dewpoint
  if (r.temp) {
    const spread = r.temp.c - r.temp.dewC;
    const comfortLabel = spread <= 2  ? 'Very humid — fog or low cloud likely' :
                         spread <= 6  ? 'Humid and muggy' :
                         spread <= 12 ? 'Somewhat humid' :
                         spread <= 20 ? 'Comfortable' : 'Dry';

    html += `
      <div class="card dew">
        <div class="card-head"><span class="card-emoji">&#128167;</span><span class="card-label">Dewpoint</span></div>
        <div class="card-primary">${r.temp.dewF}°F</div>
        <div class="card-secondary">${r.temp.dewC}°C</div>
        <div class="card-detail">${comfortLabel}</div>
      </div>`;
  }

  // ── Pressure
  if (r.altimeter) {
    const p = r.altimeter.inHg;
    const trend = p >= 30.20 ? '&#8599; High pressure — fair weather expected' :
                  p >= 29.80 ? 'Normal pressure' :
                  '&#8600; Low pressure — possible storms or clouds';
    html += `
      <div class="card pres">
        <div class="card-head"><span class="card-emoji">&#128309;</span><span class="card-label">Pressure</span></div>
        <div class="card-primary">${p.toFixed(2)}"</div>
        <div class="card-secondary">inHg${r.altimeter.hPa ? ` &middot; ${r.altimeter.hPa} hPa` : ''}</div>
        <div class="card-detail">${trend}</div>
      </div>`;
  }

  html += '</div>'; // cards-grid
  el.innerHTML = html;
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}
function show(id) { document.getElementById(id).style.display = 'block'; }
function hide(id) { document.getElementById(id).style.display = 'none'; }
function setLoading(on) { document.getElementById('loading').style.display = on ? 'block' : 'none'; }
