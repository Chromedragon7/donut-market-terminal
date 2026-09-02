import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import { ItemDetailLive } from '@/components/item-detail-live';
import { ItemMarketEvidence } from '@/components/item-market-evidence';
import { WorkspaceShell } from '@/components/workspace-shell';
import { buttonVariants } from '@/components/ui/button';

type ItemPageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: ItemPageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: `Item ${slug}`,
    description: `Source-aware market evidence requested for ${slug}.`,
    openGraph: { images: [] },
    twitter: { images: [] },
  };
}

export default async function ItemPage({ params }: ItemPageProps) {
  const { slug } = await params;

  return (
    <WorkspaceShell
      active="items"
      eyebrow="Requested identity"
      title={slug}
      description="Source-backed asks, completed sales, quality, and gaps for this requested identity. Fields stay unavailable until evidence is ingested."
      actions={
        <Link href="/items" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          <ArrowLeft aria-hidden="true" />
          Catalog
        </Link>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ItemDetailLive itemId={slug} />
      </div>

      <ItemMarketEvidence itemId={slug} />
    </WorkspaceShell>
  );
}
