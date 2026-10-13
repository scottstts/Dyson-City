import { WebGPURenderer, NoToneMapping, SRGBColorSpace } from 'three/webgpu';
import { fatal } from './fatal';
import { ResizeCoalescer, type ViewportSize } from './viewport';

export interface RendererHandle {
  readonly renderer: WebGPURenderer;
  readonly resize: ResizeCoalescer;
  /** Latest committed viewport. */
  readonly viewport: () => ViewportSize;
  readonly onViewport: (listener: (size: ViewportSize) => void) => void;
}

interface DeviceLostInfo {
  api: string;
  message: string;
  reason: string | null;
}

interface BackendErrorInfo {
  api: string;
  type: string;
  message: string;
}

type RendererHooks = WebGPURenderer & {
  onDeviceLost: (info: DeviceLostInfo) => void;
  onError: (info: BackendErrorInfo | string) => void;
  _onDeviceLost: (info: DeviceLostInfo) => void;
  _onError: (info: BackendErrorInfo | string) => void;
};

/**
 * Creates the WebGPU renderer. Device-loss and uncaptured-error callbacks are installed
 * immediately after construction (before init), chained onto Three's defaults so its own
 * bookkeeping and logging still run. Any device loss, and any uncaptured GPU error, is fatal.
 */
export async function createRenderer(canvasHost: HTMLElement, opts: { profile?: boolean } = {}): Promise<RendererHandle> {
  const renderer = new WebGPURenderer({
    trackTimestamp: opts.profile === true,
    antialias: false,
    alpha: false,
    reversedDepthBuffer: true,
    powerPreference: 'high-performance',
  });

  const hooks = renderer as RendererHooks;
  const defaultLost = hooks._onDeviceLost.bind(renderer);
  const defaultError = hooks._onError.bind(renderer);
  hooks.onDeviceLost = (info) => {
    defaultLost(info);
    fatal.setDetail('GPU device lost', `${info.reason ?? 'unknown'}: ${info.message}`);
    fatal.report('The GPU device was lost', new Error(info.message));
  };
  hooks.onError = (info) => {
    defaultError(info);
    const detail = typeof info === 'string' ? { type: 'GPUError', message: info } : info;
    fatal.setDetail('GPU error type', detail.type);
    fatal.report('A GPU error occurred', new Error(detail.message));
  };

  await renderer.init();

  if (!(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) {
    throw new Error('WebGPU backend unavailable (refusing WebGL fallback).');
  }

  const device = (renderer.backend as unknown as { device: GPUDevice }).device;
  const adapterInfo = (device as GPUDevice & { adapterInfo?: GPUAdapterInfo }).adapterInfo;
  if (adapterInfo) {
    fatal.setDetail('GPU', [adapterInfo.vendor, adapterInfo.architecture, adapterInfo.description].filter(Boolean).join(' / ') || 'unknown');
  }

  renderer.toneMapping = NoToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.domElement.classList.add('game-canvas');
  canvasHost.appendChild(renderer.domElement);

  let current: ViewportSize = { width: 1, height: 1, dpr: 1 };
  const listeners: Array<(size: ViewportSize) => void> = [];
  const resize = new ResizeCoalescer((size) => {
    current = size;
    renderer.setDrawingBufferSize(size.width, size.height, size.dpr);
    renderer.domElement.style.width = `${size.width}px`;
    renderer.domElement.style.height = `${size.height}px`;
    fatal.setDetail('Drawing buffer', `${Math.round(size.width * size.dpr)}×${Math.round(size.height * size.dpr)} (DPR ${size.dpr.toFixed(3)})`);
    for (const l of listeners) l(size);
  });
  resize.attach();
  if (!resize.commitNow()) {
    // A transient 0×0 viewport (hidden tab or pane): keep a safe size until a real resize arrives.
    renderer.setDrawingBufferSize(1280, 720, 1);
    current = { width: 1280, height: 720, dpr: 1 };
  }

  return {
    renderer,
    resize,
    viewport: () => current,
    onViewport: (listener) => listeners.push(listener),
  };
}
