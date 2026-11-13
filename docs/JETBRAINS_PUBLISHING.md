# JetBrains Marketplace release

FileBridge is a free, MIT-licensed native IntelliJ Platform plugin. Its identity
is `com.webobscure.filebridge`, with public vendor name **Webobscure**. This is
separate from the VS Code/Open VSX publisher and VSIX package.

## Release checks

1. Build the native ZIP with `python3 jetbrains/build.py`.
2. Run `python3 jetbrains/test.py --transport-only` with the fixture Python
   environment configured as described in `jetbrains/README.md`.
3. Run `python3 scripts/verify-phpstorm.py` against the supported SDK.
4. Install the resulting ZIP in a licensed PhpStorm. Use a disposable project
   and a loopback FTP fixture to check browsing, explicit Save, remote search
   and navigation, failed-upload recovery, and retry. Verify the server bytes.
5. Record the actual results in `jetbrains/VALIDATION.md`. Capture only the
   disposable project; real connection details and working projects must not
   appear in listing screenshots.

The release targets **PhpStorm 2026.2.x (build 262)**. The platform dependency
may make other IDEs appear compatible automatically. On the Marketplace admin
page, restrict the product list to the tested PhpStorm target. Do not claim
runtime validation on untested products or IDE versions.

## First upload

The first upload must be performed through the Marketplace website:

1. Sign in at <https://plugins.jetbrains.com/> and choose **Upload plugin**.
2. Select an existing Webobscure Vendor profile or create one. Suggested Vendor
   ID: `webobscure`; display name: `Webobscure`; website:
   <https://webobscure.github.io/>. Vendor IDs cannot be changed later.
3. The account holder must declare their trader/non-trader status and approve
   the Marketplace Developer Agreement. A free plugin does not by itself
   establish non-trader status. Obtain the public support email from the owner;
   do not infer it from unrelated accounts.
4. Upload the versioned `filebridge-phpstorm-<version>.zip`, not a VSIX or the
   test runner's patched JAR.
5. Choose **MIT**, source URL <https://github.com/webobscure/filebridge>, and
   relevant available tags for FTP/file management. The description is embedded
   from `docs/listing/jetbrains.html`; change notes and website come from
   `plugin.xml`.
6. Add support URL <https://github.com/webobscure/filebridge/issues/new/choose>
   and genuine PhpStorm screenshots in the media section. The existing VS Code
   demo is not evidence of the native plugin UI.
7. Review the listing, submit for moderation, and record its actual URL/status.
   A successful upload is not an approved public release.

Signing with an author's certificate is recommended. The Marketplace also
signs distributed plugins. If an author key is configured, use the official
Marketplace ZIP Signer and verify its output before uploading. Keep all private
keys and passwords outside the repository; do not generate disposable signing
identities for a production release. API tokens for later uploads belong in a
secret store, not this document or release assets.

## Official references

- [Publishing a plugin](https://plugins.jetbrains.com/docs/intellij/publishing-plugin.html)
- [First upload](https://plugins.jetbrains.com/docs/marketplace/uploading-a-new-plugin.html)
- [Vendor profiles](https://plugins.jetbrains.com/docs/marketplace/organizations.html)
- [Trader declaration](https://plugins.jetbrains.com/docs/marketplace/trader-status.html)
- [Listing and media](https://plugins.jetbrains.com/docs/marketplace/best-practices-for-listing.html)
- [Plugin signing](https://plugins.jetbrains.com/docs/intellij/plugin-signing.html)
