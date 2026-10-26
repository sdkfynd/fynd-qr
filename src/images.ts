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
    // Trim only transparent outer padding, keeping the artwork and opaque backgrounds intact.
    const pixels = context.getImageData(0, 0, 240, 240).data;
    let left = 240, top = 240, right = -1, bottom = -1;
    for (let y = 0; y < 240; y++) for (let x = 0; x < 240; x++) if (pixels[(y * 240 + x) * 4 + 3] > 8) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
    if (right < left) throw new Error('Empty image');
    const fitted = document.createElement('canvas'); fitted.width = fitted.height = 240;
    const target = fitted.getContext('2d')!;
    const cropWidth = right - left + 1, cropHeight = bottom - top + 1, fit = Math.min(240 / cropWidth, 240 / cropHeight);
    target.drawImage(canvas, left, top, cropWidth, cropHeight, (240 - cropWidth * fit) / 2, (240 - cropHeight * fit) / 2, cropWidth * fit, cropHeight * fit);
    return fitted.toDataURL('image/png');
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
