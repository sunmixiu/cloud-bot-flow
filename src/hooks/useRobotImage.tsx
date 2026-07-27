import { useState, useEffect } from 'react';
import { robotImageApi } from '@/services/api';

export function useRobotImage(xmlPath: string | undefined) {
  const [imageUrl, setImageUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!xmlPath) {
      setImageUrl('');
      return;
    }

    let cancelled = false;
    let blobUrl: string | null = null;
    setIsLoading(true);
    setError(null);

    robotImageApi.getImage(xmlPath)
      .then(url => {
        if (!cancelled) {
          blobUrl = url;
          setImageUrl(url);
          setIsLoading(false);
        } else {
          // 如果已取消，立即释放 blob URL
          URL.revokeObjectURL(url);
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
      // 清理 blob URL 以避免内存泄漏
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [xmlPath]);

  return { imageUrl, isLoading, error };
}
