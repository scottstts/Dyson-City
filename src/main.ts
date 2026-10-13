import './style.css';
import { checkPlatform } from './core/platform';
import { fatal } from './core/fatal';
import { EntryScreen } from './ui/entryScreen';

const host = document.getElementById('app');
if (!host) throw new Error('#app host element missing');

const entry = new EntryScreen(host);
fatal.setSink((diag) => entry.showError(diag));

const platform = checkPlatform();
fatal.setDetail('Browser', platform.brand);

if (!platform.ok) {
  entry.showUnsupported(platform.reason ?? 'Unsupported platform', `Detected: ${platform.brand}${platform.mobile ? ' (mobile)' : ''}`);
} else {
  // The whole startup path is one observed promise chain with a terminal catch.
  fatal.stage = 'import';
  entry.setProgress(0.02, 'Loading engine');
  import('./app/boot')
    .then(({ boot }) => boot(host, entry))
    .catch((error: unknown) => fatal.report('Dyson failed to start', error));

  window.addEventListener('error', (e) => {
    if (fatal.stage !== 'running') fatal.report('Dyson failed to start', e.error ?? e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (fatal.stage !== 'running') fatal.report('Dyson failed to start', e.reason);
  });
}
