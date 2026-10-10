export const CATEGORIES = [
  { slug: 'mutual-funds', label: 'Mutual funds', blurb: 'How SIPs, NAV, costs and fund types work.' },
  { slug: 'insurance', label: 'Insurance', blurb: 'Term, health and motor cover explained, including claims.' },
  { slug: 'credit-and-loans', label: 'Credit and loans', blurb: 'Credit scores, cards, EMIs and loan terms.' },
  { slug: 'tax', label: 'Tax', blurb: 'Income tax rules and filing, explained plainly.' },
  { slug: 'banking-and-savings', label: 'Banking and savings', blurb: 'Deposits, UPI and everyday banking.' },
  { slug: 'investing-basics', label: 'Investing basics', blurb: 'Compounding, asset allocation and inflation.' },
];

export function labelFor(slug: string) {
  return CATEGORIES.find((c) => c.slug === slug)?.label ?? slug;
}
