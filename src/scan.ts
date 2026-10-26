import './style.css';
import './design-system.css';
import { api, RequestError } from './api';

const referrer = document.createElement('meta'); referrer.name = 'referrer'; referrer.content = 'no-referrer'; document.head.append(referrer);
const app = document.querySelector<HTMLElement>('#app')!;
app.innerHTML = `<main class="scan-landing"><img src="${import.meta.env.BASE_URL}logos/fynd.svg" width="36" height="36" alt="Fynd"><h1>Opening your connection.</h1><p id="scan-message" role="status">Finding the destination for this QR code…</p><button id="scan-retry" class="button-primary" hidden>Try again</button><p class="scan-disclaimer">Destinations are chosen by the QR creator. A Fynd QR link does not imply endorsement.</p></main>`;
const style = document.createElement('style');
style.textContent = '.scan-landing{max-width:500px;margin:16vh auto;padding:32px;text-align:center}.scan-landing img{margin:auto}.scan-landing h1{font:400 38px/1.15 var(--serif);letter-spacing:-.03em;margin:26px 0 18px}.scan-landing p{font-size:14px;line-height:1.7;color:#666}.scan-landing button{margin:24px auto}.scan-landing .scan-disclaimer{font-size:11px;margin-top:40px;color:#888}';
document.head.append(style);
const slug = location.hash.slice(3);
let referrerHost = '';
try { const source = new URL(document.referrer); if (source.origin !== location.origin) referrerHost = source.hostname; } catch { /* Camera scans usually have no referrer. */ }
let opening = false;
async function open() {
  if (opening) return; opening = true;
  const retry = document.querySelector<HTMLButtonElement>('#scan-retry')!; retry.hidden = true;
  const message = document.querySelector<HTMLElement>('#scan-message')!;
  try {
    if (!/^[A-Za-z\d_-]{12}$/.test(slug)) throw new RequestError(404, 'This QR link is incomplete. Check the link with the person who shared it.');
    const { destination } = await api<{ destination: string }>(`/resolve/${slug}`, { anonymous: true, referrerHost });
    const url = new URL(destination);
    if (!['https:', 'http:'].includes(url.protocol) || url.origin === location.origin || url.username || url.password) throw new Error('The destination is not available. Contact the person who shared this code.');
    location.replace(url.href);
  } catch (error) {
    document.querySelector('h1')!.textContent = error instanceof RequestError && [404, 410].includes(error.status) ? 'This code is unavailable.' : 'A brief pause.';
    message.textContent = error instanceof RequestError && error.status === 0 ? 'We could not reach this QR’s destination service. Please try again in a moment.' : (error as Error).message;
    retry.hidden = error instanceof RequestError && [404, 410].includes(error.status);
  } finally { opening = false; }
}
document.querySelector('#scan-retry')!.addEventListener('click', () => void open());
void open();
