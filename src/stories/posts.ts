import { tr } from "../../shared/i18n";
import { dateJST } from "../../server/domain";
import type { Post, PostContent } from "../../server/post-domain";
export function storyPosts(): Post[] {
  const titles = [
    tr("秋色ネイルで、季節を指先に。"),
    tr("冬のお休みについて"),
    tr("爪をいたわる、日々の小さな習慣"),
    tr("週末の空き枠をご案内します"),
    tr("新しいケアコースができました"),
    tr("ふたりで営む、小さなアトリエ"),
    tr("はじめてのお客様へ"),
  ];
  const slugs = [
    "autumn-design",
    "winter-holidays",
    "daily-care",
    "weekend",
    "special-care",
    "our-atelier",
    "welcome",
  ];
  const list: Post[] = titles.map((title, i) => {
    const date = dateJST(new Date(Date.now() - i * 86400000));
    const content: PostContent = {
      title,
      slug: slugs[i],
      category: i === 1 || i === 3 ? "announcements" : "blogs",
      date,
      excerpt:
        i === 0
          ? tr("やわらかなくすみカラーと、さりげないきらめき。新しい季節のデザインをご紹介します。")
          : tr("お店の日々のこと、大切なご案内をお届けします。"),
      body:
        i === 0
          ? tr("## 日常になじむ、秋の色\n\n忙しい毎日の中でも、ふと指先を見てうれしくなる。そんなデザインをそろえました。\n\n- やさしいモカブラウン\n- 透明感のあるグレージュ\n- 小さなゴールドのアクセント\n\n## 似合う色を、一緒に。\n\nお仕事やふだんのお洋服に合わせて、色の調整も承ります。**初めての方も、どうぞ気軽にご相談ください。**\n\nご来店を心よりお待ちしております。")
          : tr("## {0}\n\nいつも nail atelier 凪をご利用いただき、ありがとうございます。\n\nお一人おひとりに合うデザインを、一緒に考えていきます。ご相談はお問い合わせから承ります。", title),
    };
    const at = `${date}T01:00:00.000Z`;
    return {
      id: `story-post-${i + 1}`,
      shopId: "story-shop",
      draft: structuredClone(content),
      published: structuredClone(content),
      address: { category: content.category, date, slug: content.slug },
      version: 2,
      createdAt: at,
      updatedAt: at,
      publishedAt: at,
      updatedBy: "owner@example.com",
    };
  });
  const at = new Date().toISOString();
  list.push({
    id: "story-private-post",
    shopId: "story-shop",
    draft: {
      title: tr("まだ公開していないお便り"),
      slug: "private-draft",
      category: "blogs",
      date: dateJST(),
      excerpt: tr("確認中の下書き"),
      body: tr("これは店主が確認中の下書きです。お客様には表示されません。"),
    },
    published: null,
    version: 1,
    createdAt: at,
    updatedAt: at,
    updatedBy: "owner@example.com",
  });
  return list;
}
