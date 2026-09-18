import { account, api, onAccountChange } from './api';
import { requireAuth } from './workspace';
import type { LogoSummary, SavedLogo } from './models';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
let logos: LogoSummary[] = [], loaded = false, revision = 0;
let apply: (image: string, name: string) => void;
let pending: { image: string; name: string } | null = null;
let saving = false;
export function initLogoLibrary(use: typeof apply) {
  apply = use;
  $('#logo-library-tab').addEventListener('click', () => { switchTab(true); void load(); });
  $('#logo-add-tab').addEventListener('click', () => switchTab(false));
  $('#logo-retry-save').addEventListener('click', async () => {
    if (pending && await requireAuth('Sign in to keep this uploaded logo in your library.')) void saveUploadedLogo(pending.image, pending.name);
  });
  onAccountChange(() => {
    ++revision; logos = []; loaded = false; $('#logo-library-count').textContent = '';
    if (!account) { pending = null; $('#logo-save-status').textContent = ''; $('#logo-retry-save').hidden = true; }
    if (!$<HTMLElement>('#logo-library-panel').hidden) void load();
  });
  for (const id of ['logo-add-tab', 'logo-library-tab']) $(`#${id}`).addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const library = event.key === 'End' || (event.key !== 'Home' && id === 'logo-add-tab'); switchTab(library); $(library ? '#logo-library-tab' : '#logo-add-tab').focus(); if (library) void load(); }
  });
}
function switchTab(library: boolean) {
  $('#logo-add-panel').hidden = library; $('#logo-library-panel').hidden = !library;
  for (const [id, selected] of [['logo-add-tab', !library], ['logo-library-tab', library]] as const) { $(`#${id}`).setAttribute('aria-selected', String(selected)); $(`#${id}`).tabIndex = selected ? 0 : -1; }
}
async function load(force = false) {
  if (!account) {
    $('#logo-library-list').innerHTML = '<p class="logo-library-empty">Sign in to see the logos you’ve saved.</p><button class="button-secondary" id="logos-signin">Sign in to My logos</button>';
    $('#logos-signin').addEventListener('click', async () => { if (await requireAuth('Your uploaded logos are saved privately in your account.')) void load(); }); return;
  }
  if (loaded && !force) { render(); return; }
  const version = ++revision;
  $('#logo-library-list').innerHTML = '<p class="small-note" role="status">Loading your logos…</p>';
  try {
    const response = await api<{ logos: LogoSummary[] }>('/logos');
    if (version !== revision) return;
    logos = response.logos; loaded = true; render();
  } catch (error) {
    if (version !== revision) return;
    $('#logo-library-list').innerHTML = `<p class="field-error">${escape((error as Error).message)}</p><button class="text-button" id="logos-retry">Try again</button>`;
    $('#logos-retry').addEventListener('click', () => void load(true));
  }
}
function render() {
  $('#logo-library-count').textContent = logos.length ? String(logos.length) : '';
  $('#logo-library-list').innerHTML = logos.length ? `<div class="saved-logos-grid">${logos.map(logo => `<button class="saved-logo" data-logo-id="${logo.id}" aria-label="Use ${escape(logo.name)}"><img src="${logo.thumbnail}" alt="" width="60" height="60"><span>${escape(logo.name)}</span></button>`).join('')}</div>` : '<div class="logo-library-empty"><strong>Your logos, ready next time.</strong><p>Upload a logo from Add a logo. It will appear here automatically.</p></div>';
  document.querySelectorAll<HTMLButtonElement>('[data-logo-id]').forEach(button => button.addEventListener('click', async () => {
    const owner = account?.id;
    button.disabled = true; button.setAttribute('aria-busy', 'true'); $('#logo-error').textContent = '';
    try {
      const { logo } = await api<{ logo: SavedLogo }>(`/logos/${button.dataset.logoId}`);
      if (account?.id === owner) { apply(logo.image, logo.name); $('#logo-save-status').textContent = 'Using a logo from your library.'; }
    } catch (error) { $('#logo-error').textContent = (error as Error).message; }
    finally { button.disabled = false; button.setAttribute('aria-busy', 'false'); }
  }));
}
export async function saveUploadedLogo(image: string, filename: string) {
  const upload = { image, name: filename.trim().slice(0, 80) || 'Untitled logo' };
  pending = upload;
  $('#logo-retry-save').hidden = true;
  if (!account) { $('#logo-save-status').textContent = 'Logo added to this QR. Sign in to save it for next time.'; $('#logo-retry-save').hidden = false; return; }
  if (saving) return;
  const owner = account.id;
  saving = true; $('#logo-save-status').textContent = 'Saving to My logos…';
  try {
    const response = await api<{ logo: LogoSummary; duplicate: boolean }>('/logos', { method: 'POST', body: upload });
    if (account?.id !== owner) return;
    loaded = false;
    $('#logo-save-status').textContent = response.duplicate ? 'Already in My logos. Ready to reuse.' : 'Saved to My logos. Ready to reuse.';
    if (pending === upload) pending = null;
    if (!$('#logo-library-panel').hidden) await load(true);
  } catch (error) {
    if (account?.id !== owner) return;
    $('#logo-save-status').textContent = `Logo added to this QR, but not saved to your library. ${(error as Error).message}`;
    $('#logo-retry-save').hidden = false;
  } finally {
    saving = false;
    // A second deliberate upload is queued while the first save completes.
    if (pending && pending !== upload && account?.id === owner) void saveUploadedLogo(pending.image, pending.name);
  }
}
