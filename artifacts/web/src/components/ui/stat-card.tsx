import { Card, CardContent } from "@/components/ui/card";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  trend?: { value: number; label?: string };
  className?: string;
}

export function StatCard({ title, value, subtitle, icon, trend, className }: StatCardProps) {
  return (
    <Card className={cn("overflow-hidden bg-card/50 backdrop-blur border-border/50", className)}>
      <CardContent className="p-6">
        <div className="flex justify-between items-start">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            <div className="text-2xl font-bold tracking-tight">{value}</div>
            
            {(subtitle || trend) && (
              <div className="flex items-center gap-2 text-xs">
                {trend && (
                  <span className={cn(
                    "font-medium",
                    trend.value > 0 ? "text-success" : trend.value < 0 ? "text-destructive" : "text-muted-foreground"
                  )}>
                    {trend.value > 0 ? "+" : ""}{trend.value}%
                  </span>
                )}
                {subtitle && <span className="text-muted-foreground">{subtitle}</span>}
              </div>
            )}
          </div>
          {icon && <div className="text-muted-foreground/50">{icon}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
