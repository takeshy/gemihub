import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

type File = { name: string; parents: string[]; content: string; trashed?: boolean };
type Input = { fileId?: string; requestBody?: { name?: string; parents?: string[]; trashed?: boolean }; media?: { body: Readable }; alt?: string; addParents?: string; removeParents?: string };
/** In-memory Drive transport exercising the real publication/archive/restore code. */
export function designDrive() {
  const files = new Map<string, File>();
  let failUpdate: ((input: Input) => boolean) | undefined;
  let failCopy = false;
  async function content(input: Input) {
    let text = "";
    if (input.media) for await (const chunk of input.media.body) text += chunk.toString();
    return text;
  }
  const file = (id: string) => {
    const value = files.get(id);
    if (!value || value.trashed) throw Object.assign(new Error("Drive file missing"), { code: 404 });
    return value;
  };
  return {
    files,
    failNextUpdate(predicate: (input: Input) => boolean) { failUpdate = predicate; },
    failNextCopy() { failCopy = true; },
    client: { files: {
      async create(input: Input) {
        const id = randomUUID();
        files.set(id, { name: input.requestBody?.name || "", parents: input.requestBody?.parents || [], content: await content(input) });
        return { data: { id } };
      },
      async get(input: Input) {
        const value = file(input.fileId!);
        return { data: input.alt === "media" ? value.content : { parents: value.parents } };
      },
      async copy(input: Input) {
        if (failCopy) { failCopy = false; throw new Error("Drive copy failed"); }
        const id = randomUUID();
        files.set(id, { ...file(input.fileId!), name: input.requestBody?.name || "", parents: input.requestBody?.parents || [] });
        return { data: { id } };
      },
      async update(input: Input) {
        if (failUpdate?.(input)) { failUpdate = undefined; throw new Error("Drive write failed"); }
        const value = file(input.fileId!);
        if (input.media) value.content = await content(input);
        if (input.addParents) value.parents = [input.addParents];
        if (input.requestBody?.trashed) {
          const trash = (id: string) => {
            files.get(id)!.trashed = true;
            for (const [child, entry] of files) if (entry.parents.includes(id)) trash(child);
          };
          trash(input.fileId!);
        }
        return { data: { id: input.fileId } };
      },
    } },
  };
}
