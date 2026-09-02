import { EyeOff, LockKeyhole, Palette, ShieldCheck } from 'lucide-react';

import { DashboardManager } from '@/components/dashboard-manager';
import { WorkspaceShell } from '@/components/workspace-shell';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-3 border-b border-border/60 py-4 first:pt-0 last:border-0 last:pb-0 sm:flex-row sm:items-center">
      <div className="max-w-xl">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <WorkspaceShell
      active="settings"
      eyebrow="Owner preferences"
      title="Workspace settings"
      description="Presentation choices can change emphasis and density, but never relabel one market measurement as another."
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <DashboardManager />

          <Card className="border border-white/[0.03] bg-card/80">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><EyeOff className="size-4 text-amber-300" />Seller privacy</CardTitle>
              <CardDescription>Privacy is applied in server serialization before caching or live event fan-out.</CardDescription>
            </CardHeader>
            <CardContent>
              <SettingRow title="Owner view" description="The owner may inspect seller names and UUIDs supplied by the source.">
                <NativeSelect defaultValue="full" disabled aria-label="Owner seller visibility"><NativeSelectOption value="full">Full source identity</NativeSelectOption><NativeSelectOption value="name">Name only</NativeSelectOption><NativeSelectOption value="pseudo">Pseudonymized</NativeSelectOption></NativeSelect>
              </SettingRow>
              <SettingRow title="Invited-user view" description="Future invited users default to receiving no seller identity.">
                <NativeSelect defaultValue="hidden" disabled aria-label="Invited user seller visibility"><NativeSelectOption value="hidden">Hidden</NativeSelectOption><NativeSelectOption value="pseudo">Pseudonymized</NativeSelectOption><NativeSelectOption value="name">Name only</NativeSelectOption></NativeSelect>
              </SettingRow>
              <SettingRow title="Seller-based analytics" description="Disabled until an explicit privacy decision is recorded.">
                <Switch disabled aria-label="Seller analytics" />
              </SettingRow>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="border border-white/[0.03] bg-card/80">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Palette className="size-4 text-violet-300" />Appearance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Theme</span><Badge variant="outline">Obsidian signal</Badge></div>
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Chart palette</span><span>Source contrast</span></div>
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Motion</span><span>Reduced by system</span></div>
            </CardContent>
          </Card>

          <Card className="border border-emerald-300/15 bg-emerald-300/[0.035]">
            <CardContent className="space-y-3 p-4 text-xs leading-5 text-muted-foreground">
              <p className="flex gap-2"><LockKeyhole className="mt-0.5 size-4 shrink-0 text-emerald-300" />The dashboard is private by default. Invites remain disabled until owner authentication is configured.</p>
              <p className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-300" />The upstream API key is never returned to this browser or a future Minecraft mod.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </WorkspaceShell>
  );
}
