/**
 * Autopost — Павел Белоглазов
 * Instagram Stories (@pabeloglazov = "imm", @pabeloglazov_injury = "pi") + Threads (@pabeloglazov)
 * + журнал публикаций, сбор статистики и данные для панели/задач.
 *
 * Script Properties (Project Settings → Script properties):
 *   SECRET        — ключ ежедневных задач Claude (публикация, очередь, сводка)
 *   READ_KEY      — ключ панели (только чтение статистики); создаётся в setup()
 *   TOKEN_IMM     — токен Instagram @pabeloglazov
 *   TOKEN_PI      — токен Instagram @pabeloglazov_injury
 *   TOKEN_THREADS — токен Threads @pabeloglazov
 *   FOLDER_ID     — создаётся автоматически (папка в Google Drive)
 */

const API = 'https://graph.instagram.com/v21.0';
const THREADS_API = 'https://graph.threads.net/v1.0';
const PROPS = PropertiesService.getScriptProperties();

/* ===================== HTTP ===================== */

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad json' }); }
  try {
    // панель: только чтение по READ_KEY
    if (body.action === 'analytics') {
      if (!body.read_key || body.read_key !== PROPS.getProperty('READ_KEY')) return out_({ ok: false, error: 'forbidden' });
      return out_(analytics_(body.days || 30));
    }
    if (!body.key || body.key !== PROPS.getProperty('SECRET')) return out_({ ok: false, error: 'forbidden' });
    if (body.action === 'ping') return out_(ping_(body.account));
    if (body.action === 'story') return out_(publishStory_(body.account, body.image_b64, body.name || 'story', body.meta || {}));
    if (body.action === 'topics_get') return out_(topicsGet_(body.days || 14));
    if (body.action === 'topics_add') return out_(topicsAdd_(body.topics || []));
    if (body.action === 'threads_queue') return out_(threadsQueue_(body.posts || []));
    if (body.action === 'threads_status') return out_(threadsStatus_());
    if (body.action === 'insights_summary') return out_(insightsSummary_(body.days || 14));
    if (body.action === 'collect_now') { collectInsights(); return out_({ ok: true, last: JSON.parse(PROPS.getProperty('INSIGHTS_LAST') || 'null') }); }
    if (body.action === 'records_add') {
      (body.records || []).forEach(function (r) { addRecord_(Object.assign({ metrics: {}, metrics_at: null }, r)); });
      return out_({ ok: true, added: (body.records || []).length });
    }
    return out_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}

function doGet() { return out_({ ok: true, service: 'autopost' }); }

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ===================== Хранилище (JSON в Google Drive) ===================== */

function folder_() {
  let id = PROPS.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = DriveApp.createFolder('IG Autopost (не удалять)');
  PROPS.setProperty('FOLDER_ID', f.getId());
  return f;
}
function jsonFile_(name) {
  const it = folder_().getFilesByName(name);
  if (it.hasNext()) return it.next();
  return folder_().createFile(name, '[]', 'application/json');
}
function readJson_(name) { return JSON.parse(jsonFile_(name).getBlob().getDataAsString() || '[]'); }
function writeJson_(name, data) { jsonFile_(name).setContent(JSON.stringify(data)); }
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ===================== Журнал публикаций ===================== */
// запись: {id, platform:'ig'|'threads', account, kind:'story'|'news'|'trend', dir:'IMM'|'PI'|'USA', format, tag, title, text, at, metrics:{}, metrics_at}

function addRecord_(rec) {
  withLock_(function () {
    const all = readJson_('analytics.json');
    all.push(rec);
    const keep = Date.now() - 120 * 24 * 3600 * 1000;
    writeJson_('analytics.json', all.filter(function (r) { return new Date(r.at).getTime() >= keep; }));
  });
}

/* ===================== Instagram Stories ===================== */

function token_(account) {
  const key = account === 'pi' ? 'TOKEN_PI' : account === 'imm' ? 'TOKEN_IMM' : null;
  if (!key) throw new Error('unknown account: ' + account);
  const t = PROPS.getProperty(key);
  if (!t) throw new Error(key + ' is not set');
  return t;
}

function ping_(account) {
  const r = api_('get', '/me?fields=user_id,username,account_type', token_(account));
  return { ok: true, account: account, username: r.username, account_type: r.account_type, user_id: r.user_id };
}

function publishStory_(account, b64, name, meta) {
  if (!b64) throw new Error('no image');
  const token = token_(account);
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', name + '.jpg');
  const file = folder_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const url = 'https://lh3.googleusercontent.com/d/' + file.getId();

  const c = api_('post', '/me/media', token, { image_url: url, media_type: 'STORIES' });
  let status = '';
  for (let i = 0; i < 20; i++) {
    status = api_('get', '/' + c.id + '?fields=status_code', token).status_code;
    if (status === 'FINISHED') break;
    if (status === 'ERROR' || status === 'EXPIRED') throw new Error('container ' + status);
    Utilities.sleep(3000);
  }
  if (status !== 'FINISHED') throw new Error('container not ready: ' + status);
  const p = api_('post', '/me/media_publish', token, { creation_id: c.id });
  addRecord_({
    id: p.id, platform: 'ig', account: account, kind: 'story',
    dir: meta.dir || '', format: meta.format || 'news', tag: meta.tag || '', title: meta.title || '', text: meta.text || '',
    name: name, at: new Date().toISOString(), metrics: {}, metrics_at: null
  });
  return { ok: true, account: account, media_id: p.id, name: name };
}

function api_(method, path, token, payload) {
  const sep = path.indexOf('?') >= 0 ? '&' : '?';
  const opts = { method: method, muteHttpExceptions: true };
  let url = API + path;
  if (method === 'get') {
    url += sep + 'access_token=' + encodeURIComponent(token);
  } else {
    opts.payload = Object.assign({}, payload || {}, { access_token: token });
  }
  const res = UrlFetchApp.fetch(url, opts);
  const data = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() >= 400 || data.error) {
    throw new Error('IG API ' + res.getResponseCode() + ': ' + (data.error ? data.error.message : res.getContentText()));
  }
  return data;
}

/* ===================== Журнал тем (защита от повторов) ===================== */

function topicsGet_(days) {
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const all = readJson_('topics_log.json');
  return { ok: true, topics: all.filter(function (t) { return new Date(t.date).getTime() >= cutoff; }) };
}

function topicsAdd_(items) {
  return withLock_(function () {
    const all = readJson_('topics_log.json');
    const keep = Date.now() - 60 * 24 * 3600 * 1000;
    const merged = all.concat(items).filter(function (t) { return new Date(t.date).getTime() >= keep; });
    writeJson_('topics_log.json', merged);
    return { ok: true, added: items.length, total: merged.length };
  });
}

/* ===================== Threads: очередь и публикация ===================== */

function threadsQueue_(posts) {
  return withLock_(function () {
    const q = readJson_('threads_queue.json');
    posts.forEach(function (p) {
      const o = typeof p === 'string' ? { text: p } : p;
      const text = String(o.text || '').trim().slice(0, 490);
      if (text) q.push({ text: text, kind: o.kind || '', dir: o.dir || '', format: o.format || '', added: new Date().toISOString() });
    });
    writeJson_('threads_queue.json', q);
    return { ok: true, queued: posts.length, queue_length: q.length };
  });
}

function threadsStatus_() {
  const q = readJson_('threads_queue.json');
  const log = readJson_('threads_log.json');
  return { ok: true, queue_length: q.length, last: log.slice(-5), token_set: !!PROPS.getProperty('TOKEN_THREADS') };
}

/** Таймер (каждые 10 минут): публикует один пост, равномерно распределяя очередь до 22:00 PT. */
function threadsTick() {
  const now = new Date();
  const hour = Number(Utilities.formatDate(now, 'America/Los_Angeles', 'H'));
  const minute = Number(Utilities.formatDate(now, 'America/Los_Angeles', 'm'));
  if (hour < 7 || hour >= 22) return;
  const token = PROPS.getProperty('TOKEN_THREADS');
  if (!token) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  let published = null;
  try {
    const q = readJson_('threads_queue.json');
    if (!q.length) return;
    const remaining = 22 * 60 - (hour * 60 + minute);
    const interval = Math.min(30, Math.max(10, remaining / q.length));
    const last = Number(PROPS.getProperty('THREADS_LAST_AT') || 0);
    if (last && (now.getTime() - last) / 60000 < interval - 1) return;
    const item = q[0];
    const log = readJson_('threads_log.json');
    try {
      const c = threadsApi_('post', '/me/threads', token, { media_type: 'TEXT', text: item.text });
      Utilities.sleep(5000);
      const p = threadsApi_('post', '/me/threads_publish', token, { creation_id: c.id });
      q.shift();
      PROPS.setProperty('THREADS_LAST_AT', String(Date.now()));
      log.push({ at: new Date().toISOString(), ok: true, id: p.id, text: item.text.slice(0, 80) });
      published = { id: p.id, item: item };
    } catch (err) {
      item.tries = (item.tries || 0) + 1;
      if (item.tries >= 3) q.shift();
      log.push({ at: new Date().toISOString(), ok: false, error: String(err.message || err), text: item.text.slice(0, 80) });
    }
    writeJson_('threads_queue.json', q);
    writeJson_('threads_log.json', log.slice(-300));
  } finally { lock.releaseLock(); }
  if (published) {
    const it = published.item;
    addRecord_({
      id: published.id, platform: 'threads', account: 'threads', kind: it.kind || 'post',
      dir: it.dir || '', format: it.format || '', tag: '', title: '', text: it.text,
      at: new Date().toISOString(), metrics: {}, metrics_at: null
    });
  }
}

function threadsApi_(method, path, token, payload) {
  let url = THREADS_API + path;
  const opts = { method: method, muteHttpExceptions: true };
  if (method === 'get') url += (path.indexOf('?') >= 0 ? '&' : '?') + 'access_token=' + encodeURIComponent(token);
  else opts.payload = Object.assign({}, payload || {}, { access_token: token });
  const res = UrlFetchApp.fetch(url, opts);
  const data = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() >= 400 || data.error) throw new Error('Threads API ' + res.getResponseCode() + ': ' + (data.error ? data.error.message : res.getContentText()));
  return data;
}

/* ===================== Сбор статистики ===================== */

function metricValues_(data) {
  const m = {};
  (data.data || []).forEach(function (d) {
    let v = null;
    if (d.total_value && d.total_value.value != null) v = d.total_value.value;
    else if (d.values && d.values.length) v = d.values[d.values.length - 1].value;
    if (typeof v === 'number') m[d.name] = v;
  });
  return m;
}

function igInsights_(rec) {
  const token = token_(rec.account);
  const sets = ['reach,replies,shares,total_interactions,views,navigation', 'reach,replies,shares,total_interactions,views', 'reach,replies'];
  for (let i = 0; i < sets.length; i++) {
    try { return metricValues_(api_('get', '/' + rec.id + '/insights?metric=' + sets[i], token)); } catch (e) { if (i === sets.length - 1) throw e; }
  }
}

function threadsInsights_(rec) {
  const token = PROPS.getProperty('TOKEN_THREADS');
  return metricValues_(threadsApi_('get', '/' + rec.id + '/insights?metric=views,likes,replies,reposts,quotes,shares', token));
}

/** Таймер (каждый час): обновляет метрики. Сторис — первые 24 часа (потом Instagram их не отдаёт), Threads — 7 дней. */
function collectInsights() {
  const all = withLock_(function () { return readJson_('analytics.json'); });
  const now = Date.now();
  const updates = {};
  const errors = [];
  all.forEach(function (r) {
    const age = (now - new Date(r.at).getTime()) / 3600000;
    const fresh = r.platform === 'ig' ? age <= 24 : age <= 24 * 7;
    if (!fresh) return;
    if (r.metrics_at && (now - new Date(r.metrics_at).getTime()) < 50 * 60000) return;
    try {
      const m = r.platform === 'ig' ? igInsights_(r) : threadsInsights_(r);
      updates[r.id + '|' + r.account] = m;
    } catch (e) { errors.push(String(e.message || e).slice(0, 160)); }
  });
  withLock_(function () {
    const cur = readJson_('analytics.json');
    cur.forEach(function (r) {
      const m = updates[r.id + '|' + r.account];
      if (m) { r.metrics = Object.assign({}, r.metrics || {}, m); r.metrics_at = new Date().toISOString(); }
    });
    writeJson_('analytics.json', cur);
  });
  PROPS.setProperty('INSIGHTS_LAST', JSON.stringify({ at: new Date().toISOString(), updated: Object.keys(updates).length, errors: errors.slice(0, 5) }));
}

/** Единая оценка поста для сравнения. */
function score_(r) {
  const m = r.metrics || {};
  if (r.platform === 'threads') return (m.likes || 0) + 3 * (m.replies || 0) + 4 * (m.reposts || 0) + 3 * (m.quotes || 0) + 2 * (m.shares || 0);
  return (m.reach || 0) * 0.05 + 3 * (m.replies || 0) + 4 * (m.shares || 0) + (m.total_interactions || 0);
}
function views_(r) { const m = r.metrics || {}; return r.platform === 'threads' ? (m.views || 0) : (m.reach || m.views || 0); }

/* ===================== Данные для панели и задач ===================== */

function analytics_(days) {
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const recs = readJson_('analytics.json').filter(function (r) { return new Date(r.at).getTime() >= cutoff; });
  recs.forEach(function (r) { r.score = Math.round(score_(r) * 10) / 10; r.views = views_(r); });
  const q = readJson_('threads_queue.json');
  return {
    ok: true, generated: new Date().toISOString(), days: days, records: recs,
    queue: q.map(function (x) { return { text: x.text, kind: x.kind, dir: x.dir, format: x.format }; }),
    insights_last: JSON.parse(PROPS.getProperty('INSIGHTS_LAST') || 'null')
  };
}

function group_(recs, key) {
  const g = {};
  recs.forEach(function (r) {
    const k = (r[key] || '—');
    g[k] = g[k] || { n: 0, score: 0, views: 0 };
    g[k].n++; g[k].score += score_(r); g[k].views += views_(r);
  });
  return Object.keys(g).map(function (k) {
    return { key: k, posts: g[k].n, avg_score: Math.round(g[k].score / g[k].n * 10) / 10, avg_views: Math.round(g[k].views / g[k].n) };
  }).sort(function (a, b) { return b.avg_score - a.avg_score; });
}

/** Сводка для ежедневных задач: что заходит лучше всего за N дней. */
function insightsSummary_(days) {
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const recs = readJson_('analytics.json').filter(function (r) { return new Date(r.at).getTime() >= cutoff && r.metrics_at; });
  const th = recs.filter(function (r) { return r.platform === 'threads'; });
  const ig = recs.filter(function (r) { return r.platform === 'ig'; });
  const sortS = function (a, b) { return score_(b) - score_(a); };
  const brief = function (r) { return { text: (r.title || r.text || '').slice(0, 160), tag: r.tag, dir: r.dir, format: r.format, kind: r.kind, account: r.account, score: Math.round(score_(r) * 10) / 10, metrics: r.metrics }; };
  return {
    ok: true, days: days, measured_posts: recs.length,
    threads: { by_format: group_(th, 'format'), by_dir: group_(th, 'dir'), by_kind: group_(th, 'kind'),
      top: th.slice().sort(sortS).slice(0, 10).map(brief), bottom: th.slice().sort(sortS).reverse().slice(0, 5).map(brief) },
    stories: { by_tag: group_(ig, 'tag'), by_dir: group_(ig, 'dir'), by_account: group_(ig, 'account'),
      top: ig.slice().sort(sortS).slice(0, 10).map(brief), bottom: ig.slice().sort(sortS).reverse().slice(0, 5).map(brief) }
  };
}

/* ===================== Токены и обслуживание ===================== */

function refreshTokens() {
  ['TOKEN_IMM', 'TOKEN_PI'].forEach(function (k) {
    const t = PROPS.getProperty(k);
    if (!t) return;
    const res = UrlFetchApp.fetch('https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=' + encodeURIComponent(t), { muteHttpExceptions: true });
    const d = JSON.parse(res.getContentText() || '{}');
    if (d.access_token) PROPS.setProperty(k, d.access_token);
    else console.warn(k + ' refresh failed: ' + res.getContentText());
  });
}

function refreshThreadsToken() {
  const t = PROPS.getProperty('TOKEN_THREADS');
  if (!t) return;
  const res = UrlFetchApp.fetch('https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=' + encodeURIComponent(t), { muteHttpExceptions: true });
  const d = JSON.parse(res.getContentText() || '{}');
  if (d.access_token) PROPS.setProperty('TOKEN_THREADS', d.access_token);
  else console.warn('Threads refresh failed: ' + res.getContentText());
}

/** Удаляет картинки старше 7 дней (JSON-файлы не трогает). */
function cleanup() {
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  const it = folder_().getFiles();
  while (it.hasNext()) { const f = it.next(); if (!/\.json$/.test(f.getName()) && f.getDateCreated().getTime() < cutoff) f.setTrashed(true); }
}

/** Таймеры Threads (существующие другие не трогает). */
function setupThreads() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'threadsTick') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('threadsTick').timeBased().everyMinutes(10).create();
  const have = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (have.indexOf('refreshThreadsToken') < 0) ScriptApp.newTrigger('refreshThreadsToken').timeBased().everyDays(7).atHour(3).create();
  jsonFile_('threads_queue.json'); jsonFile_('threads_log.json');
}

/** Запустить один раз после обновления: аналитика (READ_KEY, analytics.json, ежечасный сбор). */
function setupAnalytics() {
  if (!PROPS.getProperty('READ_KEY')) PROPS.setProperty('READ_KEY', Utilities.getUuid().replace(/-/g, '').slice(0, 16));
  jsonFile_('analytics.json');
  const have = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (have.indexOf('collectInsights') < 0) ScriptApp.newTrigger('collectInsights').timeBased().everyHours(1).create();
  console.log('READ_KEY: ' + PROPS.getProperty('READ_KEY'));
}

/** Полная первичная настройка (удаляет и пересоздаёт все таймеры). */
function setup() {
  if (!PROPS.getProperty('SECRET')) PROPS.setProperty('SECRET', Utilities.getUuid().replace(/-/g, ''));
  folder_();
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('refreshTokens').timeBased().everyDays(7).atHour(3).create();
  ScriptApp.newTrigger('cleanup').timeBased().everyDays(1).atHour(4).create();
  setupThreads();
  setupAnalytics();
}
