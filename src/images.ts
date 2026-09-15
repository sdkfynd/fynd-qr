/** Local image operations shared by preview, uploads and export. */
export async function normalizeLogo(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
    throw new Error('Choose a PNG, JPG or WebP image smaller than 2 MB.');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    if (image.naturalWidth * image.naturalHeight > 25_000_000) throw new Error('Image too large');
    const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 240;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable');
    const ratio = Math.min(240 / image.naturalWidth, 240 / image.naturalHeight);
    const width = image.naturalWidth * ratio, height = image.naturalHeight * ratio;
    context.drawImage(image, (240 - width) / 2, (240 - height) / 2, width, height);
    return canvas.toDataURL('image/png');
  } catch { throw new Error('We couldn’t read that image. Try a smaller PNG, JPG or WebP.'); }
  finally { URL.revokeObjectURL(url); }
}

export async function svgToPng(svg: string, pixels: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = pixels; canvas.height = pixels;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable');
    context.drawImage(image, 0, 0, pixels, pixels);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('PNG export failed.')), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}
