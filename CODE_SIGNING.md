# ClipCat code signing policy

Last updated: 2026-10-13.

This policy describes the current build and signing configuration in the official
ClipCat repository. ClipCat uses Tauri updater signatures. The current release
workflow does not apply Windows Authenticode signatures.

## Official source and releases

ClipCat source is maintained in [catninth/clipcat](https://github.com/catninth/clipcat).
Published packages are available from its
[GitHub Releases page](https://github.com/catninth/clipcat/releases).

The [`release` workflow](.github/workflows/release.yml) builds Windows and Linux
artifacts from the checked-out repository revision on GitHub-hosted runners.
Windows builds produce an NSIS installer; Linux builds produce AppImage, deb and
rpm packages. The workflow runs the configured frontend and native checks, collects
packages and signatures, writes `latest.json`, and attaches them to a GitHub release.
Stable releases are manually dispatched with the `publish` input enabled. A daily
scheduled run can publish a rolling `nightly` prerelease; the in-app updater follows
stable releases and ignores nightly prereleases.

The Windows build includes prebuilt upstream OBS and FFmpeg components downloaded
and hash-checked by [`bundle-obs.ps1`](bundle-obs.ps1). Those binaries are not built
from ClipCat source. The package signature covers the resulting installer bytes;
it does not make the upstream components ClipCat-authored software or replace their
licenses. See the [license information](README.md#license).

## Current package signatures

The release workflow expects the repository secrets `TAURI_SIGNING_PRIVATE_KEY`
and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` for Tauri's Minisign package signatures.
The corresponding public key is configured in
[`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json).

Each updater package has a `.sig` file. `latest.json` carries package URLs and these
signatures; the manifest itself is not separately signed by this workflow. Before
installation, the updater verifies the downloaded package against the configured
public key. This checks possession of the matching signing key and the integrity
of the package. It is not a certificate-based verification of a person's or
organization's identity, and it is not a malware or security review.

The current configuration does not perform Windows Authenticode signing for the
ClipCat executable or installer. Minisign signatures are used by ClipCat's updater;
they do not provide a Windows-verified publisher or remove SmartScreen warnings.
The bundle's `publisher` metadata (`Cat Ninth`) is a product label, not a signing
certificate. A bundled third-party file may have its own upstream signature.

## Responsibilities and release approval

Repository maintainers are responsible for changes to source, build scripts,
dependency pins, release configuration, and access to the updater signing key.
Contributors submit changes through the repository's normal contribution process.
People with the necessary GitHub repository permissions can dispatch a stable
release; scheduled nightly releases run automatically.

The checked-in release workflow does not configure a separate human approval for
each signing operation. This document does not assert that branch protection,
multi-factor authentication, environment approvals, or particular secret-access
settings have been independently verified. Signing is performed when the workflow
runs with the required secrets; maintainers should review the selected revision
and changes before publishing a stable release.

Keep private keys and passwords out of source control and logs. Changes to the
public key must account for already-installed applications that still trust the
old key; replacing a key in the repository alone does not update those installations.

If Authenticode signing is introduced, update this policy to describe the actual
provider, signing identity, covered files, and approval process. Sign the final
Windows package before generating its Minisign signature and updater manifest;
modifying package bytes afterward invalidates the updater signature.

For application data handling, see the [privacy notice](PRIVACY.md).
