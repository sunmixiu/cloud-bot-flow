import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { API_CONFIG } from "@/services/api";

export default function RealtimeMonitoring() {
  const location = useLocation();
  const monitoringData = (location.state as { monitoringData?: unknown } | null)?.monitoringData;

  // 构建带参数的 iframe URL
  const iframeUrl = useMemo(() => {
    try {
      if (monitoringData) {
        // 将 JSON 对象转换为字符串并编码
        const jsonString = JSON.stringify(monitoringData);
        const encodedData = encodeURIComponent(jsonString);
        
        console.log("传递监控数据到 iframe:", monitoringData);
        
        // 将编码后的数据作为 URL 参数传递
        return `${API_CONFIG.monitoringUrl}?data=${encodedData}`;
      }
    } catch (error) {
      console.error('编码监控数据失败:', error);
    }
    
    // 如果没有数据或编码失败，返回基本 URL
    return API_CONFIG.monitoringUrl;
  }, [monitoringData]);

  return (
    <Card className="w-full h-full">
      <CardContent className="h-full p-0">
        <iframe
          src={iframeUrl}
          className="w-full h-full border-0"
          title="实时监控"
          allow="fullscreen"
        />
      </CardContent>
    </Card>
  );
}
