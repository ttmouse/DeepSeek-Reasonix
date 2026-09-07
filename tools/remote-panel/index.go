package main

const indexHTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<title>Reasonix 遥控</title>
<!-- PWA: add-to-home-screen on iOS / installable on Android -->
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Reasonix">
<meta name="theme-color" content="#f6f7f9">
<style>
:root{
  --bg:#f6f7f9; --card:#fff; --border:#e4e7ec; --text:#1f2329; --muted:#6b7280;
  --accent:#2563eb; --green:#16a34a; --red:#dc2626; --amber:#d97706;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
html{-webkit-text-size-adjust:100%}
/* Hide scrollbar appearance on the whole page — iOS renders the body
   scrollbar regardless of overflow:hidden, so make it invisible while
   keeping scroll functionality in scrollable areas. */
::-webkit-scrollbar{width:0;height:0;display:none}
*{scrollbar-width:none}
body{scrollbar-width:none}
body{
  font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif;
  background:var(--bg);color:var(--text);
  padding-bottom:env(safe-area-inset-bottom);
  -webkit-touch-callout:none;
  -webkit-tap-highlight-color:transparent;
  touch-action:manipulation;
  overscroll-behavior:none;
  -webkit-user-select:none;user-select:none;
}
/* Allow one-finger scrolling inside scrollable areas while still blocking
   pinch-zoom at the page level (JS gesture handler below is the real gate
   on iOS, which ignores user-scalable=no). */
#groupList,#output,main{-webkit-overflow-scrolling:touch;touch-action:pan-x pan-y}
/* Restore selection where it matters: conversation output & the input box */
#output,#input,textarea{-webkit-user-select:text;user-select:text}
#output{-webkit-touch-callout:default}
header{position:sticky;top:0;background:var(--card);border-bottom:1px solid var(--border);padding:.75rem 1rem;display:flex;align-items:center;gap:.75rem;z-index:10}
/* In standalone PWA the status bar overlays the top; push content down. */
header{padding-top:calc(.75rem + env(safe-area-inset-top))}
header h1{font-size:1.05rem;font-weight:600}
header .badge{margin-left:auto;font-size:.75rem;color:var(--muted);background:var(--bg);border-radius:999px;padding:.25rem .6rem}
main{padding:0 0 .75rem;max-width:640px;margin:0 auto}
.count{font-size:.78rem;color:var(--muted);padding:.6rem 1rem .4rem}
/* Full-bleed list rows separated by hairline dividers (no card boxes) */
.group-card{display:flex;align-items:center;gap:.75rem;padding:.8rem 1rem;background:none;border:none;border-bottom:1px solid var(--border);border-radius:0}
.group-card:active{background:#f0f2f5}
.group-card:last-child{border-bottom:none}
.group-card .gname{font-size:.95rem;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.group-card .gpath{font-size:.72rem;color:var(--muted);margin-top:.1rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.group-card .gstat{font-size:.75rem;color:var(--muted);flex-shrink:0}
.group-card .gstat .held-n{color:var(--amber)}
.group-card .gchevron{color:var(--muted);font-size:1.1rem;flex-shrink:0}
.session{padding:.8rem 1rem;background:none;border:none;border-bottom:1px solid var(--border);border-radius:0}
.session:active{background:#f0f2f5}
.session:last-child{border-bottom:none}
.session .top{display:flex;align-items:flex-start;gap:.5rem}
.session .title{font-size:.95rem;font-weight:500;line-height:1.35;flex:1;word-break:break-word}
.session .meta{display:flex;flex-wrap:wrap;gap:.4rem .8rem;margin-top:.4rem;font-size:.75rem;color:var(--muted)}
.session .meta b{font-weight:500;color:var(--text)}
.pill{display:inline-flex;align-items:center;gap:.25rem;font-size:.72rem;font-weight:500;border-radius:999px;padding:.18rem .55rem;flex-shrink:0}
.pill::before{content:"";width:6px;height:6px;border-radius:50%}
.pill.idle{color:var(--green);background:rgba(22,163,74,.1)}
.pill.idle::before{background:var(--green)}
.pill.held{color:var(--amber);background:rgba(217,119,6,.1)}
.pill.held::before{background:var(--amber)}
.pill.running{color:var(--accent);background:rgba(37,99,235,.1)}
.pill.running::before{background:var(--accent);animation:pulse 1s infinite}
@keyframes pulse{50%{opacity:.35}}
.pill.fail{color:var(--red);background:rgba(220,38,38,.1)}
.pill.fail::before{background:var(--red)}
.sheet{position:fixed;inset:0;background:var(--bg);z-index:20;display:none;flex-direction:column}
.sheet.open{display:flex}
.sheet header{flex-shrink:0}
.sheet .back{font-size:1.5rem;line-height:1;border:none;background:none;padding:0;cursor:pointer;color:var(--text);width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:8px;flex-shrink:0;margin-left:-.3rem}
.sheet .back:active{background:rgba(0,0,0,.06)}
.sheet .info{font-size:.72rem;color:var(--muted);margin-top:.15rem;word-break:break-all}
#output{flex:1;overflow-y:auto;overflow-x:hidden;padding:.4rem 0 .6rem;font-size:.85rem;line-height:1.65}
/* Chat-style layout: user messages are right-aligned blue bubbles,
   assistant messages are left-aligned card bubbles. No role text labels
   and no emoji — the bubble position carries the role. */
#output .msg{display:flex;margin:.3rem 1rem;background:none;border:none}
#output .msg.user{justify-content:flex-end}
#output .msg.assistant{justify-content:flex-start}
/* min-width:0 lets the bubble shrink inside flex (otherwise long code/URLs
   blow past the viewport and create a horizontal scrollbar) */
#output .msg .bubble{min-width:0;max-width:86%;padding:.55rem .75rem;border-radius:14px;word-break:break-word}
#output .msg.user .bubble{background:var(--accent);color:#fff;border-bottom-right-radius:4px}
/* Assistant messages are plain text — no bubble, no box, no background:
   content flows full-width like a transcript line. */
#output .msg.assistant .bubble{background:none;border:none;border-radius:0;max-width:100%;padding:.1rem 0}
#output .msg .body{white-space:normal;word-break:break-word;overflow-wrap:anywhere;line-height:1.6;font-size:.88rem}
#output .msg.user .body p{color:#fff}
#output .msg .body p{margin:.35rem 0}
#output .msg .body h1,#output .msg .body h2,#output .msg .body h3,#output .msg .body h4{font-weight:600;margin:.6rem 0 .3rem;line-height:1.35}
#output .msg .body h1{font-size:1.1rem}
#output .msg .body h2{font-size:1.05rem}
#output .msg .body h3,#output .msg .body h4{font-size:.95rem}
#output .msg .body ul,#output .msg .body ol{margin:.3rem 0;padding-left:1.2rem}
#output .msg .body li{margin:.15rem 0}
#output .msg.user .body code{background:rgba(255,255,255,.18);color:#fff}
#output .msg.user .body pre{background:rgba(255,255,255,.12)}
#output .msg.user .body pre code{background:none}
#output .msg.user .body a{color:#fff;text-decoration:underline}
#output .msg.user .body blockquote{border-left-color:rgba(255,255,255,.5);color:rgba(255,255,255,.9)}
#output .msg.user .body th{background:rgba(255,255,255,.12)}
#output .msg.user .body th,#output .msg.user .body td{border-color:rgba(255,255,255,.4)}
#output .msg .body pre{background:rgba(0,0,0,.05);border-radius:8px;padding:.6rem .7rem;overflow-x:auto;margin:.4rem 0;font-size:.78rem;line-height:1.5}
#output .msg .body pre code{background:none;padding:0;font-family:ui-monospace,Menlo,monospace}
#output .msg .body blockquote{border-left:3px solid var(--border);margin:.4rem 0;padding:.1rem 0 .1rem .7rem;color:var(--muted)}
#output .msg .body a{color:var(--accent);text-decoration:underline}
#output .msg .body table{border-collapse:collapse;margin:.4rem 0;font-size:.8rem;width:100%;display:block;overflow-x:auto}
#output .msg .body th,#output .msg .body td{border:1px solid var(--border);padding:.3rem .5rem;text-align:left}
#output .msg .body th{background:rgba(0,0,0,.04);font-weight:600}
#output .msg .body hr{border:none;border-top:1px solid var(--border);margin:.5rem 0}
#output .msg .body strong{font-weight:600}
#output .msg .body del{color:var(--muted)}
#output .msg .steps{margin:.35rem 0 .1rem;font-size:.78rem}
#output .msg .steps-head{display:flex;align-items:center;gap:.35rem;color:var(--muted);cursor:pointer;padding:.2rem 0;user-select:none}
#output .msg.assistant .steps-head{color:var(--muted)}
#output .msg .steps-sum{font-size:.72rem;opacity:.9}
#output .msg .steps-head .chev{transition:transform .15s;font-size:.7rem}
#output .msg.steps-open .steps-head .chev{transform:rotate(90deg)}
#output .msg .steps-body{display:none;margin-top:.3rem;padding-top:.35rem}
#output .msg.steps-open .steps-body{display:block}
#output .msg .step{padding:.3rem 0}
#output .msg.assistant .step + .step{border-top:1px solid var(--border)}
#output .msg .step b{color:var(--muted);font-weight:600;font-size:.72rem}
#output .msg .step .step-pv{color:var(--muted);white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;margin-top:.1rem;font-size:.75rem}
#output .stderr{color:var(--red)}
#output .done{color:var(--green);font-weight:500}
#output .hint{color:var(--muted);font-style:italic;padding:.6rem 1rem}
.composer{flex-shrink:0;border-top:1px solid var(--border);background:var(--card);padding:.6rem .75rem calc(.6rem + env(safe-area-inset-bottom));display:flex;gap:.5rem;align-items:flex-end}
.composer textarea{flex:1;resize:none;border:1px solid var(--border);border-radius:10px;padding:.6rem .7rem;font-size:.95rem;font-family:inherit;line-height:1.4;max-height:6rem;overflow-y:hidden;background:#fff}
.composer textarea:focus{outline:none;border-color:var(--accent)}
.composer button{border:none;border-radius:10px;background:var(--accent);color:#fff;font-size:.95rem;padding:.6rem 1.1rem;font-weight:500}
.composer button:disabled{opacity:.5}
.banner{margin:0;padding:.6rem 1rem;border-bottom:1px solid var(--border);font-size:.82rem;line-height:1.5}
.banner.err{background:rgba(220,38,38,.06);color:var(--red)}
.banner.info{background:rgba(37,99,235,.06);color:var(--accent)}
</style>
</head>
<body>
<header>
  <h1>Reasonix 遥控</h1>
  <span class="badge" id="conn">连接中…</span>
</header>
<main>
  <div class="count" id="count"></div>
  <div id="list"></div>
</main>

<div class="sheet" id="groupSheet">
  <header>
    <button class="back" id="gBack" aria-label="返回">‹</button>
    <div style="flex:1;min-width:0">
      <h1 id="gTitle" style="font-size:.95rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></h1>
      <div class="info" id="gInfo"></div>
    </div>
    <span class="badge" id="gBadge"></span>
  </header>
  <div id="groupList" style="flex:1;overflow-y:auto"></div>
</div>

<div class="sheet" id="sheet">
  <header>
    <button class="back" id="back" aria-label="返回">‹</button>
    <h1 id="sTitle" style="flex:1;font-size:.95rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></h1>
    <span class="pill idle" id="sPill">空闲</span>
  </header>
  <div id="banner"></div>
  <div id="output"><div class="hint">点下方输入框发送指令，让这个对话继续推进。</div></div>
  <div class="composer">
    <textarea id="input" rows="1" placeholder="发送指令让它继续推进…"></textarea>
    <button id="send">发送</button>
  </div>
</div>

<script>
// Block pinch-zoom / double-tap zoom natively. iOS Safari ignores
// user-scalable=no (iOS >= 10) and touch-action does not stop pinch-zoom,
// so the reliable way is to cancel the Safari-only gesture events.
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('gesturechange', e => e.preventDefault());
document.addEventListener('gestureend', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());
// Also guard the wheel path (trackpads / Chrome) against pinch-to-zoom:
window.addEventListener('wheel', e => { if (e.ctrlKey) e.preventDefault(); }, {passive:false});

// PWA manifest with the current token baked into start_url, so the installed
// app opens straight into an authenticated view. iOS uses the meta tags above;
// this makes it a proper installable PWA on Android / newer iOS too.
(function(){
  const tok = new URLSearchParams(location.search).get('token') || '';
  const base = location.origin + location.pathname;
  const manifest = {
    name: 'Reasonix 遥控',
    short_name: 'Reasonix',
    start_url: base + (tok ? '?token=' + tok : ''),
    display: 'standalone',
    background_color: '#f6f7f9',
    theme_color: '#f6f7f9',
    icons: [{
      src: 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="40" fill="#2563eb"/><path d="M56 76h80M56 96h80M56 116h52" stroke="#fff" stroke-width="14" stroke-linecap="round"/></svg>'),
      sizes: 'any',
      type: 'image/svg+xml',
      purpose: 'any'
    }]
  };
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = 'data:application/manifest+json,' + encodeURIComponent(JSON.stringify(manifest));
  document.head.appendChild(link);
})();
</script>
<script>
const token = new URLSearchParams(location.search).get('token') || '';
const api = (p, opts) => fetch(p + (token ? (p.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token) : ''), opts);
const $ = id => document.getElementById(id);

let sessions = [];
let current = null;      // selected SessionEntry
let currentGroup = null; // workspaceDisplay of the open group sheet
let evtSource = null;    // SSE for the running inject
let pollTimer = null;

function esc(s){ const d=document.createElement('div'); d.textContent=s??''; return d.innerHTML; }

function pillClass(s){
  if (current && current.path === s.path && evtSource) return 'running';
  if (s.held) return 'held';
  return 'idle';
}
function pillText(s){
  if (current && current.path === s.path && evtSource) return '推进中';
  if (s.held) return '占用中';
  return '空闲';
}

// renderList renders level 1: the workspace group cards, most-recently-active
// first (based on each group's newest session), with counts.
function renderList(){
  const el = $('list');
  el.innerHTML = '';
  $('count').textContent = sessions.length + ' 个对话 · ' + groupCount() + ' 个项目';

  const groups = groupSessions(); // key -> [sessions] (already newest-first)
  const keys = Object.keys(groups).sort((a,b) => lastActive(groups[b]) - lastActive(groups[a]));

  keys.forEach(key => {
    const items = groups[key];
    const held = items.filter(x => x.held).length;
    const card = document.createElement('div');
    card.className = 'group-card';
    card.innerHTML =
      '<div style="flex:1;min-width:0">' +
        '<div class="gname">' + esc(projectName(key)) + '</div>' +
        (key !== '全局' ? '<div class="gpath">' + esc(key) + '</div>' : '') +
      '</div>' +
      '<div class="gstat">' + items.length + ' 个' +
        (held ? ' · <span class="held-n">' + held + ' 占用</span>' : '') +
        (lastActive(items) ? ' · ' + esc(fmtTime(new Date(lastActive(items)).toISOString())) : '') +
      '</div>' +
      '<div class="gchevron">›</div>';
    card.onclick = () => openGroup(key);
    el.appendChild(card);
  });
}

// projectName returns the last path segment as the project name ("全局" for
// the global group). Keeps the card readable; the full path stays as a
// secondary line below.
function projectName(key){
  if (key === '全局') return '全局';
  const parts = key.split('/').filter(Boolean);
  const last = parts[parts.length-1];
  return last || key;
}

function groupCount(){
  return Object.keys(groupSessions()).length;
}

// groupSessions buckets sessions by workspaceDisplay, preserving order.
function groupSessions(){
  const groups = {};
  sessions.forEach(s => {
    const key = s.workspaceDisplay || '全局';
    (groups[key] = groups[key] || []).push(s);
  });
  return groups;
}

// lastActive returns the newest session timestamp (ms) within a group.
function lastActive(items){
  let max = 0;
  items.forEach(s => { const t = s.updatedAt ? new Date(s.updatedAt).getTime() : 0; if (t > max) max = t; });
  return max;
}

// openGroup renders level 2: all sessions of one workspace in a full-screen
// sheet, with a back button to the group list.
// lockBodyScroll / unlockBodyScroll prevent the page behind a sheet from
// scrolling (avoids the background scrollbar and scroll-through on iOS).
function lockBodyScroll(){
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
}
function unlockBodyScroll(){
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
}

function openGroup(key){
  currentGroup = key;
  lockBodyScroll();
  const items = (groupSessions()[key] || []);
  $('gTitle').textContent = projectName(key);
  const heldN = items.filter(x=>x.held).length;
  $('gInfo').textContent = items.length + ' 个对话' + (heldN ? ' · ' + heldN + ' 个占用中' : '');
  $('gBadge').textContent = '';
  const el = $('groupList');
  el.innerHTML = '';
  items.forEach(s => el.appendChild(sessionCard(s)));
  $('groupSheet').classList.add('open');
}

function closeGroup(){
  currentGroup = null;
  $('groupSheet').classList.remove('open');
  $('groupSheet').style.transform = '';
  unlockBodyScroll();
  refresh();
}

function sessionCard(s){
  const d = document.createElement('div');
  d.className = 'session';
  d.innerHTML = '<div class="top"><div class="title">' + esc(s.title) + '</div>' +
    '<span class="pill ' + pillClass(s) + '">' + pillText(s) + '</span></div>' +
    '<div class="meta">' +
    (s.model ? '<span>模型 <b>' + esc(s.model) + '</b></span>' : '') +
    '<span>轮次 <b>' + s.turns + '</b></span>' +
    (s.updatedAt ? '<span>更新 <b>' + esc(fmtTime(s.updatedAt)) + '</b></span>' : '') +
    (s.held ? '<span style="color:var(--amber)">' + esc(s.heldBy) + '</span>' : '') +
    '</div>';
  d.onclick = () => openSheet(s);
  return d;
}

function fmtTime(iso){
  if (!iso) return '';
  const t = new Date(iso);
  const now = Date.now();
  const diff = now - t.getTime();
  if (diff < 60e3) return '刚刚';
  if (diff < 3600e3) return Math.floor(diff/60e3) + ' 分钟前';
  if (diff < 86400e3) return Math.floor(diff/3600e3) + ' 小时前';
  return t.toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'}) + ' ' + t.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
}

function openSheet(s){
  current = s;
  lockBodyScroll();
  $('sheet').classList.add('open');
  $('sTitle').textContent = s.title;
  $('banner').innerHTML = '';
  $('output').innerHTML = '<div class="hint">加载历史消息…</div>';
  resetInput();
  $('input').disabled = s.held;
  $('send').disabled = s.held;
  updatePill(s);
  if (s.held){
    $('banner').innerHTML = '<div class="banner err">该会话正被其他进程占用' + (s.heldBy ? '（' + esc(s.heldBy) + '）' : '') + '。请先在桌面端关闭对应对话 tab，再回来发送指令。</div>';
  }
  loadHistory(s.path);
  // 不 focus 输入框：避免进入详情时自动弹出键盘（用户要求）
}

// loadHistory fetches the conversation transcript and renders it full-bleed,
// user messages labeled "你", assistant messages "AI" with thinking/tool steps
// collapsed behind a toggle.
async function loadHistory(path){
  try {
    const res = await api('/api/messages', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({path: path})
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const msgs = data.messages || [];
    const out = $('output');
    out.innerHTML = '';
    if (msgs.length === 0){
      out.innerHTML = '<div class="hint">这个对话还没有可展示的历史消息。</div>';
      return;
    }
    msgs.forEach(m => appendMsg(m.role, m.content, m.steps || []));
    out.scrollTop = out.scrollHeight;
  } catch(e) {
    $('output').innerHTML = '<div class="hint">历史消息加载失败：' + esc(e.message) + '</div>';
  }
}

// appendMsg appends one transcript message. role: "user" | "assistant".
// steps (if any) render as a collapsed toggle inside the bubble. Role is
// carried by bubble side (user=right/blue, assistant=left/card), no labels.
function appendMsg(role, content, steps){
  const out = $('output');
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'user' : 'assistant');
  let html = '<div class="bubble">';
  if (steps && steps.length){
    const nThink = steps.filter(s => s.kind === 'thinking').length;
    const nTool = steps.filter(s => s.kind === 'tool').length;
    const summary = '思考 ' + nThink + ' · 工具 ' + nTool;
    html += '<div class="steps"><div class="steps-head"><span class="steps-sum">' + summary + '</span><span class="chev">›</span></div><div class="steps-body"></div></div>';
  }
  if (content){
    html += '<div class="body">' + mdToHtml(content) + '</div>';
  }
  html += '</div>';
  div.innerHTML = html;
  if (steps && steps.length){
    const head = div.querySelector('.steps-head');
    const body = div.querySelector('.steps-body');
    const detail = steps.map(s => {
      if (s.kind === 'tool'){
        const name = s.name || 'tool';
        return '<div class="step step-tool"><b>工具 · ' + esc(name) + '</b>' + (s.preview ? '<div class="step-pv">' + esc(s.preview) + '</div>' : '') + '</div>';
      }
      return '<div class="step step-thinking"><b>思考</b><div class="step-pv">' + esc(s.preview || '') + '</div></div>';
    }).join('');
    body.innerHTML = detail;
    head.onclick = () => {
      const open = div.classList.toggle('steps-open');
      head.querySelector('.chev').textContent = open ? '︾' : '›';
    };
  }
  out.appendChild(div);
  out.scrollTop = out.scrollHeight;
}

// ---- lightweight inline Markdown renderer (zero-dependency) ----
// All input is HTML-escaped first, then structural tags are applied, so raw
// HTML in a message can never inject scripts. Supports the subset chat
// transcripts use most: code blocks, inline code, headings, bold/italic/
// strikethrough, lists, blockquotes, links and simple tables.

function mdEscape(s){
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function mdInline(s){
  let out = mdEscape(s);
  // inline code first (protect backtick content from later bold/italic).
  // Backticks are written as \x60 so they don't break the Go raw string.
  out = out.replace(/\x60([^\x60]+)\x60/g, (m, code) => '<code>' + code + '</code>');
  // bold (must run BEFORE italic so **x** isn't split by the italic rule)
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // italic: single * pairs anywhere, but not part of ** (already consumed) —
  // use a callback so we can require an odd star context safely.
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?![*])/g, (m, before, inner) => {
    // 'before' may be empty or a char; keep it, wrap inner in <em>
    return before + '<em>' + inner + '</em>';
  });
  // strikethrough
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  // links: [text](url) — target=_blank so the PWA never navigates away
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    const safeUrl = /^(https?:|mailto:|tel:)/i.test(url) ? url : '#';
    return '<a href="' + mdEscape(safeUrl) + '" target="_blank" rel="noopener">' + text + '</a>';
  });
  return out;
}

function mdToHtml(src){
  if (!src) return '';
  const lines = String(src).split('\n');
  const out = [];
  let i = 0;
  let inCode = false, codeLang = '', codeBuf = [];

  const flushCode = () => {
    if (codeBuf.length){
      out.push('<pre><code' + (codeLang ? ' class="lang-' + mdEscape(codeLang) + '"' : '') + '>' +
        codeBuf.map(l => mdEscape(l)).join('\n') + '</code></pre>');
      codeBuf = []; codeLang = '';
    }
  };

  while (i < lines.length){
    const line = lines[i];
    const trimmed = line.trim();

    // fenced code block
    if (/^\x60\x60\x60/.test(trimmed)){
      if (inCode){ flushCode(); inCode = false; }
      else { inCode = true; codeLang = trimmed.slice(3).trim(); }
      i++; continue;
    }
    if (inCode){ codeBuf.push(line); i++; continue; }

    // blank line → paragraph break
    if (trimmed === ''){ out.push(''); i++; continue; }

    // headings
    const h = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (h){
      const level = Math.min(h[1].length, 4);
      out.push('<h' + level + '>' + mdInline(h[2]) + '</h' + level + '>');
      i++; continue;
    }
    // horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)){
      out.push('<hr>'); i++; continue;
    }
    // blockquote: collect consecutive lines
    if (/^>\s?/.test(trimmed)){
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())){
        quote.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + quote.map(q => mdInline(q)).join('<br>') + '</blockquote>');
      continue;
    }
    // unordered list: collect consecutive items
    if (/^[-*+]\s+/.test(trimmed)){
      const items = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())){
        items.push('<li>' + mdInline(lines[i].trim().replace(/^[-*+]\s+/, '')) + '</li>');
        i++;
      }
      out.push('<ul>' + items.join('') + '</ul>');
      continue;
    }
    // ordered list
    if (/^\d+\.\s+/.test(trimmed)){
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())){
        items.push('<li>' + mdInline(lines[i].trim().replace(/^\d+\.\s+/, '')) + '</li>');
        i++;
      }
      out.push('<ol>' + items.join('') + '</ol>');
      continue;
    }
    // table: header row | separator row | data rows
    if (trimmed.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i+1].trim())){
      const header = lines[i].trim().replace(/^\||\|$/g, '').split('|').map(c => mdInline(c.trim()));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().includes('|')){
        rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map(c => mdInline(c.trim())));
        i++;
      }
      let t = '<table><thead><tr>' + header.map(c => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>';
      rows.forEach(r => { t += '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>'; });
      t += '</tbody></table>';
      out.push(t);
      continue;
    }
    // plain paragraph (merge consecutive non-blank lines)
    const para = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^\x60\x60\x60/.test(lines[i].trim())){
      const t = lines[i].trim();
      if (/^(#{1,4})\s+/.test(t) || /^(-{3,}|\*{3,}|_{3,})$/.test(t) || /^>\s?/.test(t) ||
          /^[-*+]\s+/.test(t) || /^\d+\.\s+/.test(t) || (t.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i+1].trim()))){
        break;
      }
      para.push(t);
      i++;
    }
    if (para.length){ out.push('<p>' + para.map(l => mdInline(l)).join('<br>') + '</p>'); }
    else { i++; }
  }
  flushCode();
  return out.join('\n');
}

function updatePill(s){
  const pill = $('sPill');
  pill.className = 'pill ' + pillClass(s);
  pill.textContent = pillText(s);
}

async function refresh(){
  try {
    const res = await api('/api/sessions');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    sessions = data.sessions || [];
    $('conn').textContent = '在线';
    $('conn').style.color = 'var(--green)';
    renderList();
    // Sync the open group sheet (lease states change as tabs open/close).
    if (currentGroup){
      const items = (groupSessions()[currentGroup] || []);
      const heldN = items.filter(x=>x.held).length;
      $('gInfo').textContent = items.length + ' 个对话' + (heldN ? ' · ' + heldN + ' 个占用中' : '');
      const el = $('groupList');
      el.innerHTML = '';
      items.forEach(s => el.appendChild(sessionCard(s)));
    }
    if (current){
      const fresh = sessions.find(x => x.path === current.path);
      if (fresh) { current = fresh; updatePill(current); }
    }
  } catch(e) {
    $('conn').textContent = '离线';
    $('conn').style.color = 'var(--red)';
  }
}

// appendOut renders a status/error line (not a transcript message).
function appendOut(html){
  const out = $('output');
  const div = document.createElement('div');
  div.innerHTML = html;
  out.appendChild(div);
  out.scrollTop = out.scrollHeight;
}

async function sendInjection(){
  const msg = $('input').value.trim();
  if (!msg || !current || evtSource) return;
  $('send').disabled = true;
  $('input').disabled = true;
  resetInput(); // clear the box immediately; the message is now in the transcript
  appendMsg('user', msg);

  let res;
  try {
    res = await api('/api/drive', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({path: current.path, message: msg})
    });
  } catch(e) {
    appendOut('<div class="stderr">请求失败：' + esc(e.message) + '</div>');
    $('send').disabled = false; $('input').disabled = false;
    return;
  }
  const data = await res.json().catch(()=>({}));
  if (!res.ok || data.error){
    if (data.error === 'held'){
      $('banner').innerHTML = '<div class="banner err">' + esc(data.hint || '会话被占用') + '</div>';
    } else {
      appendOut('<div class="stderr">无法启动：' + esc(data.error || res.statusText) + '</div>');
    }
    $('send').disabled = false; $('input').disabled = false;
    return;
  }

  evtSource = new EventSource('/api/runs/' + data.runId + '?token=' + encodeURIComponent(token));
  $('sPill').className = 'pill running';
  $('sPill').textContent = '推进中';
  // Accumulate the whole run into ONE assistant message (streaming lines must
  // not become separate divider-separated blocks).
  const out = $('output');
  const runDiv = document.createElement('div');
  runDiv.className = 'msg assistant';
  runDiv.innerHTML = '<div class="bubble"><div class="body"></div></div>';
  out.appendChild(runDiv);
  const body = runDiv.querySelector('.body');
  let chunk = '';
  evtSource.onmessage = e => {
    chunk += JSON.parse(e.data) + '\n';
    body.textContent = chunk;
    out.scrollTop = out.scrollHeight;
  };
  evtSource.addEventListener('done', e => {
    const [ok, err] = JSON.parse(e.data).split('|');
    evtSource.close(); evtSource = null;
    if (chunk.trim() !== '') body.innerHTML = mdToHtml(chunk.trim());
    if (ok !== 'true') runDiv.innerHTML += '<div class="stderr" style="margin-top:.3rem">✗ 运行出错' + (err ? '：' + esc(err) : '') + '</div>';
    $('send').disabled = false; $('input').disabled = false;
    setTimeout(() => { if (current) updatePill(current); refresh(); }, 500);
  });
  evtSource.onerror = () => {
    if (evtSource){ evtSource.close(); evtSource = null; }
    $('send').disabled = false; $('input').disabled = false;
  };
}

// ---- back navigation (shared by the header button and the edge swipe) ----
function goBackFromDetail(){
  if (evtSource){ evtSource.close(); evtSource = null; }
  current = null;
  $('sheet').classList.remove('open');
  $('sheet').style.transform = '';
  // If we came from a group sheet, return there (body stays locked while a
  // sheet remains open); otherwise back to the group list and unlock.
  if (currentGroup){
    const items = (groupSessions()[currentGroup] || []);
    const el = $('groupList');
    el.innerHTML = '';
    items.forEach(s => el.appendChild(sessionCard(s)));
  } else {
    unlockBodyScroll();
    refresh();
  }
}
function goBackFromGroup(){
  closeGroup();
}

$('gBack').onclick = goBackFromGroup;
$('back').onclick = goBackFromDetail;

// ---- iOS-style edge swipe to go back ----
// A touch that starts within 28px of the left edge drags the sheet sideways
// following the finger; releasing past 80px commits the back navigation,
// otherwise it springs back. Each sheet needs its own edge listener so the
// gesture fires on whichever layer is open.
function bindEdgeSwipe(sheetEl, onBack){
  if (!sheetEl || sheetEl.__swipeBound) return;
  sheetEl.__swipeBound = true;
  let startX = 0, startY = 0, active = false, translate = 0;
  sheetEl.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.clientX > 28) return;               // only the left edge
    startX = t.clientX; startY = t.clientY;
    active = true; translate = 0;
  }, {passive: true});
  sheetEl.addEventListener('touchmove', e => {
    if (!active) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (dx > 0 && Math.abs(dx) > Math.abs(dy)) {   // rightward, more horizontal
      e.preventDefault();
      translate = Math.min(dx, 200);
      sheetEl.style.transform = 'translateX(' + translate + 'px)';
    }
  }, {passive: false});
  const finish = e => {
    if (!active) return;
    active = false;
    if (translate > 80){
      sheetEl.style.transition = 'transform .18s ease';
      sheetEl.style.transform = 'translateX(100%)';
      setTimeout(() => { sheetEl.style.transition = ''; onBack(); }, 180);
    } else {
      sheetEl.style.transition = 'transform .2s ease';
      sheetEl.style.transform = '';
      setTimeout(() => { sheetEl.style.transition = ''; }, 200);
    }
  };
  sheetEl.addEventListener('touchend', finish, {passive: true});
  sheetEl.addEventListener('touchcancel', finish, {passive: true});
}
bindEdgeSwipe($('groupSheet'), goBackFromGroup);
bindEdgeSwipe($('sheet'), goBackFromDetail);

// ---- send / autosize ----
$('send').onclick = sendInjection;
$('input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendInjection(); }
});
// Auto-grow the input up to max-height so long text never shows an inner
// scrollbar; reset to one line when emptied.
const inputEl = $('input');
function autosizeInput(){
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 96) + 'px';
}
inputEl.addEventListener('input', autosizeInput);
function resetInput(){
  inputEl.value = '';
  inputEl.style.height = 'auto';
  inputEl.style.minHeight = '2.6rem';
  autosizeInput();
}

refresh();
pollTimer = setInterval(refresh, 5000);
</script>
</body>
</html>
`
