import './style.css';
import './design-system.css';
import './customization.css';
import { BODY_SHAPES, FRAME_SHAPES, BALL_SHAPES, shapeThumbnail, type ShapeCategory } from './shapes';
import { logoPresets } from './presets';
import { normalizeLogo, svgToPng } from './images';
import { buildPayload, buildSVG, DEFAULT_DESIGN, DesignError, validateDesign, recommendedPngSize, type ColorKey, type ContentType, type Design } from './qr';

const paths: Record<string, string> = {
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"/>',
  text: '<path d="M4 5h16M12 5v15M8 20h8"/>',
  wifi: '<path d="M2 8.8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8.5 15.3a5.5 5.5 0 0 1 7 0"/><circle cx="12" cy="19" r="1"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 7 9 6 9-6"/>',
  phone: '<path d="m8 3 3 5-3 3a16 16 0 0 0 5 5l3-3 5 3-1 4c-1 3-8 0-12-4S1 5 4 4z"/>',
  sms: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z"/><path d="M7 10h9M7 14h6"/>',
  contact: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M5.5 17a3.5 3.5 0 0 1 7 0M16 9h2M16 13h2"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  shield: '<path d="M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6z"/><path d="m8 12 3 3 5-6"/>',
  sparkle: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m3 16 5-5 4 4 4-6 5 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  infinity: '<path d="M12 12c-2-3-3-5-6-5a5 5 0 0 0 0 10c3 0 4-2 6-5s3-5 6-5a5 5 0 0 1 0 10c-3 0-4-2-6-5Z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
};
const icon = (name: string, extra = '') => `<svg ${extra} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.link}</svg>`;
const brand = `<img class="brand-symbol" src="${import.meta.env.BASE_URL}logos/fynd.svg" alt="" width="32" height="32"><span>Fynd QR</span>`;
const types: { id: ContentType; label: string; icon: string; title: string; description: string }[] = [
  { id: 'url', label: 'Website', icon: 'link', title: 'Where should your code take people?', description: 'A website, a menu, your latest project. You name it.' },
  { id: 'text', label: 'Text', icon: 'text', title: 'Say it with a little square.', description: 'Share a note, a useful detail, or a little inspiration.' },
  { id: 'wifi', label: 'Wi-Fi', icon: 'wifi', title: 'Make yourself connected.', description: 'Let guests join your Wi-Fi with one quick scan.' },
  { id: 'email', label: 'Email', icon: 'mail', title: 'Start a conversation.', description: 'Open an email with the address and message ready to go.' },
  { id: 'phone', label: 'Phone', icon: 'phone', title: 'You’re just a scan away.', description: 'Make it easy for someone to give you a call.' },
  { id: 'sms', label: 'SMS', icon: 'sms', title: 'Get the message started.', description: 'Prepare a text message. They choose when to send it.' },
  { id: 'contact', label: 'Contact', icon: 'contact', title: 'Make a lasting connection.', description: 'Share a contact card that saves straight to their phone.' },
];
let activeType: ContentType = 'url';
let values: Record<ContentType, Record<string, string>> = { url: { url: 'https://example.com' }, text: {}, wifi: { security: 'WPA' }, email: {}, phone: {}, sms: {}, contact: {} };
let design: Design = { ...DEFAULT_DESIGN };
const shapeGroups = [
  { id: 'pattern', label: 'Body', description: 'The pattern that carries your content.', choices: BODY_SHAPES },
  { id: 'eyeFrame', label: 'Eye frame', description: 'The outer rings in the three corners.', choices: FRAME_SHAPES },
  { id: 'eyeBall', label: 'Eye ball', description: 'The centers inside the three corner rings.', choices: BALL_SHAPES },
] as const;
const colorKeys = ['foreground', 'background', 'eyeFrameColor', 'eyeBallColor'] as const;
let activeShapeGroup: ShapeCategory = 'pattern';
let invalidColor: ColorKey | null = null;
let currentPayload: string | null = null;
let currentSvg: string | null = null;
let imageObjectUrl: string | null = null;
let downloadBusy = false;
let logoRevision = 0;
let logoBusy = false;
let selectedPreset: string | null = null;
let activeDownload: 'png' | 'svg' | null = null;
const edited = new Set<ContentType>();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let updateTimer: ReturnType<typeof setTimeout>;
let toastTimer: ReturnType<typeof setTimeout>;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

$('#app').innerHTML = `
  <a class="skip-link" href="#generator">Skip to generator</a>
  <header class="site-header wrap">
    <a href="#" class="brand" aria-label="Fynd QR home">${brand}</a>
    <nav aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#questions">FAQs</a><a class="nav-cta" href="#generator">Create a QR code ${icon('arrow')}</a></nav>
  </header>
  <main>
    <section class="hero wrap" aria-labelledby="hero-title">
      <div class="hero-copy"><div class="eyebrow"><span></span> FREE STATIC QR GENERATOR</div>
        <h1 id="hero-title">Every connection.<br>One simple scan.</h1>
      </div>
      <div class="hero-aside"><p>Create a QR code for anything you want to share. Make it yours, download it, and connect.</p><div class="hero-perks"><span>${icon('check')} Free to create</span><span>${icon('check')} No sign-up</span><span>${icon('check')} Yours to keep</span></div></div>
    </section>
    <section id="generator" tabindex="-1" class="generator wrap" aria-label="QR code generator">
      <div class="editor">
        <div class="section-heading"><span class="step-number">01</span><h2>Make it useful</h2><span class="step-caption">Choose your content</span></div>
        <div class="type-tabs" role="tablist" aria-label="QR code content type">${types.map((t, i) => `<button id="tab-${t.id}" type="button" role="tab" data-type="${t.id}" aria-selected="${i === 0}" aria-controls="content-panel" tabindex="${i === 0 ? '0' : '-1'}">${icon(t.icon)}<span>${t.label}</span></button>`).join('')}</div>
        <div id="content-panel" role="tabpanel" tabindex="0" aria-labelledby="tab-url">
          <h3 id="content-title"></h3><p class="section-description" id="content-description"></p>
          <form id="content-form" novalidate></form>
          <p id="content-error" class="field-error" aria-live="polite"></p>
        </div>
        <details class="design-section" open>
          <summary><span class="step-number">02</span><h2>Make it yours</h2><span class="step-caption">A little personality</span>${icon('chevron', 'class="disclosure"')}</summary>
          <div class="design-body">
            <div class="sub-heading"><span>Color palette</span><button id="reset-design" class="text-button" type="button">Reset style</button></div>
            <div class="palettes" role="group" aria-label="Color palettes">
              ${[['Forest', '#173d38', '#ffffff'], ['Ink', '#242727', '#ffffff'], ['Terracotta', '#893f32', '#fff6ed'], ['Ocean', '#214c76', '#eff7ff'], ['Berry', '#653758', '#fdf2f8']].map(([label, foreground, background], i) => `<button class="palette ${i === 0 ? 'selected' : ''}" data-foreground="${foreground}" data-background="${background}" type="button" aria-pressed="${i === 0}" aria-label="${label} palette"><span class="palette-sample" style="--swatch:${foreground};--swatch-bg:${background}"><i></i><i></i><i></i><i></i></span><span>${label}</span>${icon('check', 'class="palette-check"')}</button>`).join('')}
            </div>
            <div class="color-fields"><label>Code color<div class="color-input"><input type="color" id="foreground-picker" value="${design.foreground}" aria-label="Pick code color"><input id="foreground" aria-describedby="design-error" aria-label="Code color hex" value="${design.foreground.toUpperCase()}" maxlength="7" spellcheck="false"></div></label><label>Background<div class="color-input"><input type="color" id="background-picker" value="${design.background}" aria-label="Pick background color"><input id="background" aria-describedby="design-error" aria-label="Background color hex" value="#FFFFFF" maxlength="7" spellcheck="false"></div></label></div>
            <label class="checkbox-row match-eyes"><input id="match-eye-colors" type="checkbox" checked aria-controls="eye-colors"> Match eye colors to code color</label>
            <div id="eye-colors" class="color-fields" hidden>${[['eyeFrameColor','Eye frame'],['eyeBallColor','Eye ball']].map(([key,label]) => `<label>${label} color<div class="color-input"><input type="color" id="${key}-picker" value="${design.foreground}" aria-label="Pick ${label.toLowerCase()} color" disabled><input id="${key}" aria-describedby="design-error" aria-label="${label} color hex" value="${design.foreground.toUpperCase()}" maxlength="7" spellcheck="false" disabled></div></label>`).join('')}</div>
            <p id="design-error" class="field-error" aria-live="polite"></p>
            <div class="shape-heading"><span class="field-label">Shape your code</span><span>Mix each part independently</span></div>
            <div class="shape-tabs" role="tablist" aria-label="QR shape part">${shapeGroups.map((group,i) => `<button id="shape-tab-${group.id}" type="button" role="tab" data-shape-tab="${group.id}" aria-selected="${i===0}" aria-controls="shape-panel-${group.id}" tabindex="${i===0?'0':'-1'}"><span>${group.label}</span><span class="shape-current" data-current-shape="${group.id}">Square</span></button>`).join('')}</div>
            ${shapeGroups.map((group,i) => `<div id="shape-panel-${group.id}" class="shape-panel" role="tabpanel" aria-labelledby="shape-tab-${group.id}" ${i===0?'':'hidden'}><p class="shape-description">${group.description}</p><div class="shape-gallery" role="group" aria-label="${group.label} shapes">${group.choices.map((choice,index) => `<button type="button" class="shape-choice" data-shape-category="${group.id}" data-shape="${choice.id}" aria-label="${choice.label} ${group.label.toLowerCase()}" aria-pressed="${index===0}">${shapeThumbnail(group.id,choice.id)}<span>${choice.label}</span><span class="shape-tick" aria-hidden="true">✓</span></button>`).join('')}</div></div>`).join('')}
          </div>
        </details>
        <details class="logo-section">
          <summary>${icon('image')}<span>Add your logo</span><span class="optional">Optional</span>${icon('chevron', 'class="disclosure"')}</summary>
          <div class="logo-body"><p class="preset-label">Choose a brand or upload your own</p><div id="logo-presets" class="logo-presets" role="group" aria-label="Brand logo presets">${logoPresets.map(preset => `<button class="logo-preset" data-preset="${preset.id}" type="button" aria-label="${preset.name}" aria-pressed="false"><img src="${preset.src}" alt=""><span>${preset.name}</span></button>`).join('')}</div><label class="upload-area" for="logo-upload">${icon('upload', 'id="upload-icon"')}<img id="logo-thumbnail" alt="Selected logo" width="36" height="36" hidden><span id="logo-label">Choose a logo<span>PNG, JPG or WebP · up to 2 MB</span></span><input type="file" id="logo-upload" aria-label="Choose or replace your logo" aria-describedby="logo-error" accept="image/png,image/jpeg,image/webp"></label><button id="remove-logo" class="text-button" type="button" hidden>Remove logo</button><p id="logo-progress" class="small-note" role="status" hidden>Preparing your logo…</p><p class="small-note">Small logos work best. Always test a scan before printing.</p><p id="logo-error" class="field-error" aria-live="polite"></p></div>
        </details>
      </div>
      <aside class="preview-panel" aria-label="QR code preview and downloads">
        <div class="preview-content">
        <div class="preview-heading"><h2>Your QR code</h2><span id="preview-status" class="status-pill" role="status" aria-live="polite"><i></i> Live preview</span></div>
        <div class="qr-stage"><span class="stage-corner top-left"></span><span class="stage-corner top-right"></span><span class="stage-corner bottom-left"></span><span class="stage-corner bottom-right"></span><div class="qr-paper"><img id="qr-preview" alt="QR code preview for your website" width="280" height="280"><div id="preview-empty" hidden>${icon('sparkle')}<span>A little detail.<br>A new connection.</span></div></div></div>
        <p id="preview-error" class="preview-error" hidden></p><button type="button" id="fix-colors" class="text-button" hidden>Edit colors</button><div class="scan-hint" id="scan-hint">${icon('phone')} Point your camera. Try a scan.</div>
        <div class="payload-summary"><span id="payload-icon">${icon('link')}</span><span id="payload-text"></span></div>
        <div class="download-controls"><label for="download-size">PNG size</label><select id="download-size"><option value="512">512 × 512 px</option><option value="1024" selected>1,024 × 1,024 px</option><option value="2048">2,048 × 2,048 px</option><option value="4096">4,096 × 4,096 px</option></select></div>
        <p id="size-note" class="size-note" hidden></p>
        <button type="button" id="download-png" class="button-primary">${icon('download')} <span class="button-label">Download PNG</span> ${icon('arrow')}</button>
        <button type="button" id="download-svg" class="button-secondary">${icon('download')} <span class="button-label">Download SVG</span> <span class="format-hint">Scales to any size</span></button>
        <p class="download-note">No expiry. No scan limits. All yours.</p>
        <div class="static-note">${icon('info')}<p><strong>Made to stay the same.</strong> This is a static QR code. Its content can’t be changed after download.</p></div>
        </div>
      </aside>
    </section>
    <div class="privacy-strip wrap">${icon('lock')}<p>A little privacy goes a long way. Your content stays in your browser.</p><button type="button" data-privacy>Our promise ${icon('arrow')}</button></div>
    <section id="how-it-works" class="how-section wrap"><div class="how-intro"><div class="eyebrow">FROM IDEA TO SCAN</div><h2>Three steps.<br>So many connections.</h2><p>A menu on a table. A link on a poster.<br>Your next great idea, one scan away.</p></div><ol class="how-steps"><li><span>1</span><h3>Give it somewhere to go</h3><p>Choose a content type and add the details you want to share.</p></li><li><span>2</span><h3>Add a touch of you</h3><p>Pick your colors, find your style, and make it feel like yours.</p></li><li><span>3</span><h3>Download. Share. Connect.</h3><p>Save your code, test it with your phone, and put it out into the world.</p></li></ol></section>
    <section id="questions" class="faq-section wrap"><div><div class="eyebrow">THE LITTLE DETAILS</div><h2>Good questions.<br>Simple answers.</h2></div><div class="faq-list">
      <details><summary>Is it really free? ${icon('chevron')}</summary><p>Yes. Create and download as many static QR codes as you like. No account or subscription is needed.</p></details>
      <details><summary>Will my QR code expire? ${icon('chevron')}</summary><p>The code itself doesn’t expire and has no scan limit. If it links to a website, that website still needs to stay available.</p></details>
      <details><summary>Can I change it after downloading? ${icon('chevron')}</summary><p>The information is stored directly in this static QR code, so it can’t be updated later. You can create a new code any time. Editable destinations and scan analytics are not part of this version.</p></details>
      <details><summary>Should I download PNG or SVG? ${icon('chevron')}</summary><p>PNG is easy to use on social media, in documents, or in everyday designs. SVG stays sharp at any size, making it a good choice for posters and print.</p></details>
      <details><summary>How do I make sure it scans well? ${icon('chevron')}</summary><p>Use a dark code on a light background and keep the clear border around it. A small logo is best. Test the downloaded file with your phone, and test a printed sample at the actual size before printing more.</p></details>
    </div></section>
  </main>
  <footer class="site-footer wrap"><a class="brand" href="#" aria-label="Fynd QR home">${brand}</a><p>Made for everyday connections.</p><button type="button" data-privacy>Privacy</button><span>Made for everyone ↗</span></footer>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <dialog id="privacy-dialog" aria-labelledby="privacy-title"><button id="close-dialog" class="dialog-close" aria-label="Close privacy information">${icon('close')}</button><span class="dialog-icon">${icon('shield')}</span><h2 id="privacy-title">Your content is yours.</h2><p>QR codes are created right here in your browser. Your links, messages, Wi-Fi passwords, contact details, and logos aren’t sent to a server.</p><p>This prototype has no accounts, cookies, analytics, or browser storage. Refreshing the page clears your entries. Downloaded QR files contain the information you chose to share, so share them with the right people.</p><button type="button" class="button-primary" id="privacy-done">Sounds good ${icon('check')}</button></dialog>
`;

function escapeHtml(value: string) { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
function field(key: string, label: string, placeholder: string, options: { type?: string; optional?: boolean; wide?: boolean; textarea?: boolean } = {}) {
  const common = `id="field-${key}" name="${key}" placeholder="${escapeHtml(placeholder)}" ${options.optional ? '' : 'required'} aria-describedby="content-error"`;
  return `<div class="form-field ${options.wide ? 'full-width' : ''}"><label for="field-${key}">${label}${options.optional ? ' <span>Optional</span>' : ''}</label>${options.textarea ? `<textarea ${common} rows="4" maxlength="1200">${escapeHtml(values[activeType][key] || '')}</textarea>` : `<input ${common} type="${options.type || 'text'}" maxlength="1200" value="${escapeHtml(values[activeType][key] || '')}" ${['url', 'email', 'website'].includes(key) ? 'spellcheck="false" autocapitalize="off"' : ''}>`}</div>`;
}
function renderForm() {
  const type = types.find(t => t.id === activeType)!;
  $('#content-title').textContent = type.title;
  $('#content-description').textContent = type.description;
  $('#content-panel').setAttribute('aria-labelledby', `tab-${activeType}`);
  let fields = '';
  switch (activeType) {
    case 'url': fields = field('url', 'Website URL', 'https://your-website.com', { type: 'url', wide: true }) + '<p class="input-tip">Your link, straight to their screen. We’ll add https:// if needed.</p>'; break;
    case 'text': fields = field('text', 'Your text', 'A little something worth sharing…', { textarea: true, wide: true }); break;
    case 'email': fields = field('email', 'Email address', 'hello@example.com', { type: 'email', wide: true }) + field('subject', 'Subject', 'Let’s connect', { optional: true, wide: true }) + field('body', 'Message', 'Write a message…', { textarea: true, optional: true, wide: true }); break;
    case 'phone': fields = field('phone', 'Phone number', '+1 555 123 4567', { type: 'tel', wide: true }); break;
    case 'sms': fields = field('phone', 'Phone number', '+1 555 123 4567', { type: 'tel', wide: true }) + field('message', 'Message', 'Hi there!', { textarea: true, optional: true, wide: true }); break;
    case 'wifi': fields = field('ssid', 'Network name', 'Your Wi-Fi name', { wide: true }) + `<div class="form-field"><label for="field-security">Security</label><select id="field-security" name="security"><option value="WPA">WPA / WPA2 / WPA3</option><option value="WEP">WEP</option><option value="nopass">Open · no password</option></select></div>` + `<div class="form-field" id="password-field"><label for="field-password">Password</label><div class="password-wrap"><input name="password" id="field-password" type="password" autocomplete="off" maxlength="1200" placeholder="Network password" value="${escapeHtml(values.wifi.password || '')}" aria-describedby="content-error"><button type="button" id="toggle-password" aria-label="Show Wi-Fi password">${icon('eye')}</button></div></div><label class="checkbox-row full-width"><input type="checkbox" name="hidden" ${values.wifi.hidden === 'true' ? 'checked' : ''}> This is a hidden network</label><p class="input-tip">Anyone with this code can join this network. Share it with your guests.</p>`; break;
    case 'contact': fields = field('firstName', 'First name', 'Alex', { optional: true }) + field('lastName', 'Last name', 'Morgan', { optional: true }) + field('organization', 'Organization', 'Your company', { optional: true, wide: true }) + field('email', 'Email address', 'alex@example.com', { type: 'email', optional: true }) + field('phone', 'Phone number', '+1 555 123 4567', { type: 'tel', optional: true }) + field('website', 'Website', 'https://example.com', { type: 'url', optional: true, wide: true }); break;
  }
  $('#content-form').innerHTML = fields;
  if (activeType === 'wifi') {
    $<HTMLSelectElement>('#field-security').value = values.wifi.security;
    syncWifi();
    $('#toggle-password').addEventListener('click', () => { const input = $<HTMLInputElement>('#field-password'); input.type = input.type === 'password' ? 'text' : 'password'; $('#toggle-password').setAttribute('aria-label', `${input.type === 'password' ? 'Show' : 'Hide'} Wi-Fi password`); });
  }
}
function syncWifi() { $('#password-field').hidden = values.wifi.security === 'nopass'; $<HTMLInputElement>('#field-password').disabled = values.wifi.security === 'nopass'; }
function setType(type: ContentType) {
  activeType = type;
  document.querySelectorAll<HTMLButtonElement>('[data-type]').forEach(button => { const selected = button.dataset.type === type; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; });
  renderForm(); updatePreview();
  $(`#tab-${type}`).scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  if (!reducedMotion.matches) $('#content-panel').animate([{ opacity: .35, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180, easing: 'ease-out' });
}
function setDownloadEnabled(enabled: boolean) {
  for (const format of ['png', 'svg'] as const) {
    const button = $<HTMLButtonElement>(`#download-${format}`);
    button.disabled = !enabled || downloadBusy || logoBusy;
    button.setAttribute('aria-busy', String(activeDownload === format));
    button.classList.toggle('is-busy', activeDownload === format);
    button.querySelector('.button-label')!.textContent = activeDownload === format ? 'Preparing your file…' : `Download ${format.toUpperCase()}`;
  }
}
function updatePreview() {
  clearTimeout(updateTimer);
  currentPayload = null; currentSvg = null;
  $('#content-error').textContent = ''; $('#design-error').textContent = '';
  try { currentPayload = buildPayload(activeType, values[activeType]); } catch (error) { $('#content-error').textContent = (error as Error).message; }
  let validDesign = true;
  invalidColor = null;
  try { validateDesign(design); } catch (error) { validDesign = false; invalidColor = error instanceof DesignError ? error.field : 'foreground'; $('#design-error').textContent = (error as Error).message; }
  if (currentPayload && validDesign) {
    try { currentSvg = buildSVG(currentPayload, design); } catch { $('#content-error').textContent = 'This content is too complex to fit. Try making it shorter.'; }
  }
  const valid = !!currentSvg;
  const contentError = $('#content-error');
  contentError.classList.toggle('is-hint', !edited.has(activeType));
  $('#content-form').setAttribute('aria-invalid', String(!!contentError.textContent && edited.has(activeType)));
  for (const key of colorKeys) $(`#${key}`).setAttribute('aria-invalid', String(key === invalidColor));
  $('#preview-error').hidden = valid || validDesign;
  $('#preview-error').textContent = validDesign ? '' : $('#design-error').textContent;
  $('#fix-colors').hidden = validDesign;
  $('#scan-hint').hidden = !valid;
  const minimum = currentPayload ? recommendedPngSize(currentPayload) : 512;
  const sizeSelect = $<HTMLSelectElement>('#download-size');
  Array.from(sizeSelect.options).forEach(option => { option.disabled = Number(option.value) < minimum; });
  if (Number(sizeSelect.value) < minimum) sizeSelect.value = String(minimum);
  $('#size-note').hidden = minimum <= 512;
  $('#size-note').textContent = 'More detail needs a bigger image. A sharper PNG size is selected.';
  $('#scan-hint').innerHTML = icon('phone') + (minimum >= 2048 ? 'Lots to share. Test the full-size download.' : 'Point your camera. Try a scan.');
  if (imageObjectUrl) { URL.revokeObjectURL(imageObjectUrl); imageObjectUrl = null; }
  const image = $<HTMLImageElement>('#qr-preview');
  image.hidden = !valid; $('#preview-empty').hidden = valid;
  if (currentSvg) {
    imageObjectUrl = URL.createObjectURL(new Blob([currentSvg], { type: 'image/svg+xml' })); image.src = imageObjectUrl;
    image.alt = `QR code preview for ${types.find(t => t.id === activeType)!.label.toLowerCase()}`;
  } else { image.removeAttribute('src'); }
  const status = logoBusy ? 'Adding logo…' : valid ? 'Live preview' : !validDesign ? 'Check colors' : 'Add your details';
  if ($('#preview-status').textContent?.trim() !== status) $('#preview-status').innerHTML = `<i></i> ${status}`;
  $('#preview-status').classList.toggle('is-empty', !valid);
  const data = values[activeType];
  const summaries: Record<ContentType, string> = { url: currentPayload || 'Your website will appear here', text: data.text || 'Your message will appear here', email: data.email || 'Your email address', phone: data.phone || 'Your phone number', sms: data.phone ? `SMS to ${data.phone}` : 'Your text message', wifi: data.ssid ? `Wi-Fi · ${data.ssid}` : 'Your Wi-Fi network', contact: [data.firstName, data.lastName].filter(Boolean).join(' ') || 'Your contact card' };
  $('#payload-text').textContent = summaries[activeType];
  $('#payload-text').title = activeType === 'wifi' ? 'Wi-Fi network name; password is included in the QR code.' : summaries[activeType];
  $('#payload-icon').innerHTML = icon(types.find(t => t.id === activeType)!.icon);
  setDownloadEnabled(valid);
}
function syncDesignControls() {
  const linked = design.eyeFrameColor === undefined && design.eyeBallColor === undefined;
  $<HTMLInputElement>('#match-eye-colors').checked = linked;
  $('#eye-colors').hidden = linked;
  for (const key of colorKeys) {
    const color = design[key] ?? design.foreground;
    $<HTMLInputElement>(`#${key}`).value = color.toUpperCase();
    if (/^#[0-9a-f]{6}$/i.test(color)) $<HTMLInputElement>(`#${key}-picker`).value = color;
    if (key === 'eyeFrameColor' || key === 'eyeBallColor') {
      $<HTMLInputElement>(`#${key}`).disabled = linked;
      $<HTMLInputElement>(`#${key}-picker`).disabled = linked;
    }
  }
  document.querySelectorAll<HTMLButtonElement>('.palette').forEach(b => { const selected = b.dataset.foreground === design.foreground.toLowerCase() && b.dataset.background === design.background.toLowerCase(); b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', String(selected)); });
  document.querySelectorAll<HTMLButtonElement>('[data-shape]').forEach(b => { const selected = b.dataset.shape === design[b.dataset.shapeCategory as ShapeCategory]; b.setAttribute('aria-pressed', String(selected)); });
  for (const group of shapeGroups) $(`[data-current-shape="${group.id}"]`).textContent = group.choices.find(choice => choice.id === design[group.id])!.label;
}
function setShapeGroup(category: ShapeCategory) {
  activeShapeGroup = category;
  for (const group of shapeGroups) {
    const selected = group.id === category;
    const tab = $<HTMLButtonElement>(`#shape-tab-${group.id}`);
    tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    $(`#shape-panel-${group.id}`).hidden = !selected;
  }
}
function toast(message: string) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').classList.add('visible'); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4500); }
function touchFeedback(event: MouseEvent) {
  // Optional, brief confirmation for a deliberate touch selection. Visual feedback is primary.
  if (reducedMotion.matches || !(event instanceof PointerEvent) || event.pointerType !== 'touch' || !event.isTrusted || typeof navigator.vibrate !== 'function') return;
  try { navigator.vibrate(8); } catch { /* Unsupported devices keep the visual feedback. */ }
}
function downloadBlob(blob: Blob, name: string) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000); }
async function download(format: 'png' | 'svg') {
  updatePreview();
  if (!currentSvg || !currentPayload || downloadBusy || logoBusy) return;
  const type = activeType, pixels = Number($<HTMLSelectElement>('#download-size').value);
  const svg = buildSVG(currentPayload, { ...design }, pixels);
  const fileName = `fynd-qr-${type}-${pixels}.${format}`;
  downloadBusy = true; activeDownload = format; setDownloadEnabled(false);
  try {
    if (format === 'svg') downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `fynd-qr-${type}.svg`);
    else downloadBlob(await svgToPng(svg, pixels), fileName);
    toast(`${format.toUpperCase()} download started. Give it a test scan!`);
  } catch { toast('That download didn’t work. Please try again or choose SVG.'); }
  finally { downloadBusy = false; activeDownload = null; setDownloadEnabled(!!currentSvg); }
}

$('#content-form').addEventListener('submit', e => e.preventDefault());
$('#content-form').addEventListener('input', event => {
  const input = event.target as HTMLInputElement;
  if (!input.name) return;
  edited.add(activeType);
  values[activeType][input.name] = input.type === 'checkbox' ? String(input.checked) : input.value;
  if (activeType === 'wifi' && input.name === 'security') syncWifi();
  setDownloadEnabled(false); clearTimeout(updateTimer); updateTimer = setTimeout(updatePreview, 150);
});
document.querySelectorAll<HTMLButtonElement>('[data-type]').forEach(button => {
  button.addEventListener('click', event => { if (activeType !== button.dataset.type) touchFeedback(event); setType(button.dataset.type as ContentType); });
  button.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = types.findIndex(t => t.id === activeType);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? types.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + types.length) % types.length;
    setType(types[next].id); $(`#tab-${types[next].id}`).focus();
  });
});
document.querySelectorAll<HTMLButtonElement>('.palette').forEach(button => button.addEventListener('click', event => { if (button.getAttribute('aria-pressed') !== 'true') touchFeedback(event); design.foreground = button.dataset.foreground!; design.background = button.dataset.background!; syncDesignControls(); updatePreview(); }));
document.querySelectorAll<HTMLButtonElement>('[data-shape]').forEach(button => button.addEventListener('click', event => {
  if (button.getAttribute('aria-pressed') !== 'true') touchFeedback(event);
  design = {...design, [button.dataset.shapeCategory!]: button.dataset.shape};
  syncDesignControls(); updatePreview();
}));
document.querySelectorAll<HTMLButtonElement>('[data-shape-tab]').forEach(button => {
  button.addEventListener('click', () => setShapeGroup(button.dataset.shapeTab as ShapeCategory));
  button.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const index = shapeGroups.findIndex(group => group.id === activeShapeGroup);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index+(event.key === 'ArrowRight'?1:-1)+3)%3;
    setShapeGroup(shapeGroups[next].id); $(`#shape-tab-${activeShapeGroup}`).focus();
  });
});
$('#match-eye-colors').addEventListener('change', event => {
  if ((event.target as HTMLInputElement).checked) { delete design.eyeFrameColor; delete design.eyeBallColor; }
  else { design.eyeFrameColor = design.foreground; design.eyeBallColor = design.foreground; }
  syncDesignControls(); updatePreview();
});
for (const key of colorKeys) {
  $(`#${key}-picker`).addEventListener('input', event => { design[key] = (event.target as HTMLInputElement).value; syncDesignControls(); updatePreview(); });
  $(`#${key}`).addEventListener('input', event => { design[key] = (event.target as HTMLInputElement).value; if (/^#[0-9a-f]{6}$/i.test(design[key])) $<HTMLInputElement>(`#${key}-picker`).value = design[key]; document.querySelectorAll('.palette').forEach(b => { b.classList.remove('selected'); b.setAttribute('aria-pressed', 'false'); }); setDownloadEnabled(false); clearTimeout(updateTimer); updateTimer = setTimeout(updatePreview, 150); });
  $(`#${key}`).addEventListener('blur', syncDesignControls);
}
$('#reset-design').addEventListener('click', () => { design = { ...DEFAULT_DESIGN, logo: design.logo }; syncDesignControls(); updatePreview(); toast('Shapes and colors reset.'); });
$('#download-png').addEventListener('click', () => void download('png'));
$('#download-svg').addEventListener('click', () => void download('svg'));
async function applyLogo(file: () => Promise<File>, label: string, presetId: string | null) {
  const revision = ++logoRevision;
  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => button.setAttribute('aria-busy', String(button.dataset.preset === presetId)));
  logoBusy = true; $('#logo-error').textContent = ''; $('#logo-progress').hidden = false;
  $('.upload-area').setAttribute('aria-busy', 'true'); updatePreview();
  try {
    const normalized = await normalizeLogo(await file());
    if (revision !== logoRevision) return;
    design.logo = normalized;
    selectedPreset = presetId;
    document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.preset === selectedPreset)));
    $('#logo-label').textContent = label;
    $<HTMLImageElement>('#logo-thumbnail').src = normalized;
    $('#logo-thumbnail').hidden = false; $('#upload-icon').setAttribute('hidden', '');
    $('#remove-logo').hidden = false;
    toast('Logo added. Your downloads include it.');
  } catch (error) { if (revision === logoRevision) $('#logo-error').textContent = (error as Error).message; }
  finally {
    if (revision === logoRevision) { logoBusy = false; $('#logo-progress').hidden = true; $('.upload-area').setAttribute('aria-busy', 'false'); document.querySelectorAll('[data-preset]').forEach(button => button.setAttribute('aria-busy', 'false')); updatePreview(); }
  }
}
$('#logo-upload').addEventListener('change', event => {
  const input = event.target as HTMLInputElement, file = input.files?.[0];
  if (!file) return;
  input.value = '';
  void applyLogo(async () => file, file.name, null);
});
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => button.addEventListener('click', event => {
  const preset = logoPresets.find(item => item.id === button.dataset.preset);
  if (!preset?.src) return;
  if (selectedPreset !== preset.id) touchFeedback(event);
  void applyLogo(async () => {
    const response = await fetch(preset.src!);
    if (!response.ok) throw new Error('This logo could not be loaded. Please try again.');
    return new File([await response.blob()], `${preset.name}.png`, { type: 'image/png' });
  }, `${preset.name} logo`, preset.id);
}));
$('#remove-logo').addEventListener('click', () => {
  ++logoRevision; logoBusy = false; selectedPreset = null; delete design.logo;
  document.querySelectorAll('[data-preset]').forEach(button => { button.setAttribute('aria-pressed', 'false'); button.setAttribute('aria-busy', 'false'); });
  $('#remove-logo').hidden = true; $('#logo-thumbnail').hidden = true; $('#upload-icon').removeAttribute('hidden');
  $<HTMLImageElement>('#logo-thumbnail').removeAttribute('src');
  $('#logo-label').innerHTML = 'Choose a logo<span>PNG, JPG or WebP · up to 2 MB</span>';
  $('#logo-error').textContent = ''; $('#logo-progress').hidden = true; $('.upload-area').setAttribute('aria-busy', 'false');
  updatePreview(); $('#logo-upload').focus(); toast('Logo removed.');
});
$('#fix-colors').addEventListener('click', () => { $<HTMLDetailsElement>('.design-section').open = true; $(`#${invalidColor ?? 'foreground'}`).focus(); });
const dialog = $<HTMLDialogElement>('#privacy-dialog');
document.querySelectorAll('[data-privacy]').forEach(button => button.addEventListener('click', () => dialog.showModal()));
$('#close-dialog').addEventListener('click', () => dialog.close());
$('#privacy-done').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
if (window.matchMedia('(max-width: 640px)').matches) $<HTMLDetailsElement>('.design-section').open = false;
renderForm(); updatePreview();
