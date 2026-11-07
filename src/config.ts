export const SITE = {
  name: 'Based',
  title: 'Based acquires and scales owner-led internet businesses (SaaS, FinTech, InsurTech)',
  description:
    'Based is a hands-on acquisition partner for owner-led internet businesses earning $500K–$5M in recurring revenue, providing tailored offers, operational support, and growth strategies to ensure seamless transitions and sustainable scale.',
  address: '2665 Main St, suite 2 Santa Monica, California, 90405',
  year: 2025,
};

/**
 * Form backend. Default is Web3Forms (free, no server). To switch to Formspree,
 * set `endpoint` to your https://formspree.io/f/xxxx URL and clear `accessKey`.
 */
export const FORM = {
  endpoint: 'https://api.web3forms.com/submit',
  accessKey: import.meta.env.PUBLIC_WEB3FORMS_KEY ?? '',
};

export const NAV = [
  { label: 'Home', href: '/', n: '01' },
  { label: 'About', href: '/about', n: '02' },
  { label: 'Sell your business', href: '/sell-your-business', n: '03' },
];

/** Prefix an internal path with the configured base (for GitHub project pages). */
export const url = (path = '/') => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}` || '/';
};
