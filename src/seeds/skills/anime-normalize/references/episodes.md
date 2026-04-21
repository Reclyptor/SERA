# Episode Data Sources

Load this reference during Steps 3-4 (Fetch Episode Data, Build Rename Plan).

## AniList GraphQL API (Primary)

Endpoint: `https://graphql.anilist.co` — no API key required.

**Query strategy:**
- Use `Media` query with `search` + `type: ANIME` to find the series
- Retrieve `episodes`, `title { english romaji }`, and `streamingEpisodes { title }`
- If `streamingEpisodes` returns only generic titles ("Episode 1", "Episode 2"), fall back to Jikan

**Season mapping:** AniList splits franchises into separate media entries (each cour, movies as separate entries). This does not map 1:1 to Plex seasons. When querying:
1. Search by series name for the canonical entry
2. For multi-season series, query each season separately by name (e.g., "Konosuba Season 2")
3. Map AniList episodes to the disc-derived season number — the directory structure is ground truth
4. Flag any mismatch between AniList episode count and ripped episode tracks for user review

**Movie titles:** Use `title { english }` from the movie's own AniList media entry. `S99EXX` order is chronological release order, starting at `01`.

**Series name discrepancy:** If AniList English title differs from the directory name, ask the user which to use before building the rename plan.

## Fallback Chain

If AniList episode titles are generic or missing:

1. **Jikan API (MyAnimeList)** — `https://api.jikan.moe/v4/`, no auth. Search by title for MAL ID, then `/anime/{id}/episodes`
2. **AniDB** — if Jikan also lacks titles
3. **Wikipedia** — series episode list tables as last resort
4. If no source provides titles, omit episode names entirely — never use generic placeholders

## Episode Number Assignment

Within a season, discs sorted by disc number (ascending), tracks sorted by track number (ascending). Episode-classified tracks assigned sequentially:

```
Season 01:
  Disc 01: t00->E01, t01->E02, t02->E03   [t03=mega->Extras, t04=small->Extras]
  Disc 02: t00->E04, t01->E05, t02->E06   [...]
  Disc 03: t00->E07, ...
```

## Validation

Compare assigned episode count against AniList total. On mismatch, flag for user review:
- OVA/specials on disc not counted by AniList
- Recap episodes not listed separately
- AniList splits the series across multiple entries (cour 1 vs cour 2)

## No Individual Episode Tracks

Some discs contain only a mega-track and no individual episode-sized files. Flag for user review — the mega-track cannot be automatically split.
