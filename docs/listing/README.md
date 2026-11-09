# Release listing materials

All listing copy is in English. Nothing in this directory publishes an extension
to a marketplace automatically.

| Destination | Prepared material |
| --- | --- |
| VS Code Marketplace / Open VSX | The root `README.md` is the packaged details page. `marketplace.md` is a compact, reusable listing description. |
| JetBrains Marketplace | `jetbrains.html` is the native description, embedded into plugin.xml during the native build. It explicitly labels native support experimental. |
| Source | https://github.com/webobscure/filebridge |
| Support | https://github.com/webobscure/filebridge/issues/new/choose |
| Upgrade instructions | `docs/UPGRADING.md` |
| Supported behavior and limits | `docs/LIMITATIONS.md` |

## Media

All screenshots and the video show genuine FileBridge behavior in a disposable
VS Code Extension Development Host connected to a loopback FTP fixture. They
contain no real customer connection details. They are not PhpStorm screenshots.

- `docs/media/03-edit.png`: an opened remote PHP file.
- `docs/media/05-saved.png`: edited text after a successful server save.
- `docs/media/07-search-result.png`: remote search and navigation to an unopened file.
- `docs/media/filebridge-demo.mp4`: a roughly 15-second window recording of
  connecting, browsing, opening, editing, and saving. H.264, 1920×1200, silent,
  with an English subtitle track.
- `docs/media/filebridge-demo.gif`: lightweight animated preview.
- `docs/media/filebridge-demo.en.srt`: English captions as a separate text file.

Server contents were checked after both the screenshot save and the video save.
The MP4 is assembled from timestamped captures of the actual demo window; its
effective capture frame rate is low, while the encoded video plays at 30 fps.
No UI screenshots are generated illustrations or mockups.

The native plugin does not yet have an independently validated IDE UI recording.
Use the prepared native text and compatibility information without presenting
the VS Code captures as PhpStorm UI.

## Reproduce a demonstration

Run `npm run build`, then `node scripts/start-demo.cjs` on macOS with the fixture
Python environment installed. It opens an isolated editor and loopback FTP
server. For another executable, set `REMOTER_TEST_EXECUTABLE`. Close that demo
editor when finished. Capture only its window. Use `scripts/render-demo.py`
with timestamped capture metadata to encode MP4/GIF with FFmpeg.
