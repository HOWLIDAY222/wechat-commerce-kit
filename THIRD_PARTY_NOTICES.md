# Third-party notices

The repository's Apache-2.0 license covers its original project portions. The following third-party portions and installed dependencies keep their respective licenses and attribution. No ownership of third-party code, platform plugins, or dependencies is claimed.

## Bundled icon graphics

The native client's bundled icon files are derived from Lucide. The full upstream license and copyright notice are retained in [`apps/miniapp/assets/icons/lucide-LICENSE.txt`](apps/miniapp/assets/icons/lucide-LICENSE.txt).

## Uiverse adaptations

Native button feedback, selection and loading adaptations include Uiverse-origin material. The full MIT permission text, author names and original links are retained in [`apps/miniapp/THIRD_PARTY_NOTICES.txt`](apps/miniapp/THIRD_PARTY_NOTICES.txt).

## Installed dependencies

The web dependency inventory, produced from the locked installation, is in [`docs/dependency-licenses.json`](docs/dependency-licenses.json). It records package names, versions, declared licenses and available upstream links. It is an inventory, not a determination that every possible deployment or redistribution satisfies every license.

The native test harness also uses TypeScript under Apache-2.0, installed through its own lockfile. Source code imports Next.js, React, Prisma, PostgreSQL adapters, Zod, Lucide, Sharp and other packages under their respective licenses. Unmodified dependencies and native binaries are installed by the package manager rather than vendored here. In particular, Sharp's native libvips distribution has LGPL-related notices; retain its bundled licenses when distributing an installed application or container image.

## Platform services

WeChat, WeChat Pay, WeCom, SMS and email providers are external services. Public plugin identifiers and integration examples do not grant service access, transfer a merchant account, or relicense provider software. Deployers must obtain their own access and follow the relevant provider terms.

## Community graphics

The placeholder product graphics, share-card graphics and neutral wordmark are generated from the geometric SVG source in `scripts/generate-demo-assets.mjs`. They contain no commercial photographs or copied brand marks. The inventory of generated paths is in `examples/demo-assets.json`.
