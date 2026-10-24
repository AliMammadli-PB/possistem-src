/** Phone gallery/camera files (HEIC, huge PNG) become a JPEG the API can store. */
export async function prepareCatalogPhoto(file: File): Promise<File> {
  const type = (file.type || '').toLowerCase();
  const smallEnough = file.size > 0 && file.size <= 8 * 1024 * 1024;
  if (smallEnough && (type === 'image/jpeg' || type === 'image/jpg' || type === 'image/png' || type === 'image/webp')) {
    return file;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    if (smallEnough && (type.startsWith('image/') || !type)) return file;
    throw new Error('Şəkil oxunmadı. JPEG və ya PNG seçin.');
  }
  const max = 1600;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Şəkil hazırlanmadı.');
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.88);
  });
  if (!blob) throw new Error('Şəkil hazırlanmadı.');
  const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
}
