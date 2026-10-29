/**
 * Utility to downscale and compress image files client-side before storing.
 * Reduces 3MB-10MB mobile/camera images to ~25KB-50KB without visual loss on avatars.
 */
export function compressImageFile(
  file: File,
  maxWidth = 480,
  maxHeight = 480,
  quality = 0.82
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      // Non-image file (e.g. PDF): read standard data URL
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          resolve(readerEvent.target?.result as string);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedDataUrl);
      };

      img.onerror = () => {
        resolve(readerEvent.target?.result as string);
      };

      img.src = readerEvent.target?.result as string;
    };

    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(file);
  });
}
