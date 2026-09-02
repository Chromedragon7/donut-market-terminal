import type { Metadata } from 'next';
import { KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';

import { LoginForm } from '@/components/login-form';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to the private Gilded market-intelligence workspace.',
};

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-emerald-300/30 bg-emerald-300/10">
            <span className="size-4 rotate-45 border border-emerald-200 bg-emerald-300/40" />
          </span>
          <p className="mt-4 text-lg font-semibold tracking-[0.15em]">GILDED</p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Market intelligence</p>
        </div>

        <Card className="border border-white/[0.04] bg-card/90 shadow-[0_28px_90px_rgb(0_0_0/36%)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound className="size-4 text-emerald-300" />Private sign in</CardTitle>
            <CardDescription>Use the owner credentials configured on the hosted API. Secrets never enter source control.</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
            <div className="mt-5 grid gap-2 border-t border-border pt-4 text-[11px] leading-5 text-muted-foreground">
              <p className="flex gap-2"><LockKeyhole className="mt-0.5 size-3.5 shrink-0" />Sessions are revocable, expiring, and stored server-side as hashes.</p>
              <p className="flex gap-2"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" />The upstream compatible-API key is never used by this form.</p>
            </div>
          </CardContent>
        </Card>

        <div className="mt-5 flex justify-center"><Badge variant="outline">Invite-only access remains disabled</Badge></div>
      </div>
    </main>
  );
}
