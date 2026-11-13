# Webobscure website

Public website: [webobscure.github.io](https://webobscure.github.io/).
Source repository: [webobscure/webobscure.github.io](https://github.com/webobscure/webobscure.github.io).

- `/`: publisher introduction and FileBridge overview.
- `/filebridge/`: interactive illustration, recorded demo, installation links, and limitations.
- `/privacy/`: information about the website and external services.

The English site uses Next.js static export. Its local source is in
`website-github-pages/`, an independent Git checkout. The extension repository
and VSIX packaging exclude both this directory and the earlier Sites checkout
`website-webobscure/`. Website assets reuse the existing FileBridge logo and demo.

## Build and update

Use Node.js 22 or later in the website checkout:

```sh
npm ci
npm run build
npm run check
npm run verify
```

The `out/` directory contains the entire deployable site, including directory
indexes for direct page links, video, captions, sitemap, and `.nojekyll`.
The export check validates all three pages and their local links and assets.
No application server, database, or Sites account is required to serve it.

Push website changes to the default `feature/github-pages` branch in the website
repository. Its Pages workflow builds, checks, and publishes automatically.
Pull requests run checks without deployment. The deploy job uses GitHub's
short-lived OIDC credentials; no publishing PAT is stored.

The original Sites version remains a separate historical deployment. The
GitHub Pages website is the primary address; update this repository's website
links when changing the public origin.

## Custom domain

No custom domain is registered or attached. The github.io address does not prove
ownership of an eligible Microsoft Marketplace domain. When the account holder
chooses and registers a domain, configure it in GitHub Pages, apply GitHub's DNS
records, verify HTTPS, and update metadata and links to the new origin.

Microsoft Marketplace publisher verification also requires the publisher's
extension history and domain registration to meet its minimum age requirements;
publishing this site alone does not provide a verified publisher badge.

See [Microsoft's publisher verification requirements](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#verify-a-publisher).
