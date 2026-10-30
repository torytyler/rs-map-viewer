# RuneScape Map Viewer

> **Fork notice.** This fork is the engine behind the *RuneScape World* macOS
> screen saver: **[torytyler/osrs-map-screensaver](https://github.com/torytyler/osrs-map-screensaver)**.
> Everything added here is opt-in via `?ambient=1` and lives in [`src/ambient/`](src/ambient) —
> an ambient camera director (zone rotation, flights, NPC following, era switching).
> Without the `ambient` parameter the viewer behaves exactly like upstream.

[Website](https://osrs.world) | [Discord](https://discord.gg/WfEWPE5wUd)

A webapp for exploring current and historical versions of RuneScape.

<img src="screenshots/lumbridge.png" alt="Lumbridge">

## Running locally

```
$ git clone https://github.com/dennisdev/rs-map-viewer.git
$ cd rs-map-viewer
$ yarn install
$ yarn run download-caches
$ yarn start
```

## Credits

-   Jagex
-   [RuneLite](https://github.com/runelite/runelite)
-   [OpenRS2 Archive](https://archive.openrs2.org/) - Caches
-   [RuneScape Archive](https://rs-archive.github.io/) - Caches
-   [OSRS Wiki](https://oldschool.runescape.wiki/) - Item spawns
-   [2004scape](https://github.com/2004scape/Server) - Npc spawns
-   [2009scape](https://gitlab.com/2009scape/2009scape) - Npc spawns
-   [RuneStar](https://github.com/RuneStar/fonts) - Fonts
-   [Blurite](https://github.com/blurite/pathfinder) - Some pathfinding stuff
-   [RuneApps Model Viewer](https://github.com/skillbert/rsmv) - Some procedural texture stuff
