// Keyword detection utilities for automatic model switching

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
