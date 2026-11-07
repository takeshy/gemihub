import { AsyncResource } from "node:async_hooks";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage, Server } from "node:http";
import { GoogleGenAI, Modality, Type, type FunctionDeclaration, type FunctionResponse, type LiveConnectParameters, type LiveServerMessage, type Session as LiveSession } from "@google/genai";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { z } from "zod";
import { intlLocale, tr, type Locale } from "../shared/i18n.ts";
import { regionOf } from "../shared/region.ts";
import type { PhoneSettings } from "../shared/phone.ts";
export * from "../shared/phone.ts";
import type { ShopConfig } from "./domain.ts";
import { requestLocale } from "./i18n.ts";

// AI phone reception through Twilio Programmable Voice. Twilio streams 8 kHz μ-law audio over a
// WebSocket; this module converts it to 16 kHz PCM for Gemini Live and back to μ-law for Twilio.
// Only the conversation lives here. Availability, bookings and inquiries go through the deterministic
// server callbacks supplied by the app, so the model never decides stock, prices or payment rules.

// Twilio signs the exact public URL plus the sorted POST parameters with the account Auth Token.
export function twilioSignature(authToken: string, url: string, params: Record<string, string>) {
  const data = url + Object.keys(params).sort().map(key => key + params[key]).join("");
  return createHmac("sha1", authToken).update(data).digest("base64");
}
export function validTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string) {
  const expected = twilioSignature(authToken, url, params);
  if (!signature || expected.length !== signature.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return difference === 0;
}
export type TwilioCredentials = { sid: string; token: string };
/** Environment first; a local tmp/twilio.json keeps demos working without committing secrets. */
export function twilioCredentials(): TwilioCredentials {
  let local: { sid?: string; password?: string } = {};
  try { local = JSON.parse(readFileSync("tmp/twilio.json", "utf8")); } catch { /* optional local file */ }
  let fileToken = "";
  if (process.env.TWILIO_AUTH_TOKEN_FILE) {
    try { fileToken = readFileSync(process.env.TWILIO_AUTH_TOKEN_FILE, "utf8").trim(); } catch { /* report configuration later */ }
  }
  return { sid: process.env.TWILIO_ACCOUNT_SID || local.sid || "", token: process.env.TWILIO_AUTH_TOKEN || fileToken || local.password || "" };
}
export function phoneStreamToken(shopId: string, callSid: string, caller: string, token = twilioCredentials().token) {
  if (!token.trim()) throw new Error("Twilio signing secret is required");
  return createHmac("sha256", token).update(JSON.stringify([shopId, callSid, caller])).digest("hex").slice(0, 32);
}
export function streamUrl(base: string, shopId: string, callSid: string, caller: string) {
  // Twilio Stream URLs do not support query parameters.
  const context = [shopId, callSid, caller, phoneStreamToken(shopId, callSid, caller)].map(encodeURIComponent).join("/");
  const url = new URL(`/phone/stream/${context}`, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}
export function phoneStreamContext(url: URL) {
  const match = url.pathname.match(/^\/phone\/stream\/([^/]+)\/([^/]+)\/([^/]+)\/([a-f0-9]{32})$/);
  if (!match || url.search) return undefined;
  try {
    const [shopId, callSid, caller, token] = match.slice(1).map(decodeURIComponent);
    return { shopId, callSid, caller, token };
  } catch { return undefined; }
}
const xml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
export const twimlSay = (message: string, language = "ja-JP") =>
  `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="${language}">${xml(message)}</Say><Hangup/></Response>`;
export const twimlConnect = (base: string, shopId: string, callSid: string, caller: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${xml(streamUrl(base, shopId, callSid, caller))}"/></Connect></Response>`;

// ---- Audio conversion -------------------------------------------------------------------------
const MULAW_BIAS = 0x84, MULAW_CLIP = 32635;
function mulawToLinear(value: number) {
  const u = (~value) & 0xff;
  const sign = u & 0x80, exponent = (u >> 4) & 0x07, mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample -= MULAW_BIAS;
  return sign ? -sample : sample;
}
function linearToMulaw(sample: number) {
  let sign = 0;
  if (sample < 0) { sign = 0x80; sample = -sample; }
  sample = Math.min(sample, MULAW_CLIP) + MULAW_BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  return (~(sign | (exponent << 4) | ((sample >> (exponent + 3)) & 0x0f))) & 0xff;
}
export function mulawToPcm16(input: Uint8Array) {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index++) output[index] = mulawToLinear(input[index]);
  return output;
}
export function pcm16ToMulaw(input: Int16Array) {
  const output = new Uint8Array(input.length);
  for (let index = 0; index < input.length; index++) output[index] = linearToMulaw(input[index]);
  return output;
}
/** Twilio is 8 kHz; Gemini input is 16 kHz. Duplicating samples keeps the stream length stable. */
export function upsample8kTo16k(input: Int16Array) {
  const output = new Int16Array(input.length * 2);
  for (let index = 0; index < input.length; index++) { output[index * 2] = input[index]; output[index * 2 + 1] = input[index]; }
  return output;
}
/** Gemini output is 24 kHz; Twilio is 8 kHz. Average three samples and carry a remainder between chunks. */
export function downsample24kTo8k(input: Int16Array, remainder = new Int16Array(0)) {
  const combined = new Int16Array(remainder.length + input.length);
  combined.set(remainder); combined.set(input, remainder.length);
  const length = Math.floor(combined.length / 3), output = new Int16Array(length);
  for (let index = 0; index < length; index++) output[index] = Math.round((combined[index * 3] + combined[index * 3 + 1] + combined[index * 3 + 2]) / 3);
  return { samples: output, remainder: combined.slice(length * 3) };
}
export class TwilioAudioBridge {
  private remainder = new Int16Array(0);
  toGemini(payload: string) {
    return Buffer.from(upsample8kTo16k(mulawToPcm16(Buffer.from(payload, "base64"))).buffer).toString("base64");
  }
  fromGemini(payload: string) {
    const raw = Buffer.from(payload, "base64");
    // Node pools small Buffers, so the byte offset may not be 2-byte aligned for Int16Array.
    const copy = new Uint8Array(raw.byteLength);
    copy.set(raw);
    const input = new Int16Array(copy.buffer, 0, copy.byteLength >> 1);
    const converted = downsample24kTo8k(input, this.remainder);
    this.remainder = converted.remainder;
    return Buffer.from(pcm16ToMulaw(converted.samples)).toString("base64");
  }
}

// ---- Prompt and tools -------------------------------------------------------------------------
export type PhoneCallerFacts = {
  config: ShopConfig;
  settings: PhoneSettings;
  callerName?: string;
  today: string;
  now: string;
  timeZone: string;
};
export function phoneInstruction(facts: PhoneCallerFacts) {
  const config = facts.config;
  const payment = config.rules.payment?.enabled ? tr("前払いあり") : tr("前払いなし");
  const menus = config.menus.filter(menu => menu.active).map(menu => ({
    id: menu.id, name: menu.name, duration: menu.duration, price: menu.price,
    ...(menu.optionFor ? { option: true } : {}), ...(menu.optionGroup ? { group: menu.optionGroup } : {}),
  }));
  const staff = config.staff.map(person => ({ id: person.id, name: person.name, menuIds: person.menuIds }));
  const hours = config.hours;
  return [
    tr("あなたは「{0}」の電話受付AIです。お客様の用件を短く聞き、落ち着いて丁寧に日本語で話してください。", config.name),
    tr("発信者番号はサーバーが記録し、折り返し先にも使います。番号を聞いたり読み上げたりしないでください。"),
    facts.callerName ? tr("この番号のお客様は「{0}」として記録があります。名前を聞くときの参考にしてください。", facts.callerName) : "",
    tr("事実は下の店舗情報だけを根拠にしてください。書かれていないことを推測して答えないでください。営業時間・場所・メニューと料金は、この情報から答えられる範囲でその場で答えてかまいません。それ以外の問い合わせは、名前と用件を聞いて create_inquiry を呼び、あとで折り返すことを伝えてください。"),
    tr("電話では既存の予約を変更・キャンセルできません。オンライン予約ならオンラインでの手続きを案内してください。電話予約や予約方法が不明な場合は、お名前と予約日時を聞き、変更・キャンセルの希望を create_inquiry で店に伝えてください。問い合わせを記録したことと、予約がそのままであることを伝えてください。"),
    tr("予約は、メニューを聞き、check_availability で空き時間を確認してから候補を2〜3個伝えてください。日時が決まったら名前を必ず聞き、お店に伝えておきたいことがないか尋ねてください。そのあとメニュー・日時・お名前・来店時の現金払いであることを復唱して了承を得てから create_booking を呼び、伝えたいことがあれば message に入れてください。予約IDは自分で作らず、必ずツールの結果を使ってください。"),
    tr("create_booking が ok: true を返したら、確定した日時とメニューを伝えて予約が完了したことを確認し、ほかにご用件がないか尋ねてください。なければお礼を言って finish_call を呼んでください。"),
    config.rules.payment?.enabled
      ? tr("この店は前払いを使います。電話で現金予約できるのは今日の残り枠だけです。今日より後の希望には、オンライン予約を案内してください。")
      : tr("この店は前払いを使いません。予約可能期間内なら今日より後の日も電話で予約できます。"),
    tr("create_booking や create_inquiry の結果に ok: true が返るまで、完了したと言ってはいけません。エラーが返ったら内容をお客様に伝え、別の候補を案内するか create_inquiry で残してください。予約の話が済むまで finish_call を呼ばないでください。"),
    tr("料金はメニューに書かれた金額をそのまま伝えてください。割引や返金を自分で決めてはいけません。"),
    tr("聞き取りに失敗したら無理に続けず、名前と用件を聞いて create_inquiry で残してください。"),
    tr("今日は {0} です（{1}）。現在時刻は {2} です。", facts.today, facts.timeZone, facts.now),
    tr("店舗情報: {0}", JSON.stringify({
      name: config.name, description: config.description, address: config.address,
      hours: { start: hours.start, end: hours.end, closedWeekdays: hours.closedWeekdays, holidays: hours.holidays, weekdayHours: hours.weekdayHours, specialDays: hours.specialDays },
      menus, staff, payment, rules: { advanceDays: config.rules.advanceDays, interval: config.rules.interval, leadMinutes: config.rules.leadMinutes, sameDay: config.rules.sameDay, cancelHours: config.rules.cancelHours },
      phone: { sameDayCash: facts.settings.cashBookings, greeting: facts.settings.greeting || "" },
    })),
  ].filter(Boolean).join("\n");
}
// A function because the descriptions follow the shop's language, known only per call.
export const phoneTools = (): FunctionDeclaration[] => [
  {
    name: "check_availability",
    description: tr("指定した日付・メニューの空き時間を調べる。空き状況を推測してはいけない。"),
    parameters: { type: Type.OBJECT, properties: {
      date: { type: Type.STRING, description: tr("YYYY-MM-DD。省略時は今日") },
      menuId: { type: Type.STRING, description: tr("店舗情報のメニューID") },
      staffId: { type: Type.STRING, description: tr("希望スタッフのID（任意）") },
      optionIds: { type: Type.ARRAY, items: { type: Type.STRING }, description: tr("追加メニューのID（任意）") },
    }, required: ["menuId"] },
  },
  {
    name: "create_booking",
    description: tr("空き時間を確認済みの現金予約を作成する。名前と発信者番号はサーバーが記録する。"),
    parameters: { type: Type.OBJECT, properties: {
      name: { type: Type.STRING, description: tr("お客様の名前。必ず聞いてから渡す") },
      menuId: { type: Type.STRING, description: tr("メニューID") },
      start: { type: Type.STRING, description: tr("開始日時のISO 8601（check_availability が返した start をそのまま使う）") },
      staffId: { type: Type.STRING, description: tr("スタッフID（任意）") },
      optionIds: { type: Type.ARRAY, items: { type: Type.STRING }, description: tr("追加メニューID（任意）") },
      message: { type: Type.STRING, description: tr("お店に伝えておきたいこと（任意）") },
    }, required: ["name", "menuId", "start"] },
  },
  {
    name: "create_inquiry",
    description: tr("電話で受け付けた問い合わせ・伝言を、お問い合わせとして記録する。あとで折り返す。"),
    parameters: { type: Type.OBJECT, properties: {
      name: { type: Type.STRING, description: tr("お客様の名前") },
      reason: { type: Type.STRING, description: tr("用件。お客様が話した内容を簡潔に") },
    }, required: ["name", "reason"] },
  },
  {
    name: "finish_call",
    description: tr("話が終わったので通話を終了する。お礼を言ってから呼ぶ。"),
    parameters: { type: Type.OBJECT, properties: {} },
  },
];

// ---- Phone stream -----------------------------------------------------------------------------
export type PhoneSlot = { start: string; end: string; staffId: string; staffName?: string; label?: string };
export type PhoneAvailability = { date: string; today: string; prepayment: boolean; slots: PhoneSlot[] };
export type PhoneBookingResult = { ok: true; bookingId: string; start: string; menuName: string; staffName: string; price: number; currency: string; cash: true };
export type PhoneInquiryResult = { ok: true; inquiryId: string };
export type PhoneHost = {
  availability(input: { date?: string; menuId: string; staffId?: string; optionIds?: string[] }): Promise<PhoneAvailability>;
  book(input: { name: string; menuId: string; start: string; staffId?: string; optionIds?: string[]; message?: string }, actionId?: string): Promise<PhoneBookingResult>;
  inquire(input: { name: string; reason: string }): Promise<PhoneInquiryResult>;
  recordCall(result: PhoneCallRecord): Promise<void>;
};
export type PhoneCallRecord = {
  callSid: string; caller: string; outcome: "answered" | "booking" | "inquiry" | "blocked" | "closed" | "error" | "ended";
  transcript: string; turns: { question: string; answer: string }[]; startedAt: string; endedAt: string;
  bookingId?: string; inquiryId?: string; error?: string;
};
export type PhoneAccess = {
  shopId: string; callSid: string; caller: string; config: ShopConfig; settings: PhoneSettings;
  locale: Locale; callerName?: string; host: PhoneHost;
};
export type PhoneAuthorizer = (url: URL) => Promise<PhoneAccess | undefined>;
export type PhoneConnector = (parameters: LiveConnectParameters) => Promise<LiveSession>;
export const phoneLiveConfigured = () => !!process.env.GOOGLE_CLOUD_PROJECT && !!(process.env.PHONE_LIVE_MODEL || process.env.VERTEX_LIVE_MODEL);
const defaultConnector: PhoneConnector = parameters => new GoogleGenAI({
  vertexai: true, project: process.env.GOOGLE_CLOUD_PROJECT, location: process.env.PHONE_LIVE_LOCATION || process.env.VERTEX_LIVE_LOCATION || "us-central1",
}).live.connect(parameters);

/**
 * Returns a synchronous upgrade dispatcher so the app can share one `upgrade` listener with the
 * assistant voice relay. The handler returns false when the request is not for /phone/stream.
 */
export function createPhoneUpgrade(authorize: PhoneAuthorizer, connector: PhoneConnector = defaultConnector) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
  return (req: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname !== "/phone/stream" && !url.pathname.startsWith("/phone/stream/")) return false;
    void (async () => {
      const access = phoneLiveConfigured() && twilioCredentials().token.trim() ? await authorize(url).catch(() => undefined) : undefined;
      if (!access) { socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
      // Closing the socket lets converse() finalize the call, so a failure is recorded once.
      sockets.handleUpgrade(req, socket, head, ws => requestLocale.run(access.locale, () => { void converse(ws, access, connector).catch(() => { console.warn(JSON.stringify({ event: "phone_stream_failed", shopId: access.shopId })); ws.close(1011, tr("通話を続けられませんでした")); }); }));
    })().catch(() => socket.destroy());
    return true;
  };
}
/** Attach the bidirectional Twilio Media Stream WebSocket at /phone/stream. */
export function attachPhoneReception(server: Server, authorize: PhoneAuthorizer, connector: PhoneConnector = defaultConnector) {
  const dispatch = createPhoneUpgrade(authorize, connector);
  server.on("upgrade", (req, socket, head) => { dispatch(req, socket, head); });
}

/** After the audio should have played, how long to wait for the farewell, Gemini or Twilio. */
const finishGraceMs = 5000;
async function converse(ws: WebSocket, access: PhoneAccess, connector: PhoneConnector) {
  const bridge = new TwilioAudioBridge();
  const startedAt = new Date().toISOString();
  let live: LiveSession | undefined;
  let streamSid = "", stopped = false, finished = false, started = false, greetingSent = false, greetingTimer: NodeJS.Timeout | undefined;
  let heard = "", spoken = "", transcript: string[] = [];
  const turns: { question: string; answer: string }[] = [];
  let outcome: PhoneCallRecord["outcome"] = "ended", bookingId: string | undefined, inquiryId: string | undefined, failure: string | undefined;
  const pendingInput: string[] = [], pendingMedia: string[] = [];
  const pendingTools = new Set<Promise<unknown>>();
  // A slot was offered but nothing came of it yet, so a hang-up may be losing the booking.
  let slotsOffered = false, settled = false, finishChecked = false;
  let finishRequested = false, finalTurnReady = false, finishMark = "", markSequence = 0, playbackUntil = 0, finishTimer: NodeJS.Timeout | undefined;
  const markPlayback = () => {
    if (!finishRequested || !finalTurnReady || !streamSid || finishMark) return;
    finishMark = `phone-finish-${++markSequence}`;
    send({ event: "mark", streamSid, mark: { name: finishMark } });
  };
  const send = (value: unknown) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); };
  // Neither Gemini's last turn nor Twilio's mark is guaranteed, so a finished call has a deadline.
  const armFinishDeadline = () => {
    clearTimeout(finishTimer);
    if (!finishRequested) return;
    finishTimer = setTimeout(() => { void finish(); }, Math.max(0, playbackUntil - Date.now()) + finishGraceMs);
    finishTimer.unref();
  };
  const media = (payload: string) => {
    // Twilio plays 8,000 one-byte samples per second.
    playbackUntil = Math.max(Date.now(), playbackUntil) + Buffer.byteLength(payload, "base64") / 8;
    armFinishDeadline();
    if (!streamSid) { pendingMedia.push(payload); return; }
    send({ event: "media", streamSid, media: { payload } });
    // Audio generated after the mark must play too, so the mark moves behind it.
    if (finishMark) { finishMark = ""; markPlayback(); }
  };
  const startGreeting = () => {
    if (!live || !started || greetingSent) return;
    greetingSent = true;
    clearTimeout(greetingTimer);
    // Start the conversation without waiting for the caller to speak first.
    greetingTimer = setTimeout(() => { if (!stopped) live?.sendClientContent({ turns: [{ role: "user", parts: [{ text: tr("発信者から電話がかかってきました。店名を名乗り、短く挨拶して用件を聞いてください。") }] }], turnComplete: true }); }, 250);
    greetingTimer.unref();
  };
  const finish = async (error?: string) => {
    if (finished) return;
    finished = true; stopped = true; clearTimeout(greetingTimer); clearTimeout(limit); clearTimeout(finishTimer);
    const problem = () => error || failure;
    if (live) { try { live.close(); } catch { /* already closed */ } live = undefined; }
    // A disconnected caller must not leave a committed operation out of the final record.
    await Promise.allSettled([...pendingTools]);
    if (heard.trim() || spoken.trim()) transcript.push(`${tr("お客様")}: ${heard.trim()}\n${tr("AI")}: ${spoken.trim()}`);
    await access.host.recordCall({ callSid: access.callSid, caller: access.caller, outcome: problem() ? "error" : outcome, transcript: transcript.join("\n"), turns, startedAt, endedAt: new Date().toISOString(), ...(bookingId ? { bookingId } : {}), ...(inquiryId ? { inquiryId } : {}), ...(problem() ? { error: problem() } : {}) }).catch(() => undefined);
    ws.close(error ? 1011 : 1000, tr("通話を終了しました"));
  };
  const limit = setTimeout(() => { void finish(); }, 15 * 60000);
  limit.unref();
  // Socket and Gemini events start outside this call's async context, so they are bound to its locale.
  ws.on("close", AsyncResource.bind(() => { if (!finished) void finish(); else { stopped = true; clearTimeout(limit); } }));
  ws.on("error", AsyncResource.bind(() => { if (!finished) void finish(tr("通話が切断されました")); }));
  // Twilio sends `start` and media immediately after the socket opens. Listen before the
  // Gemini connection finishes and buffer audio, otherwise the first words are lost.
  ws.on("message", AsyncResource.bind((raw: RawData) => {
    try {
      const input = JSON.parse(raw.toString());
      if (stopped) return;
      if (input.event === "start") {
        streamSid = input.start?.streamSid || input.streamSid || "";
        started = true;
        for (const payload of pendingMedia.splice(0)) send({ event: "media", streamSid, media: { payload } });
        markPlayback();
        for (const data of pendingInput.splice(0)) live?.sendRealtimeInput({ audio: { data, mimeType: "audio/pcm;rate=16000" } });
        startGreeting();
        return;
      }
      if (input.event === "media" && input.media?.payload) {
        const data = bridge.toGemini(input.media.payload);
        if (live) live.sendRealtimeInput({ audio: { data, mimeType: "audio/pcm;rate=16000" } });
        else pendingInput.push(data);
        return;
      }
      if (input.event === "stop") void finish();
      if (input.event === "mark" && finishMark && input.mark?.name === finishMark) void finish();
    } catch { /* Ignore malformed Twilio frames instead of dropping the call. */ }
  }));

  const handleTool = async (name: string, args: Record<string, unknown> | undefined, actionId?: string): Promise<Record<string, unknown>> => {
    try {
      if (name === "check_availability") {
        const input = z.object({ date: z.string().optional(), menuId: z.string().min(1), staffId: z.string().optional(), optionIds: z.array(z.string()).max(20).optional() }).parse(args || {});
        const result = await access.host.availability(input);
        if (result.slots.length) slotsOffered = true;
        return { ...result };
      }
      if (name === "create_booking") {
        const input = z.object({ name: z.string().trim().min(1).max(100), menuId: z.string().min(1), start: z.string().min(1), staffId: z.string().optional(), optionIds: z.array(z.string()).max(20).optional(), message: z.string().trim().max(2000).optional() }).parse(args || {});
        const result = await access.host.book(input, actionId);
        outcome = "booking"; bookingId = result.bookingId; settled = true; failure = undefined;
        return { ...result };
      }
      if (name === "create_inquiry") {
        const input = z.object({ name: z.string().trim().min(1).max(100), reason: z.string().trim().min(1).max(2000) }).parse(args || {});
        const result = await access.host.inquire(input);
        outcome = "inquiry"; inquiryId = result.inquiryId; settled = true; failure = undefined;
        return { ...result };
      }
      if (name === "finish_call") {
        // Once only: the caller may really have decided against booking.
        if (!finishChecked && (failure || (slotsOffered && !settled))) {
          finishChecked = true;
          return { ok: false, error: tr("予約はまだ完了していません。エラーがあれば内容をお客様に伝えてください。お客様が了承済みなら create_booking を呼び、予約しない場合や折り返し希望の場合は、そのことを確認してから finish_call を呼んでください。") };
        }
        if (outcome === "ended") outcome = transcript.length || heard.trim() ? "answered" : "ended";
        return { ok: true };
      }
      return { error: tr("この操作は利用できません") };
    } catch (error) {
      const message = error instanceof Error ? error.message : tr("処理できませんでした");
      console.warn(JSON.stringify({ event: "phone_tool_failed", shopId: access.shopId, callSid: access.callSid, tool: name, error: message }));
      if (name === "create_booking" || name === "create_inquiry") failure = message;
      return { error: message };
    }
  };

  try { live = await connector({
    model: process.env.PHONE_LIVE_MODEL || process.env.VERTEX_LIVE_MODEL!,
    config: {
      responseModalities: [Modality.AUDIO],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      contextWindowCompression: { triggerTokens: "24000", slidingWindow: { targetTokens: "12000" } },
      systemInstruction: phoneInstruction({
        config: access.config, settings: access.settings, callerName: access.callerName,
        today: new Intl.DateTimeFormat("en-CA", { timeZone: regionOf(access.config).timeZone }).format(new Date()),
        now: new Date().toLocaleString(intlLocale(), { timeZone: regionOf(access.config).timeZone, timeZoneName: "short" }),
        timeZone: regionOf(access.config).timeZone,
      }),
      tools: [{ functionDeclarations: phoneTools() }],
    },
    callbacks: {
      onmessage: AsyncResource.bind((message: LiveServerMessage) => {
        if (stopped) return;
        const content = message.serverContent;
        if (content?.inputTranscription?.text) { heard += content.inputTranscription.text; }
        if (content?.outputTranscription?.text) { spoken += content.outputTranscription.text; }
        if (content?.interrupted) {
          // A clear also acknowledges marks for audio that was discarded, not played.
          // Let the resumed conversation request a new farewell before hanging up.
          finishRequested = false; finalTurnReady = false; finishMark = ""; playbackUntil = 0;
          armFinishDeadline();
          send({ event: "clear", streamSid });
        }
        for (const part of content?.modelTurn?.parts || []) if (part.inlineData?.data) media(bridge.fromGemini(part.inlineData.data));
        if (content?.turnComplete) {
          if (heard.trim() || spoken.trim()) {
            const turn = { question: heard.trim(), answer: spoken.trim() };
            turns.push(turn); transcript.push(`${tr("お客様")}: ${turn.question}\n${tr("AI")}: ${turn.answer}`); heard = ""; spoken = "";
          }
          if (finishRequested && !message.toolCall?.functionCalls?.length) { finalTurnReady = true; markPlayback(); }
        }
        const calls = message.toolCall?.functionCalls || [];
        if (!calls.length) return;
        // One at a time with finish_call last, so a booking that fails can stop the hang-up beside it.
        const ordered = [...calls].sort((a, b) => Number(a.name === "finish_call") - Number(b.name === "finish_call"));
        const operation = (async () => {
          const functionResponses: FunctionResponse[] = [];
          for (const call of ordered) functionResponses.push({ id: call.id, name: call.name, response: await handleTool(call.name || "", call.args as Record<string, unknown> | undefined, call.id) });
          return functionResponses;
        })().then(functionResponses => {
          if (stopped) return;
          live?.sendToolResponse({ functionResponses });
          // Only a turn completed after this response can be the farewell; an earlier one is stale.
          // The mark on that turn then waits for Twilio to play all preceding audio.
          if (functionResponses.some(item => item.name === "finish_call" && item.response?.ok)) { finishRequested = true; finalTurnReady = false; finishMark = ""; armFinishDeadline(); }
        });
        pendingTools.add(operation);
        void operation.finally(() => pendingTools.delete(operation)).catch(() => undefined);
      }),
      onerror: AsyncResource.bind(() => { failure = tr("音声接続が中断しました"); void finish(failure); }),
      onclose: AsyncResource.bind(() => { live = undefined; if (!finished) void finish(failure); }),
    },
  }); } catch (error) {
    console.warn(JSON.stringify({ event: "phone_stream_failed", shopId: access.shopId }));
    await finish(error instanceof Error ? error.message : String(error));
    return;
  }
  if (stopped) { try { live.close(); } catch { /* already closed */ } return; }
  for (const data of pendingInput.splice(0)) live.sendRealtimeInput({ audio: { data, mimeType: "audio/pcm;rate=16000" } });
  startGreeting();
}
