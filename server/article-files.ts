import { tr } from "../shared/i18n.ts";
import type { Store, Shop } from "./store.ts";
import type { ShopConfig } from "./domain.ts";
import { documents } from "./domain.ts";
import type { Post } from "./post-domain.ts";
import { postKey } from "./post-domain.ts";
import { articleImagePath } from "./post-images.ts";
import { listImages } from "./image-library.ts";
import { readRequestImages, compactRequestImage } from "./request-images.ts";
import type { CustomerFiles } from "./customer-files.ts";
export type ArticleFile = {
  path: string;
  name: string;
  kind: "text" | "image";
  imageId?: string;
};
export type ArticleFileResult = {
  path: string;
  text?: string;
  image?: { mimeType: string; data: string };
};
export type ArticleToolContext = {
  files: ArticleFile[];
  requiredPaths: string[];
  readFile: (path: string) => Promise<ArticleFileResult>;
};
export async function articleFiles(
  store: Store,
  shop: Shop,
  config: ShopConfig,
) {
  const posts = (await store.records<Post>("post", shop)).filter(post => !post.deletedAt);
  const generated = documents(config, shop.history);
  const texts = new Map<string, string>([
    ["spec.md", generated.spec],
    ["history.md", generated.history],
    ["shop.json", JSON.stringify(config, null, 2)],
  ]);
  for (const page of config.pages)
    texts.set(`pages/${page.slug}.md`, `# ${page.title}\n\n${page.body}`);
  for (const post of posts)
    texts.set(
      `articles/${post.draft.category}/${postKey(post.draft)}.md`,
      `# ${post.draft.title}\n\n${post.draft.body}`,
    );
  const files: ArticleFile[] = [...texts.keys()].map((path) => ({
    path,
    name: path,
    kind: "text",
  }));
  files.push(
    ...(await listImages(store, shop, config)).map((image) => ({
      path: articleImagePath(image.id, image.name),
      name: image.name,
      kind: "image" as const,
      imageId: image.id,
    })),
  );
  return { files, texts };
}
export async function articleToolContext(
  store: Store,
  shop: Shop,
  config: ShopConfig,
  requiredPaths: string[],
  files: CustomerFiles,
  token: string,
): Promise<ArticleToolContext> {
  const catalog = await articleFiles(store, shop, config);
  const assertPath = (path: string) => {
    if (
      path.split("/").includes("..") ||
      path.includes("\\") ||
      /^[a-z]+:/i.test(path) ||
      !catalog.files.some((file) => file.path === path)
    )
      throw Object.assign(
        new Error(
          tr("参照するお店のファイルが見つかりません。パスを確認してください。"),
        ),
        { status: 404 },
      );
    return catalog.files.find((file) => file.path === path)!;
  };
  for (const path of requiredPaths) assertPath(path);
  if (
    new Set(
      requiredPaths
        .map(
          (path) => catalog.files.find((file) => file.path === path)?.imageId,
        )
        .filter(Boolean),
    ).size > 15
  )
    throw Object.assign(new Error(tr("画像は15枚まで参照できます。")), {
      status: 400,
    });
  const readImages = new Set<string>();
  return {
    files: catalog.files,
    requiredPaths,
    async readFile(path) {
      const file = assertPath(path);
      if (file.kind === "text")
        return { path, text: catalog.texts.get(path)!.slice(0, 30000) };
      readImages.add(file.imageId!);
      if (readImages.size > 15)
        throw Object.assign(new Error(tr("画像は15枚まで参照できます。")), {
          status: 400,
        });
      const image = (
        await readRequestImages(store, shop, [file.imageId!], files, token)
      )[0];
      return { path, image: await compactRequestImage(image) };
    },
  };
}
