import { account, api, acceptSession, loadGoogle, logout, onAccountChange, restoreSession } from './api';
import type { Analytics, QRDraft, QRRecord } from './models';
import { buildSVG } from './qr';
import './workspace.css';

export interface EditorBridge {
  draft(): QRDraft;
  record(): QRRecord | null;
  load(record: QRRecord): void;
  saved(record: QRRecord): void;
  dynamic(fresh?: boolean): void;
  reset(): void;
  dirty(): boolean;
  static(): void;
  valid(): boolean;
  toast(message: string): void;
}
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const number = (n: number) => n.toLocaleString();
const date = (s: string) => new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
let bridge: EditorBridge;
let records: QRRecord[] = [], selected: QRRecord | null = null, range = 30, sequence = 0;
let saving = false, saveKey = '', saveSignature = '', workspaceOpen = false;
let resolveLogin: ((success: boolean) => void) | null = null;
let authVersion = 0;

export function initWorkspace(editor: EditorBridge) {
  bridge = editor;
  const pilot = import.meta.env.VITE_CREATOR_ACCESS !== 'public';
  document.body.classList.toggle('pilot-locked', pilot && !account);
  $('main').insertAdjacentHTML('afterbegin', `<section id="pilot-gate" class="pilot-gate wrap"><div><span class="eyebrow">THE FYND TEAM PILOT</span><h1>Small square.<br>Endless possibilities.</h1><p>A home for your team’s connections. Create beautiful QR codes, update destinations, and see where each scan takes you.</p><button class="button-primary" id="pilot-signin">Continue with your work account <span>↗</span></button><span class="pilot-note">Available to gofynd.com Google Workspace accounts.</span></div><div class="pilot-art" aria-hidden="true"><div>${buildSVG('https://example.com', { foreground: '#171717', background: '#ffffff', pattern: 'rounded', eyeFrame: 'rounded', eyeBall: 'rounded' }, 260)}</div><span>CREATE. CONNECT. UNDERSTAND.</span></div></section>`);
  $('#pilot-signin').addEventListener('click', () => void requireAuth('Welcome to the Fynd team pilot. Use your work Google account to open the generator.'));
  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="account-dialog" class="account-dialog" aria-labelledby="account-title"><button class="dialog-close" data-close="account-dialog" aria-label="Close sign in">×</button><span class="eyebrow">YOUR CREATIVE SPACE</span><h2 id="account-title">Keep your connections.</h2><p id="account-reason"></p><div class="auth-benefits"><span>↗ Change a destination anytime</span><span>▥ Understand your scans</span><span>▦ Keep your codes together</span></div><div id="auth-options"></div><p id="auth-error" class="field-error" role="alert"></p><button id="retry-auth" class="text-button" hidden>Try again</button><p class="small-note">Work accounts ending in gofynd.com only. ${import.meta.env.VITE_CREATOR_ACCESS === 'public' ? 'Static generation and downloads stay open to everyone.' : 'The creator tools are available to the Fynd team during this pilot.'}</p></dialog>
    <dialog id="save-dialog" aria-labelledby="save-title"><button class="dialog-close" data-close="save-dialog" aria-label="Close save">×</button><span class="eyebrow">A LITTLE ORGANIZATION</span><h2 id="save-title">Give your code a name.</h2><form id="save-form"><label class="field-label" for="save-name">Code name</label><input id="save-name" class="workspace-input" maxlength="80" required placeholder="e.g. Reception Wi-Fi"><p class="small-note">Saving stores this code’s content and logo in your account. This includes any Wi-Fi password or contact details you entered.</p><p id="save-error" class="field-error" role="alert"></p><button class="button-primary" id="save-confirm">Save to My QR Codes <span>↗</span></button></form></dialog>
    <dialog id="confirm-dialog" aria-labelledby="confirm-title"><button class="dialog-close" data-close="confirm-dialog" aria-label="Cancel">×</button><h2 id="confirm-title"></h2><p id="confirm-description"></p><div class="dialog-actions"><button class="button-secondary" id="confirm-cancel">Cancel</button><button class="button-primary" id="confirm-yes">Continue</button></div></dialog>
  `);
  $('main').insertAdjacentHTML('beforeend', `<section id="workspace" class="workspace wrap" hidden aria-labelledby="workspace-title" tabindex="-1"><div id="workspace-content"></div></section>`);
  document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => $<HTMLDialogElement>(`#${(el as HTMLElement).dataset.close}`).close()));
  $('#account-dialog').addEventListener('close', () => { ++authVersion; resolveLogin?.(false); resolveLogin = null; });
  $('#retry-auth').addEventListener('click', () => void authOptions());
  document.querySelectorAll('[data-dynamic]').forEach(el => el.addEventListener('click', () => void startDynamic()));
  document.querySelectorAll('[data-static]').forEach(el => el.addEventListener('click', () => { showEditor(); bridge.static(); }));
  document.querySelectorAll('.brand, .nav-cta').forEach(el => el.addEventListener('click', () => { if (!pilot || account) showEditor(); }));
  $('#my-codes').addEventListener('click', () => void showLibrary());
  $('#account-button').addEventListener('click', () => void (account ? showLibrary() : requireAuth('Sign in to save your codes and make every scan count.')));
  $('#save-static').addEventListener('click', () => void saveStatic());
  $('#save-form').addEventListener('submit', async event => {
    event.preventDefault(); if (saving) return;
    const name = $<HTMLInputElement>('#save-name').value.trim(); if (!name) return;
    $('#save-error').textContent = '';
    try { await persist({ ...bridge.draft(), name }); $<HTMLDialogElement>('#save-dialog').close(); bridge.toast('Saved. Find it anytime in My QR Codes.'); }
    catch (error) { $('#save-error').textContent = (error as Error).message; }
  });
  onAccountChange(() => {
    document.body.classList.toggle('pilot-locked', pilot && !account);
    $('#account-button').textContent = account ? (account.localPreview ? 'Local preview' : account.name.split(' ')[0]) : 'Sign in';
    if (!account) { records = []; selected = null; if (workspaceOpen) showEditor(); }
  });
  void restoreSession();
}
export async function requireAuth(reason: string): Promise<boolean> {
  if (account) return true;
  if (resolveLogin) return false;
  $('#account-reason').textContent = reason;
  const result = new Promise<boolean>(resolve => { resolveLogin = resolve; });
  $<HTMLDialogElement>('#account-dialog').showModal(); void authOptions();
  return result;
}
async function authOptions() {
  const version = ++authVersion;
  $('#auth-options').innerHTML = '<p class="workspace-muted" role="status">Getting sign-in ready…</p>';
  $('#auth-error').textContent = ''; $('#retry-auth').hidden = true;
  const finish = (session: Parameters<typeof acceptSession>[0]) => {
    if (version !== authVersion) return;
    acceptSession(session); const resolve = resolveLogin; resolveLogin = null;
    $<HTMLDialogElement>('#account-dialog').close(); resolve?.(true);
  };
  try {
    const config = await api<{ googleClientId: string; localPreview: boolean }>('/config');
    if (version !== authVersion) return;
    $('#auth-options').innerHTML = '';
    if (config.localPreview) {
      $('#auth-options').innerHTML = '<div class="local-preview-note"><strong>Local testing only</strong><p>Try the full journey with a test account on this computer. This is not Google sign-in.</p><button id="local-signin" class="button-secondary">Continue with local test account</button></div>';
      $('#local-signin').addEventListener('click', async () => {
        $<HTMLButtonElement>('#local-signin').disabled = true;
        try { finish(await api('/auth/local-preview', { method: 'POST' })); }
        catch (error) { if (version === authVersion) { $('#auth-error').textContent = (error as Error).message; $<HTMLButtonElement>('#local-signin').disabled = false; } }
      });
    }
    if (config.googleClientId) {
      const [challenge] = await Promise.all([api<{ id: string; nonce: string }>('/auth/challenge', { method: 'POST' }), loadGoogle()]);
      if (version !== authVersion) return;
      const container = document.createElement('div'); container.className = 'google-signin'; $('#auth-options').prepend(container);
      window.google!.accounts.id.initialize({ client_id: config.googleClientId, nonce: challenge.nonce, auto_select: false, callback: async response => {
        if (version !== authVersion) return;
        $('#auth-error').textContent = ''; container.setAttribute('inert', '');
        try { finish(await api('/auth/google', { method: 'POST', body: { credential: response.credential, challengeId: challenge.id } })); }
        catch (error) { if (version === authVersion) { $('#auth-error').textContent = (error as Error).message; $('#retry-auth').hidden = false; container.removeAttribute('inert'); } }
      } });
      window.google!.accounts.id.renderButton(container, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', width: 300 });
    } else if (!config.localPreview) throw new Error('Google sign-in is not configured yet. Please contact the pilot owner.');
  } catch (error) {
    if (version !== authVersion) return;
    $('#auth-options').innerHTML = ''; $('#auth-error').textContent = (error as Error).message; $('#retry-auth').hidden = false;
  }
}
function showEditor() {
  workspaceOpen = false; ++sequence; $('#workspace').hidden = true;
  document.querySelectorAll<HTMLElement>('main > :not(#workspace)').forEach(el => el.hidden = false);
}
export async function startDynamic(fresh = false) {
  if (fresh && bridge.dirty() && !await confirm('Start a new code?', 'Your current unsaved changes will be replaced. Saved codes remain in My QR Codes.', 'Start a new code')) return;
  if (!await requireAuth('Sign in to create an editable link, save your design, and see how it performs.')) return;
  showEditor(); bridge.dynamic(fresh); $('#generator').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function saveStatic() {
  if (!bridge.valid()) { bridge.toast('Check your content and colors before saving.'); return; }
  if (!await requireAuth('Save this design to your account so it is ready next time.')) return;
  $<HTMLInputElement>('#save-name').value = bridge.record()?.name || '';
  $('#save-error').textContent = ''; $<HTMLDialogElement>('#save-dialog').showModal(); $('#save-name').focus();
}
async function persist(draft: QRDraft): Promise<QRRecord> {
  if (saving) throw new Error('Your code is being saved.');
  saving = true; $<HTMLButtonElement>('#save-confirm').disabled = true;
  try {
    const existing = bridge.record(), signature = JSON.stringify(draft);
    if (signature !== saveSignature) { saveSignature = signature; saveKey = crypto.randomUUID(); }
    const { code } = existing
      ? await api<{ code: QRRecord }>(`/codes/${existing.id}`, { method: 'PATCH', body: { revision: existing.revision, draft } })
      : await api<{ code: QRRecord }>('/codes', { method: 'POST', body: draft, key: saveKey });
    bridge.saved(code); saveKey = ''; saveSignature = ''; return code;
  } finally { saving = false; $<HTMLButtonElement>('#save-confirm').disabled = false; }
}
export async function saveDynamic(): Promise<boolean> {
  if (!bridge.valid()) return false;
  if (!await requireAuth('Sign in to activate this dynamic code. Your design is ready to save.')) return false;
  try { await persist(bridge.draft()); bridge.toast('Dynamic code saved. Your scan link stays the same.'); return true; }
  catch (error) { $('#dynamic-error').textContent = (error as Error).message; return false; }
}
function card(code: QRRecord) {
  const preview = buildSVG(code.payload, code.design, 100);
  return `<article class="code-card"><button class="code-card-open" data-open="${code.id}" aria-label="Open ${escape(code.name)}"><div class="code-card-top"><span class="kind-badge ${code.kind}">${code.kind === 'dynamic' ? '↗ Dynamic' : '▦ Static'}</span><span class="state-badge ${code.status}">${code.status}</span></div><div class="card-preview">${preview}</div><h3>${escape(code.name)}</h3><p class="code-destination">${escape(code.kind === 'dynamic' ? code.destination! : `${code.contentType.toUpperCase()} · Saved design`)}</p><div class="card-foot"><span>${code.kind === 'dynamic' ? `<strong>${number(code.totalScans)}</strong> scans` : 'Ready to download'}</span><span>${code.kind === 'dynamic' ? 'View analytics ↗' : 'Open editor ↗'}</span></div></button></article>`;
}
export async function showLibrary() {
  if (!await requireAuth('Your codes, in one place. Sign in with your work Google account to continue.')) return;
  workspaceOpen = true; document.querySelectorAll<HTMLElement>('main > :not(#workspace)').forEach(el => el.hidden = true); $('#workspace').hidden = false;
  selected = null;
  const current = ++sequence;
  $('#workspace-content').innerHTML = '<p class="workspace-loading" role="status">Finding your connections…</p>';
  $('#workspace').focus(); window.scrollTo({ top: 0, behavior: 'smooth' });
  try { records = (await api<{ codes: QRRecord[] }>('/codes')).codes; if (current === sequence) renderLibrary(); }
  catch (error) { if (current === sequence) showError(error, () => void showLibrary()); }
}
function showError(error: unknown, retry: () => void) {
  $('#workspace-content').innerHTML = `<div class="workspace-empty"><h2>Let’s try that again.</h2><p>${escape((error as Error).message)}</p><div class="inline-actions"><button class="button-primary" id="workspace-retry">Retry</button><button class="button-secondary" id="workspace-back">Back to generator</button></div></div>`;
  $('#workspace-retry').addEventListener('click', retry); $('#workspace-back').addEventListener('click', showEditor);
}
function renderLibrary() {
  const live = records.filter(r => r.status !== 'archived');
  $('#workspace-content').innerHTML = `<div class="workspace-heading"><div><button class="text-button back-button" id="back-generator">← Back to generator</button><div class="eyebrow">YOUR CONNECTIONS, COLLECTED</div><h1 id="workspace-title">My QR Codes<span class="title-dot">.</span></h1><p>Little squares. Big possibilities. Everything you’ve saved, right here.</p></div><div class="workspace-actions"><button class="button-primary" id="new-dynamic">Create dynamic QR <span>↗</span></button><button class="text-button" id="signout">Sign out${account?.localPreview ? ' of local preview' : ''}</button></div></div>
    ${account?.localPreview ? '<p class="preview-banner">LOCAL PREVIEW · Saved on this computer. These dynamic links are for local testing and cannot be scanned from another device.</p>' : ''}
    <div class="library-summary"><div><strong>${number(live.length)}</strong><span>Saved codes</span></div><div><strong>${number(live.filter(r => r.kind === 'dynamic').length)}</strong><span>Dynamic connections</span></div><div><strong>${number(records.reduce((n, r) => n + r.totalScans, 0))}</strong><span>All-time recorded scans</span></div></div>
    <div class="library-toolbar"><div class="filter-tabs" role="group" aria-label="Filter codes"><button data-filter="all" aria-pressed="true">All codes</button><button data-filter="dynamic" aria-pressed="false">Dynamic</button><button data-filter="static" aria-pressed="false">Static</button><button data-filter="archived" aria-pressed="false">Archived</button></div><label class="search-field"><span class="sr-only">Search your codes</span><input id="code-search" type="search" placeholder="Search by name or destination"></label></div><p id="result-count" class="sr-only" role="status"></p><div id="code-grid" class="code-grid"></div>`;
  $('#back-generator').addEventListener('click', showEditor); $('#new-dynamic').addEventListener('click', () => void startDynamic(true));
  $('#signout').addEventListener('click', async () => { try { await logout(); bridge.reset(); window.google?.accounts.id.disableAutoSelect(); bridge.toast('Signed out. Your saved codes will be here next time.'); } catch (error) { bridge.toast((error as Error).message); } });
  let filter = 'all';
  const update = () => {
    const search = $<HTMLInputElement>('#code-search').value.trim().toLowerCase();
    const found = records.filter(r => (filter === 'archived' ? r.status === 'archived' : r.status !== 'archived' && (filter === 'all' || r.kind === filter)) && `${r.name} ${r.destination || ''}`.toLowerCase().includes(search));
    $('#result-count').textContent = `${found.length} codes`;
    $('#code-grid').innerHTML = found.length ? found.map(card).join('') : `<div class="workspace-empty"><div class="empty-symbol">↗</div><h2>${records.length ? 'No codes here yet.' : 'Your next connection starts here.'}</h2><p>${records.length ? 'Try another filter or a different search.' : 'Create a dynamic QR to change destinations anytime, or save a static design from the generator.'}</p>${records.length ? '' : '<button class="button-primary" id="empty-create">Create your first dynamic QR ↗</button>'}</div>`;
    $('#empty-create')?.addEventListener('click', () => void startDynamic(true));
    document.querySelectorAll<HTMLElement>('[data-open]').forEach(el => el.addEventListener('click', () => {
      const code = records.find(r => r.id === el.dataset.open)!;
      if (code.kind === 'dynamic') void showDetail(code); else { showEditor(); bridge.load(code); $('#generator').scrollIntoView({ behavior: 'smooth' }); }
    }));
  };
  document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter!; document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b === button))); update(); }));
  $('#code-search').addEventListener('input', update); update();
}
async function showDetail(code: QRRecord) {
  selected = code; const current = ++sequence;
  $('#workspace-content').innerHTML = '<p class="workspace-loading" role="status">Bringing your scans into focus…</p>';
  try {
    const data = await api<{ analytics: Analytics; code: QRRecord }>(`/codes/${code.id}/analytics?days=${range}`);
    if (current !== sequence) return;
    selected = data.code; renderDetail(data.code, data.analytics);
  } catch (error) { if (current === sequence) showError(error, () => void showDetail(code)); }
}
function bars(title: string, rows: { label: string; count: number }[], total: number) {
  return `<section class="breakdown"><h3>${title}</h3>${rows.length ? rows.map(row => `<div class="breakdown-row"><div><span>${escape(row.label)}</span><span>${number(row.count)} <small>${Math.round(row.count / Math.max(total, 1) * 100)}%</small></span></div><div class="bar-track"><i style="width:${row.count / Math.max(total, 1) * 100}%"></i></div></div>`).join('') : '<p class="workspace-muted">The story starts with your first scan.</p>'}</section>`;
}
function renderDetail(code: QRRecord, data: Analytics) {
  const max = Math.max(1, ...data.daily.map(d => d.scans)), step = 700 / data.days, width = Math.max(2, step * .65);
  const chart = data.daily.map((d, i) => `<rect x="${48 + step * i + (step - width) / 2}" y="${180 - d.scans / max * 150}" width="${width}" height="${Math.max(d.scans ? 3 : 1, d.scans / max * 150)}" rx="2" fill="${d.scans ? '#161616' : '#eaeaea'}"><title>${d.day}: ${d.scans} scans, ${d.visitors} estimated visitors</title></rect>`).join('');
  $('#workspace-content').innerHTML = `<button class="text-button back-button" id="back-library">← All my QR codes</button><div class="workspace-heading detail-heading"><div><div class="detail-badges"><span class="kind-badge dynamic">↗ Dynamic QR</span><span class="state-badge ${code.status}">${code.status}</span></div><h1 id="workspace-title">${escape(code.name)}</h1><p>One permanent code. A destination that moves with you.</p></div><div class="workspace-actions"><button class="button-primary" id="edit-code">Edit & download <span>↗</span></button><button class="text-button" id="refresh-analytics">Refresh analytics</button></div></div>
    <div class="destination-panel"><div class="detail-preview">${buildSVG(code.payload, code.design, 120)}</div><div class="destination-info"><span class="field-label">PERMANENT SCAN LINK</span><div class="scan-link"><span>${escape(code.scanUrl!)}</span><button class="text-button" id="copy-scan">Copy link</button></div><span class="destination-arrow">↳ Takes people to</span><p>${escape(code.destination!)}</p></div><div class="destination-actions"><button class="button-secondary" id="change-destination">Change destination</button><button class="text-button" id="toggle-code">${code.status === 'active' ? 'Pause code' : 'Activate code'}</button><button class="text-button danger-text" id="archive-code" ${code.status === 'archived' ? 'hidden' : ''}>Archive</button></div></div>
    ${code.status !== 'active' ? `<p class="preview-banner">This code is ${code.status}. Scanners will not be redirected until you activate it.</p>` : ''}
    <div class="analytics-heading"><div><h2>A closer look at your scans.</h2><p class="workspace-muted">Recorded requests, with known automated traffic separated.</p></div><div class="analytics-controls"><label class="sr-only" for="analytics-range">Analytics date range</label><select id="analytics-range"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select><button class="button-secondary" id="export-analytics">Export CSV ↓</button></div></div>
    <div class="analytics-metrics"><div><span>Scans</span><strong>${number(data.scans)}</strong><small>Excludes recognized bots</small></div><div><span>Estimated visitors</span><strong>${number(data.visitors)}</strong><small>Approximate devices, not people</small></div><div><span>Automated requests</span><strong>${number(data.automated)}</strong><small>Recognized bots & previews</small></div><div><span>All-time scans</span><strong>${number(code.totalScans)}</strong><small>${code.lastScanAt ? `Last scan ${date(code.lastScanAt)}` : 'Ready for your first scan'}</small></div></div>
    <section class="scan-chart"><div><h3>Scans over time</h3><span>Daily · UTC</span></div>${data.scans ? '' : '<p class="chart-empty">Nothing to chart just yet. Share your code to start the story.</p>'}<svg viewBox="0 0 780 225" role="img" aria-label="Daily scans for the last ${data.days} days; ${data.scans} total. Daily values are in the table below."><path d="M48 30H748M48 105H748M48 180H748" stroke="#eeeeee" stroke-width="1"/><text x="34" y="34" text-anchor="end">${max}</text><text x="34" y="184" text-anchor="end">0</text>${chart}<text x="48" y="210">${date(data.daily[0].day)}</text><text x="748" y="210" text-anchor="end">${date(data.daily.at(-1)!.day)}</text></svg><details class="daily-table"><summary>View daily numbers</summary><div class="table-scroll"><table><thead><tr><th>Date (UTC)</th><th>Scans</th><th>Estimated visitors</th></tr></thead><tbody>${data.daily.map(d => `<tr><td>${d.day}</td><td>${d.scans}</td><td>${d.visitors}</td></tr>`).join('')}</tbody></table></div></details></section>
    <div class="breakdown-grid">${bars('Devices', data.devices, data.scans)}${bars('Browsers', data.browsers, data.scans)}${bars('Countries', data.countries, data.scans)}${bars('Referring websites', data.referrers, data.scans)}</div><p class="analytics-footnote">A scan is a recorded redirect request; repeat visits count again. Estimated visitors use a code-specific hash of network address and browser information. Shared networks, privacy tools, and unrecognized bots can affect accuracy. Countries appear only when supplied by trusted hosting infrastructure. Referrers are often unavailable for camera scans. Detailed events are retained for 90 days; all-time counts remain. No raw IP addresses or full browser identifiers are stored in scan analytics.</p>`;
  $('#back-library').addEventListener('click', () => void showLibrary());
  const edit = () => { showEditor(); bridge.load(code); $('#generator').scrollIntoView({ behavior: 'smooth' }); };
  $('#edit-code').addEventListener('click', edit); $('#change-destination').addEventListener('click', () => { edit(); $('#field-url').focus(); });
  $('#refresh-analytics').addEventListener('click', () => void showDetail(code));
  $<HTMLSelectElement>('#analytics-range').value = String(range);
  $('#analytics-range').addEventListener('change', e => { range = Number((e.target as HTMLSelectElement).value); void showDetail(code); });
  $('#copy-scan').addEventListener('click', async () => { try { await navigator.clipboard.writeText(code.scanUrl!); bridge.toast('Permanent scan link copied.'); } catch { bridge.toast('Could not copy. Select the scan link above to copy it.'); } });
  $('#export-analytics').addEventListener('click', () => exportCSV(code, data));
  $('#toggle-code').addEventListener('click', () => void changeStatus(code, code.status === 'active' ? 'paused' : 'active'));
  $('#archive-code').addEventListener('click', () => void changeStatus(code, 'archived'));
}
async function confirm(title: string, description: string, action: string) {
  $('#confirm-title').textContent = title; $('#confirm-description').textContent = description; $('#confirm-yes').textContent = action;
  const dialog = $<HTMLDialogElement>('#confirm-dialog'); dialog.showModal();
  return new Promise<boolean>(resolve => {
    let agreed = false;
    const yes = () => { agreed = true; dialog.close(); }, no = () => dialog.close();
    $('#confirm-yes').addEventListener('click', yes); $('#confirm-cancel').addEventListener('click', no);
    dialog.addEventListener('close', () => { $('#confirm-yes').removeEventListener('click', yes); $('#confirm-cancel').removeEventListener('click', no); resolve(agreed); }, { once: true });
  });
}
async function changeStatus(code: QRRecord, status: QRRecord['status']) {
  if (!await confirm(`${status === 'active' ? 'Activate' : status === 'paused' ? 'Pause' : 'Archive'} this code?`, status === 'active' ? 'Your existing printed code will redirect to its saved destination again.' : 'People scanning the existing QR will see an unavailable message. You can activate it again from My QR Codes.', status === 'active' ? 'Activate code' : status === 'paused' ? 'Pause code' : 'Archive code')) return;
  try { const { code: updated } = await api<{ code: QRRecord }>(`/codes/${code.id}`, { method: 'PATCH', body: { revision: code.revision, status } }); if (selected?.id === code.id) await showDetail(updated); }
  catch (error) { bridge.toast((error as Error).message); }
}
function exportCSV(code: QRRecord, data: Analytics) {
  const rows: (string | number)[][] = [['Code', code.name], ['Range (days)', data.days], ['Timezone', 'UTC'], ['Scans', data.scans], ['Estimated visitors', data.visitors], ['Automated requests', data.automated], [], ['Date (UTC)', 'Scans', 'Estimated visitors'], ...data.daily.map(d => [d.day, d.scans, d.visitors])];
  for (const key of ['devices', 'browsers', 'countries', 'referrers'] as const) rows.push([], [key, 'Scans'], ...data[key].map(r => [r.label, r.count]));
  const csv = rows.map(row => row.map(value => { let s = String(value); if (/^[=+\-@\t\r]/.test(s.trimStart())) s = `'${s}`; return `"${s.replaceAll('"', '""')}"`; }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' })), link = document.createElement('a');
  link.href = url; link.download = `fynd-qr-analytics-${data.days}-days.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
  bridge.toast('Analytics export downloaded.');
}
