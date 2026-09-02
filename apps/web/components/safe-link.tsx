import type { ComponentPropsWithoutRef } from 'react';

type SafeLinkProps = Omit<ComponentPropsWithoutRef<'a'>, 'href'> & {
  href: string;
};

export default function SafeLink({ href, ...props }: SafeLinkProps) {
  return <a href={href} {...props} />;
}
