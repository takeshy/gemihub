// Keyword detection utilities for automatic model/feature switching

// ---------------------------------------------------------------------------
// Image model auto-switch
// ---------------------------------------------------------------------------

const IMAGE_KEYWORDS = [
  // Japanese
  "画像を生成", "画像を作成", "画像を描", "イラストを", "絵を描",
  "写真を生成", "写真を作成", "画像にして",
  // English
  "generate image", "create image", "draw image",
  "generate a picture", "create a picture", "make an image",
  // German
  "bild generieren", "bild erstellen",
  // Spanish
  "generar imagen", "crear imagen",
  // French
  "générer une image", "créer une image",
  // Italian
  "genera immagine", "crea immagine",
  // Korean
  "이미지 생성", "그림 그려",
  // Portuguese
  "gerar imagem", "criar imagem",
  // Chinese
  "生成图片", "创建图片",
];

export function shouldUseImageModel(message: string): boolean {
  const lower = message.toLowerCase();
  return IMAGE_KEYWORDS.some((kw) => lower.includes(kw));
}

// ---------------------------------------------------------------------------
// Thinking keyword detection
// ---------------------------------------------------------------------------

// Latin-script keywords use word-boundary regex to avoid false positives
const THINKING_KEYWORDS_REGEX = [
  // English
  /\bthink\b/, /\banalyze\b/, /\bconsider\b/, /\breason about\b/, /\breflect\b/,
  // German
  /\bnachdenken\b/, /\banalysieren\b/, /\büberlegen\b/,
  // Spanish
  /\bpiensa\b/, /\banaliza\b/, /\breflexiona\b/,
  // French
  /\bréfléchis\b/, /\banalyse\b/, /\bconsidère\b/,
  // Italian
  /\bpensa\b/, /\banalizza\b/, /\brifletti\b/,
  // Portuguese
  /\bpense\b/, /\banalise\b/, /\breflita\b/,
];

// CJK keywords use substring matching (word boundaries don't apply)
const THINKING_KEYWORDS_CJK = [
  // Japanese
  "考えて", "考察", "分析して", "検討して", "深く考", "じっくり", "よく考えて",
  // Korean
  "생각해", "분석해", "고려해",
  // Chinese
  "思考", "分析一下", "考虑",
];

export function shouldEnableThinking(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    THINKING_KEYWORDS_REGEX.some((re) => re.test(lower)) ||
    THINKING_KEYWORDS_CJK.some((kw) => lower.includes(kw))
  );
}
