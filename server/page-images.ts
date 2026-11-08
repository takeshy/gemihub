import { parseFragment, serialize, serializeOuter, type DefaultTreeAdapterTypes as Html } from "parse5";
import { z } from "zod";
import { tr } from "../shared/i18n.ts";

export const pageImageEditsSchema = z.array(z.strictObject({ index: z.number().int().min(0), imageId: z.string().regex(/^[a-f0-9]{64}$/), alt: z.string().max(300).optional() })).max(16);
function imageNodes(root: Html.DocumentFragment) {
  const images: Html.Element[] = [];
  const walk = (node: Html.ChildNode) => {
    if (!("tagName" in node)) return;
    if (node.tagName === "img" || node.tagName === "svg") { images.push(node);return; }
    node.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  return images;
}
export const pageImageTargets = (body: string) => imageNodes(parseFragment(body)).map((node, index) => ({ index, html: serializeOuter(node) }));

/** Replace a picture in place; surrounding copy, cards and other pictures remain server-owned. */
export function applyPageImageEdits(body: string, input: z.infer<typeof pageImageEditsSchema>) {
  const edits = pageImageEditsSchema.parse(input), root = parseFragment(body), nodes = imageNodes(root);
  const changed = new Set<number>();
  for (const edit of edits) {
    const node = nodes[edit.index];
    if (!node || changed.has(edit.index)) throw Object.assign(new Error(tr("変更対象を選び直してください")), { status: 400 });
    changed.add(edit.index);
    const image = parseFragment('<img alt="">').childNodes[0] as Html.Element;
    image.attrs = node.attrs.filter(attr => node.tagName === "img" ? !["src", "data-image-id", "alt"].includes(attr.name) : ["id", "class", "style", "width", "height"].includes(attr.name)).map(attr => ({ ...attr }));
    image.attrs.push({ name: "data-image-id", value: edit.imageId }, { name: "alt", value: edit.alt ?? node.attrs.find(attr => attr.name === "alt")?.value ?? "" });
    if (node.tagName === "svg") {
      const style = image.attrs.find(attr => attr.name === "style");
      const fit = "max-width:100%;object-fit:cover";
      if (style) style.value += `;${fit}`;else image.attrs.push({ name: "style", value: fit });
    }
    image.parentNode = node.parentNode;
    node.parentNode!.childNodes.splice(node.parentNode!.childNodes.indexOf(node), 1, image);
  }
  return edits.length ? serialize(root) : body;
}

/** A design edit can replace images, but cannot rewrite the page's text or structure. */
export function samePageImageStructure(before: string, after: string) {
  if (before === after) return true;
  const shape = (body: string) => {
    const root = parseFragment(body);
    for (const node of imageNodes(root)) {
      const marker = parseFragment("<img>").childNodes[0];
      marker.parentNode = node.parentNode;
      node.parentNode!.childNodes.splice(node.parentNode!.childNodes.indexOf(node), 1, marker);
    }
    return serialize(root);
  };
  return shape(before) === shape(after);
}
