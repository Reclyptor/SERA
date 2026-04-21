# Edge Cases

Load this reference when encountering anomalies during any workflow step.

## Missing Seasons

**Demon Slayer:** Directory has `Season 02`, `Season 03`, `Season 04`, and `Movies/` only. Season 01 rip absent. Skip and note as pending.

**Shirobako:** Contains only `Movies/Shirobako - The Movie/`. TV rips absent. Process the movie only, note TV as pending.

## Type A Series (No Season Directories)

Discs directly under the series root with no `Season XX/` parent. Treat as Season 01. If AniList shows multiple seasons, ask the user to map disc ranges before proceeding.

## Movie Folders Within TV Series

**Demon Slayer example:** `Movies/Demon Slayer- Mugen Train_t00.mkv` (22 GB main feature) and `_t01.mkv` (198 MB extra). Main feature becomes `Demon Slayer - S99E01 - Mugen Train.mkv` in `$ANIME_OUTPUT_DIR/Demon Slayer/Movies/`. Extra moves to `$ANIME_OUTPUT_DIR/Demon Slayer/Extras/Movies/`.

## No Individual Episode Tracks

**Konosuba example:** Season 01 has only one track at ~664 MB and one at ~38 GB. No individual episode-sized files. Flag for user:
- Skip (handle manually)
- Treat the largest file as a single-file season (unlikely to work in Plex)

## Extras-Only Discs

**Cowboy Bebop Disc 04:** Largest files are 21 GB and 15 GB mega-tracks; remaining files under 1.2 GB. No episode-sized tracks. Classify as a bonus disc, move all contents to `$ANIME_OUTPUT_DIR/Cowboy Bebop/Extras/Disc 04/`.

## File Naming Collisions

Before any move, check whether the target path already exists. If a file is already at the destination, halt the operation and notify the user.
