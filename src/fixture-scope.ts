import type { ShopConfig } from "../server/domain";
import { postKey, type PostCategory } from "../server/post-domain";
import { articleKinds } from "../shared/article-features";
import { compilePresentation } from "../shared/presentation";
import type { Fixtures } from "./local-preview";

export type FixtureScope = {
  customer: boolean;
  bookings: boolean;
  bookingNames: boolean;
  postCategories: PostCategory[];
  articleBody: boolean;
  articleKey?: string;
  articleIndex?: number;
  recentPosts: boolean;
};
export function fixtureScope(config: ShopConfig, screen: string, articleKey?: string, fixtures?: Fixtures): FixtureScope {
  const enabled = articleKinds(config);
  const [category, article] = screen.split(":");
  const articleScreen = (category === "blogs" || category === "announcements") && enabled.includes(category);
  const mineNews = screen === "mine" && (!config.screens?.mine || compilePresentation(config.screens.mine).slots.includes("news"));
  return {
    customer: ["reserve", "mine", "contact"].includes(screen),
    bookings: screen === "reserve" || screen === "mine",
    bookingNames: screen === "mine",
    postCategories: articleScreen ? [category] : mineNews ? enabled : [],
    articleBody: articleScreen && article === "article",
    articleKey: articleScreen && article === "article" ? articleKey : undefined,
    articleIndex: articleScreen && article === "article" && fixtures ? fixtures.posts.findIndex(post => post.category === category && postKey(post) === articleKey) : undefined,
    recentPosts: mineNews,
  };
}
export const hasFixtureFields = (scope: FixtureScope) => scope.customer || scope.bookings || scope.postCategories.length > 0;
export function fixturePostEntries(fixtures: Fixtures, scope: FixtureScope) {
  const entries = fixtures.posts.map((post, index) => ({ post, index })).filter(({ post }) => scope.postCategories.includes(post.category));
  if (scope.articleBody) return entries.filter(({ post, index }) => scope.articleIndex === undefined ? postKey(post) === scope.articleKey : index === scope.articleIndex);
  return scope.recentPosts ? entries.slice(0, 5) : entries;
}
