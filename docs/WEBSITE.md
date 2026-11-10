# Webobscure website

Public website: [webobscure.gentle-bard-9614.chatgpt.site](https://webobscure.gentle-bard-9614.chatgpt.site).

- `/`: publisher introduction and FileBridge overview.
- `/filebridge`: interactive illustration, recorded demo, installation links, and limitations.
- `/privacy`: information about the website and external services.

The English site is built with the Sites Vinext starter. Its local source is in
`website-webobscure/`, a separate Git checkout backed by the Sites source
repository. The extension repository and VSIX packaging explicitly exclude that
directory. Production assets use the existing FileBridge logo and demo recording.

Update the site through the Sites source workflow: preserve its project ID in
`.openai/hosting.json`, build and verify changes, push source, save a version,
and deploy that saved version. Publishing credentials must stay out of source.

The initial public release is Site version 1, source commit
`de610d32b5005554c01a4f4684d80e66af27115c`. TypeScript and production build
checks passed. Browser checks covered page navigation, the illustrative save and
search interactions, FAQ expansion, video loading, and a 390-pixel mobile viewport.

## Custom domain

No custom domain is registered or attached. The current address is a temporary
hosting address, not evidence of ownership of an eligible Marketplace domain.
When the account holder chooses and registers a domain, attach it to this Site,
apply the returned DNS records, and update metadata and links to the verified
origin. Buying a domain and changing DNS are separate actions.

Microsoft Marketplace publisher verification also requires the publisher's
extension history and domain registration to meet its minimum age requirements;
publishing this site alone does not provide a verified publisher badge.

See [Microsoft's publisher verification requirements](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#verify-a-publisher).
