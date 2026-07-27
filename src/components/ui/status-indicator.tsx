import { cn } from "@/lib/utils";

interface StatusIndicatorProps {
  status: "online" | "offline" | "idle" | "working";
  className?: string;
  showText?: boolean;
}

const statusConfig = {
  online: {
    color: "bg-status-online",
    text: "在线",
    pulse: true
  },
  offline: {
    color: "bg-status-offline", 
    text: "离线",
    pulse: false
  },
  idle: {
    color: "bg-status-idle",
    text: "空闲", 
    pulse: false
  },
  working: {
    color: "bg-status-working",
    text: "工作中",
    pulse: true
  }
};

export function StatusIndicator({ status, className, showText = false }: StatusIndicatorProps) {
  const config = statusConfig[status];
  
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative">
        <div className={cn(
          "w-2 h-2 rounded-full",
          config.color
        )} />
        {config.pulse && (
          <div className={cn(
            "absolute inset-0 w-2 h-2 rounded-full animate-ping opacity-75",
            config.color
          )} />
        )}
      </div>
      {showText && (
        <span className="text-sm text-muted-foreground">
          {config.text}
        </span>
      )}
    </div>
  );
}