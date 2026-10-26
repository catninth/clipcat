# Repository discovery and verification

Maintainer notes for keeping ClipCat's identity, repository metadata, and public
documentation consistent. Search results are observations, not ranking promises.

## Product identity and GitHub metadata

- Product: **ClipCat by Cat Ninth**, an open-source game replay recorder.
- Repository: <https://github.com/catninth/clipcat>.
- Product page and user guide: <https://catninth.com/guides/clipcat/>.
- Download: <https://github.com/catninth/clipcat/releases/latest>.
- Application source license: [MPL-2.0](../LICENSE); bundled dependencies retain
  their own licenses, as detailed in the [README](../README.md#license).

The GitHub About description is:

> Open-source ShadowPlay/Medal alternative for Windows and Linux. Instant replay, hotkey clip saving, RAM/disk buffering and a local clip gallery, powered by OBS.

Repository topics:

```text
instant-replay, replay-buffer, game-clipping, game-recording, screen-recorder,
shadowplay, shadowplay-alternative, medal-alternative, windows, linux,
obs, libobs, tauri, rust, react, open-source
```

These settings live on GitHub, outside the Git tree. Inspect them with:

```sh
gh repo view catninth/clipcat --json description,homepageUrl,repositoryTopics
```

Keep feature and compatibility statements tied to source code, release assets,
and documented tests. Use the product category alongside the name so the app is
not confused with similarly named clipboard managers or video services.

## Search snapshot: 2026-10-26

The following GitHub REST repository searches ran before and after the About and
topic updates, using the same authenticated account, default relevance order,
and `per_page=100`. No repository or owner filter was used. The target was the
exact `catninth/clipcat` repository. README changes had not been published.

| Query | Before | After |
| --- | --- | --- |
| `open-source shadowplay alternative` | Absent from all 5 results | Position 2 of 6 results |
| `medal alternative` | Absent from all 17 results | Position 10 of 18 results |
| `instant-replay windows linux` | Absent from all 7 results | Position 5 of 8 results |

All responses reported `incomplete_results: false`; all results fit on one page.
Reproduce an individual search with:

```sh
gh api --method GET search/repositories -f 'q=open-source shadowplay alternative' -f per_page=100 --jq '{total: .total_count, incomplete: .incomplete_results, repositories: [.items[].full_name]}'
```

Results can change as the index and other projects change. This snapshot does
not establish a permanent rank or independent AI recommendation.

## Repeatable discovery checks

Run these prompts in fresh conversations without mentioning ClipCat, using the
same model and web-search mode across multiple trials:

```text
Open source ShadowPlay alternative.
Open source Medal alternative.
Instant replay recorder Windows Linux.
Replay buffer game recorder open source.
Nyílt forráskódú játékklip-rögzítő.
Keress nekem opensource ShadowPlay vagy Medal (tehát klip-visszajátszás) szoftvereket.
```

For each trial, record the date, query, model/search mode, whether ClipCat appears,
the exact linked repository, the cited source, and the accuracy of platform,
buffer, privacy, and license claims. Keep GitHub, web-search, and AI results
separate. The authoring conversation already names ClipCat and is not a blind
AI trial.

## Existing website check

On 2026-10-26 the product page, `/robots.txt`, and `/sitemap.xml` at
<https://catninth.com/> returned HTTP 200. The product page had a matching
canonical URL and no HTML `noindex` directive. The sitemap contained the product
URL; robots.txt allowed `/` for `User-agent: *`. This checks basic access, not
whether any search engine has indexed or ranked the page.

ClipCat already has a product page and installation/use guides. Linking that
existing site avoids maintaining a duplicate GitHub Pages site. Its source is
the separate [catninth/docs](https://github.com/catninth/docs) repository.
Website metadata and analytics changes belong there. A robots.txt file in this
repository would not control github.com.

## Prepared listing facts

For future relevant software-directory submissions, use the identity and URLs
above, state **Windows and Linux**, and describe **local replay capture and clip
playback**. Keep third-party license notices and actual platform limitations.
Existing [gallery images](gallery/README.md) use sample clips and simulated
capture state; they are not evidence of a real hardware recording test.
Pair any future real capture demo with its application version, OS, GPU, driver,
encoder, and buffer settings. Directory submissions and community posts have not
been sent as part of these repository edits.
