// Shared by the adapters. A Screenshot's width and height are the pixels of the image that is sent;
// the scene language maps them to 0..1000 across the image, so the capture keeps its own scale.

export type Screenshot = {
  mime: 'image/png' | 'image/jpeg';
  /** The image bytes, base64 encoded (no data: prefix). */
  base64: string;
  /** Pixel size of the image as sent (after any scaling for the model). */
  width: number;
  height: number;
};
