export type AppDataDomain = 'absences' | 'entries' | 'sync' | 'students' | 'timetable';

export interface AppDataChangedEvent {
  domains: AppDataDomain[];
  timestamp: string;
  date?: string;
  reason?: string;
}

const WINDOW_EVENT_NAME = 'edutrack:data-changed';
const BROADCAST_CHANNEL_NAME = 'edutrack-data-events';

type Listener = (event: AppDataChangedEvent) => void;

const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;
let channelInitialized = false;

function ensureBroadcastChannel(): BroadcastChannel | null {
  if (channelInitialized) return channel;
  channelInitialized = true;
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  try {
    channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    channel.onmessage = (msg: MessageEvent<AppDataChangedEvent>) => {
      const data = msg?.data;
      if (!data || !Array.isArray(data.domains)) return;
      notifyLocalListeners(data);
    };
  } catch {
    channel = null;
  }
  return channel;
}

function notifyLocalListeners(payload: AppDataChangedEvent): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener(payload);
    } catch {
      // Ignore individual subscriber errors so other views still refresh.
    }
  }
}

export function emitAppDataChanged(
  domains: AppDataDomain[],
  detail?: { date?: string; reason?: string },
): void {
  const uniqueDomains = Array.from(new Set(domains));
  if (uniqueDomains.length === 0) return;

  const payload: AppDataChangedEvent = {
    domains: uniqueDomains,
    timestamp: new Date().toISOString(),
    ...(detail?.date ? { date: detail.date } : {}),
    ...(detail?.reason ? { reason: detail.reason } : {}),
  };

  notifyLocalListeners(payload);

  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent<AppDataChangedEvent>(WINDOW_EVENT_NAME, { detail: payload }));
    } catch {
      // Ignore environments where CustomEvent dispatch is restricted.
    }
  }

  const bc = ensureBroadcastChannel();
  if (bc) {
    try {
      bc.postMessage(payload);
    } catch {
      // Ignore closed/unsupported BroadcastChannel instances.
    }
  }
}

export function subscribeAppDataChanged(
  domains: AppDataDomain[],
  callback: (event: AppDataChangedEvent) => void,
): () => void {
  ensureBroadcastChannel();
  const domainSet = new Set(domains);
  const wrapped: Listener = (payload) => {
    if (payload.domains.some((domain) => domainSet.has(domain))) {
      callback(payload);
    }
  };
  listeners.add(wrapped);
  return () => {
    listeners.delete(wrapped);
  };
}
