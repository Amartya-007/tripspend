export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB limit

export const fileToDataUrl = (file: File): Promise<string> => {
  return blobToDataUrl(file);
};

export const blobToDataUrl = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (blob.size > MAX_FILE_SIZE_BYTES) {
      reject(new Error('File size exceeds the 10MB maximum limit.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('File read failed'));
      }
    };
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(blob);
  });
};
