# OKF ナレッジソース

GemiHub は Open Knowledge Format（OKF）バンドルをチャットのナレッジソースとして利用できます。

OKF は Agent Skills とは別の仕組みです。Skills は再利用可能な振る舞い・参照資料・（任意で）ワークフローを定義するのに対し、OKF は概念、メトリクス、データセット、用語集、プレイブックといった、会話をまたいでチャットから常に参照できるようにしたいドメイン知識を提供します。

## OKF の設定

1. OKF バンドルを含む Drive ファイルを同期する。
2. **Settings** を開く。
3. **RAG** タブへ移動する。
4. OKF フォルダパス（例: `Knowledge` や `Knowledge/okf`）を設定する。
5. 検出されたバンドルから1つ以上を選択して保存する。

![OKF Settings](images/okf.png)

GemiHub は同期済みの Drive ファイルキャッシュから OKF を読み込みます。フォルダパスは GemiHub の Drive ルートからの相対パスです。

## OKF フォーマット

OKF は Markdown ベースのナレッジバンドル形式です。各コンセプトは通常、YAML frontmatter 付きの Markdown ファイルです:

```markdown
---
type: Metric
title: Monthly recurring revenue
description: Recurring subscription revenue normalized to a monthly value.
tags:
  - revenue
  - finance
---

# Monthly recurring revenue

MRR is calculated from active paid subscriptions...
```

![OKF Sample](images/okf_sample.png)

## バンドル

バンドルとは、直下に `index.md` を含む任意のフォルダです。バンドルの表示名は `index.md` の frontmatter `title` から取得され、なければフォルダ名にフォールバックします。

推奨レイアウト:

```text
Knowledge/
  index.md
  metrics/
    mrr.md
    churn-rate.md
  datasets/
    subscriptions.md
  playbooks/
    investigate-revenue-drop.md
  log.md
```

`log.md` はスキップされます。`index.md` はインデックスドキュメントとして扱われます。

## 読み込まれる内容

バンドルを選択すると、GemiHub は選択された各バンドルの Markdown ファイルを読み込み、コンパクトな要約をチャットのシステムプロンプトに注入します。ローダーが含める情報:

- `type`
- `title`
- `description`
- `tags`
- ファイルパス
- 本文の短い抜粋

ローダーは控えめなファイル数・文字数制限を適用するため、大きな OKF バンドルがモデルのコンテキストを圧迫することはありません。

## OKF と Skills の使い分け

Gemini にドメインを一貫して理解させたいときは OKF を使います。特定のプロセスに従わせたり、アクションを実行させたいときは Skill を使います。ドメインのコンテキストと再現可能な振る舞いの両方が必要なときは、両方を使います。

![OKF with Skills](images/okf_skill.png)

## 制限事項

- OKF のコンテンツはプロンプトコンテキストとして注入されるものであり、Gemini File Search に自動アップロードされるわけではありません。
- 大きな OKF バンドルはファイル数・文字数制限により要約されます。
- OKF ファイルは、検出される前に同期済み Drive キャッシュに存在している必要があります。
