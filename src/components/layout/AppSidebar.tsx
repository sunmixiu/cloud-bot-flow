import { 
  Home, 
  Settings, 
  Activity, 
  BarChart3,
  Monitor,
  GraduationCap,
  Box,
  Boxes,
  FlaskConical,
  CloudCog,
  Rocket
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";

const mainNavItems = [
  { 
    title: "任务工作流", 
    url: "/", 
    icon: Home
  },
  { 
    title: "实时监控", 
    url: "/monitoring", 
    icon: Monitor
  },
  {
    title: "算法资产库",
    url: "/algorithm-library",
    icon: Boxes
  },
  {
    title: "镜像与 Pipeline",
    url: "/build-pipeline",
    icon: CloudCog
  },
  {
    title: "算法快速部署",
    url: "/quick-deployment",
    icon: Rocket
  },
  {
    title: "仿真实验室",
    url: "/simulation",
    icon: FlaskConical
  },
  { 
    title: "性能报告", 
    url: "/reports", 
    icon: BarChart3
  },
  { 
    title: "资源管理", 
    url: "/resources", 
    icon: Settings
  },
  { 
    title: "机器人训练场", 
    url: "/training", 
    icon: GraduationCap
  },
  { 
    title: "3D查看器", 
    url: "/viewer", 
    icon: Box
  },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const location = useLocation();
  const currentPath = location.pathname;
  const isCollapsed = state === "collapsed";

  const isActive = (path: string) => {
    if (path === "/") return currentPath === "/";
    return currentPath.startsWith(path);
  };

  const getNavCls = ({ isActive }: { isActive: boolean }) =>
    isActive 
      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" 
      : "hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground";

  return (
    <Sidebar className={isCollapsed ? "w-14" : "w-64"} collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border p-4">
        {!isCollapsed && (
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg">
              <img src="/favicon.png" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-base font-semibold text-sidebar-foreground">
                机器人云边协同调度平台
              </h1>
            </div>
          </div>
        )}
        {isCollapsed && (
          <div className="flex justify-center">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg">
              <img src="/favicon.png" />
            </div>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNavItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild className="h-12">
                    <NavLink 
                      to={item.url} 
                      end={item.url === "/"} 
                      className={({ isActive }) => getNavCls({ isActive })}
                    >
                      <item.icon className="h-5 w-5 shrink-0" />
                      {!isCollapsed && (
                        <span className="text-base font-medium">{item.title}</span>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
