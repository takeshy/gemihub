import { tr } from "../shared/i18n";

export async function readApiResponse<T>(response: Response): Promise<T> {
  let value: unknown;
  try { value = JSON.parse(await response.text()); }
  catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    const timeout = response.status === 504 || response.status === 408;
    throw Object.assign(new Error(timeout
      ? tr("サーバーの応答がタイムアウトしました。処理結果を確認してから、もう一度お試しください。")
      : tr("サーバーから正しい応答を受け取れませんでした（HTTP {0}）。", response.status)), { status: response.status });
  }
  if (!response.ok) {
    const message = value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : tr("操作できませんでした");
    throw Object.assign(new Error(message), { status: response.status });
  }
  return value as T;
}
