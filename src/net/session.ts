import type { CircuitFile } from '../io/format';

export type LinkPhase = 'gathering' | 'waiting' | 'connecting' | 'connected' | 'failed' | 'closed';

export type NetMessage =
  | { t: 'snap'; rev: number; doc: CircuitFile }
  | { t: 'edit'; rev: number; doc: CircuitFile }
  | { t: 'input'; kind: 'switch'; id: string; on: boolean }
  | { t: 'input'; kind: 'button'; id: string; pressed: boolean };

/** A guest edit applies only when it was made against the host's current revision. */
export function acceptEdit(hostRev: number, editRev: number): boolean {
  return editRev === hostRev;
}

const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

type Desc = { type: 'offer' | 'answer'; sdp: string };

export interface PeerSlot {
  id: string;
  phase: LinkPhase;
  offerCode: string;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(code: string): Uint8Array {
  const pad = code.length % 4 === 0 ? '' : '='.repeat(4 - (code.length % 4));
  const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function encodeCode(text: string): Promise<string> {
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream('deflate'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  return bytesToBase64Url(buf);
}

export async function decodeCode(code: string): Promise<string> {
  const raw = base64UrlToBytes(code);
  const copy = new Uint8Array(raw.byteLength);
  copy.set(raw);
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

function waitGather(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', on);
      resolve();
    };
    const on = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, 12000);
    pc.addEventListener('icegatheringstatechange', on);
  });
}

async function localCode(pc: RTCPeerConnection): Promise<string> {
  await waitGather(pc);
  const desc = pc.localDescription;
  if (!desc?.sdp || (desc.type !== 'offer' && desc.type !== 'answer')) throw new Error('No local description');
  return encodeCode(JSON.stringify({ type: desc.type, sdp: desc.sdp } satisfies Desc));
}

interface Link {
  id: string;
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  phase: LinkPhase;
  offerCode: string;
  failTimer: ReturnType<typeof setTimeout> | undefined;
}

/** One browser hosts; each guest is a separate direct connection. */
export class CircuitSession {
  role: 'idle' | 'host' | 'guest' = 'idle';
  phase: LinkPhase = 'closed';
  answerCode = '';
  peers: PeerSlot[] = [];
  onMessage: (msg: NetMessage) => void = () => {};
  onOpen: () => void = () => {};
  onChange: () => void = () => {};

  private links = new Map<string, Link>();
  private guest: Link | null = null;

  get live(): boolean {
    return this.role !== 'idle';
  }

  leave(): void {
    for (const link of this.links.values()) this.closeLink(link);
    if (this.guest) this.closeLink(this.guest);
    this.links.clear();
    this.guest = null;
    this.role = 'idle';
    this.phase = 'closed';
    this.answerCode = '';
    this.peers = [];
    this.onChange();
  }

  async startHost(): Promise<void> {
    this.leave();
    this.role = 'host';
    this.phase = 'waiting';
    await this.addGuest();
  }

  async addGuest(): Promise<void> {
    if (this.role !== 'host') return;
    const id = Math.random().toString(36).slice(2, 8);
    const pc = new RTCPeerConnection(ICE);
    const channel = pc.createDataChannel('circuit');
    const link: Link = { id, pc, channel, phase: 'gathering', offerCode: '', failTimer: undefined };
    this.links.set(id, link);
    this.bindChannel(link, channel);
    this.watch(link);
    this.publish();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    link.offerCode = await localCode(pc);
    if (link.phase === 'gathering') link.phase = 'waiting';
    this.publish();
  }

  async acceptReply(id: string, code: string): Promise<void> {
    const link = this.links.get(id);
    if (!link || link.phase === 'connected' || link.phase === 'failed') return;
    const desc = JSON.parse(await decodeCode(code.trim())) as Desc;
    if (desc.type !== 'answer' || !desc.sdp) throw new Error('That is not a reply code');
    link.phase = 'connecting';
    this.publish();
    await link.pc.setRemoteDescription({ type: 'answer', sdp: desc.sdp });
    this.armFail(link);
  }

  async join(code: string): Promise<void> {
    this.leave();
    this.role = 'guest';
    this.phase = 'gathering';
    this.onChange();
    const desc = JSON.parse(await decodeCode(code.trim())) as Desc;
    if (desc.type !== 'offer' || !desc.sdp) throw new Error('That is not a host code');
    const pc = new RTCPeerConnection(ICE);
    const link: Link = { id: 'host', pc, channel: null, phase: 'gathering', offerCode: '', failTimer: undefined };
    this.guest = link;
    pc.ondatachannel = (e) => {
      link.channel = e.channel;
      this.bindChannel(link, e.channel);
    };
    this.watch(link);
    await pc.setRemoteDescription({ type: 'offer', sdp: desc.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.answerCode = await localCode(pc);
    this.phase = 'waiting';
    link.phase = 'waiting';
    this.onChange();
  }

  send(msg: NetMessage): void {
    const text = JSON.stringify(msg);
    const links = this.role === 'guest' && this.guest ? [this.guest] : [...this.links.values()];
    for (const link of links) {
      if (link.channel?.readyState === 'open') link.channel.send(text);
    }
  }

  private bindChannel(link: Link, channel: RTCDataChannel): void {
    channel.onopen = () => {
      clearTimeout(link.failTimer);
      link.phase = 'connected';
      if (this.role === 'guest') this.phase = 'connected';
      this.publish();
      this.onOpen();
    };
    channel.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      try {
        this.onMessage(JSON.parse(e.data) as NetMessage);
      } catch {
        /* ignore a malformed packet */
      }
    };
    channel.onclose = () => {
      if (link.phase === 'connected') this.fail(link);
    };
  }

  private watch(link: Link): void {
    link.pc.onconnectionstatechange = () => {
      const state = link.pc.connectionState;
      if (state === 'failed') this.fail(link);
    };
    link.pc.oniceconnectionstatechange = () => {
      if (link.pc.iceConnectionState === 'failed') this.fail(link);
    };
  }

  private armFail(link: Link): void {
    clearTimeout(link.failTimer);
    link.failTimer = setTimeout(() => {
      if (link.phase !== 'connected') this.fail(link);
    }, 20000);
  }

  private fail(link: Link): void {
    if (link.phase === 'failed' || link.phase === 'closed') return;
    link.phase = 'failed';
    if (this.role === 'guest') this.phase = 'failed';
    this.publish();
  }

  private closeLink(link: Link): void {
    clearTimeout(link.failTimer);
    link.phase = 'closed';
    link.channel?.close();
    link.pc.close();
  }

  private publish(): void {
    this.peers = [...this.links.values()].map((link) => ({
      id: link.id,
      phase: link.phase,
      offerCode: link.offerCode,
    }));
    this.onChange();
  }
}
