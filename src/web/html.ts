export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Vibe Session Stats</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.25)}
*{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent}
body{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
  background:#1a1a2e;color:#e0e0e0;min-height:100vh;
  padding:20px;line-height:1.5;
}
.container{max-width:1200px;margin:0 auto}

/* Header */
.header{
  display:flex;align-items:center;justify-content:space-between;
  margin-bottom:24px;padding-bottom:16px;
  border-bottom:1px solid rgba(255,255,255,0.1);
}
.header h1{font-size:1.6rem;font-weight:600;letter-spacing:-0.02em}
.header h1 span{opacity:0.5;font-weight:400;margin-left:8px;font-size:0.9rem}
.btn-refresh{
  background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);
  color:#e0e0e0;padding:8px 18px;border-radius:8px;cursor:pointer;
  font-size:0.85rem;transition:background 0.2s;
}
.btn-refresh:hover{background:rgba(255,255,255,0.15)}

/* Account Info Bar */
.account-bar{
  background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
  border-radius:10px;padding:12px 18px;margin-bottom:20px;
  font-size:0.85rem;color:#888;
  display:flex;gap:24px;flex-wrap:wrap;align-items:center;
}
.account-bar .label{color:#888}
.account-bar .value{color:#e0e0e0;font-weight:500}
.account-bar.hidden{display:none}

/* Overview Cards */
.overview-grid{
  display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px;
}
.agent-card{
  background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
  border-radius:12px;padding:20px;cursor:pointer;
  backdrop-filter:blur(10px);transition:border-color 0.2s,transform 0.15s;
  position:relative;overflow:hidden;
}
.agent-card:hover{border-color:rgba(255,255,255,0.25);transform:translateY(-2px)}
.agent-card.active{border-color:var(--agent-color)}
.agent-card .color-bar{
  position:absolute;top:0;left:0;right:0;height:3px;
  background:var(--agent-color);opacity:0.8;
}
.agent-card .agent-icon{
  width:36px;height:36px;border-radius:8px;display:flex;align-items:center;
  justify-content:center;font-size:1.1rem;font-weight:700;margin-bottom:12px;
  background:var(--agent-color);color:#fff;
}
.agent-card .agent-name{font-size:1rem;font-weight:600;margin-bottom:4px}
.agent-card .stat-row{
  display:flex;justify-content:space-between;margin-top:8px;
  font-size:0.82rem;color:#888;
}
.agent-card .stat-value{color:#e0e0e0;font-weight:500}

/* Detail Section */
.detail-section{
  background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
  border-radius:12px;padding:24px;backdrop-filter:blur(10px);
  display:none;margin-bottom:24px;
}
.detail-section.visible{display:block}
.detail-header{
  display:flex;align-items:center;justify-content:space-between;
  margin-bottom:16px;
}
.detail-header h2{font-size:1.1rem;font-weight:600}
.detail-header .detail-color{
  width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:8px;
}
.btn-close{
  background:none;border:none;color:#888;font-size:1.2rem;cursor:pointer;
  padding:4px 8px;
}
.btn-close:hover{color:#e0e0e0}

/* Token Summary */
.token-summary{
  display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));
  gap:12px;margin-bottom:20px;
}
.token-box{
  background:rgba(0,0,0,0.2);border-radius:8px;padding:12px;text-align:center;
}
.token-box .token-label{font-size:0.75rem;color:#888;margin-bottom:4px}
.token-box .token-value{font-size:1.1rem;font-weight:600}

/* Session Table */
.table-wrap{overflow-x:auto}
table{
  width:100%;border-collapse:collapse;font-size:0.82rem;
}
th{
  text-align:left;padding:10px 12px;color:#888;font-weight:500;
  border-bottom:1px solid rgba(255,255,255,0.1);cursor:pointer;
  user-select:none;white-space:nowrap;
}
th:hover{color:#e0e0e0}
th .sort-arrow{margin-left:4px;font-size:0.7rem}
td{
  padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.05);
  white-space:nowrap;
}
tr.session-row{cursor:pointer;transition:background 0.15s}
tr.session-row:hover{background:rgba(255,255,255,0.05)}

/* Loading */
.spinner{
  display:inline-block;width:20px;height:20px;
  border:2px solid rgba(255,255,255,0.2);border-top-color:#e0e0e0;
  border-radius:50%;animation:spin 0.6s linear infinite;
  margin:20px auto;
}
.loading-wrap{text-align:center;padding:40px 0}
@keyframes spin{to{transform:rotate(360deg)}}

/* Session Modal */
.modal-overlay{
  position:fixed;inset:0;background:rgba(0,0,0,0.6);
  display:none;align-items:center;justify-content:center;z-index:100;
  backdrop-filter:blur(4px);
}
.modal-overlay.visible{display:flex}
.modal{
  background:#1a1a2e;border:1px solid rgba(255,255,255,0.15);
  border-radius:12px;padding:24px;max-width:600px;width:90%;
  max-height:80vh;overflow-y:auto;backdrop-filter:blur(10px);
}
.modal h3{font-size:1rem;margin-bottom:12px;font-weight:600}
.modal .meta-grid{
  display:grid;grid-template-columns:1fr 1fr;gap:10px;
  margin-bottom:16px;font-size:0.82rem;
}
.modal .meta-item .label{color:#888}
.modal .meta-item .value{color:#e0e0e0}
.modal pre{
  background:rgba(0,0,0,0.3);border-radius:8px;padding:12px;
  font-size:0.78rem;white-space:pre-wrap;word-break:break-all;
  max-height:200px;overflow-y:auto;color:#aaa;
}
.modal .btn-close-modal{
  margin-top:16px;background:rgba(255,255,255,0.08);
  border:1px solid rgba(255,255,255,0.15);color:#e0e0e0;
  padding:8px 20px;border-radius:8px;cursor:pointer;font-size:0.82rem;
}
.modal .btn-close-modal:hover{background:rgba(255,255,255,0.15)}

/* Responsive */
@media(max-width:768px){
  .overview-grid{grid-template-columns:1fr}
  .account-bar{flex-direction:column;gap:8px}
  .token-summary{grid-template-columns:1fr 1fr}
  .modal .meta-grid{grid-template-columns:1fr}
}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>Vibe Session Stats</h1>
    <button class="btn-refresh" onclick="refresh()">Refresh</button>
  </div>
  <div class="account-bar hidden" id="accountBar"></div>
  <div class="overview-grid" id="overviewGrid"></div>
  <div class="detail-section" id="detailSection"></div>
</div>
<div class="modal-overlay" id="modalOverlay" onclick="if(event.target===this)closeModal()">
  <div class="modal" id="modalContent"></div>
</div>

<script>
const AGENT_META = {
  cc:      { name: 'Claude Code',       color: '#CC7832', initial: 'C' },
  copilot: { name: 'GitHub Copilot',    color: '#00B8D4', initial: 'G' },
  codex:   { name: 'Codex (OpenAI)',    color: '#10A37F', initial: 'X' },
};

let currentAgent = null;
let sortState = { col: 'lastModified', dir: 'desc' };

/* Formatters */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'GB';
}

function formatTokens(n) {
  if (n == null) return '-';
  return n.toLocaleString();
}

function formatRelativeTime(ts) {
  if (!ts) return '-';
  var diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  var MIN = 60000, HR = 3600000, DAY = 86400000, MO = 2592000000, YR = 31536000000;
  if (diff < MIN) return '<1m ago';
  if (diff < HR) return Math.round(diff / MIN) + 'm ago';
  if (diff < DAY) return Math.round(diff / HR) + 'h ago';
  if (diff < MO) return Math.round(diff / DAY) + 'd ago';
  if (diff < YR) return Math.round(diff / MO) + 'mo ago';
  return Math.round(diff / YR) + 'y ago';
}

/* Data Fetch */
async function fetchStats() {
  const res = await fetch('/api/stats');
  return res.json();
}

async function fetchTokens(agent) {
  const res = await fetch('/api/tokens/' + agent);
  return res.json();
}

async function fetchSession(agent, id) {
  const res = await fetch('/api/session/' + agent + '/' + encodeURIComponent(id));
  return res.json();
}

/* Render Overview */
function renderOverview(data) {
  var grid = document.getElementById('overviewGrid');
  grid.innerHTML = '';
  data.agents.forEach(function(agent) {
    var meta = AGENT_META[agent.agent] || { name: agent.agent, color: '#888', initial: '?' };
    var q = agent.quota;
    var card = document.createElement('div');
    card.className = 'agent-card' + (currentAgent === agent.agent ? ' active' : '');
    card.style.setProperty('--agent-color', meta.color);
    card.setAttribute('data-agent', agent.agent);

    var html =
      '<div class="color-bar"></div>' +
      '<div class="agent-icon">' + meta.initial + '</div>' +
      '<div class="agent-name">' + meta.name + '</div>';

    // Quota info inside card
    if (q) {
      if (q.planType) {
        html += '<div style="font-size:0.78rem;color:#888;margin-bottom:8px">' + q.planType;
        if (q.subscriptionStart && q.subscriptionEnd) {
          html += ' · ' + q.subscriptionStart + ' ~ ' + q.subscriptionEnd;
        }
        html += '</div>';
      }
      // Remaining quota bars
      if (q.remaining5hPercent != null) {
        html += quotaBar('5h', q.remaining5hPercent);
      } else if (q.recentTokens5h != null) {
        html += quotaBarFallback('5h', q.recentTokens5h);
      }
      if (q.remaining1wPercent != null) {
        html += quotaBar('1w', q.remaining1wPercent);
      } else if (q.recentTokens1w != null) {
        html += quotaBarFallback('1w', q.recentTokens1w);
      }
    }

    html +=
      '<div class="stat-row"><span>Sessions</span><span class="stat-value">' + agent.sessionCount + '</span></div>' +
      '<div class="stat-row"><span>Storage</span><span class="stat-value">' + formatBytes(agent.totalSize) + '</span></div>';

    card.innerHTML = html;
    card.onclick = function() { loadDetail(agent.agent); };
    grid.appendChild(card);
  });
}

function quotaBar(label, remainingPercent) {
  var remaining = Math.max(0, Math.min(100, remainingPercent));
  var barColor = remaining > 50 ? '#10A37F' : remaining > 20 ? '#f0a030' : '#e55';
  return '<div style="margin-bottom:6px">' +
    '<div style="display:flex;justify-content:space-between;font-size:0.75rem;margin-bottom:3px">' +
      '<span style="color:#888">' + label + '</span>' +
      '<span style="color:' + barColor + ';font-weight:500">' + remaining + '%</span>' +
    '</div>' +
    '<div style="height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden">' +
      '<div style="height:100%;width:' + remaining + '%;background:' + barColor + ';border-radius:2px;transition:width 0.3s"></div>' +
    '</div>' +
  '</div>';
}

function quotaBarFallback(label, usedTokens) {
  var limits = { '5h': 23500000, '1w': 28300000 };
  var limit = limits[label] || 23500000;
  var remaining = Math.max(0, Math.min(100, Math.round((1 - usedTokens / limit) * 100)));
  return quotaBar(label, remaining);
}

/* Render Detail */
async function loadDetail(agent) {
  currentAgent = agent;
  var section = document.getElementById('detailSection');
  var meta = AGENT_META[agent] || { name: agent, color: '#888' };
  section.className = 'detail-section visible';
  section.innerHTML =
    '<div class="detail-header">' +
      '<h2><span class="detail-color" style="background:' + meta.color + '"></span>' + meta.name + ' Sessions</h2>' +
      '<button class="btn-close" onclick="closeDetail()">&times;</button>' +
    '</div>' +
    '<div class="loading-wrap"><div class="spinner"></div></div>';

  /* Mark active card */
  document.querySelectorAll('.agent-card').forEach(function(c) {
    c.classList.toggle('active', c.getAttribute('data-agent') === agent);
  });

  try {
    var data = await fetchTokens(agent);
    renderTokenTable(agent, data.sessions, meta);
  } catch (e) {
    section.innerHTML += '<p style="color:#e55;margin-top:16px">Failed to load: ' + e.message + '</p>';
  }
}

function renderTokenTable(agent, sessions, meta) {
  var section = document.getElementById('detailSection');

  /* Compute totals */
  var totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheCreate = 0;
  sessions.forEach(function(s) {
    if (s.tokenUsage) {
      totalInput += s.tokenUsage.input || 0;
      totalOutput += s.tokenUsage.output || 0;
      totalCacheRead += s.tokenUsage.cacheRead || 0;
      totalCacheCreate += s.tokenUsage.cacheCreate || 0;
    }
  });

  var summaryHtml =
    '<div class="token-summary">' +
      tokenBox('Input', formatTokens(totalInput)) +
      tokenBox('Cache Hit', formatTokens(totalCacheRead)) +
      tokenBox('Cache Create', formatTokens(totalCacheCreate)) +
      tokenBox('Output', formatTokens(totalOutput)) +
      tokenBox('Total', formatTokens(totalInput + totalOutput + totalCacheRead + totalCacheCreate)) +
      tokenBox('Sessions', sessions.length) +
    '</div>';

  /* Sort sessions */
  var sorted = sessions.slice().sort(function(a, b) {
    var va = getSortVal(a, sortState.col);
    var vb = getSortVal(b, sortState.col);
    var cmp = 0;
    if (typeof va === 'string') cmp = va.localeCompare(vb);
    else cmp = (va || 0) - (vb || 0);
    return sortState.dir === 'asc' ? cmp : -cmp;
  });

  var tableHtml =
    '<div class="table-wrap"><table>' +
      '<thead><tr>' +
        th('id', 'ID') + th('name', 'Name') + th('size', 'Size') +
        th('tokens', 'Token Usage') + th('lastModified', 'Last Active') +
      '</tr></thead><tbody>' +
      sorted.map(function(s) {
        var tokenStr = '-';
        if (s.tokenUsage) {
          var t = s.tokenUsage;
          var total = (t.input||0) + (t.output||0) + (t.cacheRead||0) + (t.cacheCreate||0);
          tokenStr = '<div style="line-height:1.4">' +
            '<div style="font-weight:500">' + formatTokens(total) + '</div>' +
            '<div style="font-size:0.75rem;color:#888">' +
              '<span style="color:#e0e0e0">' + formatTokens(t.output||0) + '</span>' +
              '<span style="color:#555"> out</span>' +
              ' <span style="color:#555; margin:0 2px">|</span> ' +
              '<span style="color:#e0e0e0">' + formatTokens(t.input||0) + '</span>' +
              '<span style="color:#555"> in</span>';
          if (t.cacheRead) {
            tokenStr += ' <span style="color:#555">(</span><span style="color:#10A37F">' + formatTokens(t.cacheRead) + '</span><span style="color:#555"> hit)</span>';
          }
          if (t.cacheCreate) {
            tokenStr += ' <span style="color:#555">+</span><span style="color:#f0a030">' + formatTokens(t.cacheCreate) + '</span><span style="color:#555"> new</span>';
          }
          tokenStr += '</div></div>';
        }
        return '<tr class="session-row" onclick="openSession(\\''+agent+'\\',\\''+s.id+'\\')">' +
          '<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis" title="'+s.id+'">' + s.id.slice(0, 12) + '</td>' +
          '<td>' + (s.name || '-') + '</td>' +
          '<td>' + formatBytes(s.size) + '</td>' +
          '<td style="white-space:normal;padding-top:6px;padding-bottom:6px">' + tokenStr + '</td>' +
          '<td>' + formatRelativeTime(s.lastModified) + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';

  section.innerHTML =
    '<div class="detail-header">' +
      '<h2><span class="detail-color" style="background:' + meta.color + '"></span>' + meta.name + ' Sessions</h2>' +
      '<button class="btn-close" onclick="closeDetail()">&times;</button>' +
    '</div>' +
    summaryHtml + tableHtml;

  /* Attach sort handlers */
  section.querySelectorAll('th[data-col]').forEach(function(thEl) {
    thEl.onclick = function() {
      var col = thEl.getAttribute('data-col');
      if (sortState.col === col) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      } else {
        sortState.col = col;
        sortState.dir = 'desc';
      }
      renderTokenTable(agent, sessions, meta);
    };
  });
}

function tokenBox(label, value) {
  return '<div class="token-box"><div class="token-label">' + label + '</div><div class="token-value">' + value + '</div></div>';
}

function th(col, label) {
  var arrow = '';
  if (sortState.col === col) {
    arrow = '<span class="sort-arrow">' + (sortState.dir === 'asc' ? '&#9650;' : '&#9660;') + '</span>';
  }
  return '<th data-col="' + col + '">' + label + arrow + '</th>';
}

function getSortVal(s, col) {
  switch (col) {
    case 'id': return s.id || '';
    case 'name': return s.name || '';
    case 'size': return s.size || 0;
    case 'tokens': return s.tokenUsage ? (s.tokenUsage.input + s.tokenUsage.output) : 0;
    case 'lastModified': return s.lastModified || 0;
    default: return 0;
  }
}

/* Session Detail Modal */
async function openSession(agent, id) {
  var overlay = document.getElementById('modalOverlay');
  var content = document.getElementById('modalContent');
  overlay.classList.add('visible');
  content.innerHTML = '<div class="loading-wrap"><div class="spinner"></div></div>';

  try {
    var detail = await fetchSession(agent, id);
    renderModal(detail);
  } catch (e) {
    content.innerHTML = '<p style="color:#e55">Failed to load: ' + e.message + '</p>' +
      '<button class="btn-close-modal" onclick="closeModal()">Close</button>';
  }
}

function renderModal(detail) {
  var content = document.getElementById('modalContent');
  var s = detail.session || {};
  var tu = detail.tokenUsage || {};

  var html = '<h3>' + (s.name || s.id || 'Session') + '</h3>';
  html += '<div class="meta-grid">';
  html += metaItem('ID', s.id);
  html += metaItem('Agent', (AGENT_META[s.agent] || {}).name || s.agent);
  html += metaItem('Size', formatBytes(s.size || 0));
  html += metaItem('Messages', detail.messageCount != null ? detail.messageCount : '-');
  html += metaItem('Input', formatTokens(tu.input));
  html += metaItem('Cache Hit', formatTokens(tu.cacheRead));
  html += metaItem('Cache Create', formatTokens(tu.cacheCreate));
  html += metaItem('Output', formatTokens(tu.output));
  var modalTotal = (tu.input||0) + (tu.output||0) + (tu.cacheRead||0) + (tu.cacheCreate||0);
  html += metaItem('Total', formatTokens(modalTotal || undefined));
  html += metaItem('Last Modified', formatRelativeTime(s.lastModified));
  html += '</div>';

  if (detail.firstUserMessage) {
    html += '<div style="margin-bottom:12px"><div class="label" style="color:#888;font-size:0.78rem;margin-bottom:4px">First Message</div>' +
      '<pre>' + escapeHtml(detail.firstUserMessage) + '</pre></div>';
  }
  if (detail.lastUserMessage) {
    html += '<div style="margin-bottom:12px"><div class="label" style="color:#888;font-size:0.78rem;margin-bottom:4px">Last Message</div>' +
      '<pre>' + escapeHtml(detail.lastUserMessage) + '</pre></div>';
  }
  if (detail.preview && detail.preview.length) {
    html += '<div style="margin-bottom:12px"><div class="label" style="color:#888;font-size:0.78rem;margin-bottom:4px">Preview</div>' +
      '<pre>' + escapeHtml(detail.preview.join('\\n')) + '</pre></div>';
  }

  html += '<button class="btn-close-modal" onclick="closeModal()">Close</button>';
  content.innerHTML = html;
}

function metaItem(label, value) {
  return '<div class="meta-item"><div class="label">' + label + '</div><div class="value">' + (value != null ? value : '-') + '</div></div>';
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('visible');
}

function closeDetail() {
  currentAgent = null;
  document.getElementById('detailSection').className = 'detail-section';
  document.querySelectorAll('.agent-card').forEach(function(c) { c.classList.remove('active'); });
}

/* Refresh */
async function refresh() {
  currentAgent = null;
  document.getElementById('detailSection').className = 'detail-section';
  try {
    var data = await fetchStats();
    renderOverview(data);
  } catch (e) {
    document.getElementById('overviewGrid').innerHTML =
      '<p style="color:#e55;grid-column:1/-1;text-align:center;padding:40px">Failed to load stats: ' + e.message + '</p>';
  }
}

/* Init */
refresh();
</script>
</body>
</html>`;
}
