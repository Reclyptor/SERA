# Directory Structure Taxonomy

Load this reference during Step 1 (Inventory) to identify the structural type of each series.

| Type | Pattern | Example |
|------|---------|---------|
| **A** | `Series/Disc XX/files` | Cowboy Bebop, Neon Genesis Evangelion |
| **B** | `Series/Season XX/Disc XX/files` | Demon Slayer |
| **C** | `Series/Season XX/files` | Konosuba!, Peter Grill |
| **D** | `Series/files` (flat) | Movies, short OVAs |
| **E** | `Series/Movies/[Title]/files` | Shirobako, Demon Slayer |
| **F** | Mixed (Season dirs + non-Season subdir) | Demon Slayer (has `Movies/` alongside Season dirs) |

Type A series have no explicit season information. Treat as **Season 01** unless AniList indicates multiple seasons, in which case ask the user to clarify disc-to-season mapping.
