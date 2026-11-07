# Based — basedinc.com

A static rebuild of [basedinc.com](https://www.basedinc.com) (originally on Framer). It keeps the motion and the forms, and it hosts free on **GitHub Pages**.

## Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Framework | [Astro](https://astro.build) (static output) | Ships plain HTML/CSS; JS only where needed |
| Animations | Vanilla TS + CSS (`src/scripts/main.ts`) | ~6 KB gzipped: one rAF loop drives every scroll effect |
| Smooth scroll | [Lenis](https://lenis.darkroom.engineering) | Small and smooth, works with native scroll |
| Page transitions | Astro View Transitions (`<ClientRouter />`) | SPA-style navigation with the gold stair wipe |
| Images | `astro:assets` `<Picture>` | AVIF/WebP + responsive sizes, generated at build time |
| Font | Inter Variable with optical sizing (self-hosted) | Matches the original Inter / Inter Display; no third-party requests |
| Forms | [Web3Forms](https://web3forms.com) (free) | No server needed; swappable for Formspree |

## Effects that were recreated

- Gold preloader that wipes away in a stepped "staircase" (shorter on repeat visits in the same session)
- The same staircase wipe on every page navigation
- Stepped blocks that rise over the hero and the road image as they scroll away
- Hero parallax and scale; the road image settles as it scrolls through
- Masked word-by-word and letter-by-letter headline reveals
- Stats paragraph whose words darken as you scroll; counters that count up
- Header that hides on scroll down, comes back on scroll up, and frosts once past the hero
- Rolling text on nav links and buttons; gold fill on button hover; circular dark reveal on the "How we do it" cards
- FAQ accordion where the + turns into ×; drifting background shapes; mobile menu that wipes down
- Subtle WebGL "cloud trail" on the hero photos that follows the cursor (`src/scripts/trail.ts`, ~3 KB gz). It replaces the original's Unicorn Studio embed, loads only on desktop mice, and stops rendering when idle. Tune its strength in `DISPLAY_FRAG`.
- Respects `prefers-reduced-motion` (all motion off, content shown straight away)

## Develop

```bash
nvm use            # Node 24 (see .nvmrc)
npm install
cp .env.example .env   # add your Web3Forms key
npm run dev            # http://localhost:4321
npm run build && npm run preview
```

## Forms (free)

1. Go to <https://web3forms.com>, enter the inbox that should receive leads, and copy the access key.
2. Local: put it in `.env` as `PUBLIC_WEB3FORMS_KEY=...`
3. GitHub: **Settings → Secrets and variables → Actions → Variables → New repository variable** named `PUBLIC_WEB3FORMS_KEY`.

The key is meant to be public: it can only send mail to your inbox. Spam protection is a honeypot field, and you can turn on hCaptcha in Web3Forms.
**Using Formspree instead:** set `FORM.endpoint` in `src/config.ts` to your `https://formspree.io/f/…` URL and remove the `access_key` hidden input in `src/components/ContactForm.astro`.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repo, on the `main` branch.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Every push to `main` builds and deploys (`.github/workflows/deploy.yml`). The workflow reads the Pages URL, so the same build works for `user.github.io/repo` and for a custom domain.

**Custom domain (www.basedinc.com):** in Settings → Pages, set the custom domain and tick "Enforce HTTPS". At your DNS provider, add a `CNAME` record from `www` to `<user>.github.io`, plus the GitHub `A` records for the apex domain.

## Editing content

- Copy lives in `src/pages/*.astro`. The FAQ is in `src/data/faq.ts`, and site-wide settings are in `src/config.ts`.
- Images are in `src/assets/img/`. Replace a file with the same name and the build re-optimizes it.
