import { tr } from "../shared/i18n.ts";
import type { Content, GenerateContentResponse, Part } from "@google/genai";
import type { ArticleToolContext } from "./article-files.ts";
export async function gatherArticleSources(
  generate: (
    contents: Content[],
  ) => Promise<
    Partial<
      Pick<GenerateContentResponse, "functionCalls" | "candidates" | "text">
    >
  >,
  initial: Content[],
  context: ArticleToolContext,
) {
  const contents = [...initial];
  const read = new Set<string>();
  const cache = new Map<
    string,
    Awaited<ReturnType<ArticleToolContext["readFile"]>>
  >();
  let count = 0;
  for (let round = 0; round < 7; round++) {
    const response = await generate(contents);
    const calls = response.functionCalls || [];
    if (!calls.length) {
      const missing = context.requiredPaths.filter((path) => !read.has(path));
      if (!missing.length) return contents;
      contents.push({
        role: "user",
        parts: [
          {
            text: tr("記事を作る前に、read_shop_file で次の参照ファイルを必ず確認してください：{0}", JSON.stringify(missing)),
          },
        ],
      });
      continue;
    }
    if (count + calls.length > 30)
      throw new Error(
        tr("参照ファイルの確認が多すぎます。参照を絞ってもう一度依頼してください。"),
      );
    count += calls.length;
    const modelContent = response.candidates?.[0]?.content;
    if (!modelContent)
      throw new Error(tr("AIのファイル参照を確認できませんでした"));
    contents.push(modelContent);
    const parts: Part[] = [];
    for (const call of calls) {
      const path = typeof call.args?.path === "string" ? call.args.path : "";
      try {
        if (call.name !== "read_shop_file")
          throw new Error(tr("この操作は利用できません"));
        const file = cache.get(path) || (await context.readFile(path));
        cache.set(path, file);
        read.add(path);
        parts.push({
          functionResponse: {
            name: call.name,
            id: call.id,
            response: {
              path: file.path,
              ...(file.text !== undefined
                ? { text: file.text }
                : { image: true }),
            },
          },
        });
        if (file.image)
          parts.push(
            { text: tr("参照画像：{0}", file.path) },
            { inlineData: file.image },
          );
      } catch (error) {
        parts.push({
          functionResponse: {
            name: call.name || "read_shop_file",
            id: call.id,
            response: {
              error: error instanceof Error ? error.message : tr("参照できません"),
            },
          },
        });
      }
    }
    contents.push({ role: "user", parts });
  }
  throw new Error(
    tr("参照ファイルを確認できませんでした。パスを確認してもう一度依頼してください。"),
  );
}
