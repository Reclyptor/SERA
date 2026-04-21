---
name: anime-normalize
description: >
  Processes raw MakeMKV Blu-ray rips into a Plex-compatible anime library.
  Classifies tracks, fetches episode metadata from AniList, builds rename plans,
  and updates MKV segment titles. Use when handling anime, plex, makemkv,
  rename, episode, bluray, series, or anilist tasks.
compatibility: Requires mkvtoolnix (mkvinfo, mkvpropedit) and network access for AniList/Jikan APIs
allowed-tools: shell execute_code
metadata:
  default-source: /data/nfs/dxp6800/_pending/anime/
  default-output: /data/nfs/dxp6800/_pending/anime/_processed/
---

## Configuration

This skill uses two directory paths:

| Variable | Default | Description |
|---|---|---|
| `ANIME_SOURCE_DIR` | `{{default-source}}` | Root directory containing raw MakeMKV rips |
| `ANIME_OUTPUT_DIR` | `{{default-output}}` | Destination for processed output |

Resolution order: environment variable -> default above -> error.

**Before starting:** If the effective paths come from frontmatter defaults, or the user mentioned a specific path in their request, confirm both paths with the user before proceeding.

## Goals

Rename raw MakeMKV Blu-ray rips to Plex-compatible filenames and flatten the disc-based directory structure into a clean season-based hierarchy.

**Source tree** (`$ANIME_SOURCE_DIR`):
```
Series Name/
├── Season 01/
│   └── Disc 01/ ...
└── ...
```

**Output tree** (`$ANIME_OUTPUT_DIR`):
```
Series Name/
├── Season 01/
│   ├── Series Name - S01E01 - Episode Name.mkv
│   └── ...
├── Movies/
│   ├── Series Name - Movie Name (Year) - S99E01.mkv
│   └── ...
└── Extras/
    └── (original filenames, subdirectory structure preserved)
```

**Absolute constraint:** No file is moved or renamed without explicit human approval of a presented plan.

## Output Naming Convention

### TV Episodes
```
Series Name - SXXEXX - Episode Name.mkv
```
- Zero-padded to 2 digits (`S01E01`)
- Episode names from AniList, with Jikan/AniDB/Wikipedia as fallbacks (load `references/episodes.md` for API details)
- If no source provides titles, omit the episode name entirely -- never use generic placeholders
- OVAs: append ` (OVA)` before `.mkv`
- Illegal characters: `:` -> ` - `, `?` -> full-width `?`, `/ * " < > | \` -> removed

### Movies
```
Series Name - Movie Title (Year) - S99EXX.mkv
```
Placed under `Movies/`. `S99` is the sentinel season, `XX` is release order. Same character substitution rules apply.

### Extras
Original filenames preserved under `Extras/` with original subdirectory structure.

## Workflow

Process one series at a time. Load the relevant reference for each step using `skills` with `read_skill_file`.

1. **Inventory** -- Scan the series directory under `$ANIME_SOURCE_DIR`, build track list with file sizes, identify structural type. Load `references/taxonomy.md` for type definitions (A-F)
2. **Classify Tracks** -- Apply size-based heuristics to classify each track. Load `references/classification.md` for heuristics. Verify counts computationally via shell commands -- never count by hand
3. **Fetch Episode Data** -- Query AniList GraphQL API by series name. Load `references/episodes.md` for API endpoints, query strategy, and fallback chain
4. **Build Rename Plan** -- Map episode candidates to sequential episode numbers across discs. Produce a full SOURCE -> DESTINATION table with flagged issues. Load `references/edges.md` if anomalies encountered
5. **Human Approval** -- Present the plan. No files touched until approval is given
6. **Execute** -- Create target directories under `$ANIME_OUTPUT_DIR`, pre-validate filenames with `touch`, then move files using the appropriate filesystem strategy (see below)
7. **Update MKV Metadata** -- Set segment titles via `mkvpropedit`. TV episodes/extras get the series name; movies get the full movie title with year. Only rewrite files whose title does not already match
8. **Verify** -- Confirm file counts match plan, verify metadata on all files, remove empty source directories

## Filesystem Strategy

Before executing moves, determine whether source and output share a filesystem:

```sh
SRC_DEV=$(stat -c %d -- "$ANIME_SOURCE_DIR")
OUT_DEV=$(stat -c %d -- "$ANIME_OUTPUT_DIR")
if [ "$SRC_DEV" = "$OUT_DEV" ]; then
    STRATEGY=mv
else
    STRATEGY=copy
fi
```

- **Same filesystem (`mv`):** Instant metadata operation, no data copied
- **Cross filesystem (`cp -a && rm`):** Check for partial destination files from interrupted copies before re-running. Only remove source after verifying destination integrity

## Out of Scope

- Transcoding or re-encoding
- Splitting combined/mega-track files
- Fetching artwork, subtitles, or NFO files
- Processing files already in a Plex library
