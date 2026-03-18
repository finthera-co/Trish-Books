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
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="page-title">{config.label}</h1>
        <p className="page-description">Select a feature below to get started.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {config.sidebarItems.map((item, i) => (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className="group text-left bg-card border border-border rounded-xl p-5 hover:shadow-lg hover:border-primary/20 hover:-translate-y-0.5 transition-all duration-300 active:scale-[0.98]"
            style={{ animationDelay: `${i * 0.05}s` }}
          >
            <div className="flex items-start justify-between mb-3">
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shadow-sm transition-transform duration-300 group-hover:scale-110", config.color)}>
                <item.icon className="w-4.5 h-4.5 text-primary-foreground" />
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all duration-300" />
            </div>
            <h3 className="text-sm font-bold text-foreground">{item.label}</h3>
          </button>
        ))}
      </div>
    </div>
  );
}
