# Release procedure

## Prepare a version

1. Update the VS Code extension version with `npm version VERSION --no-git-tag-version`.
2. Add the matching section to `CHANGELOG.md`. Keep the user-facing install
   instructions current. If the native plugin changed, update its version in
   `jetbrains/src/main/resources/META-INF/plugin.xml` and native documentation.
   Its version is independent of the VS Code extension's version.
3. Commit the changes on a `feature/...` or `fix/...` branch and push. Wait for
   **CI**, including all four Windows/Linux/editor-version combinations, to pass.
   Run the macOS suite locally or opt into hosted macOS checks manually.
4. Test a release candidate against a disposable account on a real hosting
   server. Check connection setup, search, save, reconnect, and a failed save.
   Review the native plugin UI/save behavior in a licensed PhpStorm separately.

The existing legacy helper versions intentionally stay 0.3.2 and 0.4.1; they
replace earlier extension identities and are not the main release version.

## Build locally

After installing the prerequisites described in `CONTRIBUTING.md`:

```sh
npm ci
npm run check
npm test
npm run package
npm run package:migration
python3 jetbrains/build.py
npm run release:collect
```

`release/` contains the current main VSIX, both one-time migration helpers, the
native ZIP, `SHA256SUMS`, and `build-info.json` with package versions and the
source commit. Verify downloaded files with `sha256sum -c SHA256SUMS` on Linux
or `shasum -a 256 -c SHA256SUMS` on macOS. Generated packages are not committed.

## Publish a GitHub release automatically

Create a `vVERSION` tag matching `package.json`, on the reviewed commit, and
push that tag. For example, for version 0.6.1:

```sh
git tag v0.6.1
git push origin v0.6.1
```

The **Release** workflow validates the tag and changelog, reruns the complete
CI pipeline, assembles the files, verifies their checksums, and **publishes** a
GitHub Release with those files attached. Stable versions are marked Latest
and appear in the repository's Releases sidebar. Tags containing a prerelease
suffix (for example `v0.7.0-beta.1`) create prereleases instead.

The public download includes the main VSIX, both migration helpers, the
experimental PhpStorm ZIP, checksums, and build information. Release notes come
from that version's `CHANGELOG.md` section. A failed validation, test, build, or
checksum check prevents publication. Ordinary branch pushes do not publish a
release; pushing the version tag is the release action.

Review the version and changelog before pushing its tag. Marketplace and Open
VSX publishing require their own publisher credentials and remain separate
actions.

Before the first registry release, complete the account and ownership checks in
[Publisher setup](docs/PUBLISHING.md).

## Compatibility claims

A passing CI job establishes the recorded OS, editor version, and architecture
for the automated scenarios. It does not establish all OS/architecture variants
or every FTP hosting implementation. Cursor is checked with the local installed
application; the hosted matrix uses VS Code. The PhpStorm transport suite and
Plugin Verifier do not establish that native editor UI/save behavior passed.
