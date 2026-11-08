import React, { useEffect, useMemo, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { App, type Session } from '../App';
import { AssistantVoiceContext, type AssistantVoiceProps } from '../Assistant';
import { ApiProvider, type ApiClient } from '../api';
import { createMockClient, scenarioProps } from './mock';
import { getLocale, tr } from '../../shared/i18n';
import type { ShopChat } from '../../server/shop-chat';
import { assistantStorageKey } from '../assistant-storage';

// The previous answer examples now run through the real full-screen Assistant.
const answerExamples = {
  "Markdown": {
    "question": {
      "ja": "キャンセル時の返金条件を教えてください",
      "en": "What are the refund terms for cancellations?"
    },
    "answer": {
      "ja": "## キャンセル時の返金\n\n**予約時の条件**が適用されます。\n\n- マイページから予約を確認します。\n- キャンセル前に返金額を確認します。\n\n| 開始までの時間 | 返金率 |\n| --- | --- |\n| 72時間以上 | 100% |\n| 24時間以上 | 50% |\n| 24時間未満 | 0% |\n\n設定項目は `rules.payment.refundTiers` です。\n\n```text\n予約の条件を確認 → キャンセル → 返金\n```\n\n[使い方を開く](/manual)",
      "en": "## Refunds on cancellation\n\nThe **terms at the time of booking** apply.\n\n- Check the booking on My page.\n- Check the refund amount before cancelling.\n\n| Time before start | Refund rate |\n| --- | --- |\n| 72 hours or more | 100% |\n| 24 hours or more | 50% |\n| Less than 24 hours | 0% |\n\nThe setting is `rules.payment.refundTiers`.\n\n```text\nCheck booking terms → Cancel → Refund\n```\n\n[Open the help](/manual)"
    },
    "source": "spec.md"
  },
  "PlainText": {
    "question": {
      "ja": "営業時間を教えてください",
      "en": "What are the opening hours?"
    },
    "answer": {
      "ja": "営業時間は午前10時から午後6時です。\n\n火曜日は定休日です。",
      "en": "We are open from 10 a.m. to 6 p.m.\n\nWe are closed on Tuesdays."
    },
    "source": "spec.md"
  },
  "Charts": {
    "question": {
      "ja": "スタッフ別の売上と日別の推移を見せてください",
      "en": "Show staff sales and daily sales trends."
    },
    "answer": {
      "ja": "スタッフ別売上と日別推移です。金額は施術終了済みの予約に基づきます。\n\n```mermaid\nxychart-beta\ntitle \"スタッフ別売上\"\nx-axis [\"あおい\", \"はる\"]\ny-axis \"JPY\" 0 --> 60000\nbar [55000, 42000]\n```\n\n```mermaid\nxychart-beta\ntitle \"日別売上\"\nx-axis [\"11/01\", \"11/02\", \"11/03\", \"11/04\", \"11/05\"]\ny-axis \"JPY\" 0 --> 30000\nline \"あおい\" [7000, 10000, 8000, 13000, 17000]\nline \"はる\" [5000, 8000, 7000, 11000, 11000]\n```\n\n根拠：予約の完了率・スタッフ別売上（logs:booking-analytics）。",
      "en": "Staff sales and daily trends, based on appointments whose service has ended.\n\n```mermaid\nxychart-beta\ntitle \"Staff sales\"\nx-axis [\"Aoi\", \"Haru\"]\ny-axis \"JPY\" 0 --> 60000\nbar [55000, 42000]\n```\n\n```mermaid\nxychart-beta\ntitle \"Daily sales\"\nx-axis [\"11/01\", \"11/02\", \"11/03\", \"11/04\", \"11/05\"]\ny-axis \"JPY\" 0 --> 30000\nline \"Aoi\" [7000, 10000, 8000, 13000, 17000]\nline \"Haru\" [5000, 8000, 7000, 11000, 11000]\n```\n\nSource: Booking conversion and staff sales (logs:booking-analytics)."
    },
    "source": "logs:booking-analytics"
  },
  "BookingFlow": {
    "question": {
      "ja": "予約が確定するまでの流れを教えてください",
      "en": "How does a booking become confirmed?"
    },
    "answer": {
      "ja": "予約が確定するまでの流れです。\n\n```mermaid\nflowchart LR\na[予約ページ] --> b[ログイン]\nb --> c[メニューと日時を選択]\nc --> d[予約完了]\n```\n\n根拠：現在のお店の設定（spec.md）。",
      "en": "The steps to confirm a booking.\n\n```mermaid\nflowchart LR\na[Booking page] --> b[Sign in]\nb --> c[Select menu and time]\nc --> d[Booking completed]\n```\n\nSource: Current shop settings (spec.md)."
    },
    "source": "spec.md"
  },
  "InvalidDiagram": {
    "question": {
      "ja": "予約の流れを図で見せてください",
      "en": "Show the booking flow as a diagram."
    },
    "answer": {
      "ja": "図を表示できない場合も、説明と元のデータを確認できます。\n\n```mermaid\nflowchart LR\na[Incomplete\n```",
      "en": "If a diagram cannot be displayed, its explanation and original data remain available.\n\n```mermaid\nflowchart LR\na[Incomplete\n```"
    },
    "source": "spec.md"
  }
} as const;
type Pattern = 'history' | 'new' | 'voice' | 'voice-active' | keyof typeof answerExamples;

function PreviewVoice({ disabled, onTurn, context }: AssistantVoiceProps) {
  const [connected, setConnected] = useState(false);
  return <div className="assistant-voice assistant-voice-preview">
    <p className="small muted">{tr('Storybookの表示例です。マイクや実際の音声通話には接続しません。')}</p>
    <p className="assistant-voice-status small" aria-live="polite">{connected ? tr('通話中の表示例です。') : tr('開始ボタンを押して、AIに話しかけてください。')}</p>
    <button type="button" className={connected ? 'primary' : ''} aria-pressed={connected} disabled={disabled && !connected} onClick={() => {
      if (!connected && !context().some(message => message.role === 'user' && message.text === (getLocale() === 'en' ? 'How do cancellations work?' : 'キャンセルするとどうなりますか？'))) onTurn(getLocale() === 'en' ? 'How do cancellations work?' : 'キャンセルするとどうなりますか？', getLocale() === 'en' ? 'Check the cancellation terms and refund amount on My page before confirming cancellation.' : 'マイページで、予約時のキャンセル条件と確定前の返金額を確認できます。', [{ path: 'spec.md', title: tr('現在のお店の設定') }]);
      setConnected(value => !value);
    }}>{connected ? tr('■ 音声を終了') : tr('🎙 音声で話す')}</button>
  </div>;
}

function Consultations({ pattern = 'history' }: { pattern?: Pattern }) {
  const fixture = useMemo(() => {
    const base = createMockClient('consultations', pattern);
    const locale = getLocale() === 'en' ? 'en' : 'ja';
    const patternIndex = ['history', 'new', ...Object.keys(answerExamples), 'voice', 'voice-active'].indexOf(pattern);
    // Stable UUIDs keep reloads idempotent, while each pattern has independent drafts.
    const requestId = (index: number) => `810b583a-5f98-4f5f-b231-${String(patternIndex * 100 + index).padStart(12, '0')}`;
    const create = (index: number) => base<ShopChat>('/api/shops/story-shop/conversations', { intent: 'consult', requestId: requestId(index) });
    const turn = (chat: ShopChat, index: number, question: string, answer: string, path = 'spec.md') => base(`/api/shops/story-shop/conversations/${chat.id}/turns`, {
      requestId: requestId(index), question, answer, voice: false,
      sources: [{ path, title: path === 'spec.md' ? tr('現在のお店の設定') : tr('スタッフ別売上') }],
    });
    const ready = (async () => {
      if (pattern === 'new' || pattern === 'voice' || pattern === 'voice-active') return (await create(1)).id;
      const cancellation = await create(1);
      await turn(cancellation, 2, locale === 'en' ? 'How do cancellations work?' : 'キャンセルするとどうなりますか？', locale === 'en' ? 'You can check the cancellation terms and refund amount on My page before confirming cancellation.' : 'マイページで予約を開くと、予約時のキャンセル条件と、確定前の返金額を確認できます。');
      const hours = await create(3);
      const plain = answerExamples.PlainText;
      await turn(hours, 4, plain.question[locale], plain.answer[locale]);
      if (pattern === 'history') {
        try { const key = assistantStorageKey('story-shop', hours.email, hours.id); if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ messages: [], text: locale === 'en' ? 'And on holidays?' : '祝日の場合は？' })); } catch { /* Browser storage may be unavailable. */ }
        return hours.id;
      }
      if (pattern === 'PlainText') return hours.id;
      const chat = await create(5);
      const example = answerExamples[pattern];
      await turn(chat, 6, example.question[locale], example.answer[locale], example.source);
      return chat.id;
    })();
    const client = (async (path: string, data?: unknown, options?: Parameters<ApiClient>[2]) => {
      await ready;
      if (path === '/api/session') return { ...await base<Session>(path, data, options), assistantVoice: true };
      return base(path, data, options);
    }) as ApiClient;
    return { client, ready };
  }, [pattern]);
  const [selected, setSelected] = useState<{ fixture: typeof fixture; id: string }>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setError('');
    void fixture.ready.then(id => { if (active) setSelected({ fixture, id }); }).catch(error => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, [fixture]);
  if (error) return <p role="alert">{error}</p>;
  if (selected?.fixture !== fixture) return <p role="status">{tr('読み込み中…')}</p>;
  return <ApiProvider value={fixture.client}><AssistantVoiceContext.Provider value={PreviewVoice}><App key={pattern} {...scenarioProps('consultations')} search={`?tab=assistant&conversation=${selected.id}`} navigate={() => {}} /></AssistantVoiceContext.Provider></ApiProvider>;
}
const meta = { title: '運営/相談・質問', component: Consultations, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof Consultations>;
export default meta;
type Story = StoryObj<typeof meta>;
export const History: Story = { name: '過去の相談・切替・削除' };
export const New: Story = { name: '新規の相談', args: { pattern: 'new' } };
export const PlainText: Story = { name: '営業時間の相談（文章）', args: { pattern: 'PlainText' } };
export const Markdown: Story = { name: '返金条件の相談（表・説明）', args: { pattern: 'Markdown' } };
export const Charts: Story = { name: '売上の相談（グラフ）', args: { pattern: 'Charts' } };
export const BookingFlow: Story = { name: '予約の流れの相談（図）', args: { pattern: 'BookingFlow' } };
export const InvalidDiagram: Story = { name: '図を表示できないとき', args: { pattern: 'InvalidDiagram' } };

async function showVoice(canvasElement: HTMLElement, connected: boolean) {
  async function button(text: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const found = [...canvasElement.querySelectorAll<HTMLButtonElement>('.assistant button')].find(button => button.textContent === text && !button.disabled);
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Voice control did not appear: ${text}`);
  }
  (await button(tr('AIと話す'))).click();
  if (connected) (await button(tr('🎙 音声で話す'))).click();
}
export const Voice: Story = { name: 'AIと通話で相談（開始前）', args: { pattern: 'voice' }, play: async ({ canvasElement }) => showVoice(canvasElement, false) };
export const VoiceActive: Story = { name: 'AIと通話で相談（通話中）', args: { pattern: 'voice-active' }, play: async ({ canvasElement }) => showVoice(canvasElement, true) };
