'use client';

import { useState, type SyntheticEvent } from 'react';
import { ArrowRight, LoaderCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? '';

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch(`${apiOrigin}/v1/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: typeof form.get('username') === 'string' ? form.get('username') : '',
          password: typeof form.get('password') === 'string' ? form.get('password') : '',
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        setError(payload?.message ?? 'Sign-in failed. Check your credentials and try again.');
        return;
      }

      window.location.assign('/');
    } catch {
      setError('The private API is unavailable. Confirm that the hosted service is running.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="username">Username</Label>
        <Input id="username" name="username" autoComplete="username" required maxLength={80} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required maxLength={1024} />
      </div>
      {error ? (
        <p role="alert" className="rounded-lg border border-red-300/20 bg-red-300/[0.06] px-3 py-2 text-xs leading-5 text-red-100">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="h-10 w-full" disabled={submitting}>
        {submitting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
        Enter private workspace
        {!submitting ? <ArrowRight aria-hidden="true" /> : null}
      </Button>
    </form>
  );
}
