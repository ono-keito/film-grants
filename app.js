/* ── Supabase client ── */
let supabase;
if (window.SUPABASE_URL && window.SUPABASE_ANON_KEY) {
  supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
} else {
  console.error('Supabase config not loaded. Check supabase-config.js');
}

/* ── State ── */
let allGrants = [];
let currentUser = null;
let likedIds = new Set();      // grant ids the current user has favorited
let favoritesById = new Map(); // grant id -> favorites row (id, project_id, note)
let projects = [];             // current user's projects

const TODAY = new Date();
const QUARTERS = ['Jan-Mar', 'Apr-Jun', 'Jul-Sep', 'Oct-Dec'];
function currentQuarter() {
  return QUARTERS[Math.floor(TODAY.getMonth() / 3)];
}

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── Boot ── */
init();

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    await onSignedIn(session.user);
  } else {
    document.getElementById('authGate').style.display = 'flex';
  }

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      await onSignedIn(session.user);
    } else if (event === 'SIGNED_OUT') {
      document.getElementById('appRoot').style.display = 'none';
      document.getElementById('authGate').style.display = 'flex';
      currentUser = null;
    }
  });
}

async function onSignedIn(user) {
  // Allowlist check — RLS already blocks unauthorized data access, this just
  // gives a friendly message instead of a silently empty app.
  const { data: allowed } = await supabase
    .from('allowed_emails')
    .select('email')
    .eq('email', user.email)
    .maybeSingle();

  if (!allowed) {
    document.getElementById('authStatus').textContent =
      `${user.email} isn't on the access list yet. Ask the admin to add you.`;
    document.getElementById('authStatus').className = 'auth-status error';
    await supabase.auth.signOut();
    return;
  }

  currentUser = user;
  document.getElementById('authGate').style.display = 'none';
  document.getElementById('appRoot').style.display = 'flex';
  document.getElementById('sidebarUser').textContent = user.email;

  await loadGrants();
  await loadFavorites();
  await loadProjects();
  renderAll();
}

/* ── Auth form ── */
document.getElementById('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('authEmail').value.trim();
  const btn = document.getElementById('authSubmit');
  const status = document.getElementById('authStatus');
  btn.disabled = true;
  status.className = 'auth-status';
  status.textContent = 'Sending link…';

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href }
  });

  if (error) {
    status.textContent = error.message;
    status.className = 'auth-status error';
  } else {
    status.textContent = `Check ${email} for a sign-in link.`;
    status.className = 'auth-status success';
  }
  btn.disabled = false;
});

document.getElementById('signOutBtn').addEventListener('click', () => supabase.auth.signOut());

/* ── Data loading ── */
async function loadGrants() {
  allGrants = await fetch('grants-data.json').then(r => r.json());
}

async function loadFavorites() {
  const { data, error } = await supabase
    .from('favorites')
    .select('*')
    .eq('user_id', currentUser.id);
  if (error) { console.error(error); return; }
  favoritesById = new Map((data || []).map(f => [f.grant_id, f]));
  likedIds = new Set(favoritesById.keys());
}

async function loadProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: true });
  if (error) { console.error(error); return; }
  projects = data || [];
}

function updateSidebarMeta() {
  document.getElementById('sidebarMeta').textContent =
    `${allGrants.length} grants tracked · ${likedIds.size} liked`;
}

/* ── Favorites (server-backed "Like") ── */
async function toggleLike(grant) {
  if (likedIds.has(grant.id)) {
    const row = favoritesById.get(grant.id);
    await supabase.from('favorites').delete().eq('id', row.id);
    favoritesById.delete(grant.id);
    likedIds.delete(grant.id);
  } else {
    const { data, error } = await supabase
      .from('favorites')
      .insert({ user_id: currentUser.id, grant_id: grant.id, grant_name: grant.name })
      .select()
      .single();
    if (error) { console.error(error); return; }
    favoritesById.set(grant.id, data);
    likedIds.add(grant.id);
  }
  renderAll();
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
function applyFilters(grants, { region, timeline, type, theme, search, likedOnly }) {
  return grants.filter(g => {
    if (region && g.region !== region) return false;
    if (timeline && g.timeline !== timeline) return false;
    if (type && !(g.projectType || []).includes(type)) return false;
    if (theme && !(g.themeTags || []).includes(theme)) return false;
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
  renderGrantsTable();
  renderTimeline();
  renderCurated();
  renderAccount();
}

/* ── Grants table view ── */
function renderGrantsTable() {
  const filters = {
    region: document.getElementById('grantsRegion').value,
    timeline: document.getElementById('grantsTimeline').value,
    type: document.getElementById('grantsType').value,
    theme: document.getElementById('grantsTheme').value,
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
          <tr>
            <td>${likeBtnHtml(g.id)}</td>
            <td>
              <div class="font-weight-500">${esc(g.name)}</div>
              <div class="grant-card-tags">${(g.themeTags||[]).map(t=>`<span class="tag theme-tag">${esc(t)}</span>`).join('')}</div>
            </td>
            <td><span class="tag">${esc(g.region)}</span></td>
            <td style="font-size:12px">${esc((g.projectType||[]).join(', '))}</td>
            <td style="font-size:12px">${esc((g.fundingStage||[]).join(', '))}</td>
            <td style="white-space:nowrap;font-size:12.5px">${esc(g.amount)}</td>
            <td style="font-size:12px;max-width:200px">${esc(g.deadline)}</td>
            <td style="font-size:11.5px;color:var(--text-2);max-width:160px">${esc(g.applicationFee)}</td>
            <td><a href="${g.link}" target="_blank" rel="noopener" class="link-icon">↗</a></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  bindLikeButtons(wrap);
}

/* ── Timeline view ── */
function timelineStatus(bucket) {
  if (bucket === 'Rolling/Annual') return { label: 'Rolling / check site', cls: 'tl-rolling' };
  const cq = currentQuarter();
  const qIdx = QUARTERS.indexOf(bucket);
  const curIdx = QUARTERS.indexOf(cq);
  if (qIdx === curIdx) return { label: 'Open now (this window)', cls: 'tl-open' };
  if (qIdx === (curIdx + 1) % 4) return { label: 'Opens next window', cls: 'tl-soon' };
  return { label: 'Closed for this cycle — reopens next year', cls: 'tl-closed' };
}

function renderTimeline() {
  const wrap = document.getElementById('timelineWrap');
  const cq = currentQuarter();
  const buckets = [...QUARTERS, 'Rolling/Annual'];
  const labels = { 'Jan-Mar': 'Jan – Mar', 'Apr-Jun': 'Apr – Jun', 'Jul-Sep': 'Jul – Sep', 'Oct-Dec': 'Oct – Dec', 'Rolling/Annual': 'Rolling / Annual' };

  wrap.innerHTML = `
    <div class="timeline-today">Today: ${TODAY.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} — current window: <strong>${labels[cq]}</strong></div>
    <div class="timeline-strip">
      ${buckets.map(b => {
        const items = allGrants.filter(g => g.timeline === b);
        const status = timelineStatus(b);
        const isCurrent = b === cq;
        return `
          <div class="timeline-lane ${status.cls} ${isCurrent ? 'is-current' : ''}">
            <div class="timeline-lane-head">
              <span class="timeline-lane-title">${labels[b]}</span>
              ${isCurrent ? '<span class="timeline-now-badge">TODAY</span>' : ''}
              <span class="timeline-lane-status">${status.label}</span>
              <span class="timeline-lane-count">${items.length}</span>
            </div>
            <div class="timeline-lane-items">
              ${items.map(g => `
                <div class="timeline-item">
                  <div class="timeline-item-top">
                    <span class="timeline-item-name">${esc(g.name)}</span>
                    ${likeBtnHtml(g.id)}
                  </div>
                  <div class="timeline-item-meta">${esc(g.region)} · ${esc(g.amount)}</div>
                  <div class="timeline-item-deadline">${esc(g.deadline)}</div>
                </div>
              `).join('') || '<div class="timeline-empty">No grants in this window</div>'}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
  bindLikeButtons(wrap);
}

/* ── Cards view ── */
function renderCurated() {
  const filters = {
    region: document.getElementById('curatedRegion').value,
    timeline: document.getElementById('curatedTimeline').value,
    type: document.getElementById('curatedType').value,
    theme: document.getElementById('curatedTheme').value,
    search: document.getElementById('curatedSearch').value,
    likedOnly: document.getElementById('curatedLikedOnly').checked,
  };
  const rows = applyFilters(allGrants, filters);
  const wrap = document.getElementById('curatedWrap');

  if (!rows.length) {
    wrap.innerHTML = '<div class="empty-state"><p>No grants match your filters.</p></div>';
    return;
  }

  wrap.innerHTML = `
    <div class="curated-count">${rows.length} of ${allGrants.length} grants</div>
    <div class="grant-cards">
      ${rows.map(g => `
        <div class="grant-card">
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
        </div>
      `).join('')}
    </div>
  `;
  bindLikeButtons(wrap);
}

/* ── Account view: Projects + Favorites ── */
function renderAccount() {
  const projWrap = document.getElementById('projectsList');
  projWrap.innerHTML = projects.length
    ? projects.map(p => `
        <div class="project-item">
          <div>
            <div class="project-item-name">${esc(p.name)}</div>
            <div class="project-item-meta">${[p.format, p.stage, p.location].filter(Boolean).map(esc).join(' · ')}</div>
          </div>
          <button class="remove-btn" data-project-id="${p.id}" title="Delete project">✕</button>
        </div>
      `).join('')
    : '<p style="font-size:12.5px;color:var(--text-3)">No projects yet — create one to organize your favorited grants.</p>';

  projWrap.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await supabase.from('projects').delete().eq('id', btn.dataset.projectId);
      await loadProjects();
      await loadFavorites();
      renderAll();
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
              <div class="favorite-item-meta">${grant ? esc(grant.region + ' · ' + grant.amount) : ''}</div>
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
      await supabase.from('favorites').update({ project_id: sel.value || null }).eq('id', sel.dataset.favId);
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
  await supabase.from('projects').insert({
    user_id: currentUser.id,
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

/* ── Nav ── */
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.view-pane').forEach(p => p.classList.toggle('active', p.id === `view-${btn.dataset.view}`));
  });
});

/* ── Filter bindings ── */
['grantsRegion','grantsTimeline','grantsType','grantsTheme'].forEach(id =>
  document.getElementById(id).addEventListener('change', renderGrantsTable));
document.getElementById('grantsSearch').addEventListener('input', renderGrantsTable);
document.getElementById('grantsLikedOnly').addEventListener('change', renderGrantsTable);

['curatedRegion','curatedTimeline','curatedType','curatedTheme'].forEach(id =>
  document.getElementById(id).addEventListener('change', renderCurated));
document.getElementById('curatedSearch').addEventListener('input', renderCurated);
document.getElementById('curatedLikedOnly').addEventListener('change', renderCurated);
