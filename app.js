/* ── State ── */
let sbClient;
let allGrants = [];
let currentUserEmail = null;
let likedIds = new Set();
let favoritesById = new Map();
let projects = [];
let mapFilterRegion = null;

const TODAY = new Date();
const QUARTERS = ['Jan-Mar', 'Apr-Jun', 'Jul-Sep', 'Oct-Dec'];
const STATUS_OPTIONS = ['Not Started', 'Researching', 'Drafting', 'Submitted', 'Awaiting Response', 'Awarded', 'Rejected'];
const REGION_COORDS = {
  US: { lat: 39.8, lon: -98.6 },
  Europe: { lat: 54.5, lon: 15.2 },
  Asia: { lat: 34.0, lon: 100.6 },
  Japan: { lat: 36.2, lon: 138.3 },
  Armenia: { lat: 40.1, lon: 45.0 },
};

function currentQuarter() {
  return QUARTERS[Math.floor(TODAY.getMonth() / 3)];
}

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── Deadline → week-of-year parsing (best effort) ── */
const MONTH_IDX = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS_IN_MONTH = [31,28,31,30,31,30,31,31,30,31,30,31];

function dayOfYear(month, day) {
  let d = 0;
  for (let m = 0; m < month; m++) d += DAYS_IN_MONTH[m];
  return d + day;
}
function weekOf(doy) {
  return Math.min(52, Math.max(1, Math.ceil(doy / 7)));
}
function monthWeekRange(m) {
  const start = weekOf(dayOfYear(m, 1));
  const end = weekOf(dayOfYear(m, DAYS_IN_MONTH[m]));
  return [start, end];
}

const QUARTER_WEEKS = { 'Jan-Mar': [1, 13], 'Apr-Jun': [14, 26], 'Jul-Sep': [27, 39], 'Oct-Dec': [40, 52] };

function parseDeadlineWeeks(grant) {
  const text = (grant.deadline || '').toLowerCase();
  const monthMatch = text.match(/jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/);
  if (monthMatch) {
    const month = MONTH_IDX[monthMatch[0]];
    const dayMatch = text.match(/\b([1-9]|[12]\d|3[01])\b/);
    let day;
    if (dayMatch) day = parseInt(dayMatch[1], 10);
    else if (/early/.test(text)) day = 5;
    else if (/late/.test(text)) day = 25;
    else day = 15;
    day = Math.min(day, DAYS_IN_MONTH[month]);
    const wk = weekOf(dayOfYear(month, day));
    return { start: wk, end: wk, exact: true, rolling: false };
  }
  if (QUARTER_WEEKS[grant.timeline]) {
    const [s, e] = QUARTER_WEEKS[grant.timeline];
    return { start: s, end: e, exact: false, rolling: false };
  }
  return { start: 1, end: 52, exact: false, rolling: true };
}

function currentWeek() {
  return weekOf(dayOfYear(TODAY.getMonth(), TODAY.getDate()));
}

/* ── Boot ── */
window.addEventListener('load', () => {
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
    console.error('Supabase config not loaded. Check supabase-config.js');
    return;
  }
  sbClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  checkSavedLogin();
});

function checkSavedLogin() {
  const saved = localStorage.getItem('filmGrantsEmail');
  if (saved) {
    currentUserEmail = saved;
    showApp();
  } else {
    document.getElementById('authGate').style.display = 'flex';
  }
}

async function onSignIn() {
  const email = document.getElementById('authEmail').value.trim();
  const btn = document.getElementById('authSubmit');
  const status = document.getElementById('authStatus');

  if (!email) {
    status.textContent = 'Please enter an email.';
    status.className = 'auth-status error';
    return;
  }

  btn.disabled = true;
  status.className = 'auth-status';
  status.textContent = 'Checking access...';

  try {
    const { data: allowed, error } = await sbClient
      .from('allowed_emails')
      .select('email')
      .eq('email', email)
      .maybeSingle();

    if (error) throw error;

    if (!allowed) {
      status.textContent = `${email} is not on the access list. Contact the admin to be added.`;
      status.className = 'auth-status error';
      btn.disabled = false;
      return;
    }

    currentUserEmail = email;
    localStorage.setItem('filmGrantsEmail', email);
    document.getElementById('authEmail').value = '';
    showApp();
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    status.className = 'auth-status error';
    btn.disabled = false;
  }
}

function showApp() {
  document.getElementById('authGate').style.display = 'none';
  document.getElementById('appRoot').style.display = 'flex';
  document.getElementById('sidebarUser').textContent = currentUserEmail;
  loadGrants();
  loadFavorites();
  loadProjects();
  renderAll();
}

/* ── Auth form ── */
document.getElementById('authForm').addEventListener('submit', (e) => {
  e.preventDefault();
  onSignIn();
});

document.getElementById('signOutBtn').addEventListener('click', () => {
  localStorage.removeItem('filmGrantsEmail');
  currentUserEmail = null;
  document.getElementById('appRoot').style.display = 'none';
  document.getElementById('authGate').style.display = 'flex';
  document.getElementById('authEmail').value = '';
  document.getElementById('authStatus').textContent = '';
});

/* ── Data loading ── */
async function loadGrants() {
  allGrants = await fetch('grants-data.json').then(r => r.json());
  renderAll();
}

async function loadFavorites() {
  const { data, error } = await sbClient
    .from('favorites')
    .select('*')
    .eq('user_id', currentUserEmail);
  if (error) { console.error(error); return; }
  favoritesById = new Map((data || []).map(f => [f.grant_id, f]));
  likedIds = new Set(favoritesById.keys());
}

async function loadProjects() {
  const { data, error } = await sbClient
    .from('projects')
    .select('*')
    .eq('user_id', currentUserEmail)
    .order('created_at', { ascending: true });
  if (error) { console.error(error); return; }
  projects = data || [];
}

function updateSidebarMeta() {
  document.getElementById('sidebarMeta').textContent =
    `${allGrants.length} grants tracked · ${likedIds.size} liked`;
}

/* ── Favorites ── */
async function toggleLike(grant) {
  if (likedIds.has(grant.id)) {
    const row = favoritesById.get(grant.id);
    await sbClient.from('favorites').delete().eq('id', row.id);
    favoritesById.delete(grant.id);
    likedIds.delete(grant.id);
  } else {
    const { data, error } = await sbClient
      .from('favorites')
      .insert({ user_id: currentUserEmail, grant_id: grant.id, grant_name: grant.name })
      .select()
      .single();
    if (error) { console.error(error); return; }
    favoritesById.set(grant.id, data);
    likedIds.add(grant.id);
  }
  renderAll();
}

async function addGrantToProject(projectId, grant) {
  if (likedIds.has(grant.id)) {
    const row = favoritesById.get(grant.id);
    await sbClient.from('favorites').update({ project_id: projectId }).eq('id', row.id);
  } else {
    const { data, error } = await sbClient
      .from('favorites')
      .insert({ user_id: currentUserEmail, grant_id: grant.id, grant_name: grant.name, project_id: projectId })
      .select()
      .single();
    if (error) { console.error(error); return; }
    favoritesById.set(grant.id, data);
    likedIds.add(grant.id);
  }
  await loadFavorites();
  renderAll();
}

async function updateFavoriteStatus(favId, status) {
  await sbClient.from('favorites').update({ status }).eq('id', favId);
  await loadFavorites();
  renderAccount();
}

function likeBtnHtml(id) {
  const liked = likedIds.has(id);
  return `<button class="like-btn ${liked ? 'liked' : ''}" data-id="${id}" title="${liked ? 'Unlike' : 'Like'}">${liked ? '♥' : '♡'}</button>`;
}

function bindLikeButtons(root) {
  root.querySelectorAll('.like-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const grant = allGrants.find(g => g.id === btn.dataset.id);
      if (grant) toggleLike(grant);
    });
  });
}

/* ── Shared filter logic ── */
function applyFilters(grants, { region, timeline, type, search, likedOnly }) {
  return grants.filter(g => {
    if (region && g.region !== region) return false;
    if (timeline && g.timeline !== timeline) return false;
    if (type && !(g.projectType || []).includes(type)) return false;
    if (likedOnly && !likedIds.has(g.id)) return false;
    if (search) {
      const hay = [g.name, g.requirements, g.strategy, g.amount].join(' ').toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });
}

function confBadge(c) {
  const key = (c || '').toLowerCase();
  if (key === 'high') return '<span class="conf-badge conf-high">verified</span>';
  if (key === 'medium') return '<span class="conf-badge conf-medium">partially verified</span>';
  return '<span class="conf-badge conf-low">unconfirmed — recheck source</span>';
}

function renderAll() {
  updateSidebarMeta();
  renderHome();
  renderGrantsTable();
  renderTimelineGrid();
  renderMap();
  renderAccount();
}

/* ── Home dashboard ── */
function renderHome() {
  const wrap = document.getElementById('homeWrap');
  if (!allGrants.length) {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>Loading…</p></div>';
    return;
  }
  const cw = currentWeek();
  const openNow = allGrants.filter(g => {
    const w = parseDeadlineWeeks(g);
    return !w.rolling && w.start <= cw && cw <= w.end;
  });
  const upcoming = openNow
    .map(g => ({ g, w: parseDeadlineWeeks(g) }))
    .sort((a, b) => a.w.end - b.w.end)
    .slice(0, 6);

  wrap.innerHTML = `
    <div class="home-stats">
      <div class="stat-card"><div class="stat-num">${allGrants.length}</div><div class="stat-label">Total grants</div></div>
      <div class="stat-card stat-open"><div class="stat-num">${openNow.length}</div><div class="stat-label">Open this week</div></div>
      <div class="stat-card"><div class="stat-num">${likedIds.size}</div><div class="stat-label">Liked</div></div>
      <div class="stat-card"><div class="stat-num">${projects.length}</div><div class="stat-label">Projects</div></div>
    </div>
    <div class="home-section">
      <h2 class="account-section-title">Closing soonest</h2>
      <div class="home-urgent-list">
        ${upcoming.length ? upcoming.map(({ g }) => `
          <div class="home-urgent-item" data-id="${g.id}">
            <div>
              <div class="font-weight-500">${esc(g.name)}</div>
              <div class="timeline-item-meta">${esc(g.region)} · ${esc(g.amount)}</div>
            </div>
            ${likeBtnHtml(g.id)}
          </div>
        `).join('') : '<p style="font-size:12.5px;color:var(--text-3)">Nothing closing this week.</p>'}
      </div>
    </div>
  `;
  bindLikeButtons(wrap);
  wrap.querySelectorAll('.home-urgent-item').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.like-btn')) return;
      const grant = allGrants.find(g => g.id === row.dataset.id);
      if (grant) openGrantModal(grant);
    });
  });
}

/* ── Grants table view ── */
function renderGrantsTable() {
  const filters = {
    region: document.getElementById('grantsRegion').value,
    timeline: document.getElementById('grantsTimeline').value,
    type: document.getElementById('grantsType').value,
    search: document.getElementById('grantsSearch').value,
    likedOnly: document.getElementById('grantsLikedOnly').checked,
  };
  const rows = applyFilters(allGrants, filters);
  const wrap = document.getElementById('grantsTableWrap');

  if (!rows.length) {
    wrap.innerHTML = '<div class="empty-state"><p>No grants match your filters.</p></div>';
    return;
  }

  wrap.innerHTML = `
    <div class="curated-count">${rows.length} of ${allGrants.length} grants</div>
    <table class="data-table">
      <thead><tr>
        <th></th><th>Grant</th><th>Region</th><th>Type</th><th>Stage</th>
        <th>Amount</th><th>Deadline</th><th>Fee</th><th></th>
      </tr></thead>
      <tbody>
        ${rows.map(g => `
          <tr class="grant-row" data-id="${g.id}">
            <td>${likeBtnHtml(g.id)}</td>
            <td><div class="font-weight-500">${esc(g.name)}</div></td>
            <td><span class="tag">${esc(g.region)}</span></td>
            <td style="font-size:12px">${esc((g.projectType||[]).join(', '))}</td>
            <td style="font-size:12px">${esc((g.fundingStage||[]).join(', '))}</td>
            <td style="white-space:nowrap;font-size:12.5px">${esc(g.amount)}</td>
            <td style="font-size:12px;max-width:200px">${esc(g.deadline)}</td>
            <td style="font-size:11.5px;color:var(--text-2);max-width:160px">${esc(g.applicationFee)}</td>
            <td><a href="${g.link}" target="_blank" rel="noopener" class="link-icon" onclick="event.stopPropagation()">↗</a></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  bindLikeButtons(wrap);
  wrap.querySelectorAll('.grant-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.like-btn') || e.target.closest('a')) return;
      const grant = allGrants.find(g => g.id === row.dataset.id);
      if (grant) openGrantModal(grant);
    });
  });
}

/* ── Grant detail modal ── */
function grantCardInnerHtml(g) {
  return `
    <div class="grant-card-head">
      <div>
        <div class="grant-card-title">${esc(g.name)}</div>
        <div class="grant-card-tags">
          <span class="tag tag-light">${esc(g.region)}</span>
          ${(g.themeTags || []).map(t => `<span class="tag theme-tag">${esc(t)}</span>`).join('')}
        </div>
      </div>
      <div class="grant-card-actions">
        ${likeBtnHtml(g.id)}
        ${confBadge(g.confidence)}
      </div>
    </div>
    <div class="grant-card-grid">
      <div><span class="gc-label">Amount</span><div class="gc-value">${esc(g.amount || '—')}</div></div>
      <div><span class="gc-label">Deadline</span><div class="gc-value">${esc(g.deadline || '—')}</div></div>
      <div><span class="gc-label">Project Type</span><div class="gc-value">${esc((g.projectType||[]).join(', '))}</div></div>
      <div><span class="gc-label">Funding Stage</span><div class="gc-value">${esc((g.fundingStage||[]).join(', '))}</div></div>
      <div><span class="gc-label">Application Fee</span><div class="gc-value">${esc(g.applicationFee || '—')}</div></div>
    </div>
    <div class="gc-section"><span class="gc-label">Requirements</span><p>${esc(g.requirements || '—')}</p></div>
    <div class="gc-section"><span class="gc-label">Previous Winners</span><p>${esc(g.previousWinners || 'Not publicly listed')}</p></div>
    <div class="gc-section gc-strategy"><span class="gc-label">Strategy &amp; Tendency</span><p>${esc(g.strategy || '—')}</p></div>
    <a href="${g.link}" target="_blank" rel="noopener" class="gc-link">Official page ↗</a>
  `;
}

function openGrantModal(grant) {
  const content = document.getElementById('grantModalContent');
  content.innerHTML = `<button class="modal-close" id="modalCloseBtn">✕</button>` + grantCardInnerHtml(grant);
  bindLikeButtons(content);
  document.getElementById('modalCloseBtn').addEventListener('click', closeGrantModal);
  const overlay = document.getElementById('grantModalOverlay');
  overlay.classList.add('open');
}

function closeGrantModal() {
  document.getElementById('grantModalOverlay').classList.remove('open');
}

document.getElementById('grantModalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'grantModalOverlay') closeGrantModal();
});

/* ── Timeline grid view ── */
function renderTimelineGrid() {
  const wrap = document.getElementById('timelineWrap');
  if (!allGrants.length) {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>Loading…</p></div>';
    return;
  }
  const cw = currentWeek();
  const monthHeaders = MONTH_NAMES.map((name, i) => {
    const [s, e] = monthWeekRange(i);
    return { name, span: Math.max(1, e - s + 1) };
  });

  const rows = allGrants.map(g => {
    const w = parseDeadlineWeeks(g);
    let cells = '';
    for (let wk = 1; wk <= 52; wk++) {
      const active = !w.rolling && wk >= w.start && wk <= w.end;
      const isToday = wk === cw;
      cells += `<td class="wk-cell ${active ? 'wk-active' : ''} ${isToday ? 'wk-today' : ''}"></td>`;
    }
    return `
      <tr class="tl-row" data-id="${g.id}">
        <td class="tl-name-cell">
          <div class="tl-name-inner">
            ${likeBtnHtml(g.id)}
            <span>${esc(g.name)}</span>
            ${w.rolling ? '<span class="tl-rolling-tag">Rolling</span>' : ''}
          </div>
        </td>
        ${cells}
      </tr>
    `;
  }).join('');

  wrap.innerHTML = `
    <div class="timeline-today">Today: ${TODAY.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} — week ${cw} of 52</div>
    <div class="tl-grid-scroll">
      <table class="tl-grid">
        <thead>
          <tr>
            <th class="tl-name-cell tl-name-head"></th>
            ${monthHeaders.map(m => `<th colspan="${m.span}" class="tl-month-head">${m.name}</th>`).join('')}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
  bindLikeButtons(wrap);
  wrap.querySelectorAll('.tl-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.like-btn')) return;
      const grant = allGrants.find(g => g.id === row.dataset.id);
      if (grant) openGrantModal(grant);
    });
  });
}

/* ── Map view ── */
function renderMap() {
  const wrap = document.getElementById('mapWrap');
  if (!allGrants.length) {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>Loading…</p></div>';
    return;
  }
  const counts = {};
  allGrants.forEach(g => { counts[g.region] = (counts[g.region] || 0) + 1; });

  const pins = Object.keys(REGION_COORDS).map(region => {
    const { lat, lon } = REGION_COORDS[region];
    const x = ((lon + 180) / 360) * 100;
    const y = ((90 - lat) / 180) * 100;
    const isActive = mapFilterRegion === region;
    return `
      <button class="map-pin ${isActive ? 'active' : ''}" data-region="${region}" style="left:${x}%;top:${y}%;">
        <span class="map-pin-dot"></span>
        <span class="map-pin-label">${esc(region)} <span class="map-pin-count">${counts[region] || 0}</span></span>
      </button>
    `;
  }).join('');

  const filtered = mapFilterRegion ? allGrants.filter(g => g.region === mapFilterRegion) : [];

  wrap.innerHTML = `
    <div class="map-strip">
      <div class="map-basemap">${pins}</div>
    </div>
    <div class="map-results">
      ${mapFilterRegion ? `
        <div class="curated-count">${filtered.length} grants in ${esc(mapFilterRegion)} <button class="remove-btn" id="mapClearBtn" style="font-size:11px;">clear ✕</button></div>
        <div class="favorites-list">
          ${filtered.map(g => `
            <div class="favorite-item map-result-row" data-id="${g.id}">
              <div>
                <div class="favorite-item-name">${esc(g.name)}</div>
                <div class="favorite-item-meta">${esc(g.amount)} · ${esc(g.deadline)}</div>
              </div>
              ${likeBtnHtml(g.id)}
            </div>
          `).join('')}
        </div>
      ` : '<p style="font-size:12.5px;color:var(--text-3)">Click a pin above to see grants in that region.</p>'}
    </div>
  `;
  bindLikeButtons(wrap);
  wrap.querySelectorAll('.map-pin').forEach(btn => {
    btn.addEventListener('click', () => {
      mapFilterRegion = mapFilterRegion === btn.dataset.region ? null : btn.dataset.region;
      renderMap();
    });
  });
  const clearBtn = document.getElementById('mapClearBtn');
  if (clearBtn) clearBtn.addEventListener('click', (e) => { e.stopPropagation(); mapFilterRegion = null; renderMap(); });
  wrap.querySelectorAll('.map-result-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.like-btn')) return;
      const grant = allGrants.find(g => g.id === row.dataset.id);
      if (grant) openGrantModal(grant);
    });
  });
}

/* ── My Page (projects + favorites) ── */
let expandedProjectId = null;
let projectPickerOpenFor = null;

function renderAccount() {
  const projWrap = document.getElementById('projectsList');
  projWrap.innerHTML = projects.length
    ? projects.map(p => {
        const attached = [...favoritesById.values()].filter(f => f.project_id === p.id);
        const expanded = expandedProjectId === p.id;
        return `
        <div class="project-item-block">
          <div class="project-item" data-project-id="${p.id}">
            <div>
              <div class="project-item-name">${esc(p.name)}</div>
              <div class="project-item-meta">${[p.format, p.stage, p.location].filter(Boolean).map(esc).join(' · ')} · ${attached.length} grant${attached.length === 1 ? '' : 's'}</div>
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
              <button class="signout-btn expand-project-btn" style="width:auto;padding:4px 10px;" data-project-id="${p.id}">${expanded ? 'Hide' : 'Manage'}</button>
              <button class="remove-btn" data-project-id="${p.id}" title="Delete project">✕</button>
            </div>
          </div>
          ${expanded ? `
            <div class="project-detail">
              ${attached.map(f => {
                const grant = allGrants.find(g => g.id === f.grant_id);
                return `
                  <div class="favorite-item">
                    <div>
                      <div class="favorite-item-name">${esc(f.grant_name)}</div>
                      <div class="favorite-item-meta">${grant ? esc(grant.region + ' · ' + grant.amount) : ''}</div>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                      <select class="status-select" data-fav-id="${f.id}">
                        ${STATUS_OPTIONS.map(s => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                      </select>
                      <button class="remove-btn" data-grant-id="${f.grant_id}" title="Remove from project">✕</button>
                    </div>
                  </div>
                `;
              }).join('') || '<p style="font-size:12px;color:var(--text-3)">No grants attached yet.</p>'}
              <div class="add-grant-row">
                <input type="text" class="search-input add-grant-search" data-project-id="${p.id}" placeholder="Search grants to add…">
                <div class="add-grant-results" data-project-id="${p.id}"></div>
              </div>
            </div>
          ` : ''}
        </div>
      `;
      }).join('')
    : '<p style="font-size:12.5px;color:var(--text-3)">No projects yet — create one to organize your favorited grants.</p>';

  projWrap.querySelectorAll('.expand-project-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      expandedProjectId = expandedProjectId === btn.dataset.projectId ? null : btn.dataset.projectId;
      renderAccount();
    });
  });

  projWrap.querySelectorAll('.remove-btn[data-project-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await sbClient.from('projects').delete().eq('id', btn.dataset.projectId);
      await loadProjects();
      await loadFavorites();
      renderAll();
    });
  });

  projWrap.querySelectorAll('.remove-btn[data-grant-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const grant = allGrants.find(g => g.id === btn.dataset.grantId);
      if (grant) await toggleLike(grant);
    });
  });

  projWrap.querySelectorAll('.status-select').forEach(sel => {
    sel.addEventListener('change', () => updateFavoriteStatus(sel.dataset.favId, sel.value));
  });

  projWrap.querySelectorAll('.add-grant-search').forEach(input => {
    input.addEventListener('input', () => {
      const projectId = input.dataset.projectId;
      const term = input.value.trim().toLowerCase();
      const resultsEl = projWrap.querySelector(`.add-grant-results[data-project-id="${projectId}"]`);
      if (!term) { resultsEl.innerHTML = ''; return; }
      const matches = allGrants.filter(g => g.name.toLowerCase().includes(term)).slice(0, 6);
      resultsEl.innerHTML = matches.map(g => `
        <button class="add-grant-result-btn" data-project-id="${projectId}" data-grant-id="${g.id}">${esc(g.name)}</button>
      `).join('') || '<div class="timeline-empty">No matches</div>';
      resultsEl.querySelectorAll('.add-grant-result-btn').forEach(b => {
        b.addEventListener('click', async () => {
          const grant = allGrants.find(g => g.id === b.dataset.grantId);
          if (grant) await addGrantToProject(b.dataset.projectId, grant);
          input.value = '';
          resultsEl.innerHTML = '';
        });
      });
    });
  });

  const favWrap = document.getElementById('favoritesList');
  const favs = [...favoritesById.values()];
  favWrap.innerHTML = favs.length
    ? favs.map(f => {
        const grant = allGrants.find(g => g.id === f.grant_id);
        return `
          <div class="favorite-item">
            <div>
              <div class="favorite-item-name">${esc(f.grant_name)}</div>
              <div class="favorite-item-meta">${grant ? esc(grant.region + ' · ' + grant.amount) : ''} · ${esc(f.status || 'Not Started')}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <select class="fav-project-select" data-fav-id="${f.id}">
                <option value="">No project</option>
                ${projects.map(p => `<option value="${p.id}" ${f.project_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
              </select>
              <button class="remove-btn" data-grant-id="${f.grant_id}" title="Remove favorite">✕</button>
            </div>
          </div>
        `;
      }).join('')
    : '<p style="font-size:12.5px;color:var(--text-3)">No favorites yet — click ♡ on any grant to save it here.</p>';

  favWrap.querySelectorAll('.fav-project-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      await sbClient.from('favorites').update({ project_id: sel.value || null }).eq('id', sel.dataset.favId);
      await loadFavorites();
      renderAccount();
    });
  });

  favWrap.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const grant = allGrants.find(g => g.id === btn.dataset.grantId);
      if (grant) await toggleLike(grant);
    });
  });
}

/* ── New project form ── */
document.getElementById('newProjectBtn').addEventListener('click', () => {
  document.getElementById('projectForm').style.display = 'flex';
});
document.getElementById('pfCancel').addEventListener('click', () => {
  document.getElementById('projectForm').style.display = 'none';
});
document.getElementById('pfSave').addEventListener('click', async () => {
  const name = document.getElementById('pfName').value.trim();
  if (!name) return;
  await sbClient.from('projects').insert({
    user_id: currentUserEmail,
    name,
    format: document.getElementById('pfFormat').value.trim(),
    stage: document.getElementById('pfStage').value.trim(),
    location: document.getElementById('pfLocation').value.trim(),
    notes: document.getElementById('pfNotes').value.trim(),
  });
  ['pfName','pfFormat','pfStage','pfLocation','pfNotes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('projectForm').style.display = 'none';
  await loadProjects();
  renderAccount();
});

/* ── Nav with fade transition ── */
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('active')) return;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b === btn));
    const current = document.querySelector('.view-pane.active');
    const next = document.getElementById(`view-${btn.dataset.view}`);
    if (current === next) return;
    if (current) current.classList.add('fading');
    setTimeout(() => {
      document.querySelectorAll('.view-pane').forEach(p => p.classList.remove('active', 'fading'));
      next.classList.add('active', 'fading');
      requestAnimationFrame(() => next.classList.remove('fading'));
    }, 160);
  });
});

/* ── Filter bindings ── */
['grantsRegion','grantsTimeline','grantsType'].forEach(id =>
  document.getElementById(id).addEventListener('change', renderGrantsTable));
document.getElementById('grantsSearch').addEventListener('input', renderGrantsTable);
document.getElementById('grantsLikedOnly').addEventListener('change', renderGrantsTable);
