import { account, api, acceptSession, loadGoogle, logout, onAccountChange, restoreSession, sessionError } from './api';
import { supabase, signInGoogle } from './supabase';
import type { Analytics, QRDraft, QRRecord } from './models';
import { buildSVG } from './qr';
import { actionIcon } from './icons';
import './workspace.css';

export interface EditorBridge {
  draft(): QRDraft;
  record(): QRRecord | null;
  load(record: QRRecord): void;
  restore(draft: QRDraft, record: QRRecord | null): void;
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
let authVersion = 0, authBusy = false;

export function initWorkspace(editor: EditorBridge) {
  bridge = editor;
  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="account-dialog" class="account-dialog" aria-labelledby="account-title"><button class="dialog-close" data-close="account-dialog" aria-label="Close sign in">×</button><span class="eyebrow">YOUR CREATIVE SPACE</span><h2 id="account-title">Keep your connections.</h2><p id="account-reason"></p><div class="auth-benefits"><span>↗ Change a destination anytime</span><span>▥ Understand your scans</span><span>▦ Keep your codes together</span></div><div id="auth-options"></div><p id="auth-error" class="field-error" role="alert"></p><button id="retry-auth" class="text-button" hidden>Try again</button><p class="small-note">Continue with any Google account. Static generation and downloads stay open to everyone. <a href="${import.meta.env.BASE_URL}privacy.html">Read the privacy notice.</a></p></dialog>
    <dialog id="save-dialog" aria-labelledby="save-title"><button class="dialog-close" data-close="save-dialog" aria-label="Close save">×</button><span class="eyebrow">A LITTLE ORGANIZATION</span><h2 id="save-title">Give your code a name.</h2><form id="save-form"><label class="field-label" for="save-name">Code name</label><input id="save-name" class="workspace-input" maxlength="80" required placeholder="e.g. Reception Wi-Fi"><p class="small-note">Saving stores this code’s content and logo in your account. This includes any Wi-Fi password or contact details you entered.</p><p id="save-error" class="field-error" role="alert"></p><button class="button-primary" id="save-confirm">Save to My QR Codes <span>↗</span></button></form></dialog>
    <dialog id="confirm-dialog" aria-labelledby="confirm-title"><button class="dialog-close" data-close="confirm-dialog" aria-label="Cancel">×</button><h2 id="confirm-title"></h2><p id="confirm-description"></p><div class="dialog-actions"><button class="button-secondary" id="confirm-cancel">Cancel</button><button class="button-primary" id="confirm-yes">Continue</button></div></dialog>
  `);
  $('main').insertAdjacentHTML('beforeend', `<section id="workspace" class="workspace wrap" hidden aria-labelledby="workspace-title" tabindex="-1"><div id="workspace-content"></div></section>`);
  document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => { if (!saving && !authBusy) $<HTMLDialogElement>(`#${(el as HTMLElement).dataset.close}`).close(); }));
  $('#save-dialog').addEventListener('cancel', e => { if (saving) e.preventDefault(); });
  $('#account-dialog').addEventListener('cancel', event => { if (authBusy) event.preventDefault(); });
  $('#account-dialog').addEventListener('close', () => { ++authVersion; $('#auth-options').innerHTML = ''; resolveLogin?.(false); resolveLogin = null; });
  $('#retry-auth').addEventListener('click', () => void authOptions());
  document.querySelectorAll('[data-dynamic]').forEach(el => el.addEventListener('click', () => void startDynamic()));
  document.querySelectorAll('[data-static]').forEach(el => el.addEventListener('click', () => { showEditor(); bridge.static(); }));
  document.querySelectorAll('.brand, .nav-cta').forEach(el => el.addEventListener('click', () => { showEditor(); }));
  $('#my-codes').addEventListener('click', () => void showLibrary());
  const closeAccount = () => { $('#account-panel').hidden = true; $('#account-button').setAttribute('aria-expanded', 'false'); };
  $('#account-button').addEventListener('click', () => {
    if (!account) { void requireAuth('Sign in to save your codes and make every scan count.'); return; }
    const open = $('#account-panel').hidden; $('#account-panel').hidden = !open; $('#account-button').setAttribute('aria-expanded', String(open));
    if (open) $('#account-signout').focus();
  });
  document.addEventListener('click', event => { if (!(event.target as Element).closest('.account-control')) closeAccount(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#account-panel').hidden) { closeAccount(); $('#account-button').focus(); } });
  $('#account-password').addEventListener('click', () => { closeAccount(); $<HTMLDialogElement>('#account-dialog').showModal(); void authOptions(true); });
  $('#account-signout').addEventListener('click', async () => {
    closeAccount();
    if (bridge.dirty() && !await confirm('Sign out?', 'Your unsaved editor changes will be cleared. Saved codes and logos stay in your account.', 'Sign out')) return;
    try { await logout(); bridge.reset(); window.google?.accounts.id.disableAutoSelect(); bridge.toast('Signed out. Your saved codes will be here next time.'); }
    catch (error) { bridge.toast((error as Error).message); }
  });
  $('#save-static').addEventListener('click', () => void saveStatic());
  $('#save-form').addEventListener('submit', async event => {
    event.preventDefault(); if (saving) return;
    const name = $<HTMLInputElement>('#save-name').value.trim(); if (!name) return;
    $('#save-error').textContent = '';
    try { await persist({ ...bridge.draft(), name }); $<HTMLDialogElement>('#save-dialog').close(); bridge.toast('Saved. Find it anytime in My QR Codes.'); }
    catch (error) { $('#save-error').textContent = (error as Error).message; }
  });
  let reportedSessionError='';
  onAccountChange(() => {
    if (sessionError && sessionError!==reportedSessionError) bridge.toast(sessionError);
    reportedSessionError=sessionError;
    closeAccount();
    $('#account-button').innerHTML = account ? `<span class="account-avatar" aria-hidden="true">${escape(account.name.charAt(0).toUpperCase())}</span><span class="account-label">Account</span><span aria-hidden="true">⌄</span>` : 'Sign in';
    $('#account-button').setAttribute('aria-label', account ? `Account for ${account.name}` : 'Sign in');
    $('#account-name').textContent = account?.name || '';
    $('#account-email').textContent = account?.email || '';
    $('#account-password').hidden = !account?.passwordAccount;
    $('#account-password').textContent = account?.mustChangePassword ? 'Finish account setup' : 'Change password';
    $('#account-environment').hidden = !account?.localPreview;
    $('#account-environment').textContent = 'Local test account · saved on this computer';
    if (!account) { records = []; selected = null; if (workspaceOpen) showEditor(); }
  });
  try {
    const pending=sessionStorage.getItem('fynd-qr-oauth-draft');
    if (pending) {
      sessionStorage.removeItem('fynd-qr-oauth-draft');
      const saved=JSON.parse(pending);
      if (Date.now()-saved.at<30*60_000) bridge.restore(saved.draft,saved.record);
    }
  } catch { /* Keep the default editor if tab storage is unavailable. */ }
  void restoreSession();
}
export async function requireAuth(reason: string): Promise<boolean> {
  if (account && !account.mustChangePassword) return true;
  if (resolveLogin) return false;
  $('#account-reason').textContent = reason;
  const result = new Promise<boolean>(resolve => { resolveLogin = resolve; });
  $<HTMLDialogElement>('#account-dialog').showModal(); void authOptions();
  return result;
}
type AuthSession = Parameters<typeof acceptSession>[0];
function passwordField(id: string, label: string, autocomplete: string, minimum = 1) {
  return `<label class="field-label" for="${id}">${label}</label><div class="password-field"><input id="${id}" class="workspace-input" type="password" autocomplete="${autocomplete}" minlength="${minimum}" maxlength="128" required><button type="button" class="password-toggle" data-password="${id}" aria-label="Show ${label.toLowerCase()}" aria-pressed="false">Show</button></div>`;
}
function wirePasswordToggles() {
  document.querySelectorAll<HTMLButtonElement>('[data-password]').forEach(button => button.addEventListener('click', () => {
    const input = $<HTMLInputElement>(`#${button.dataset.password}`), show = input.type === 'password';
    input.type = show ? 'text' : 'password'; button.textContent = show ? 'Hide' : 'Show'; button.setAttribute('aria-pressed', String(show));
    button.setAttribute('aria-label', `${show ? 'Hide' : 'Show'} ${document.querySelector(`label[for="${input.id}"]`)!.textContent!.toLowerCase()}`);
  }));
}
async function authOptions(changePassword = false) {
  const version = ++authVersion, changing = changePassword || !!account?.mustChangePassword;
  $('#account-title').textContent = changing ? 'Make it yours.' : 'Keep your connections.';
  $('.auth-benefits').hidden = changing;
  $('#auth-options').innerHTML = '<p class="workspace-muted" role="status">Getting sign-in ready…</p>';
  $('#auth-error').textContent = ''; $('#retry-auth').hidden = true;
  const finish = (session: AuthSession) => {
    if (version !== authVersion) return;
    acceptSession(session);
    if (session.account.mustChangePassword) { void authOptions(true); return; }
    const resolve = resolveLogin; resolveLogin = null;
    $<HTMLDialogElement>('#account-dialog').close(); resolve?.(true);
    if (changing) bridge.toast('Password updated. Other sessions have been signed out.');
  };
  const submit = async (button: HTMLButtonElement, action: () => Promise<AuthSession>) => {
    if (authBusy) return;
    authBusy = true; button.disabled = true; const label = button.textContent; button.textContent = 'Please wait…'; $('#auth-error').textContent = '';
    try { finish(await action()); }
    catch (error) { if (version === authVersion) { if (changing && !account) await authOptions(); $('#auth-error').textContent = (error as Error).message; } }
    finally { authBusy = false; button.disabled = false; button.textContent = label; }
  };
  if (supabase && !changing) {
    $('#auth-error').textContent=sessionError;
    $('#auth-options').innerHTML='<button id="supabase-google" class="button-secondary" type="button">Continue with Google</button>';
    $('#supabase-google').addEventListener('click',async () => {
      const button=$<HTMLButtonElement>('#supabase-google'); button.disabled=true;
      try {
        sessionStorage.setItem('fynd-qr-oauth-draft',JSON.stringify({at:Date.now(),draft:bridge.draft(),record:bridge.record()}));
        await signInGoogle();
      } catch (error) { $('#auth-error').textContent=(error as Error).message; button.disabled=false; }
    });
    return;
  }
  if (changing) {
    $('#account-reason').textContent = account?.mustChangePassword ? 'Replace your temporary password to open your workspace.' : 'Choose a new password for your account.';
    $('#auth-options').innerHTML = `<form id="password-change-form" class="auth-form"><input type="text" name="username" autocomplete="username" value="${escape(account?.email || '')}" hidden>${passwordField('current-password', account?.mustChangePassword ? 'Temporary password' : 'Current password', 'current-password')}${passwordField('new-password', 'New password', 'new-password', 15)}<p class="password-hint" id="password-hint">Use 15–128 characters. A few unrelated words make a memorable passphrase.</p>${passwordField('confirm-password', 'Confirm new password', 'new-password', 15)}<button class="button-primary" type="submit">${account?.mustChangePassword ? 'Set password & continue' : 'Update password'} ${actionIcon('arrow')}</button></form>`;
    $('#new-password').setAttribute('aria-describedby', 'password-hint'); wirePasswordToggles(); $('#current-password').focus();
    $('#password-change-form').addEventListener('submit', event => {
      event.preventDefault();
      const currentPassword = $<HTMLInputElement>('#current-password').value, newPassword = $<HTMLInputElement>('#new-password').value;
      if (newPassword !== $<HTMLInputElement>('#confirm-password').value) { $('#auth-error').textContent = 'The new passwords don’t match.'; $('#confirm-password').focus(); return; }
      void submit($<HTMLButtonElement>('#password-change-form button[type="submit"]'), () => api('/auth/password', { method: 'POST', body: { currentPassword, newPassword } }));
    });
    return;
  }
  try {
    const config = await api<{ googleClientId: string; localPreview: boolean; passwordLogin: boolean }>('/config');
    if (version !== authVersion) return;
    $('#auth-options').innerHTML = '';
    if (config.passwordLogin) {
      $('#auth-options').innerHTML = `<form id="password-login-form" class="auth-form"><label class="field-label" for="login-email">Email</label><input id="login-email" class="workspace-input" type="email" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="254" placeholder="you@example.com" required>${passwordField('login-password', 'Password', 'current-password')}<button class="button-primary" type="submit">Sign in ${actionIcon('arrow')}</button><p class="password-hint">Need access or a password reset? Contact the person who invited you to the Fynd QR pilot.</p></form>`;
      wirePasswordToggles(); $('#login-email').focus();
      $('#password-login-form').addEventListener('submit', event => {
        event.preventDefault();
        const email = $<HTMLInputElement>('#login-email').value, password = $<HTMLInputElement>('#login-password').value;
        void submit($<HTMLButtonElement>('#password-login-form button[type="submit"]'), () => api('/auth/password-login', { method: 'POST', body: { email, password } }));
      });
    }
    if (config.localPreview) {
      $('#auth-options').insertAdjacentHTML('beforeend', '<details class="local-preview-note"><summary>Development tools</summary><p>Use a shared local test account on this computer only.</p><button id="local-signin" class="button-secondary" type="button">Continue with local test account</button></details>');
      $('#local-signin').addEventListener('click', () => void submit($<HTMLButtonElement>('#local-signin'), () => api('/auth/local-preview', { method: 'POST' })));
    }
    if (config.googleClientId) {
      try {
        const [challenge] = await Promise.all([api<{ id: string; nonce: string }>('/auth/challenge', { method: 'POST' }), loadGoogle()]);
        if (version !== authVersion) return;
        const container = document.createElement('div'); container.className = 'google-signin'; $('#auth-options').append(container);
        window.google!.accounts.id.initialize({ client_id: config.googleClientId, nonce: challenge.nonce, auto_select: false, callback: async response => {
          if (version !== authVersion || authBusy) return;
          authBusy = true; $('#auth-error').textContent = ''; container.setAttribute('inert', '');
          try { finish(await api('/auth/google', { method: 'POST', body: { credential: response.credential, challengeId: challenge.id } })); }
          catch (error) { if (version === authVersion) { $('#auth-error').textContent = (error as Error).message; $('#retry-auth').hidden = false; container.removeAttribute('inert'); } }
          finally { authBusy = false; }
        } });
        window.google!.accounts.id.renderButton(container, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', width: 300 });
      } catch { if (version === authVersion) { $('#auth-error').textContent = 'Google sign-in could not load. Try again or use your individual credentials.'; $('#retry-auth').hidden = false; } }
    } else if (!config.localPreview && !config.passwordLogin) throw new Error('Sign-in is not configured yet. Please contact the pilot owner.');
  } catch (error) {
    if (version !== authVersion) return;
    $('#auth-options').innerHTML = ''; $('#auth-error').textContent = (error as Error).message; $('#retry-auth').hidden = false;
  }
}
function showEditor() {
  workspaceOpen = false; $('#my-codes').removeAttribute('aria-current'); ++sequence; $('#workspace').hidden = true;
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
  saving = true; $<HTMLButtonElement>('#save-confirm').disabled = true; $('main').inert = true; $('.site-header').inert = true; $('#save-dialog').setAttribute('aria-busy', 'true');
  try {
    const existing = bridge.record(), signature = JSON.stringify(draft);
    if (signature !== saveSignature) { saveSignature = signature; saveKey = crypto.randomUUID(); }
    const { code } = existing
      ? await api<{ code: QRRecord }>(`/codes/${existing.id}`, { method: 'PATCH', body: { revision: existing.revision, draft } })
      : await api<{ code: QRRecord }>('/codes', { method: 'POST', body: draft, key: saveKey });
    bridge.saved(code); saveKey = ''; saveSignature = ''; return code;
  } finally { saving = false; $<HTMLButtonElement>('#save-confirm').disabled = false; $('main').inert = false; $('.site-header').inert = false; $('#save-dialog').removeAttribute('aria-busy'); }
}
export async function saveDynamic(): Promise<boolean> {
  if (!bridge.valid()) return false;
  if (!await requireAuth('Sign in to activate this dynamic code. Your design is ready to save.')) return false;
  try { await persist(bridge.draft()); bridge.toast('Dynamic code saved. Your scan link stays the same.'); return true; }
  catch (error) { $('#dynamic-error').textContent = (error as Error).message; return false; }
}
function card(code: QRRecord) {
  const dynamic = code.kind === 'dynamic';
  return `<article class="code-row"><div class="code-row-name"><h3>${escape(code.name)}</h3><p title="${escape(code.destination || code.contentType)}">${escape(dynamic ? code.destination! : `${code.contentType.toUpperCase()} · Saved design`)}</p></div><div class="code-row-type"><span class="kind-badge ${code.kind}">${dynamic ? '↗ Dynamic' : '▦ Static'}</span></div><div class="code-row-status">${dynamic ? `<span class="state-badge ${code.status}">${code.status}</span>` : '<span class="row-muted">Saved</span>'}</div><div class="code-row-scans">${dynamic ? `<strong>${number(code.totalScans)}</strong><span class="mobile-label"> ${code.totalScans === 1 ? 'scan' : 'scans'}</span>` : '<span class="row-muted">No analytics</span>'}</div><div class="code-row-date">${date(code.updatedAt)}</div><button class="row-action" data-open="${code.id}" aria-label="${dynamic ? 'View analytics for' : 'Edit'} ${escape(code.name)}">${dynamic ? 'Analytics' : 'Edit & download'} <span aria-hidden="true">↗</span></button></article>`;
}
async function openEditorRecord(code: QRRecord): Promise<boolean> {
  if (bridge.dirty() && !await confirm('Open this saved code?', 'Your current unsaved editor changes will be replaced.', 'Open code')) return false;
  showEditor(); bridge.load(code); $('#generator').scrollIntoView({ behavior: 'smooth' }); return true;
}
export async function showLibrary() {
  if (!await requireAuth('Your codes, in one place. Sign in with your team account to continue.')) return;
  workspaceOpen = true; $('#my-codes').setAttribute('aria-current', 'page'); document.querySelectorAll<HTMLElement>('main > :not(#workspace)').forEach(el => el.hidden = true); $('#workspace').hidden = false;
  selected = null; $('#workspace-content').removeAttribute('aria-busy');
  const current = ++sequence;
  $('#workspace-content').innerHTML = '<p class="workspace-loading" role="status">Finding your connections…</p>';
  $('#workspace').focus(); window.scrollTo({ top: 0, behavior: 'smooth' });
  try { records = (await api<{ codes: QRRecord[] }>('/codes')).codes; if (current === sequence) renderLibrary(); }
  catch (error) { if (current === sequence) showError(error, () => void showLibrary()); }
}
function showError(error: unknown, retry: () => void) {
  $('#workspace-content').removeAttribute('aria-busy');
  $('#workspace-content').innerHTML = `<div class="workspace-empty"><h2>Let’s try that again.</h2><p>${escape((error as Error).message)}</p><div class="inline-actions"><button class="button-primary" id="workspace-retry">Retry</button><button class="button-secondary" id="workspace-back">Back to generator</button></div></div>`;
  $('#workspace-retry').addEventListener('click', retry); $('#workspace-back').addEventListener('click', showEditor);
}
function renderLibrary() {
  const live = records.filter(r => r.status !== 'archived');
  $('#workspace-content').innerHTML = `<div class="workspace-heading"><div><button class="text-button back-button" id="back-generator">← Back to generator</button><div class="eyebrow">YOUR CONNECTIONS, COLLECTED</div><h1 id="workspace-title">My QR Codes<span class="title-dot">.</span></h1><p>Find a code, update a destination, or see how it performs.</p></div><div class="workspace-actions"><button class="button-primary" id="new-dynamic">Create dynamic QR <span>↗</span></button></div></div>
    ${account?.localPreview ? '<p class="preview-banner">Local test workspace · scan links open on this computer only.</p>' : ''}
    <div class="library-summary"><div><strong>${number(live.length)}</strong><span>Saved codes</span></div><div><strong>${number(live.filter(r => r.kind === 'dynamic').length)}</strong><span>Dynamic codes</span></div><div><strong>${number(live.filter(r => r.kind === 'static').length)}</strong><span>Static codes</span></div></div>
    <div class="library-toolbar"><div class="filter-tabs" role="group" aria-label="Filter codes"><button data-filter="all" aria-pressed="true">All codes</button><button data-filter="dynamic" aria-pressed="false">Dynamic</button><button data-filter="static" aria-pressed="false">Static</button><button data-filter="archived" aria-pressed="false">Archived</button></div><label class="search-field"><span class="sr-only">Search your codes</span><input id="code-search" type="search" placeholder="Search by name or destination"></label></div><p id="result-count" class="result-count" role="status"></p><div class="code-list-heading" aria-hidden="true"><span>Name & destination</span><span>Type</span><span>Status</span><span>Scans</span><span>Updated</span><span></span></div><div id="code-grid" class="code-list"></div>`;
  $('#back-generator').addEventListener('click', showEditor); $('#new-dynamic').addEventListener('click', () => void startDynamic(true));
  let filter = 'all';
  const update = () => {
    const search = $<HTMLInputElement>('#code-search').value.trim().toLowerCase();
    const found = records.filter(r => (filter === 'archived' ? r.status === 'archived' : r.status !== 'archived' && (filter === 'all' || r.kind === filter)) && `${r.name} ${r.destination || ''}`.toLowerCase().includes(search));
    $('#result-count').textContent = `${found.length} ${found.length === 1 ? 'code' : 'codes'}${search ? ' matching your search' : ''}`;
    $('#code-grid').innerHTML = found.length ? found.map(card).join('') : `<div class="workspace-empty"><div class="empty-symbol">↗</div><h2>${records.length ? 'No codes here yet.' : 'Your next connection starts here.'}</h2><p>${records.length ? 'Try another filter or a different search.' : 'Create a dynamic QR to change destinations anytime, or save a static design from the generator.'}</p>${records.length ? '' : '<button class="button-primary" id="empty-create">Create your first dynamic QR ↗</button>'}</div>`;
    $('#empty-create')?.addEventListener('click', () => void startDynamic(true));
    document.querySelectorAll<HTMLElement>('[data-open]').forEach(el => el.addEventListener('click', () => {
      const code = records.find(r => r.id === el.dataset.open)!;
      if (code.kind === 'dynamic') void showDetail(code); else void openEditorRecord(code);
    }));
  };
  document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter!; document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b === button))); update(); }));
  $('#code-search').addEventListener('input', update); update();
}
async function showDetail(code: QRRecord, focusId = '') {
  const refreshing = selected?.id === code.id && !!document.querySelector('#analytics-ranges');
  selected = code; const current = ++sequence;
  if (!refreshing) $('#workspace-content').innerHTML = '<p class="workspace-loading" role="status">Bringing your scans into focus…</p>';
  else { $('#workspace-content').setAttribute('aria-busy', 'true'); document.querySelectorAll<HTMLButtonElement>('[data-days], #refresh-analytics, #export-analytics').forEach(b => b.disabled = true); }
  try {
    const data = await api<{ analytics: Analytics; code: QRRecord }>(`/codes/${code.id}/analytics?days=${range}`);
    if (current !== sequence) return;
    selected = data.code; renderDetail(data.code, data.analytics); $('#workspace-content').removeAttribute('aria-busy');
    if (focusId) document.getElementById(focusId)?.focus();
  } catch (error) { if (current === sequence) showError(error, () => void showDetail(code)); }
}
function bars(title: string, rows: { label: string; count: number }[], total: number) {
  return `<section class="breakdown"><h3>${title}</h3>${rows.length ? rows.map(row => `<div class="breakdown-row"><div><span>${escape(row.label)}</span><span>${number(row.count)} <small>${Math.round(row.count / Math.max(total, 1) * 100)}%</small></span></div><div class="bar-track"><i style="width:${row.count / Math.max(total, 1) * 100}%"></i></div></div>`).join('') : '<p class="workspace-muted">The story starts with your first scan.</p>'}</section>`;
}
function renderDetail(code: QRRecord, data: Analytics) {
  const max = Math.max(1, ...data.daily.map(d => d.scans)), step = 700 / data.days, width = Math.max(2, step * .65);
  const chart = data.daily.map((d, i) => `<rect x="${48 + step * i + (step - width) / 2}" y="${180 - d.scans / max * 150}" width="${width}" height="${Math.max(d.scans ? 3 : 1, d.scans / max * 150)}" rx="2" fill="${d.scans ? '#161616' : '#eaeaea'}"><title>${d.day}: ${d.scans} scans, ${d.visitors} estimated visitors</title></rect>`).join('');
  $('#workspace-content').innerHTML = `<button class="text-button back-button" id="back-library">← All my QR codes</button><div class="workspace-heading detail-heading"><div><div class="detail-badges"><span class="kind-badge dynamic">↗ Dynamic QR</span><span class="state-badge ${code.status}">${code.status}</span></div><h1 id="workspace-title">${escape(code.name)}</h1><p>One permanent code. A destination that moves with you.</p></div><div class="workspace-actions"><button class="button-primary" id="edit-code">${actionIcon('edit')}<span>Edit & download</span></button><button class="subtle-button" id="refresh-analytics">${actionIcon('refresh')}<span>Refresh</span></button></div></div>
    <div class="destination-panel"><div class="detail-preview">${buildSVG(code.payload, code.design, 120)}</div><div class="destination-info"><span class="field-label">PERMANENT SCAN LINK</span><div class="scan-link"><span>${escape(code.scanUrl!)}</span><button class="icon-button" id="copy-scan" aria-label="Copy scan link" title="Copy scan link">${actionIcon('copy')}</button></div><span class="destination-arrow">↳ Takes people to</span><p>${escape(code.destination!)}</p></div><div class="destination-actions"><button class="button-secondary" id="change-destination">${actionIcon('edit')}<span>Change destination</span></button><button class="subtle-button" id="toggle-code">${actionIcon(code.status === 'active' ? 'pause' : 'play')}<span>${code.status === 'active' ? 'Pause code' : 'Activate code'}</span></button><button class="subtle-button danger-text" id="archive-code" ${code.status === 'archived' ? 'hidden' : ''}>${actionIcon('archive')}<span>Archive</span></button></div></div>
    ${code.status !== 'active' ? `<p class="preview-banner">This code is ${code.status}. Scanners will not be redirected until you activate it.</p>` : ''}
    <div class="analytics-heading"><div><h2>A closer look at your scans.</h2><p class="workspace-muted">Recorded requests, with known automated traffic separated.</p></div><div class="analytics-controls"><div class="analytics-range-control"><span>Last</span><div id="analytics-ranges" class="range-tabs" role="group" aria-label="Analytics date range">${[7,30,90].map(days => `<button id="range-${days}" data-days="${days}" aria-pressed="${days === range}">${days} days</button>`).join('')}</div></div><button class="button-secondary" id="export-analytics">${actionIcon('download')}<span>Export CSV</span></button></div></div>
    <div class="analytics-metrics"><div><span>Scans</span><strong>${number(data.scans)}</strong><small>Excludes recognized bots</small></div><div><span>Estimated visitors</span><strong>${number(data.visitors)}</strong><small>Approximate devices, not people</small></div><div><span>Automated requests</span><strong>${number(data.automated)}</strong><small>Recognized bots & previews</small></div><div><span>All-time scans</span><strong>${number(code.totalScans)}</strong><small>${code.lastScanAt ? `Last scan ${date(code.lastScanAt)}` : 'Ready for your first scan'}</small></div></div>
    <section class="scan-chart"><div><h3>Scans over time</h3><span>Daily · UTC</span></div>${data.scans ? '' : '<p class="chart-empty">Nothing to chart just yet. Share your code to start the story.</p>'}<svg viewBox="0 0 780 225" role="img" aria-label="Daily scans for the last ${data.days} days; ${data.scans} total. Daily values are in the table below."><path d="M48 30H748M48 105H748M48 180H748" stroke="#eeeeee" stroke-width="1"/><text x="34" y="34" text-anchor="end">${max}</text><text x="34" y="184" text-anchor="end">0</text>${chart}<text x="48" y="210">${date(data.daily[0].day)}</text><text x="748" y="210" text-anchor="end">${date(data.daily.at(-1)!.day)}</text></svg><details class="daily-table"><summary>View daily numbers</summary><div class="table-scroll"><table><thead><tr><th>Date (UTC)</th><th>Scans</th><th>Estimated visitors</th></tr></thead><tbody>${data.daily.map(d => `<tr><td>${d.day}</td><td>${d.scans}</td><td>${d.visitors}</td></tr>`).join('')}</tbody></table></div></details></section>
    <div class="breakdown-grid">${bars('Devices', data.devices, data.scans)}${bars('Browsers', data.browsers, data.scans)}${bars('Countries', data.countries, data.scans)}${bars('Referring websites', data.referrers, data.scans)}</div><details class="analytics-notes"><summary>How analytics are counted</summary><p class="analytics-footnote">A scan is a recorded redirect request; repeat visits count again. Estimated visitors use a code-specific hash of network address and browser information. Shared networks, privacy tools, and unrecognized bots can affect accuracy. Countries appear only when supplied by trusted hosting infrastructure. Referrers are often unavailable for camera scans. Detailed events are retained for 90 days; all-time counts remain. No raw IP addresses or full browser identifiers are stored in scan analytics.</p></details>`;
  $('#back-library').addEventListener('click', () => void showLibrary());
  $('#edit-code').addEventListener('click', () => void openEditorRecord(code)); $('#change-destination').addEventListener('click', async () => { if (await openEditorRecord(code)) $('#field-url').focus(); });
  $('#refresh-analytics').addEventListener('click', () => void showDetail(code, 'refresh-analytics'));
  document.querySelectorAll<HTMLButtonElement>('[data-days]').forEach(button => button.addEventListener('click', () => { range = Number(button.dataset.days); void showDetail(code, button.id); }));
  $('#copy-scan').addEventListener('click', async () => { try { await navigator.clipboard.writeText(code.scanUrl!); const button = $('#copy-scan'); button.innerHTML = actionIcon('check'); button.setAttribute('aria-label', 'Scan link copied'); button.title = 'Copied'; setTimeout(() => { if (button.isConnected) { button.innerHTML = actionIcon('copy'); button.setAttribute('aria-label', 'Copy scan link'); button.title = 'Copy scan link'; } }, 2000); bridge.toast('Permanent scan link copied.'); } catch { bridge.toast('Could not copy. Select the scan link above to copy it.'); } });
  $('#export-analytics').addEventListener('click', () => exportCSV(code, data));
  $('#toggle-code').addEventListener('click', () => void changeStatus(code, code.status === 'active' ? 'paused' : 'active'));
  $('#archive-code').addEventListener('click', () => void changeStatus(code, 'archived'));
}
async function confirm(title: string, description: string, action: string) {
  $('#confirm-title').textContent = title; $('#confirm-description').textContent = description; $('#confirm-yes').textContent = action;
  const dialog = $<HTMLDialogElement>('#confirm-dialog'); if (dialog.open) return false; dialog.showModal();
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
