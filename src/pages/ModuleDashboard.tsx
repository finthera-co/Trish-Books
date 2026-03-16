import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ModuleConfig } from "@/components/layout/ModuleLayout";

interface ModuleDashboardProps {
  config: ModuleConfig;
}

export default function ModuleDashboard({ config }: ModuleDashboardProps) {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{config.label}</h1>
        <p className="page-description">Select a feature below to get started.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {config.sidebarItems.map((item) => (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className="group text-left bg-card border border-border rounded-xl p-5 hover:shadow-md hover:border-primary/30 transition-all duration-200"
          >
            <div className="flex items-start justify-between mb-3">
              <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", config.color)}>
                <item.icon className="w-4 h-4 text-primary-foreground" />
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">{item.label}</h3>
          </button>
        ))}
      </div>
    </div>
  );
}
