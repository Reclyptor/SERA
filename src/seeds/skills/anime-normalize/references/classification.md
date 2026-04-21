# Track Classification

Load this reference during Step 2 (Classify Tracks). All rips are full-quality MakeMKV Blu-ray rips. File size is the primary discriminator.

## Episode Tracks

Episodes are the largest files on a disc after excluding mega-tracks. For full BD anime rips, they form a tight cluster at the top of the size distribution (~3-5 GB each).

**Method:**
1. Exclude mega-tracks first (see below)
2. Take the largest remaining file as the reference size
3. Files >= 50% of that reference size are episode candidates

Example: reference = 4.9 GB, threshold = 2.45 GB. Any file >= 2.45 GB is an episode candidate. This handles discs where extras outnumber episodes (a median-based approach would fail).

## Combined/Playlist Mega-Tracks

Single file significantly larger than any individual episode (typically >= 2x the sum of 2-3 episode files; observed range: 15-40 GB). These are MakeMKV "full disc" playlist tracks, redundant with individual episodes.

- Move to `Extras/`, do NOT assign an episode number
- **Exception:** For standalone movie entries (Type D), the largest file IS the movie

## Movie Tracks

Classified as the main feature when:
- Largest file in a disc/directory with a movie-style name (`- The Movie`, `Part X`, etc.), **or**
- Single dominant file in a flat (Type D) directory with no episode-sized sequence

Main feature goes to `Movies/` with the movie naming convention. All other tracks on the same disc are extras.

**Multi-movie series** (Evangelion films, Berserk Golden Age Arc): each main feature gets the next sequential `S99EXX` number in release order, confirmed against AniList.

## OVA Episodes

OVA tracks bundled on a TV series disc are numbered sequentially after the last official episode of the season. Placed in the same `Season XX/` directory.

- Append ` (OVA)` before `.mkv`: `Series Name - SXXEXX - Episode Title (OVA).mkv`
- Episode number follows the last official episode (e.g., 12 official episodes -> first OVA is E13)
- Multi-part OVAs: each part gets its own sequential number with part label in the title
- Title source: same AniList/Jikan fallback chain as regular episodes

## Extras

Everything not classified as episode, OVA, or main movie feature:
- Files < ~500 MB on an episode disc (creditless OP/ED, trailers, PVs, previews)
- Combined mega-tracks
- All tracks on a disc with no episode-sized files (bonus disc)
- Non-main-feature tracks on a movie disc

**TV extras:** `$ANIME_OUTPUT_DIR/Series/Extras/` preserving original directory structure and filenames.

**Movie extras:** `$ANIME_OUTPUT_DIR/Series/Extras/Movies/Movie Title/` preserving structure beneath the movie title folder. Isolates each movie's extras to prevent collisions.
