import React from "react";
import { tr } from "../shared/i18n";
import type { DefaultTreeAdapterTypes as Html } from "parse5";
import { compilePresentation, presentationBaseCss, presentationStyle, presentationUrl, type Presentation as Design } from "../shared/presentation";
import { MenuImage } from "./MenuImage";

const attributes = new Set("id class title role lang dir width height alt href src target loading decoding viewbox d x y x1 x2 y1 y2 cx cy r rx ry points fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset stroke-opacity opacity transform offset stop-color stop-opacity gradientunits gradienttransform preserveaspectratio clip-path mask colspan rowspan scope datetime open".split(" "));
const property: Record<string, string> = { class: "className", viewbox: "viewBox", colspan: "colSpan", rowspan: "rowSpan", datetime: "dateTime", gradientunits: "gradientUnits", gradienttransform: "gradientTransform", preserveaspectratio: "preserveAspectRatio" };
export function Presentation({ design, slots, fallback, imageBase, imageSuffix, resolvedImages, resetStructure = true }: { design?: Design; slots: Record<string, React.ReactNode>; fallback: React.ReactNode; imageBase?: string; imageSuffix?: string; resolvedImages?: Record<string, string>; resetStructure?: boolean }) {
  if (!design) return <>{fallback}</>;
  let compiled: ReturnType<typeof compilePresentation>;
  try { compiled = compilePresentation(design); } catch { return <>{fallback}</>; }
  const render = (node: Html.ChildNode, key: number): React.ReactNode => {
    if (node.nodeName === "#text" && "value" in node) return node.value;
    if (!("tagName" in node)) return null;
    const imageId = node.attrs.find(attr => attr.name === "data-image-id")?.value;
    if (imageId && resolvedImages?.[imageId]) return <span key={key} className={`theme-image ${node.attrs.find(attr => attr.name === "class")?.value || ""}`} style={presentationStyle(node.attrs.find(attr => attr.name === "style")?.value || "", compiled.animations)}><img src={resolvedImages[imageId]} alt={tr("{0}の画像", node.attrs.find(attr => attr.name === "alt")?.value || "")} /></span>;
    if (imageId) return imageBase ? <MenuImage key={key} imageId={imageId} imageBase={imageBase} suffix={imageSuffix} name={node.attrs.find(attr => attr.name === "alt")?.value || ""} className={`theme-image ${node.attrs.find(attr => attr.name === "class")?.value || ""}`} style={presentationStyle(node.attrs.find(attr => attr.name === "style")?.value || "", compiled.animations)} /> : <span key={key} data-design-image={imageId}>{node.attrs.find(attr => attr.name === "alt")?.value}</span>;
    const props: Record<string, unknown> = { key };
    for (const attr of node.attrs) {
      const name = attr.name.toLowerCase();
      if (name === "style") { props.style = presentationStyle(attr.value, compiled.animations); continue; }
      if (!attributes.has(name) && !/^(?:aria|data)-[a-z0-9-]+$/.test(name)) continue;
      if ((name === "href" || name === "src") && !presentationUrl(attr.value, name === "src")) continue;
      const reactName = property[name] || name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      props[name.startsWith("aria-") || name.startsWith("data-") ? name : reactName] = name === "open" ? true : attr.value;
    }
    if (node.tagName === "a") props.rel = "noopener noreferrer";
    const slot = node.tagName === "slot" ? node.attrs.find(a => a.name === "name")?.value : node.attrs.find(a => a.name === "data-slot")?.value;
    if (slot) return React.createElement(node.tagName === "slot" ? "div" : node.tagName, { ...props, ...(!resetStructure ? { style: { display: "contents" } } : {}), "data-design-slot": slot }, slots[slot] ?? null);
    return React.createElement(node.tagName, props, ["img", "br", "hr", "col"].includes(node.tagName) ? undefined : node.childNodes.map(render));
  };
  return <div className={`design-boundary ${compiled.id}`} data-style-only={resetStructure ? undefined : true} style={resetStructure ? { contain: "layout paint", isolation: "isolate" } : { display: "contents" }}>
    <style>{(resetStructure ? presentationBaseCss + "\n" : "") + compiled.css}</style><div className="design-root" style={resetStructure ? undefined : { display: "contents" }}>{compiled.nodes.map(render)}</div>
  </div>;
}
