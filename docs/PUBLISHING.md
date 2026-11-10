# Publisher setup

FileBridge uses `publisher: Webobscure` and `name: filebridge` in
`package.json`. Keep this identity in both registries. Manifest metadata and
ownership of the GitHub repository do not establish registry permissions.

## Readiness record — November 10, 2026

| Registry | Confirmed | Still required |
| --- | --- | --- |
| Visual Studio Marketplace | `Webobscure` publisher created; current account is **Owner**. Version **0.7.3** uploaded successfully; management page shows **Verifying** and **Public**. | Wait for verification, then confirm the [public listing](https://marketplace.visualstudio.com/items?itemName=Webobscure.filebridge). Automated registry publishing is not configured. |
| Open VSX | Ownership request [#15480](https://github.com/EclipseFdn/open-vsx.org/issues/15480) granted. Version **0.7.3** is publicly available with a verified publisher badge at the [extension listing](https://open-vsx.org/extension/Webobscure/filebridge). | Verify availability in Cursor separately. |

Marketplace ownership is confirmed at
[publisher management](https://marketplace.visualstudio.com/manage/publishers/Webobscure).
The Open VSX account completed the agreement and namespace-creation prerequisites.
Namespace ownership has now been granted by the registry administrators. This
approval establishes the publishing identity. The first VSIX, version 0.7.1,
was subsequently published, followed by uploads of 0.7.3 to both registries. Open VSX's
0.7.3 listing is public; Marketplace verification is still pending. Temporary Marketplace
verification access has been removed; the publisher membership list contains only
the account owner.

The 0.7.1 Marketplace upload was rejected because the icon exceeded 1024 KB;
0.7.2 passed that check but exceeded 1024×1024 pixels. Version 0.7.3 uses a
512×512 PNG of about 270 KiB and checks both limits before packaging. Both stores
received the same VSIX; its contents match the successful v0.7.3 CI artifact.

## Visual Studio Marketplace

Open [publisher management](https://marketplace.visualstudio.com/manage) and
select `Webobscure`. Inspect membership: use Owner or a role explicitly permitted
to publish. A successful CLI authentication check alone does not establish a
publishing role. If the publisher does not exist, register the exact ID and
complete the required account and agreement steps.

For future automation, prefer Trusted Publishing with GitHub OIDC over a stored
PAT. Global Azure DevOps PATs retire on December 1, 2026. Configure a policy only
after the publishing workflow is reviewed: repository owner `webobscure`,
repository `filebridge`, and the exact workflow filename and environment.
The existing `release.yml` publishes GitHub Releases after successful checks;
it does not publish to a registry.

Source: [official publishing documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

## Open VSX

Start at the [profile settings](https://open-vsx.org/user-settings/profile).
Link the Eclipse account with GitHub username `webobscure` and review the
Publisher Agreement. The account holder must approve the agreement before
publishing.

If Eclipse GitHub sign-in says that the provider login must be configured first,
sign in using the existing Eclipse account and use
[Linked Accounts](https://accounts.eclipse.org/user/linked-accounts) to connect
`webobscure`. A GitHub authorization alone does not create this link.

Inspect namespace settings for `Webobscure`. A new namespace gives its creator
Contributor access, which permits publishing; verified ownership is a separate
step. Request Owner status through the public namespace-claim process after
logging in. Prepare the request with the repository link and GitHub identity;
do not describe a pending request as approved ownership.

Store publishing tokens only in an appropriate secret store. Never commit them
or put them in issue text, screenshots, release notes, or chat.

Sources: [publishing instructions](https://github.com/eclipse-openvsx/openvsx/wiki/Publishing-Extensions),
[namespace access and ownership](https://github.com/eclipse-openvsx/openvsx/wiki/Namespace-Access).

### Namespace ownership request

Submitted: [Claiming namespace `Webobscure` — #15480](https://github.com/EclipseFdn/open-vsx.org/issues/15480).
The request uses validation Option 2 (a Marketplace publisher without published
extensions) and links the namespace, Marketplace publisher, source repository,
and pinned manifest. The administrators granted it on November 9, 2026.

After review, check that the Open VSX namespace is verified and `webobscure` is
an Owner. Review Marketplace membership and remove any temporary verification
access once the request closes; temporary review access does not expire by
itself. Keep release uploads separate from this identity check.

## Cursor

Cursor obtains third-party extensions from Open VSX through its own marketplace
proxy and review process. An Open VSX upload alone does not prove availability
in Cursor: check search and installation after the registry release.

Cursor's optional verification badge is separate from Open VSX namespace
ownership. It requires a website on an owned domain linking to the Open VSX
listing, a matching listing homepage, and a request on the Cursor forum.

Source: [Cursor extension documentation](https://cursor.com/help/customization/extensions).
